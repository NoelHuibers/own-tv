// Based on the Home identity/rescan technique documented by Glasshouse and Luma.
// LG's files remain under a temporary bind mount. No SAM restart or layout edit.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';

/** Calls a Luna service once and resolves with its parsed reply. */
export type Luna = (uri: string, body: Readonly<Record<string, unknown>>) => Promise<unknown>;

/** Runs a program without a shell (execFile). */
export type Run = (
  file: string,
  args: readonly string[],
  options: { readonly timeout: number },
) => Promise<unknown>;

export interface HomeReplacementOptions {
  readonly root?: string;
  readonly appDir?: string;
  readonly source?: string;
  readonly procDir?: string;
  readonly schemaFile?: string;
  readonly assetGroup?: number;
  readonly luna?: Luna;
  readonly run?: Run;
  readonly now?: () => number;
  readonly isMounted?: () => boolean;
  readonly kill?: (pid: number, signal: NodeJS.Signals) => unknown;
  readonly ping?: () => Promise<void>;
}

/**
 * home-system/state.json. Written only by this module; fields are read defensively because
 * the file survives updates.
 */
export interface HomeState {
  readonly enabled?: unknown;
  readonly phase?: unknown;
  readonly preload?: unknown;
  readonly startedAt?: unknown;
  readonly failure?: unknown;
  readonly normalClosed?: unknown;
  readonly [key: string]: unknown;
}

export interface HomeResult {
  readonly ok: true;
  readonly enabled: boolean;
}

export interface DisableOptions {
  readonly keepEnabled?: boolean;
  readonly launch?: boolean | 'ifHome';
  readonly phase?: string;
}

export interface HomeReplacement {
  status(): HomeState;
  mounted(): boolean;
  token(): string;
  heartbeat(value: unknown): void;
  prepare(): HomeState;
  enable(options?: { readonly launch?: boolean }): Promise<HomeResult>;
  disable(reason?: string | null, options?: DisableOptions): Promise<HomeResult>;
  recover(reason: string): Promise<HomeResult>;
  guard(foreground: unknown, power: unknown): Promise<HomeResult | undefined>;
  escape(options?: { readonly launch?: boolean }): Promise<HomeResult>;
  stopFlutter(): void;
  refresh(): Promise<{ readonly ok: true; readonly refreshed: boolean }>;
}

export const LG = 'com.webos.app.home';
export const APP = 'io.github.noelhuibers.owntv';
const PORT = 18766;
// The dashboard bundle; the runtime settings must load right before it.
const APP_SCRIPT = '<script src="app.js"></script>';

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function field(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined;
}

export function isLgFlutter(argv: readonly string[]): boolean {
  return (
    path.basename(argv[0] || '') === 'flutter-client' &&
    argv.some((a, i) => a === '-i' && argv[i + 1] === LG)
  );
}

export function heartbeatExpired({
  foreground,
  power,
  startedAt,
  lastBeat,
  now,
}: {
  readonly foreground: unknown;
  readonly power: unknown;
  readonly startedAt: number;
  readonly lastBeat: number;
  readonly now: number;
}): boolean {
  return (
    foreground === LG &&
    power === 'Active' &&
    now - Math.max(startedAt, lastBeat || 0) > (lastBeat >= startedAt ? 45000 : 60000)
  );
}

/** The staged index.html: allows the private bridge and loads the runtime before the app. */
function withHomeRuntime(html: string): string {
  if (!html.includes(APP_SCRIPT)) {
    throw new Error(
      'Reinstall Own TV before enabling Direct Home: its index.html does not load app.js.',
    );
  }
  return html
    .replace("connect-src 'self';", `connect-src 'self' http://127.0.0.1:${PORT};`)
    .replace(APP_SCRIPT, `<script src="home-runtime.js"></script>${APP_SCRIPT}`);
}

function missingLuna(): Promise<never> {
  return Promise.reject(new TypeError('luna is not a function'));
}

export function createHomeReplacement(options: HomeReplacementOptions = {}): HomeReplacement {
  const root = options.root || '/var/lib/own-tv';
  const dir = path.join(root, 'home-system');
  const stage = path.join(dir, 'app');
  const appDir = options.appDir || `/usr/palm/applications/${LG}`;
  const source = options.source || `/media/developer/apps/usr/palm/applications/${APP}`;
  const proc = options.procDir || '/proc';
  const luna: Luna = options.luna || missingLuna;
  const run: Run = options.run || promisify(execFile);
  const now = options.now || Date.now;
  function read(name: string, fallback: unknown): unknown {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      return fallback;
    }
  }
  function write(name: string, data: unknown): void {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const p = path.join(dir, name);
    fs.writeFileSync(`${p}.tmp`, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(`${p}.tmp`, p);
  }
  function status(): HomeState {
    const state = read('state.json', { enabled: false });
    return isObject(state) ? state : { enabled: false };
  }
  function mounted(): boolean {
    if (options.isMounted) {
      return options.isMounted();
    }
    try {
      const a = fs.statSync(stage);
      const b = fs.statSync(appDir);
      return a.dev === b.dev && a.ino === b.ino;
    } catch {
      return false;
    }
  }
  function token(): string {
    const saved = read('token.json', null);
    if (saved) {
      return String(saved);
    }
    const t = randomBytes(32).toString('hex');
    write('token.json', t);
    return t;
  }
  function heartbeat(value: unknown): void {
    const v = isObject(value) ? value : {};
    const version = v.version;
    const apps = v.apps;
    write('heartbeat.json', {
      at: now(),
      version: typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? version : null,
      rendered: v.rendered === true,
      connected: v.connected === true,
      apps:
        typeof apps === 'number' && Number.isInteger(apps) ? Math.max(0, Math.min(500, apps)) : 0,
    });
  }
  function processes(): number[] {
    const ids: number[] = [];
    for (const pid of fs.readdirSync(proc)) {
      if (!/^\d+$/.test(pid)) {
        continue;
      }
      try {
        if (isLgFlutter(fs.readFileSync(path.join(proc, pid, 'cmdline'), 'utf8').split('\0'))) {
          ids.push(Number(pid));
        }
      } catch {
        // The process exited while it was being read
      }
    }
    return ids;
  }
  function stopFlutter(): void {
    const kill = options.kill || process.kill;
    for (const pid of processes()) {
      try {
        kill(pid, 'SIGTERM');
      } catch {
        // Already gone
      }
    }
  }
  async function reread(type: unknown): Promise<void> {
    const schema = fs.readFileSync(
      options.schemaFile || '/etc/palm/schemas/sam/applicationManager.blockSystemApp.schema',
      'utf8',
    );
    const payload = {
      id: LG,
      // biome-ignore lint/security/noSecrets: a field name in LG's Luna schema, not a credential
      ...(schema.includes('"forceBlockSystemApp"') ? { forceBlockSystemApp: false } : {}),
    };
    let blockError: unknown = null;
    try {
      await luna('com.webos.applicationManager/blockSystemApp', payload);
    } catch (e) {
      blockError = e;
    }
    let released = false;
    for (let i = 0; i < 3 && !released; i++) {
      try {
        await luna('com.webos.applicationManager/releaseBlockSystemApp', { id: LG });
        released = true;
      } catch {
        // Retried below
      }
    }
    if (!released) {
      throw new Error('LG Home could not be released; run the recovery command.');
    }
    if (blockError) {
      throw blockError;
    }
    for (let i = 0; i < 16; i++) {
      const info = field(
        await luna('com.webos.applicationManager/getAppInfo', { id: LG }),
        'appInfo',
      );
      const category = field(info, 'appCategory');
      if (
        field(info, 'type') === type &&
        (type !== 'web' ||
          ((Array.isArray(category) || typeof category === 'string') && category.includes('home')))
      ) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('The TV did not register the Home manifest.');
  }
  function ping(): Promise<void> {
    if (options.ping) {
      return options.ping();
    }
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({ action: 'homePing' });
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: PORT,
          path: '/action',
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token()}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
          },
        },
        (res) => {
          let body = '';
          res.on('data', (b: Buffer) => {
            body += b.toString();
          });
          res.on('end', () => {
            try {
              const reply: unknown = JSON.parse(body);
              if (reply === null) {
                throw new TypeError('Empty reply');
              }
              if (field(reply, 'service') === 'own-tv-home' && res.statusCode === 200) {
                resolve();
              } else {
                reject(new Error('Home bridge did not authenticate'));
              }
            } catch {
              reject(new Error('Home bridge unavailable'));
            }
          });
        },
      );
      req.setTimeout(3000, () =>
        req.destroy(new Error('Start the Own TV Home router before enabling Direct Home.')),
      );
      req.on('error', reject);
      req.end(data);
    });
  }
  function prepare(): HomeState {
    const current = status();
    if (!mounted()) {
      const manifest: unknown = JSON.parse(
        fs.readFileSync(path.join(appDir, 'appinfo.json'), 'utf8'),
      );
      if (field(manifest, 'id') !== LG || field(manifest, 'type') !== 'flutter') {
        throw new Error('Direct Home is only prepared for the tested Flutter Home.');
      }
      if (!fs.existsSync(path.join(dir, 'stock-manifest.json'))) {
        write('stock-manifest.json', manifest);
      }
    }
    if (!fs.existsSync(path.join(source, 'index.html'))) {
      throw new Error('Install Own TV before enabling Direct Home.');
    }
    // Fail closed before touching the stage (it is live while mounted)
    withHomeRuntime(fs.readFileSync(path.join(source, 'index.html'), 'utf8'));
    fs.mkdirSync(stage, { recursive: true, mode: 0o700 });
    fs.cpSync(source, stage, { recursive: true, filter: (p) => !path.basename(p).startsWith('.') });
    const info: unknown = JSON.parse(fs.readFileSync(path.join(stage, 'appinfo.json'), 'utf8'));
    if (!isObject(info)) {
      throw new TypeError('Invalid Own TV appinfo.json');
    }
    const staged = {
      ...info,
      id: LG,
      title: 'Own TV',
      visible: false,
      type: 'web',
      main: 'index.html',
      appCategory: ['home'],
    };
    fs.writeFileSync(path.join(stage, 'appinfo.json'), JSON.stringify(staged), { mode: 0o600 });
    const runtime = `window.OWN_TV_SYSTEM_HOME=true;window.OWN_TV_HOME_BRIDGE=${JSON.stringify({ port: PORT, token: token() })};`;
    fs.writeFileSync(path.join(stage, 'home-runtime.js'), runtime, { mode: 0o600 });
    const html = withHomeRuntime(fs.readFileSync(path.join(stage, 'index.html'), 'utf8'));
    fs.writeFileSync(path.join(stage, 'index.html'), html, { mode: 0o600 });
    // WAM runs as uid/gid 505 on the gated C5. Root retains write access;
    // only that runtime group can read the mounted assets and bridge token.
    function readable(p: string): void {
      const isDir = fs.lstatSync(p).isDirectory();
      fs.chownSync(p, -1, options.assetGroup ?? 505);
      fs.chmodSync(p, isDir ? 0o750 : 0o640);
      if (isDir) {
        for (const f of fs.readdirSync(p)) {
          readable(path.join(p, f));
        }
      }
    }
    readable(stage);
    return current;
  }
  async function setDefault(id: string): Promise<void> {
    const r = await luna('com.webos.settingsservice/getSystemSettings', {
      category: 'general',
      keys: ['defaultApps'],
    });
    const apps = field(field(r, 'settings'), 'defaultApps');
    if (!isObject(apps)) {
      throw new Error('Home settings unavailable');
    }
    await luna('com.webos.settingsservice/setSystemSettings', {
      category: 'general',
      settings: { defaultApps: { ...apps, home: id } },
    });
  }
  async function enable({
    launch = true,
  }: {
    readonly launch?: boolean;
  } = {}): Promise<HomeResult> {
    if (mounted() && status().enabled) {
      return { ok: true, enabled: true };
    }
    const previous = prepare();
    await ping();
    try {
      fs.unlinkSync(path.join(root, 'allow-stock-until'));
    } catch {
      // Not escaped
    }
    const before = await luna('com.webos.service.preloadmanager/getPreloadPolicy', {});
    const applications = field(before, 'applications');
    const preload =
      previous.preload ??
      (Array.isArray(applications)
        ? field(
            applications.find((a) => field(a, 'id') === LG),
            'isEnabled',
          )
        : undefined);
    write('state.json', {
      ...previous,
      enabled: true,
      phase: 'preparing',
      preload,
      startedAt: now(),
      failure: null,
    });
    try {
      await run('/bin/mount', ['--bind', stage, appDir], { timeout: 4000 });
      if (!mounted()) {
        throw new Error('The Home mount did not take.');
      }
      await reread('web');
      try {
        await luna('com.webos.service.preloadmanager/setPreloadPolicy', {
          application: { id: LG, isEnabled: false },
        });
      } catch {
        // Preloading only costs memory
      }
      stopFlutter();
      await setDefault(LG);
      write('state.json', {
        ...status(),
        enabled: true,
        phase: 'active',
        startedAt: now(),
        normalClosed: false,
      });
      if (launch) {
        await luna('com.webos.applicationManager/launch', { id: LG });
      }
      return { ok: true, enabled: true };
    } catch (e) {
      try {
        await disable(`Activation failed: ${String(field(e, 'message'))}`);
      } catch {
        // The original error is more useful
      }
      throw e;
    }
  }
  async function disable(
    reason: string | null = null,
    {
      keepEnabled = false,
      launch = 'ifHome',
      phase = keepEnabled ? 'escaped' : 'off',
    }: DisableOptions = {},
  ): Promise<HomeResult> {
    let foreground: unknown = null;
    try {
      foreground = field(
        await luna('com.webos.applicationManager/getForegroundAppInfo', {}),
        'appId',
      );
    } catch {
      // Unknown foreground: do not launch Home
    }
    const saved = status();
    write('state.json', { ...saved, enabled: keepEnabled, phase, failure: reason });
    if (mounted()) {
      try {
        await run('/bin/umount', [appDir], { timeout: 4000 });
      } catch {
        await run('/bin/umount', ['-l', appDir], { timeout: 4000 });
      }
      if (mounted()) {
        throw new Error('Could not unmount Own TV Home.');
      }
    }
    const stock = read('stock-manifest.json', null);
    if (stock) {
      await reread(field(stock, 'type'));
      try {
        await luna('com.palm.webappmanager/killApp', { appId: LG });
      } catch {
        // Not running
      }
    }
    if (typeof saved.preload === 'boolean') {
      try {
        await luna('com.webos.service.preloadmanager/setPreloadPolicy', {
          application: { id: LG, isEnabled: saved.preload },
        });
      } catch {
        // Preloading only costs memory
      }
    }
    await setDefault(keepEnabled ? LG : APP);
    if (launch === true || (launch === 'ifHome' && (foreground === LG || foreground === APP))) {
      await luna('com.webos.applicationManager/launch', { id: LG });
    }
    return { ok: true, enabled: keepEnabled };
  }
  let homeSince: number | null = null;
  async function guard(foreground: unknown, power: unknown): Promise<HomeResult | undefined> {
    // Each return to Home (wake from standby, screensaver, another app) restarts
    // the grace period: the last heartbeat may predate standby by hours.
    if (foreground !== LG || power !== 'Active') {
      homeSince = null;
    } else if (homeSince === null) {
      homeSince = now();
    }
    if (!(status().enabled && mounted())) {
      return;
    }
    stopFlutter();
    const saved = status();
    const lastBeat = Number(field(read('heartbeat.json', {}), 'at') || 0);
    const startedAt = Number(saved.startedAt);
    if (saved.phase === 'preparing' && now() - startedAt > 60000) {
      return disable('Home activation was interrupted. LG Home restored.');
    }
    if (foreground === LG && power === 'Active' && lastBeat >= startedAt && !saved.normalClosed) {
      try {
        await luna('com.palm.webappmanager/killApp', { appId: APP });
      } catch {
        // Not running
      }
      const current = status();
      if (current.enabled && current.startedAt === saved.startedAt) {
        write('state.json', { ...current, normalClosed: true });
      }
    }
    if (
      heartbeatExpired({
        foreground,
        power,
        startedAt: Math.max(startedAt, homeSince ?? 0),
        lastBeat,
        now: now(),
      })
    ) {
      await disable('Dashboard heartbeat was lost. LG Home restored.');
    }
    return;
  }
  async function refresh(): Promise<{ readonly ok: true; readonly refreshed: boolean }> {
    if (!(status().enabled && mounted())) {
      return { ok: true, refreshed: false };
    }
    prepare();
    const foreground = await luna('com.webos.applicationManager/getForegroundAppInfo', {});
    write('state.json', { ...status(), startedAt: now(), normalClosed: false });
    await luna('com.palm.webappmanager/killApp', { appId: LG });
    if (field(foreground, 'appId') === LG) {
      await luna('com.webos.applicationManager/launch', { id: LG });
    }
    return { ok: true, refreshed: true };
  }
  // After an unexpected router exit: restore LG's identity while the bridge is
  // down, but stay enabled so the restarted router mounts and launches Own TV
  // again. Relaunching stock Home here would race that remount and leave SAM
  // without a foreground window.
  async function recover(reason: string): Promise<HomeResult> {
    if (!status().enabled) {
      return { ok: true, enabled: false };
    }
    return await disable(reason, { keepEnabled: true, phase: 'recovering', launch: false });
  }
  async function escapeToStock({
    launch = true,
  }: {
    readonly launch?: boolean;
  } = {}): Promise<HomeResult> {
    fs.writeFileSync(path.join(root, 'allow-stock-until'), String(now() + 120000), {
      mode: 0o600,
    });
    return await disable(null, { keepEnabled: true, launch });
  }
  return {
    status,
    mounted,
    token,
    heartbeat,
    prepare,
    enable,
    disable,
    recover,
    guard,
    escape: escapeToStock,
    stopFlutter,
    refresh,
  };
}
