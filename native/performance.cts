import { createHomeReplacement, type Luna } from './home-replacement.cjs';

export interface MemoryStats {
  readonly memoryUsedPercent: number;
  readonly memoryAvailableMB: number;
  readonly memoryTotalMB: number;
  readonly memoryCachedMB: number;
  readonly swapUsedMB: number;
}

/** performance.json: whether memory mode is on, and the preload choices it replaced. */
export interface PerformanceSettings {
  readonly enabled?: unknown;
  readonly before?: unknown;
}

export interface IdleRelease {
  readonly ok: true;
  readonly closed: string[];
  readonly failed: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function field(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined;
}

function items(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parseMemory(text: string): MemoryStats | Record<string, never> {
  const m: Record<string, number> = {};
  for (const line of text.split('\n')) {
    const [, key, value] = line.match(/^(\w+):\s+(\d+)\s+kB$/) ?? [];
    if (key !== undefined && value !== undefined) {
      m[key] = Number(value);
    }
  }
  const total = m.MemTotal;
  const available = m.MemAvailable;
  if (!total || available === undefined || !Number.isFinite(available)) {
    return {};
  }
  return {
    memoryUsedPercent: Math.round(((total - available) * 100) / total),
    memoryAvailableMB: Math.round(available / 1024),
    memoryTotalMB: Math.round(total / 1024),
    memoryCachedMB: Math.round((m.Cached || 0) / 1024),
    swapUsedMB: Math.round(((m.SwapTotal || 0) - (m.SwapFree || 0)) / 1024),
  };
}

// Deliberately excludes Spotify, inputs, Home, the screensaver and all services.
const VIDEO_APPS = new Set([
  'youtube.leanback.v4',
  'netflix',
  'amazon',
  'com.disney.disneyplus-prod',
  'com.netrtl.tvnow',
  'com.webos.app.lgchannels',
]);

export async function releaseIdleApps(luna: Luna): Promise<IdleRelease> {
  const allowedForeground = new Set(['io.github.noelhuibers.owntv', 'com.webos.app.screensaver']);
  if (createHomeReplacement().mounted()) {
    allowedForeground.add('com.webos.app.home');
  }
  const allowed = (reply: unknown) => {
    const appId = field(reply, 'appId');
    return typeof appId === 'string' && allowedForeground.has(appId);
  };
  if (!allowed(await luna('com.webos.applicationManager/getForegroundAppInfo', {}))) {
    throw new Error('Open Own TV on the TV before releasing idle apps.');
  }
  const running = await luna('com.webos.applicationManager/running', {});
  const closed: string[] = [];
  const failed: string[] = [];
  for (const app of items(field(running, 'running'))) {
    const id = field(app, 'id');
    if (typeof id !== 'string' || !VIDEO_APPS.has(id)) {
      continue;
    }
    // Stop if the viewer changes apps while this operation is in progress.
    if (!allowed(await luna('com.webos.applicationManager/getForegroundAppInfo', {}))) {
      break;
    }
    try {
      await luna('com.webos.applicationManager/closeByAppId', { id });
      closed.push(id);
    } catch {
      failed.push(id);
    }
  }
  return { ok: true, closed, failed };
}

const PRELOAD_APPS = new Set([
  'youtube.leanback.v4',
  'netflix',
  'amazon',
  'com.webos.app.lgchannels',
]);

/**
 * Turns the video preload policies off, or restores the original choices. Records each
 * original choice in `settings.before` (in place) the first time it sees the app.
 */
export async function applyPreload(
  luna: Luna,
  settings: PerformanceSettings,
  restore = false,
): Promise<{ enabled: boolean; before: Record<string, unknown> }> {
  const policy = await luna('com.webos.service.preloadmanager/getPreloadPolicy', {});
  const applications = field(policy, 'applications');
  if (!Array.isArray(applications)) {
    throw new Error('This TV does not expose preload policies.');
  }
  const before = settings.before || {};
  if (!isObject(before)) {
    throw new TypeError('Invalid preload settings');
  }
  let matched = 0;
  for (const app of applications) {
    const id = field(app, 'id');
    const isEnabled = field(app, 'isEnabled');
    if (typeof id !== 'string' || !PRELOAD_APPS.has(id) || typeof isEnabled !== 'boolean') {
      continue;
    }
    matched++;
    if (!(id in before)) {
      before[id] = isEnabled;
    }
    const enabled = restore ? before[id] : false;
    if (isEnabled !== enabled) {
      await luna('com.webos.service.preloadmanager/setPreloadPolicy', {
        application: { id, isEnabled: enabled },
      });
    }
  }
  if (!matched) {
    throw new Error('Video preload policies are not ready yet.');
  }
  return { enabled: !restore, before };
}
