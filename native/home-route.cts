// Reversible foreground routing; no network listener or firmware-file changes.
import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import { main } from './helper.cjs';
import { createHomeApi, PORT } from './home-api.cjs';
import { createHomeReplacement, type Luna } from './home-replacement.cjs';
import { applyPreload, releaseIdleApps } from './performance.cjs';

const ROOT = '/var/lib/own-tv';
const APP = 'io.github.noelhuibers.owntv';
const STOCK = new Set(['com.webos.app.home', 'com.webos.app.fullhome']);
const PID = '/var/run/own-tv-home.pid';
const ALLOW_STOCK = `${ROOT}/allow-stock-until`;

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function field(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined;
}

function isStock(appId: unknown): boolean {
  return typeof appId === 'string' && STOCK.has(appId);
}

/** Sends SIGTERM to the process in pidFile, if its command line contains `expected`. */
function stopRecorded(pidFile: string, expected: string): void {
  try {
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    if (
      Number.isInteger(pid) &&
      pid > 1 &&
      fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(expected)
    ) {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    // Not running
  }
}

if (process.argv.includes('--stop')) {
  stopRecorded('/var/run/own-tv-home-supervisor.pid', '/var/lib/webosbrew/init.d/60-own-tv-home');
  stopRecorded(PID, '/var/lib/own-tv/home-route.cjs');
  process.exit(0);
}

let subscription: ChildProcess | null = null;
let stopping = false;
let inFlight = false;
let lastLaunch = 0;
let failures = 0;
let observedStock = false;
fs.writeFileSync(PID, String(process.pid), { mode: 0o600 });

const once: Luna = (uri, body) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      '/usr/bin/luna-send',
      ['-n', '1', '-w', '3000', `luna://${uri}`, JSON.stringify(body)],
      { stdio: ['pipe', 'pipe', 'ignore'] },
    );
    let raw = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Luna timeout'));
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
        const d: unknown = JSON.parse(raw.trim());
        if (d === null) {
          throw new TypeError("Cannot read properties of null (reading 'returnValue')");
        }
        if (field(d, 'returnValue') === false) {
          reject(new Error(String(field(d, 'errorText') || 'Luna refused')));
        } else {
          resolve(d);
        }
      } catch (e) {
        reject(e);
      }
    });
  });

const replacement = createHomeReplacement({ luna: once });
const api = createHomeApi({ token: replacement.token, main, heartbeat: replacement.heartbeat });
api.on('error', () =>
  console.error('Own TV private Home bridge could not start. Direct Home will refuse activation.'),
);
api.listen(PORT, '127.0.0.1');

function allowStockUntil(): number {
  try {
    return Number(fs.readFileSync(ALLOW_STOCK, 'utf8'));
  } catch {
    return 0;
  }
}

function clearAllowStock(): void {
  try {
    fs.unlinkSync(ALLOW_STOCK);
  } catch {
    // Not escaped
  }
}

let directBusy = false;
async function directForeground(appId: unknown): Promise<boolean> {
  const s = replacement.status();
  if (!s.enabled) {
    return false;
  }
  if (s.phase === 'preparing' && Date.now() - Number(s.startedAt) > 60000 && !directBusy) {
    await replacement.disable('Home activation was interrupted.');
    return false;
  }
  if (s.phase === 'preparing' || directBusy || replacement.mounted()) {
    return true;
  }
  if (s.phase === 'escaped') {
    if (isStock(appId) && stockAllowed()) {
      return true;
    }
    if (!observedStock && Date.now() < allowStockUntil()) {
      return true;
    }
  }
  directBusy = true;
  try {
    clearAllowStock();
    observedStock = false;
    const power = await once('com.webos.service.tvpower/power/getPowerState', {});
    await replacement.enable({
      launch: field(power, 'state') === 'Active' && (!appId || isStock(appId) || appId === APP),
    });
  } catch {
    console.error('Direct Home could not start; foreground routing retained.');
  } finally {
    directBusy = false;
  }
  return Boolean(replacement.status().enabled);
}

function stockAllowed(): boolean {
  try {
    const allowed = Number(fs.readFileSync(ALLOW_STOCK, 'utf8')) > Date.now();
    if (allowed) {
      observedStock = true;
    }
    return allowed;
  } catch {
    return false;
  }
}

async function foreground(appId: unknown): Promise<void> {
  // Crash recovery closes Home, so an empty foreground must still remount it.
  if (!appId && replacement.status().phase !== 'recovering') {
    return;
  }
  if (await directForeground(appId)) {
    return;
  }
  if (!isStock(appId)) {
    if (appId !== APP || observedStock) {
      clearAllowStock();
      observedStock = false;
    }
    if (appId === APP) {
      failures = 0;
    }
    return;
  }
  if (stockAllowed() || inFlight || Date.now() - lastLaunch < 1500 || failures >= 3) {
    return;
  }
  inFlight = true;
  lastLaunch = Date.now();
  try {
    await once('com.webos.applicationManager/launch', { id: APP });
    failures = 0;
  } catch {
    failures++;
    console.error('Own TV launch failed; LG Home remains available.');
  } finally {
    inFlight = false;
  }
}

function subscribe(): void {
  if (stopping) {
    return;
  }
  const child = spawn(
    '/usr/bin/luna-send',
    ['-i', 'luna://com.webos.applicationManager/getForegroundAppInfo', '{"subscribe":true}'],
    { stdio: ['pipe', 'pipe', 'ignore'] },
  );
  subscription = child;
  let pending = '';
  child.stdout.on('data', (b: Buffer) => {
    pending += b.toString();
    if (pending.length > 65536) {
      pending = '';
    }
    let i: number;
    // biome-ignore lint/suspicious/noAssignInExpressions: drains complete lines from the stream buffer
    while ((i = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, i).trim();
      pending = pending.slice(i + 1);
      try {
        const appId = field(JSON.parse(line), 'appId');
        if (appId) {
          foreground(appId);
        }
      } catch {
        // Not a complete reply
      }
    }
  });
  child.on('error', () => {
    // Retried on close
  });
  child.on('close', () => {
    subscription = null;
    if (!stopping) {
      setTimeout(subscribe, 5000);
    }
  });
}

let memoryBusy = false;
let memoryPrepared = false;
function readPerformance(): unknown {
  return JSON.parse(fs.readFileSync(`${ROOT}/performance.json`, 'utf8'));
}

async function enforceMemory(appId: unknown): Promise<void> {
  if (memoryBusy || stopping) {
    return;
  }
  let settings: unknown;
  try {
    settings = readPerformance();
  } catch {
    return;
  }
  if (!isObject(settings) || settings.enabled !== true) {
    memoryPrepared = false;
    return;
  }
  memoryBusy = true;
  try {
    await applyPreload(once, settings);
    const current = readPerformance();
    if (field(current, 'enabled') !== true) {
      await applyPreload(once, settings, true);
      return;
    }
    if (
      !memoryPrepared &&
      (appId === APP || (appId === 'com.webos.app.home' && replacement.mounted()))
    ) {
      await releaseIdleApps(once);
      memoryPrepared = true;
    }
  } catch {
    // Retried on the next check
  } finally {
    memoryBusy = false;
  }
}

async function check(): Promise<void> {
  if (stopping) {
    return;
  }
  try {
    const appId = field(
      await once('com.webos.applicationManager/getForegroundAppInfo', {}),
      'appId',
    );
    await foreground(appId);
    if (replacement.mounted() && !directBusy) {
      const power = await once('com.webos.service.tvpower/power/getPowerState', {});
      await replacement.guard(appId, field(power, 'state'));
    }
    enforceMemory(appId);
  } catch {
    // Retried in ten seconds
  }
}

function stop(): void {
  stopping = true;
  if (subscription) {
    subscription.kill();
  }
  try {
    if (fs.readFileSync(PID, 'utf8').trim() === String(process.pid)) {
      fs.unlinkSync(PID);
    }
  } catch {
    // Already removed
  }
  process.exit(0);
}

process.on('SIGTERM', stop);
process.on('SIGINT', stop);
subscribe();
check();
setInterval(check, 10000);
setInterval(() => {
  if (
    replacement.status().enabled &&
    replacement.status().phase === 'active' &&
    replacement.mounted()
  ) {
    replacement.stopFlutter();
  }
}, 2000);
