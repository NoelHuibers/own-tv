/* The TV state as the dashboard uses it. normalizeState checks every field the bridge
   reports: missing means unavailable, never zero. */

import { t } from './text';
import { clip, finite, isObj, str } from './util';

export interface TvApp {
  readonly id: string;
  readonly title: string;
  readonly icon: string | null;
}

export interface TvInput {
  readonly id: string;
  readonly title: string;
  readonly connected: boolean | null;
}

export interface RecentApp {
  readonly id: string;
  readonly title: string;
}

export interface TvHealth {
  readonly panelHours: number | null;
  readonly webos: string;
  readonly temperature: number | null;
  readonly idleReleaseSupported: boolean;
  lowMemoryMode: boolean;
  readonly directHome: boolean;
  readonly directHomeFailure: string;
  readonly memoryUsedPercent: number | null;
  readonly memoryAvailableMB: number | null;
  readonly memoryTotalMB: number | null;
  readonly memoryCachedMB: number | null;
  readonly swapUsedMB: number | null;
  readonly uptimeSeconds: number | null;
  readonly model: string | null;
  readonly firmware: string | null;
}

export interface TvPrivacy {
  readonly summary: string | null;
  readonly trackingOff: boolean | null;
  readonly adBlocking: boolean | null;
}

export interface CalendarSource {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly catalogId: string;
  readonly connected: boolean;
  readonly stale: boolean;
}

export interface CalendarEvent {
  readonly title: string;
  readonly start: Date;
  readonly end: Date;
  readonly allDay: boolean;
  readonly calendar: string;
}

export interface TvCalendar {
  readonly configured: boolean;
  readonly error: boolean;
  readonly partial: boolean;
  readonly busyOnly: boolean;
  readonly sources: readonly CalendarSource[];
  readonly updatedAt: number | null;
  readonly events: readonly CalendarEvent[];
}

export interface SolarEntry {
  readonly start: number | null;
  readonly end: number | null;
  readonly sunrise: number | null;
  readonly sunset: number | null;
}

export interface TvWeather {
  readonly configured: boolean;
  readonly temperature: number | null;
  readonly condition: string | null;
  readonly city: string | null;
  readonly solar: readonly SolarEntry[];
  readonly error: boolean;
  readonly updatedAt: number | null;
}

export interface SmartHomeDevice {
  readonly name: string;
  readonly state: string | null;
}

export interface TvSmartHome {
  readonly configured: boolean;
  readonly devices: readonly SmartHomeDevice[];
}

/** Either when the TV will sleep, or that no timer runs. */
export interface SleepTimer {
  readonly endsAt?: number;
  readonly off?: true;
}

export interface TvState {
  readonly apps: readonly TvApp[] | null;
  readonly inputs: readonly TvInput[] | null;
  recent: readonly RecentApp[] | null;
  readonly health: TvHealth | null;
  readonly privacy: TvPrivacy | null;
  readonly calendar: TvCalendar | null;
  readonly weather: TvWeather | null;
  readonly smartHome: TvSmartHome | null;
  sleepTimer: SleepTimer | null;
}

/** Only local or inline images: no remote hosts. */
function safeIcon(v: unknown): string | null {
  if (typeof v !== 'string' || !v) {
    return null;
  }
  if (/^data:image\/(png|jpe?g|webp|svg\+xml);/i.test(v)) {
    return v;
  }
  if (/^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/|file:\/\/\/|\/)/i.test(v)) {
    return v;
  }
  if (/^[\w./-]+\.(png|jpe?g|webp|svg)$/i.test(v) && !v.includes('..')) {
    return v;
  }
  return null;
}

interface When {
  readonly d: Date;
  readonly allDay: boolean;
}

/** Seconds or milliseconds since the epoch, an ISO time, or an all-day YYYY-MM-DD. */
function parseWhen(v: unknown): When | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return { d: new Date(v < 1e12 ? v * 1000 : v), allDay: false };
  }
  if (typeof v !== 'string') {
    return null;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) {
    return { d: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), allDay: true };
  }
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : { d: new Date(ms), allDay: false };
}

function stamp(v: unknown): number | null {
  const w = parseWhen(v);
  return w && !w.allDay ? w.d.getTime() : null;
}

function list(v: unknown, max?: number): Record<string, unknown>[] | null {
  return Array.isArray(v) ? v.filter(isObj).slice(0, max || 200) : null;
}

function health(h: Record<string, unknown>): TvHealth {
  return {
    panelHours: finite(h.panelHours),
    webos: str(h.webos),
    temperature: finite(h.temperature),
    idleReleaseSupported: h.idleReleaseSupported === true,
    lowMemoryMode: h.lowMemoryMode === true,
    directHome: h.directHome === true,
    directHomeFailure: str(h.directHomeFailure),
    memoryUsedPercent: finite(h.memoryUsedPercent),
    memoryAvailableMB: finite(h.memoryAvailableMB),
    memoryTotalMB: finite(h.memoryTotalMB),
    memoryCachedMB: finite(h.memoryCachedMB),
    swapUsedMB: finite(h.swapUsedMB),
    uptimeSeconds: finite(h.uptimeSeconds),
    model: str(h.model) ? clip(str(h.model), 40) : null,
    firmware: str(h.firmware) ? clip(str(h.firmware), 40) : null,
  };
}

function calendarEvent(e: Record<string, unknown>): CalendarEvent | null {
  const s = parseWhen(e.start);
  if (!s) {
    return null;
  }
  const en = parseWhen(e.end);
  let end: Date;
  if (en) {
    end = en.d;
  } else if (s.allDay) {
    end = new Date(s.d.getFullYear(), s.d.getMonth(), s.d.getDate() + 1);
  } else {
    end = new Date(s.d.getTime() + 3_600_000);
  }
  return {
    title: clip(e.title === 'Busy' ? t('cal.busy') : str(e.title) || '—', 60),
    start: s.d,
    end,
    allDay: s.allDay || e.allDay === true,
    calendar: clip(str(e.calendar) || '', 60),
  };
}

function calendar(c: Record<string, unknown>): TvCalendar {
  return {
    configured: c.configured === true,
    error: Boolean(c.error),
    partial: Boolean(c.partial),
    busyOnly: c.busyOnly !== false,
    sources: (list(c.sources, 16) || []).map((s) => ({
      id: clip(str(s.id) || '', 24),
      name: clip(str(s.name) || 'Calendar', 60),
      enabled: s.enabled !== false,
      catalogId: clip(str(s.catalogId) || '', 80),
      connected: s.connected === true,
      stale: s.stale === true,
    })),
    updatedAt: stamp(c.updatedAt),
    events: (list(c.events, 200) || [])
      .map(calendarEvent)
      .filter((e): e is CalendarEvent => e !== null)
      .sort((a, b) => a.start.getTime() - b.start.getTime()),
  };
}

function weather(w: Record<string, unknown>): TvWeather {
  return {
    configured: w.configured === true,
    temperature: finite(w.temperature),
    condition: str(w.condition) ? clip(str(w.condition), 32) : null,
    city: str(w.city) ? clip(str(w.city), 32) : null,
    solar: (list(w.solar, 8) || []).map((d) => ({
      start: finite(d.start),
      end: finite(d.end),
      sunrise: finite(d.sunrise),
      sunset: finite(d.sunset),
    })),
    error: Boolean(w.error),
    updatedAt: stamp(w.updatedAt),
  };
}

function sleepTimer(raw: Record<string, unknown>): SleepTimer | null {
  // Optional extension (see DESIGN.md): sleepTimer: { endsAt } | null
  if (!('sleepTimer' in raw)) {
    return null;
  }
  const st = raw.sleepTimer;
  if (st === null) {
    return { off: true };
  }
  if (!isObj(st)) {
    return null;
  }
  const ends = parseWhen(st.endsAt);
  const rem = finite(st.minutesRemaining);
  if (ends) {
    return { endsAt: ends.d.getTime() };
  }
  if (rem !== null) {
    return rem > 0 ? { endsAt: Date.now() + rem * 60_000 } : { off: true };
  }
  return null;
}

export function normalizeState(input: unknown): TvState {
  const raw = isObj(input) ? input : {};
  const apps = list(raw.apps, 400);
  const inputs = list(raw.inputs, 12);
  const recent = list(raw.recent, 20);
  return {
    apps: apps
      ? apps
          .filter((a) => str(a.id))
          .map((a) => ({
            id: str(a.id),
            title: clip(str(a.title) || str(a.id), 48),
            icon: safeIcon(a.icon),
          }))
      : null,
    inputs: inputs
      ? inputs
          .filter((i) => str(i.id))
          .map((i) => ({
            id: str(i.id),
            title: clip(str(i.title) || str(i.id), 32),
            connected: typeof i.connected === 'boolean' ? i.connected : null,
          }))
      : null,
    recent: recent
      ? recent
          .filter((r) => str(r.id))
          .map((r) => ({ id: str(r.id), title: clip(str(r.title) || str(r.id), 48) }))
      : null,
    health: isObj(raw.health) ? health(raw.health) : null,
    privacy: isObj(raw.privacy)
      ? {
          summary: str(raw.privacy.summary) ? clip(str(raw.privacy.summary), 80) : null,
          trackingOff:
            typeof raw.privacy.trackingOff === 'boolean' ? raw.privacy.trackingOff : null,
          adBlocking: typeof raw.privacy.adBlocking === 'boolean' ? raw.privacy.adBlocking : null,
        }
      : null,
    calendar: isObj(raw.calendar) ? calendar(raw.calendar) : null,
    weather: isObj(raw.weather) ? weather(raw.weather) : null,
    smartHome: isObj(raw.smartHome)
      ? {
          configured: raw.smartHome.configured === true,
          devices: (list(raw.smartHome.devices, 24) || []).map((d) => ({
            name: clip(str(d.title) || str(d.name) || str(d.id) || '—', 32),
            state: str(d.state) ? clip(str(d.state), 20) : null,
          })),
        }
      : null,
    sleepTimer: sleepTimer(raw),
  };
}
