// The compiled helper, run the way the dashboard bridge runs it: `node helper.cjs ACTION
// BASE64-JSON`, one JSON line on stdout, exit code 1 on errors. Its state lives in a temporary
// OWN_TV_DATA directory and Glasshouse is a fake on 127.0.0.1. Nothing here calls luna, the
// network or a TV: weather, radar and calendar data come from fresh caches, and actions that
// would reach luna-send or a provider are only exercised up to their validation.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { type TestContext, test } from 'node:test';
import { field, find, list, readJson, record } from './json.cjs';
import { BUILD } from './paths.cjs';

const HELPER = path.join(BUILD, 'native/helper.cjs');
const TOKEN = 'glasshouse-test-token';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Tv {
  /** OWN_TV_DATA; does not exist until the helper creates it. */
  readonly data: string;
  /** OWN_TV_GLASSHOUSE_CONFIG; absent unless a fake Glasshouse is running. */
  readonly glasshouse: string;
}

interface Result {
  readonly code: number;
  readonly stdout: string;
  readonly reply: unknown;
}

interface Request {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

interface Reply {
  readonly status?: number;
  readonly type?: string;
  readonly body: unknown;
  /** Never answer. */
  readonly hang?: true;
}

function fakeTv(t: TestContext): Tv {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'own-tv-helper-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { data: path.join(root, 'state'), glasshouse: path.join(root, 'tvweb-config.json') };
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64');
}

/** Runs the compiled helper with raw command-line arguments. */
function runRaw(tv: Tv, args: readonly string[]): Promise<Result> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [HELPER, ...args],
      {
        env: { ...process.env, OWN_TV_DATA: tv.data, OWN_TV_GLASSHOUSE_CONFIG: tv.glasshouse },
        timeout: 20000,
      },
      (error, stdout) => {
        const code = error ? error.code : 0;
        if (typeof code !== 'number') {
          reject(error ?? new Error('The helper did not exit'));
          return;
        }
        assert.match(stdout, /^[^\n]+\n$/, 'one JSON line on stdout');
        resolve({ code, stdout, reply: JSON.parse(stdout) });
      },
    );
  });
}

function run(tv: Tv, action: string, argument?: unknown): Promise<Result> {
  return runRaw(tv, argument === undefined ? [action] : [action, encode(argument)]);
}

/** Runs an action that must succeed, returning its reply. */
async function ok(tv: Tv, action: string, argument?: unknown): Promise<unknown> {
  const result = await run(tv, action, argument);
  assert.equal(result.code, 0, result.stdout);
  return result.reply;
}

/** Runs an action that must fail with `error`. */
async function fails(tv: Tv, action: string, argument: unknown, error: string): Promise<void> {
  const result = await run(tv, action, argument);
  assert.equal(result.code, 1, result.stdout);
  assert.deepEqual(result.reply, { ok: false, error });
}

function file(tv: Tv, name: string): string {
  return path.join(tv.data, name);
}

function readState(tv: Tv, name: string): unknown {
  return readJson(fs.readFileSync(file(tv, name), 'utf8'));
}

function seed(tv: Tv, name: string, value: unknown): void {
  fs.mkdirSync(tv.data, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file(tv, name), JSON.stringify(value));
}

function mode(p: string): number {
  return fs.statSync(p).mode & 0o777;
}

/**
 * A Glasshouse that answers from `table` and records requests. Keys are "METHOD /path?query"
 * or, for any query, "METHOD /path".
 */
async function glasshouse(
  t: TestContext,
  tv: Tv,
  table: Map<string, Reply>,
  token = TOKEN,
): Promise<Request[]> {
  const requests: Request[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (b: Buffer) => {
      raw += b.toString();
    });
    req.on('end', () => {
      const url = req.url ?? '';
      const method = req.method ?? '';
      requests.push({
        method,
        url,
        authorization: req.headers.authorization,
        body: raw ? JSON.parse(raw) : undefined,
      });
      const route =
        table.get(`${method} ${url}`) ?? table.get(`${method} ${url.split('?')[0] ?? ''}`);
      const authorized = req.headers.authorization === `Bearer ${TOKEN}`;
      const reply: Reply = authorized
        ? (route ?? { status: 404, body: { ok: false, error: 'Not found' } })
        : { status: 401, body: { ok: false, error: 'Unauthorized' } };
      if (reply.hang) {
        return;
      }
      const body = Buffer.isBuffer(reply.body) ? reply.body : JSON.stringify(reply.body);
      res.writeHead(reply.status ?? 200, { 'Content-Type': reply.type ?? 'application/json' });
      res.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  fs.writeFileSync(tv.glasshouse, JSON.stringify({ port: address.port, token }));
  return requests;
}

function statsBody(model = 'OLED55B4.AEU'): Readonly<Record<string, unknown>> {
  return {
    device: { model },
    system: { firmware: '33.10.50', webos: '9.0' },
    oled: {
      panel_usage_units: 12,
      panel_hours_exact: 1234.5,
      comp_cycles: 3,
      refresher_cycles: 1,
    },
    temp: 41,
    uptime: 3600,
    mem: { total: 1000, available: 250 },
    inputs: { hdmi1: 'HDMI 1', hdmi2: 'Console' },
    sleepTimer: '30',
    tvwebVersion: '1.2.3',
  };
}

function stats(model?: string): Reply {
  return { body: statsBody(model) };
}

const INSTALLED = [
  { id: 'netflix', title: 'Netflix', version: '5.1' },
  { id: 'youtube.leanback.v4', title: 'YouTube', version: '1.0' },
  { id: 'x;reboot', title: 'Shell-shaped' },
  { id: 'com.example.untitled', version: '1' },
  { id: 'com.example.big', title: 'Big icon', version: '1' },
];

/** The Glasshouse API of a non-C5 TV: every model-gated action stops before luna. */
function routes(): Map<string, Reply> {
  return new Map<string, Reply>([
    ['GET /api/stats', stats()],
    ['GET /api/apps', { body: { installed: INSTALLED } }],
    ['GET /api/home/recents', { body: { apps: [{ id: 'netflix', title: 'Netflix', at: 1 }] } }],
    ['GET /api/privacy', { body: { simple: { total: 0 }, adblock: { mode: 'ads' } } }],
    [
      'GET /api/hdmi',
      {
        body: {
          inputs: [
            { id: 'com.webos.app.hdmi1', connected: true },
            { appId: 'com.webos.app.hdmi2', connected: 'yes' },
          ],
        },
      },
    ],
    ['GET /api/apps/icon', { type: 'image/png', body: PNG }],
    ['POST /api/control', { body: { ok: true, done: true } }],
  ]);
}

/** An Open-Meteo forecast for "now", as the weather cache stores it. */
function forecast(now: number) {
  const hour = Math.floor(now / 3600000) * 3600;
  const day = Math.floor(now / 86400000) * 86400;
  return {
    current: {
      temperature_2m: 5,
      weather_code: 3,
      apparent_temperature: 2,
      relative_humidity_2m: 80,
      wind_speed_10m: 10,
      wind_direction_10m: 270,
      is_day: 1,
    },
    timezone: 'UTC',
    hourly: {
      time: [hour, hour + 3600, hour + 7200],
      temperature_2m: [5, 6, 7],
      weather_code: [3, 3, 61],
    },
    daily: {
      time: [day, day + 86400, day + 2 * 86400],
      sunrise: [day + 25000, day + 86400 + 25000, day + 2 * 86400 + 25000],
      sunset: [day + 60000, day + 86400 + 60000, day + 2 * 86400 + 60000],
      temperature_2m_max: [8, 9, 10],
      temperature_2m_min: [1, 2, 3],
    },
  };
}

/** Weather and a calendar whose caches are fresh, so no provider is contacted. */
function seedIntegrations(tv: Tv, now: number): void {
  const feedUrl = 'https://calendar.invalid/feed.ics';
  const start = new Date(now + 3600000).toISOString();
  const end = new Date(now + 7200000).toISOString();
  const key = createHash('sha256').update(`true\n${feedUrl}`).digest('hex');
  seed(tv, 'integrations.json', {
    weather: { latitude: 52.5, longitude: 13.4, label: 'Berlin' },
    calendar: { feedUrl, busyOnly: true },
  });
  seed(tv, 'weather-cache.json', { schema: 3, at: now, data: forecast(now) });
  seed(tv, 'calendar-cache.json', {
    schema: 2,
    entries: { [key]: { at: now, events: [{ title: 'Busy', start, end, allDay: false }] } },
  });
}

test('the command line answers one JSON line and exits 1 on bad requests', async (t) => {
  const tv = fakeTv(t);
  const none = await runRaw(tv, []);
  assert.equal(none.code, 1);
  assert.equal(none.stdout, '{"ok":false,"error":"Unknown command"}\n');
  const garbage = await runRaw(tv, ['state', Buffer.from('{not json').toString('base64')]);
  assert.equal(garbage.code, 1);
  assert.equal(garbage.stdout, '{"ok":false,"error":"Invalid request"}\n');
  await fails(tv, 'exec', 'reboot', 'Unknown command');
  // No state directory is created for refused requests
  assert.equal(fs.existsSync(tv.data), false);
});

test('requests are validated before anything is written or launched', async (t) => {
  const tv = fakeTv(t);
  await fails(tv, 'launch', 'x;reboot', 'Invalid app id');
  await fails(tv, 'launch', null, 'Invalid app id');
  await fails(tv, 'sleep', 7, 'Unsupported sleep duration');
  await fails(tv, 'sleep', '30', 'Unsupported sleep duration');
  await fails(tv, 'memoryMode', 'yes', 'Invalid memory mode');
  await fails(tv, 'directHome', 1, 'Choose whether Direct Home is enabled.');
  await fails(tv, 'weatherSource', 'https://attacker.invalid', 'Unknown weather source');
  await fails(tv, 'weatherSearch', 'x', 'Enter a city or town name (2–80 characters).');
  await fails(tv, 'radar', null, 'Configure weather first.');
  await fails(tv, 'configure', [1], 'Invalid integrations');
  await fails(
    tv,
    'configure',
    { weather: { latitude: 91, longitude: 0 } },
    'Invalid weather coordinates',
  );
  await fails(
    tv,
    'configure',
    { calendar: { feedUrl: 'http://calendar.example.com/feed.ics' } },
    'Use a public HTTPS calendar feed, without a login or custom port.',
  );
  await fails(tv, 'preferences', null, 'Invalid preferences');
  await fails(tv, 'preferences', [1], 'Invalid preferences');
  await fails(tv, 'preferences', { schema: 1, text: 'x'.repeat(65536) }, 'Invalid preferences');
  await fails(tv, 'preferences', { schema: 2 }, 'Unsupported preference schema');
  await fails(tv, 'calendarSource', { id: 'x' }, 'Choose a calendar and whether to show it.');
  await fails(
    tv,
    'calendarSource',
    { id: 'unknown', enabled: true },
    'Calendar no longer exists. Refresh and retry.',
  );
  await fails(
    tv,
    'calendarSource',
    { publicId: 'tb-nowhere', enabled: true },
    'Unknown public calendar.',
  );
  assert.equal(fs.existsSync(tv.data), false);
});

test('settings are written privately and each change keeps the other settings', async (t) => {
  const tv = fakeTv(t);
  const weather = { latitude: 52.5, longitude: 13.4, label: 'Berlin' };
  assert.deepEqual(await ok(tv, 'configure', { weather }), { ok: true });
  assert.equal(mode(tv.data), 0o700);
  assert.equal(mode(file(tv, 'integrations.json')), 0o600);
  assert.equal(fs.existsSync(file(tv, 'integrations.json.tmp')), false);
  assert.deepEqual(readState(tv, 'integrations.json'), { weather });

  seed(tv, 'calendar-cache.json', { schema: 2, entries: {} });
  seed(tv, 'weather-cache.json', { schema: 3, at: 0, data: {} });
  await ok(tv, 'configure', { calendar: { feedUrl: 'webcal://calendar.example.com/feed.ics' } });
  assert.deepEqual(readState(tv, 'integrations.json'), {
    weather,
    calendar: { feedUrl: 'https://calendar.example.com/feed.ics', busyOnly: true },
  });
  // Only the cache of the changed integration is dropped
  assert.equal(fs.existsSync(file(tv, 'calendar-cache.json')), false);
  assert.equal(fs.existsSync(file(tv, 'weather-cache.json')), true);

  await ok(tv, 'calendarSource', { publicId: 'tb-germany', enabled: true });
  const catalogue = await ok(tv, 'calendarCatalog');
  assert.equal(field(find(field(catalogue, 'calendars'), 'id', 'tb-germany'), 'selected'), true);
  assert.equal(field(find(field(catalogue, 'calendars'), 'id', 'tb-france'), 'selected'), false);
  assert.ok(!JSON.stringify(catalogue).includes('calendar.example.com'));
  assert.deepEqual(field(readState(tv, 'integrations.json'), 'weather'), weather);
  assert.equal(list(field(readState(tv, 'integrations.json'), 'calendar', 'feeds')).length, 2);

  assert.deepEqual(await ok(tv, 'weather', { latitude: 1.5, longitude: -2 }), { ok: true });
  assert.deepEqual(field(readState(tv, 'integrations.json'), 'weather'), {
    latitude: 1.5,
    longitude: -2,
    label: 'Local weather',
  });
  assert.equal(fs.existsSync(file(tv, 'weather-cache.json')), false);
  assert.equal(list(field(readState(tv, 'integrations.json'), 'calendar', 'feeds')).length, 2);

  await ok(tv, 'configure', { weather: null });
  assert.equal(field(readState(tv, 'integrations.json'), 'weather'), undefined);
  assert.equal(list(field(readState(tv, 'integrations.json'), 'calendar', 'feeds')).length, 2);
  assert.deepEqual(await ok(tv, 'weatherDetails'), { configured: false });
  await ok(tv, 'configure', { calendar: null });
  assert.deepEqual(readState(tv, 'integrations.json'), {});

  const preferences = { schema: 1, theme: 'dark', order: ['netflix'] };
  const saved = await ok(tv, 'preferences', preferences);
  assert.deepEqual(readState(tv, 'preferences.json'), preferences);
  assert.equal(mode(file(tv, 'preferences.json')), 0o600);
  assert.equal(field(saved, 'ok'), true);
  assert.equal(field(saved, 'revision'), fs.statSync(file(tv, 'preferences.json')).mtimeMs);
});

test('Direct Home actions are no-ops while it is off', async (t) => {
  const tv = fakeTv(t);
  assert.deepEqual(await ok(tv, 'directHomeRecover'), { ok: true, enabled: false });
  assert.deepEqual(await ok(tv, 'homeRefresh'), { ok: true, refreshed: false });
});

test('weather details and radar are served from fresh caches', async (t) => {
  const tv = fakeTv(t);
  const now = Date.now();
  seedIntegrations(tv, now);
  const cache = fs.readFileSync(file(tv, 'weather-cache.json'), 'utf8');
  const details = await ok(tv, 'weatherDetails');
  assert.equal(field(details, 'configured'), true);
  assert.equal(field(details, 'city'), 'Berlin');
  assert.equal(field(details, 'condition'), 'Overcast');
  assert.equal(field(details, 'feelsLike'), 2);
  assert.equal(field(details, 'windDirection'), 270);
  assert.deepEqual(field(details, 'location'), { latitude: 52.5, longitude: 13.4 });
  assert.equal(field(details, 'hourly', 0, 'temperature'), 5);
  assert.equal(field(details, 'daily', 0, 'high'), 8);
  assert.equal(field(details, 'error'), undefined);
  // A cache hit is not rewritten
  assert.equal(fs.readFileSync(file(tv, 'weather-cache.json'), 'utf8'), cache);

  const frames = [{ time: 1700000000000, path: '/v2/radar/abc' }];
  seed(tv, 'radar-cache.json', {
    at: now,
    data: { host: 'https://tilecache.rainviewer.com', generated: 1700000000000, frames },
  });
  assert.deepEqual(await ok(tv, 'radar'), {
    host: 'https://tilecache.rainviewer.com',
    generated: 1700000000000,
    frames,
    location: { latitude: 52.5, longitude: 13.4 },
    city: 'Berlin',
  });
});

test('without Glasshouse, TV actions fail closed', async (t) => {
  const tv = fakeTv(t);
  await fails(tv, 'state', null, 'Install Glasshouse first.');
  await fails(tv, 'launch', 'netflix', 'Install Glasshouse first.');
  await fails(tv, 'screenOff', null, 'Install Glasshouse first.');
  await fails(tv, 'firmwareCheck', null, 'Install Glasshouse first.');
  // Setup creates the state directory; lgHome expects it
  fs.mkdirSync(tv.data, { mode: 0o700 });
  const before = Date.now();
  await fails(tv, 'lgHome', null, 'Install Glasshouse first.');
  // Stock Home is allowed for two minutes even when the launch fails
  const until = Number(fs.readFileSync(file(tv, 'allow-stock-until'), 'utf8'));
  assert.ok(until >= before + 120000 && until <= Date.now() + 120000);
  assert.equal(mode(file(tv, 'allow-stock-until')), 0o600);
});

test('state combines Glasshouse, the local caches and the settings, and caches slow lookups', async (t) => {
  const tv = fakeTv(t);
  const now = Date.now();
  seedIntegrations(tv, now);
  // An entry for a feed that has since been removed
  const cached = readState(tv, 'calendar-cache.json');
  seed(tv, 'calendar-cache.json', {
    schema: 2,
    entries: { ...record(field(cached, 'entries')), removed: { at: now, events: [] } },
  });
  seed(tv, 'performance.json', { enabled: true, before: {} });
  seed(tv, 'preferences.json', { schema: 1, theme: 'dark' });
  const table = routes();
  table.set('GET /api/apps/icon?id=youtube.leanback.v4', { status: 404, body: {} });
  table.set('GET /api/apps/icon?id=com.example.untitled', {
    type: 'text/html',
    body: Buffer.from('<html>'),
  });
  table.set('GET /api/apps/icon?id=com.example.big', {
    type: 'image/webp',
    body: Buffer.alloc(40000),
  });
  const requests = await glasshouse(t, tv, table);
  const state = await run(tv, 'state');
  assert.equal(state.code, 0, state.stdout);

  assert.deepEqual(field(state.reply, 'apps'), [
    { id: 'netflix', title: 'Netflix', icon: `data:image/png;base64,${PNG.toString('base64')}` },
    { id: 'youtube.leanback.v4', title: 'YouTube', icon: null },
    { id: 'com.example.untitled', title: 'com.example.untitled', icon: null },
    { id: 'com.example.big', title: 'Big icon', icon: null },
  ]);
  assert.deepEqual(field(state.reply, 'inputs'), [
    { id: 'com.webos.app.hdmi1', title: 'HDMI 1', connected: true },
    { id: 'com.webos.app.hdmi2', title: 'Console' },
  ]);
  assert.deepEqual(field(state.reply, 'recent'), [{ id: 'netflix', title: 'Netflix' }]);
  const health = field(state.reply, 'health');
  assert.equal(field(health, 'model'), 'OLED55B4.AEU');
  assert.equal(field(health, 'firmware'), '33.10.50');
  assert.equal(field(health, 'webos'), '9.0');
  assert.equal(field(health, 'panelHours'), 1234.5);
  assert.equal(field(health, 'panelCompensationCycles'), 3);
  assert.equal(field(health, 'panelRefresherCycles'), 1);
  assert.equal(field(health, 'temperature'), 41);
  assert.equal(field(health, 'uptimeSeconds'), 3600);
  // Whole-TV memory comes from /proc/meminfo
  assert.equal(typeof field(health, 'memoryUsedPercent'), 'number');
  assert.equal(typeof field(health, 'memoryTotalMB'), 'number');
  assert.equal(field(health, 'lowMemoryMode'), true);
  assert.equal(field(health, 'directHome'), false);
  assert.equal(field(health, 'directHomeFailure'), null);
  assert.equal(field(health, 'idleReleaseSupported'), false);
  assert.deepEqual(field(state.reply, 'privacy'), {
    trackingOff: true,
    adBlocking: true,
    summary: 'Privacy controls applied',
  });
  assert.deepEqual(field(state.reply, 'sleepTimer'), { minutesRemaining: 30 });
  assert.deepEqual(field(state.reply, 'preferences'), { schema: 1, theme: 'dark' });
  assert.equal(
    field(state.reply, 'preferencesRevision'),
    fs.statSync(file(tv, 'preferences.json')).mtimeMs,
  );
  assert.equal(field(state.reply, 'weather', 'city'), 'Berlin');
  assert.equal(field(state.reply, 'weather', 'temperature'), 5);
  assert.equal(field(state.reply, 'weather', 'hourly'), undefined);
  assert.equal(field(state.reply, 'calendar', 'configured'), true);
  assert.equal(field(state.reply, 'calendar', 'sources', 0, 'connected'), true);
  assert.equal(field(state.reply, 'calendar', 'events', 0, 'title'), 'Busy');
  assert.equal(field(state.reply, 'calendar', 'events', 0, 'calendar'), 'Calendar');
  // The removed feed's entry is pruned; the live one is kept as it was
  assert.deepEqual(
    Object.keys(record(field(readState(tv, 'calendar-cache.json'), 'entries'))),
    Object.keys(record(field(cached, 'entries'))),
  );
  assert.deepEqual(field(state.reply, 'smartHome'), { configured: false, devices: [] });
  assert.equal(field(state.reply, 'errors'), 0);

  assert.ok(requests.every((r) => r.authorization === `Bearer ${TOKEN}`));
  assert.deepEqual(field(readState(tv, 'apps-cache.json'), 'data'), { installed: INSTALLED });
  assert.ok(fs.existsSync(file(tv, 'privacy-cache.json')));
  assert.ok(fs.existsSync(file(tv, 'inputs-cache.json')));
  assert.equal(mode(file(tv, 'icons-cache.json')), 0o600);
  const iconCache = field(readState(tv, 'icons-cache.json'), 'items');
  assert.deepEqual(field(iconCache, 'youtube.leanback.v4'), { version: '1.0', data: null });

  // Apps, privacy, inputs and icons are cached; stats and recents are always fresh
  const count = (route: string) => requests.filter((r) => r.url.split('?')[0] === route).length;
  const before = {
    apps: count('/api/apps'),
    icons: count('/api/apps/icon'),
    stats: count('/api/stats'),
  };
  const again = await run(tv, 'state');
  assert.deepEqual(field(again.reply, 'apps'), field(state.reply, 'apps'));
  assert.equal(count('/api/apps'), before.apps);
  assert.equal(count('/api/apps/icon'), before.icons);
  assert.equal(count('/api/stats'), before.stats + 1);
});

test('one failing Glasshouse lookup is reported without hiding the rest', async (t) => {
  const tv = fakeTv(t);
  const table = routes();
  table.set('GET /api/home/recents', {
    status: 500,
    body: { ok: false, error: 'Recents are down' },
  });
  table.set('GET /api/stats', { body: { ...statsBody('OLED65C51LA.AEU'), mem: { usedPct: 42 } } });
  table.set('GET /api/privacy', { body: { simple: { total: 3 } } });
  table.set('GET /api/hdmi', { body: { ports: 'none' } });
  table.set('GET /api/apps/icon?id=netflix', { body: null, hang: true });
  await glasshouse(t, tv, table);
  const started = Date.now();
  const state = await ok(tv, 'state');
  // A stuck icon costs at most its 1.5 s timeout and is left out
  assert.ok(Date.now() - started < 10000);
  assert.deepEqual(find(field(state, 'apps'), 'id', 'netflix'), {
    id: 'netflix',
    title: 'Netflix',
    icon: null,
  });
  assert.equal(field(state, 'errors'), 1);
  assert.deepEqual(field(state, 'recent'), []);
  assert.equal(field(state, 'apps', 'length'), 4);
  assert.equal(field(state, 'health', 'idleReleaseSupported'), true);
  assert.equal(field(state, 'health', 'lowMemoryMode'), false);
  assert.deepEqual(field(state, 'privacy'), {
    trackingOff: false,
    summary: 'Review privacy controls',
  });
  assert.deepEqual(field(state, 'weather'), { configured: false });
  assert.deepEqual(field(state, 'calendar'), { configured: false, events: [] });
  assert.equal(fs.existsSync(file(tv, 'calendar-cache.json')), false);
});

test('TV commands go to Glasshouse only for installed apps and supported values', async (t) => {
  const tv = fakeTv(t);
  fs.mkdirSync(tv.data, { mode: 0o700 });
  const requests = await glasshouse(t, tv, routes());
  const controls = () => requests.filter((r) => r.url === '/api/control').map((r) => r.body);
  assert.deepEqual(await ok(tv, 'launch', 'netflix'), { ok: true, done: true });
  await ok(tv, 'launch', 'com.webos.app.hdmi3');
  await fails(tv, 'launch', 'com.example.missing', 'App is not installed');
  await ok(tv, 'sleep', 0);
  await ok(tv, 'sleep', 90);
  await ok(tv, 'screenOff');
  await ok(tv, 'settings');
  await ok(tv, 'lgHome');
  assert.ok(Number(fs.readFileSync(file(tv, 'allow-stock-until'), 'utf8')) > Date.now());
  assert.deepEqual(controls(), [
    { action: 'launchApp', value: 'netflix' },
    { action: 'launchApp', value: 'com.webos.app.hdmi3' },
    { action: 'sleepTimer', value: 'off' },
    { action: 'sleepTimer', value: '90' },
    { action: 'screenOff' },
    { action: 'launchApp', value: 'com.palm.app.settings' },
    { action: 'launchApp', value: 'com.webos.app.home' },
  ]);
  assert.ok(requests.every((r) => r.method === (r.url === '/api/control' ? 'POST' : 'GET')));
});

test('Glasshouse refusals and unverified models stop before any TV change', async (t) => {
  const tv = fakeTv(t);
  const table = routes();
  const requests = await glasshouse(t, tv, table);
  await fails(tv, 'memoryMode', true, 'Memory mode is unverified on this model.');
  await fails(tv, 'releaseIdleApps', null, 'Idle-app release is unverified on this model.');
  await fails(
    tv,
    'directHome',
    true,
    'Direct Home has not been verified for this model and firmware.',
  );
  assert.ok(requests.every((r) => r.url === '/api/stats'));
  assert.equal(fs.existsSync(file(tv, 'performance.json')), false);

  table.set('POST /api/control', { body: { ok: false, error: 'Busy' } });
  await fails(tv, 'screenOff', null, 'Busy');
  table.set('POST /api/control', { status: 500, body: {} });
  await fails(tv, 'screenOff', null, 'TV operation failed');
  table.set('POST /api/control', { body: null });
  await fails(tv, 'screenOff', null, "Cannot read properties of null (reading 'ok')");
  table.set('POST /api/control', { body: { ok: true, padding: 'x'.repeat(4000001) } });
  await fails(tv, 'screenOff', null, 'Response too large');
});

test('a wrong Glasshouse token is refused', async (t) => {
  const tv = fakeTv(t);
  await glasshouse(t, tv, routes(), 'stale-token');
  await fails(tv, 'screenOff', null, 'Unauthorized');
  // state still answers, reporting the five failed lookups
  const state = await ok(tv, 'state');
  assert.equal(field(state, 'errors'), 5);
  assert.deepEqual(field(state, 'apps'), []);
});
