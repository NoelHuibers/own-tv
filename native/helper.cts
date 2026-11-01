#!/usr/bin/env node
// No listener, shell execution, telemetry or account login. Invoked over SSH or
// through Homebrew Channel by the installed dashboard's fixed bridge.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { type Agenda, collectAgenda } from './calendar-agenda.cjs';
import { fetchCalendar } from './calendar-feed.cjs';
import {
  type CalendarSettings,
  changeCalendar,
  isCalendarSettings,
  publicCatalog,
} from './calendar-settings.cjs';
import { type AppVersion, type CurrentSetup, evaluate } from './firmware.cjs';
import { createHomeReplacement, type Luna } from './home-replacement.cjs';
import { validateIntegrations } from './integrations.cjs';
import { applyPreload, parseMemory, releaseIdleApps } from './performance.cjs';
import {
  forecastUrl,
  normalizeRadar,
  normalizeWeather,
  searchUrl,
  type Weather,
  type WeatherLocation,
} from './weather.cjs';

type Json = Readonly<Record<string, unknown>>;

/** What the dashboard gets when weather is not set up or unavailable. */
type WeatherView =
  | Weather
  | { configured: false }
  | {
      configured: true;
      city: string;
      error: true;
      location?: { latitude: number; longitude: number };
    };

interface IntegrationsView {
  weather: WeatherView;
  calendar: Agenda;
  smartHome: { configured: false; devices: never[] };
}

interface InstalledApp {
  readonly id: string;
  readonly title?: unknown;
  readonly version?: unknown;
}

interface IconEntry {
  readonly version: unknown;
  readonly data: string | null;
}

interface Health {
  model: unknown;
  firmware: unknown;
  webos: unknown;
  panelHours: unknown;
  panelCompensationCycles: unknown;
  panelRefresherCycles: unknown;
  temperature: number | undefined;
  uptimeSeconds: unknown;
  memoryUsedPercent: unknown;
  memoryAvailableMB?: number;
  memoryTotalMB?: number;
  memoryCachedMB?: number;
  swapUsedMB?: number;
  lowMemoryMode?: boolean;
  directHome?: boolean;
  directHomeFailure?: unknown;
  idleReleaseSupported?: boolean;
}

interface Input {
  readonly id: string;
  readonly title: unknown;
  connected: boolean | undefined;
}

const ROOT = process.env.OWN_TV_DATA || '/var/lib/own-tv';
// Tests point this at a fake Glasshouse on 127.0.0.1; it is never set on the TV.
const GLASSHOUSE_CONFIG = process.env.OWN_TV_GLASSHOUSE_CONFIG || '/var/lib/tvweb/config.json';
const MODEL = 'OLED65C51LA';

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null;
}

/** Like `value?.a?.b`: undefined as soon as a step is not an object. */
function field(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (!isObject(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function items(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function read(name: string, fallback: unknown): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
  } catch {
    return fallback;
  }
}

function write(name: string, value: unknown): void {
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  const p = path.join(ROOT, name);
  fs.writeFileSync(`${p}.tmp`, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(`${p}.tmp`, p);
}

/** integrations.json, keeping any keys this version does not know. */
function integrationsFile(): Record<string, unknown> {
  const value = read('integrations.json', {});
  return isObject(value) ? { ...value } : {};
}

function isWeatherLocation(value: unknown): value is WeatherLocation {
  return (
    isObject(value) &&
    typeof value.latitude === 'number' &&
    typeof value.longitude === 'number' &&
    typeof value.label === 'string'
  );
}

function weatherConfig(): WeatherLocation | undefined {
  const weather = integrationsFile().weather;
  return isWeatherLocation(weather) ? weather : undefined;
}

function calendarConfig(cfg: Json): CalendarSettings | undefined {
  return isCalendarSettings(cfg.calendar) ? cfg.calendar : undefined;
}

function glasshouseConfig(): unknown {
  return JSON.parse(fs.readFileSync(GLASSHOUSE_CONFIG, 'utf8'));
}

function glasshousePort(cfg: unknown): number | string {
  const port = field(cfg, 'port') || 8080;
  return typeof port === 'number' || typeof port === 'string' ? port : 8080;
}

export function gh(route: string, body?: Json): Promise<unknown> {
  let cfg: unknown;
  try {
    cfg = glasshouseConfig();
  } catch {
    throw new Error('Install Glasshouse first.');
  }
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: glasshousePort(cfg),
        path: route,
        method: data ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${String(field(cfg, 'token'))}`,
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (b: Buffer) => {
          raw += b.toString();
          if (raw.length > 4000000) {
            req.destroy(new Error('Response too large'));
          }
        });
        res.on('end', () => {
          try {
            const value: unknown = JSON.parse(raw);
            if (value === null) {
              throw new TypeError("Cannot read properties of null (reading 'ok')");
            }
            if ((res.statusCode ?? 0) >= 400 || field(value, 'ok') === false) {
              reject(new Error(String(field(value, 'error') || 'TV operation failed')));
            } else {
              resolve(value);
            }
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.setTimeout(30000, () => req.destroy(new Error('TV operation timed out')));
    req.on('error', reject);
    if (data) {
      req.write(data);
    }
    req.end();
  });
}

function ghIcon(id: string): Promise<string | null> {
  return new Promise((resolve) => {
    const cfg = glasshouseConfig();
    const req = http.get(
      {
        hostname: '127.0.0.1',
        port: glasshousePort(cfg),
        path: `/api/apps/icon?id=${encodeURIComponent(id)}`,
        headers: { Authorization: `Bearer ${String(field(cfg, 'token'))}` },
      },
      (res) => {
        const type = String(res.headers['content-type'] || '').split(';')[0] ?? '';
        if (res.statusCode !== 200 || !['image/png', 'image/jpeg', 'image/webp'].includes(type)) {
          res.resume();
          resolve(null);
          return;
        }
        const buffers: Buffer[] = [];
        let size = 0;
        res.on('data', (b: Buffer) => {
          size += b.length;
          if (size > 32768) {
            req.destroy();
            resolve(null);
          } else {
            buffers.push(b);
          }
        });
        res.on('end', () =>
          resolve(`data:${type};base64,${Buffer.concat(buffers).toString('base64')}`),
        );
      },
    );
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

async function appIcons(apps: readonly InstalledApp[]): Promise<Record<string, IconEntry>> {
  const saved = read('icons-cache.json', { at: 0, items: {} });
  const cachedAt = Number(field(saved, 'at'));
  const cachedItems = field(saved, 'items');
  const priority = [
    'youtube.leanback.v4',
    'tv.twitch.tv.starshot.lg',
    'spotify-beehive',
    'netflix',
    'amazon',
    'com.disney.disneyplus-prod',
    'com.netrtl.tvnow',
  ];
  const rank = (id: string) => (priority.includes(id) ? priority.indexOf(id) : 99);
  const ordered = [...apps].sort((a, b) => rank(a.id) - rank(b.id));
  let budget = 120000;
  const result: Record<string, IconEntry> = {};
  let changed = Date.now() - cachedAt >= 86400000;
  for (const app of ordered) {
    const entry = field(cachedItems, app.id);
    const hit =
      Boolean(entry) && field(entry, 'version') === app.version && Date.now() - cachedAt < 86400000;
    const cachedData = field(entry, 'data');
    let data = hit && typeof cachedData === 'string' ? cachedData : null;
    if (!hit) {
      changed = true;
      try {
        data = await ghIcon(app.id);
      } catch {
        data = null;
      }
    }
    if (!data || data.length <= budget) {
      result[app.id] = { version: app.version, data };
      if (data) {
        budget -= data.length;
      }
    }
  }
  if (changed) {
    write('icons-cache.json', { at: Date.now(), items: result });
  }
  return result;
}

function getText(url: string, maxBytes = 2000000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Provider returned HTTP ${String(res.statusCode)}`));
        return;
      }
      let raw = '';
      res.on('data', (b: Buffer) => {
        raw += b.toString();
        if (Buffer.byteLength(raw) > maxBytes) {
          req.destroy(new Error('Provider response too large'));
        }
      });
      res.on('end', () => resolve(raw));
    });
    req.on('timeout', () => req.destroy(new Error('Provider timed out')));
    req.on('error', () => reject(new Error('Provider connection failed')));
  });
}

async function weatherData(details = false, force = false): Promise<WeatherView> {
  const w = weatherConfig();
  if (!w) {
    return { configured: false };
  }
  const location = { latitude: w.latitude, longitude: w.longitude };
  const saved = read('weather-cache.json', null);
  const cached = field(saved, 'schema') === 3 ? saved : null;
  try {
    const d =
      !force && cached && Date.now() - Number(field(cached, 'at')) < 30 * 60 * 1000
        ? cached
        : { schema: 3, at: Date.now(), data: JSON.parse(await getText(forecastUrl(w))) };
    const result = normalizeWeather(field(d, 'data'), w.label, field(d, 'at'), details);
    if (d !== saved) {
      write('weather-cache.json', d);
    }
    if (details) {
      result.location = location;
    }
    return result;
  } catch {
    if (cached) {
      const result = normalizeWeather(field(cached, 'data'), w.label, field(cached, 'at'), details);
      if (details) {
        result.location = location;
      }
      return { ...result, error: true };
    }
    return { configured: true, city: w.label, error: true, ...(details ? { location } : {}) };
  }
}

async function integrations(): Promise<IntegrationsView> {
  const cfg = integrationsFile();
  const old = read('calendar-cache.json', {});
  const calendar = calendarConfig(cfg);
  const agendaDeadline = Date.now() + 45000;
  const [weather, agenda] = await Promise.all([
    weatherData(false),
    collectAgenda(calendar, old, (url) =>
      fetchCalendar(url, 0, Math.min(agendaDeadline, Date.now() + 15000)),
    ),
  ]);
  if (calendar && JSON.stringify(old) !== JSON.stringify(agenda.cache)) {
    write('calendar-cache.json', agenda.cache);
  }
  return { weather, calendar: agenda.calendar, smartHome: { configured: false, devices: [] } };
}

export function safeApp(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(id);
}

function isInstalledApp(app: unknown): app is InstalledApp {
  return isObject(app) && safeApp(app.id);
}

async function cachedGh(name: string, route: string, ttl: number): Promise<unknown> {
  const cached = read(name, null);
  if (cached && Date.now() - Number(field(cached, 'at')) < ttl) {
    return field(cached, 'data');
  }
  const data = await gh(route);
  write(name, { at: Date.now(), data });
  return data;
}

function settled<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === 'fulfilled' ? result.value : fallback;
}

function modelOf(stats: unknown): string {
  return String(field(stats, 'device', 'model') || '').split('.')[0] ?? '';
}

function preferencesRevision(): number {
  try {
    return fs.statSync(path.join(ROOT, 'preferences.json')).mtimeMs;
  } catch {
    return 0;
  }
}

async function state() {
  const results = await Promise.allSettled([
    gh('/api/stats'),
    cachedGh('apps-cache.json', '/api/apps', 300000),
    gh('/api/home/recents'),
    cachedGh('privacy-cache.json', '/api/privacy', 300000),
    cachedGh('inputs-cache.json', '/api/hdmi', 300000),
    integrations(),
  ]);
  const [statsResult, appsResult, recentResult, privacyResult, hdmiResult, integrationsResult] =
    results;
  const stats = settled(statsResult, {});
  const apps = settled(appsResult, {});
  const recent = settled(recentResult, {});
  const privacy = settled(privacyResult, {});
  const hdmi = settled(hdmiResult, {});
  const installed = items(field(apps, 'installed') || field(stats, 'apps')).filter(isInstalledApp);
  const icons = await appIcons(installed);
  const list = installed.map((a) => ({
    id: a.id,
    title: a.title || a.id,
    icon: icons[a.id]?.data,
  }));
  const memory = field(stats, 'mem') || {};
  const temperature = field(stats, 'temp');
  const health: Health = {
    model: field(stats, 'device', 'model'),
    firmware: field(stats, 'system', 'firmware'),
    webos: field(stats, 'system', 'webos'),
    panelHours:
      field(stats, 'oled', 'panel_usage_units') == null
        ? undefined
        : field(stats, 'oled', 'panel_hours_exact'),
    panelCompensationCycles: field(stats, 'oled', 'comp_cycles'),
    panelRefresherCycles: field(stats, 'oled', 'refresher_cycles'),
    temperature: typeof temperature === 'number' ? temperature : undefined,
    uptimeSeconds: field(stats, 'uptime'),
    memoryUsedPercent: field(memory, 'usedPercent') ?? field(memory, 'usedPct'),
  };
  const total = field(memory, 'total');
  const available = field(memory, 'available') ?? field(memory, 'avail');
  if (health.memoryUsedPercent == null && total && available != null) {
    health.memoryUsedPercent = Math.round(
      ((Number(total) - Number(available)) * 100) / Number(total),
    );
  }
  try {
    Object.assign(health, parseMemory(fs.readFileSync('/proc/meminfo', 'utf8')));
  } catch {
    // Glasshouse's numbers stay
  }
  health.lowMemoryMode = field(read('performance.json', {}), 'enabled') === true;
  const direct = createHomeReplacement({ root: ROOT, luna });
  health.directHome = direct.status().enabled === true && direct.mounted();
  health.directHomeFailure = direct.status().failure || null;
  health.idleReleaseSupported = String(health.model || '').split('.')[0] === MODEL;
  const inputEntries: [string, unknown][] = Object.entries(field(stats, 'inputs') || {});
  const inputs = inputEntries.map(
    ([key, title]): Input => ({ id: `com.webos.app.${key}`, title, connected: undefined }),
  );
  const catalog = field(hdmi, 'inputs') || field(hdmi, 'ports') || [];
  if (Array.isArray(catalog)) {
    for (const input of inputs) {
      const found: unknown = catalog.find(
        (p) => field(p, 'id') === input.id || field(p, 'appId') === input.id,
      );
      const connected = field(found, 'connected');
      if (typeof connected === 'boolean') {
        input.connected = connected;
      }
    }
  }
  const simple = field(privacy, 'simple');
  const simpleTotal = field(simple, 'total');
  const adblock = field(privacy, 'adblock');
  const adblockMode = field(adblock, 'mode');
  let summary = 'Privacy status unavailable';
  if (simple) {
    summary = simpleTotal === 0 ? 'Privacy controls applied' : 'Review privacy controls';
  }
  const sleepTimer = field(stats, 'sleepTimer');
  return {
    apps: list,
    inputs,
    recent: items(field(recent, 'apps') || []).map((a) => ({
      id: field(a, 'id'),
      title: field(a, 'title'),
    })),
    health,
    privacy: {
      trackingOff: typeof simpleTotal === 'number' ? simpleTotal === 0 : undefined,
      adBlocking: adblock ? adblockMode === 'ads' || adblockMode === 'full' : undefined,
      summary,
    },
    sleepTimer: sleepTimer == null ? undefined : { minutesRemaining: Number(sleepTimer) || 0 },
    preferencesRevision: preferencesRevision(),
    preferences: read('preferences.json', null),
    ...settled<IntegrationsView>(integrationsResult, {
      calendar: { configured: false, events: [] },
      weather: { configured: false },
      smartHome: { configured: false, devices: [] },
    }),
    errors: results.slice(0, 5).filter((r) => r.status === 'rejected').length,
  };
}

const luna: Luna = (uri, body) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      '/usr/bin/luna-send',
      ['-n', '1', '-w', '3000', `luna://${uri}`, JSON.stringify(body)],
      {
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    );
    let raw = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('TV command timed out'));
    }, 5000);
    child.stdout.on('data', (b: Buffer) => {
      raw += b.toString();
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const r: unknown = JSON.parse(raw.trim());
        if (r === null) {
          throw new TypeError("Cannot read properties of null (reading 'returnValue')");
        }
        if (field(r, 'returnValue') === false) {
          throw new Error(String(field(r, 'errorText') || 'TV command refused'));
        }
        resolve(r);
      } catch (e) {
        reject(e);
      }
    });
  });

async function directHome(argument: unknown): Promise<unknown> {
  if (typeof argument !== 'boolean') {
    throw new Error('Choose whether Direct Home is enabled.');
  }
  const direct = createHomeReplacement({ root: ROOT, luna });
  if (!argument) {
    return direct.disable();
  }
  const stats = await gh('/api/stats');
  if (modelOf(stats) !== MODEL || field(stats, 'system', 'firmware') !== '43.21.77') {
    throw new Error('Direct Home has not been verified for this model and firmware.');
  }
  const foreground = field(
    await luna('com.webos.applicationManager/getForegroundAppInfo', {}),
    'appId',
  );
  return direct.enable({
    launch: foreground === 'com.webos.app.home' || foreground === 'io.github.noelhuibers.owntv',
  });
}

async function radar(): Promise<unknown> {
  const w = weatherConfig();
  if (!w) {
    throw new Error('Configure weather first.');
  }
  const cached = read('radar-cache.json', null);
  const cachedData = field(cached, 'data');
  let data: unknown;
  if (cached && Date.now() - Number(field(cached, 'at')) < 300000) {
    data = cachedData;
  } else {
    data = normalizeRadar(
      JSON.parse(await getText('https://api.rainviewer.com/public/weather-maps.json', 65536)),
    );
    write('radar-cache.json', { at: Date.now(), data });
  }
  return {
    ...(isObject(data) ? data : {}),
    location: { latitude: w.latitude, longitude: w.longitude },
    city: w.label,
  };
}

async function weatherSearch(argument: unknown): Promise<unknown> {
  const r: unknown = JSON.parse(await getText(searchUrl(argument), 65536));
  return {
    ok: true,
    places: items(field(r, 'results') || []).map((p) => ({
      label: String(field(p, 'name')).slice(0, 40),
      region: [field(p, 'admin1'), field(p, 'country')].filter(Boolean).join(', '),
      latitude: field(p, 'latitude'),
      longitude: field(p, 'longitude'),
    })),
  };
}

async function memoryMode(argument: unknown): Promise<unknown> {
  if (typeof argument !== 'boolean') {
    throw new Error('Invalid memory mode');
  }
  const stats = await gh('/api/stats');
  if (modelOf(stats) !== MODEL) {
    throw new Error('Memory mode is unverified on this model.');
  }
  const previous = read('performance.json', { enabled: false, before: {} });
  // Capture the originals before writing any policies, including across a restart.
  const policy = await luna('com.webos.service.preloadmanager/getPreloadPolicy', {});
  const applications = field(policy, 'applications');
  if (!Array.isArray(applications)) {
    throw new Error('Preload policy unavailable');
  }
  const previousBefore = field(previous, 'before');
  const before: Record<string, unknown> = isObject(previousBefore) ? { ...previousBefore } : {};
  for (const p of applications) {
    const id = field(p, 'id');
    const isEnabled = field(p, 'isEnabled');
    if (
      typeof id === 'string' &&
      ['youtube.leanback.v4', 'netflix', 'amazon', 'com.webos.app.lgchannels'].includes(id) &&
      typeof isEnabled === 'boolean' &&
      !(id in before)
    ) {
      before[id] = isEnabled;
    }
  }
  if (Object.keys(before).length === 0) {
    throw new Error('No supported video preload policies');
  }
  const next = { enabled: argument, before };
  write('performance.json', next);
  try {
    await applyPreload(luna, next, !argument);
    write('performance.json', next);
  } catch (e) {
    write('performance.json', previous);
    try {
      await applyPreload(luna, next, true);
    } catch {
      // Report the first failure
    }
    throw e;
  }
  if (argument) {
    try {
      await releaseIdleApps(luna);
    } catch {
      // Memory mode is on; releasing apps is a bonus
    }
  }
  return { ok: true, enabled: argument };
}

async function releaseIdle(): Promise<unknown> {
  const stats = await gh('/api/stats');
  if (modelOf(stats) !== MODEL) {
    throw new Error('Idle-app release is unverified on this model.');
  }
  return releaseIdleApps(luna);
}

function isThirdPartyApp(app: unknown): app is AppVersion {
  const id = field(app, 'id');
  return (
    typeof id === 'string' &&
    !id.startsWith('com.webos.') &&
    !id.startsWith('com.palm.') &&
    !id.startsWith('org.webosbrew.') &&
    id !== 'io.github.noelhuibers.owntv'
  );
}

async function firmwareCheck(): Promise<unknown> {
  const stats = await gh('/api/stats');
  const apps = await gh('/api/apps');
  const device = read('device-capabilities.json', {});
  let hb: unknown = {};
  try {
    hb = JSON.parse(
      fs.readFileSync(
        '/media/developer/apps/usr/palm/applications/org.webosbrew.hbchannel/appinfo.json',
        'utf8',
      ),
    );
  } catch {
    // Homebrew Channel version unknown
  }
  const current: CurrentSetup = {
    model: modelOf(stats),
    country: field(device, 'country'),
    otaid: field(device, 'otaid'),
    firmware: field(stats, 'system', 'firmware'),
    components: {
      homebrew: field(hb, 'version'),
      ownTv: field(read('build.json', {}), 'version'),
      glasshouse: field(stats, 'tvwebVersion'),
    },
    apps: items(field(apps, 'installed') || [])
      .filter(isThirdPartyApp)
      .map((a) => ({ id: a.id, version: a.version })),
  };
  let catalog: unknown;
  try {
    catalog = JSON.parse(
      await getText(
        'https://raw.githubusercontent.com/NoelHuibers/own-tv/main/compatibility/firmware.json',
        65536,
      ),
    );
  } catch {
    return { ...evaluate(current, null), catalogueReachable: false };
  }
  return { ...evaluate(current, catalog), catalogueReachable: true };
}

function removeCache(name: string): void {
  try {
    fs.unlinkSync(path.join(ROOT, name));
  } catch {
    // Nothing cached
  }
}

function configure(argument: unknown): unknown {
  const patch = validateIntegrations(argument);
  const input = isObject(argument) ? argument : {};
  const cfg: Record<string, unknown> = { ...integrationsFile(), ...patch };
  for (const name of ['calendar', 'weather']) {
    if (input[name] === null) {
      delete cfg[name];
    }
  }
  write('integrations.json', cfg);
  for (const name of ['calendar', 'weather']) {
    if (name in input) {
      removeCache(`${name}-cache.json`);
    }
  }
  return { ok: true };
}

function preferences(argument: unknown): unknown {
  if (!isObject(argument) || Array.isArray(argument) || JSON.stringify(argument).length > 65536) {
    throw new Error('Invalid preferences');
  }
  if (argument.schema !== 1) {
    throw new Error('Unsupported preference schema');
  }
  write('preferences.json', argument);
  return { ok: true, revision: fs.statSync(path.join(ROOT, 'preferences.json')).mtimeMs };
}

async function launch(argument: unknown): Promise<unknown> {
  if (!safeApp(argument)) {
    throw new Error('Invalid app id');
  }
  const apps = await gh('/api/apps');
  if (
    !items(field(apps, 'installed') || []).some((a) => field(a, 'id') === argument) &&
    !/^com\.webos\.app\.hdmi[1-4]$/.test(argument)
  ) {
    throw new Error('App is not installed');
  }
  return gh('/api/control', { action: 'launchApp', value: argument });
}

function lgHome(): Promise<unknown> {
  const direct = createHomeReplacement({ root: ROOT, luna });
  if (direct.status().enabled && direct.mounted()) {
    return direct.escape();
  }
  fs.writeFileSync(path.join(ROOT, 'allow-stock-until'), String(Date.now() + 120000), {
    mode: 0o600,
  });
  return gh('/api/control', { action: 'launchApp', value: 'com.webos.app.home' });
}

export async function main(action: string | undefined, argument?: unknown): Promise<unknown> {
  switch (action) {
    case 'state':
      return await state();
    case 'directHomeRecover':
      return await createHomeReplacement({ root: ROOT, luna }).recover(
        'Direct Home restarted after a router error.',
      );
    case 'homeRefresh':
      return await createHomeReplacement({ root: ROOT, luna }).refresh();
    case 'directHome':
      return await directHome(argument);
    case 'weatherSource':
      if (argument !== 'forecast' && argument !== 'radar') {
        throw new Error('Unknown weather source');
      }
      return await luna('com.webos.applicationManager/launch', {
        id: 'com.webos.app.browser',
        params: {
          target:
            argument === 'forecast' ? 'https://open-meteo.com/' : 'https://www.rainviewer.com/',
        },
      });
    case 'weatherDetails':
      return await weatherData(true, argument === true);
    case 'radar':
      return await radar();
    case 'weatherSearch':
      return await weatherSearch(argument);
    case 'memoryMode':
      return await memoryMode(argument);
    case 'releaseIdleApps':
      return await releaseIdle();
    case 'firmwareCheck':
      return await firmwareCheck();
    case 'weather': {
      const cfg = integrationsFile();
      cfg.weather = validateIntegrations({ weather: argument }).weather;
      write('integrations.json', cfg);
      removeCache('weather-cache.json');
      return { ok: true };
    }
    case 'calendarCatalog':
      return publicCatalog(calendarConfig(integrationsFile()));
    case 'calendarSource': {
      const cfg = integrationsFile();
      cfg.calendar = changeCalendar(calendarConfig(cfg), argument);
      write('integrations.json', cfg);
      return { ok: true };
    }
    case 'configure':
      return configure(argument);
    case 'preferences':
      return preferences(argument);
    case 'launch':
      return await launch(argument);
    case 'sleep':
      if (typeof argument !== 'number' || ![0, 10, 30, 60, 90, 120].includes(argument)) {
        throw new Error('Unsupported sleep duration');
      }
      return await gh('/api/control', {
        action: 'sleepTimer',
        value: argument === 0 ? 'off' : String(argument),
      });
    case 'screenOff':
      return await gh('/api/control', { action: 'screenOff' });
    case 'lgHome':
      return await lgHome();
    case 'settings':
      return await gh('/api/control', { action: 'launchApp', value: 'com.palm.app.settings' });
    default:
      throw new Error('Unknown command');
  }
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

if (require.main === module) {
  let arg: unknown;
  try {
    const encoded = process.argv[3];
    arg = encoded ? JSON.parse(Buffer.from(encoded, 'base64').toString()) : null;
  } catch {
    print({ ok: false, error: 'Invalid request' });
    process.exit(1);
  }
  main(process.argv[2], arg).then(print, (e: unknown) => {
    print({ ok: false, error: field(e, 'message') });
    process.exitCode = 1;
  });
}
