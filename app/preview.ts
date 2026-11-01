/* Preview bridge: only ever constructed for ?preview=… in a non-webOS browser, never
   exposed on window, and every value is labelled "Sample". */

import type { TvBridge } from './bridge';
import { pad } from './util';

export const PREVIEW_KINDS = ['sample', 'empty', 'error'] as const;
export type PreviewKind = (typeof PREVIEW_KINDS)[number];

type Glyph = 'dot' | 'tri' | 'bars' | 'ring' | 'wave' | 'plus';

/* Abstract sample icons: plain geometric glyphs, deliberately not brand marks.
   They only exercise the icon path (colour extraction, framing). */
const SHAPES: Readonly<Record<Glyph, string>> = {
  dot: '<circle cx="48" cy="48" r="20" fill="#fff"/>',
  tri: '<path d="M38 30v36l30-18z" fill="#fff"/>',
  bars: '<path d="M30 36h36M30 48h36M30 60h24" stroke="#fff" stroke-width="7" stroke-linecap="round"/>',
  ring: '<circle cx="48" cy="48" r="18" fill="none" stroke="#fff" stroke-width="8"/>',
  wave: '<path d="M26 56c8-16 14-16 22 0s14 16 22 0" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/>',
  plus: '<path d="M48 30v36M30 48h36" stroke="#fff" stroke-width="8" stroke-linecap="round"/>',
};

function sampleIcon(bg: string, glyph: Glyph): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="18" fill="${bg}"/>${SHAPES[glyph]}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function later(ms: number): Promise<void> {
  return new Promise((r) => {
    setTimeout(r, ms);
  });
}

function fail(ms: number): Promise<never> {
  return later(ms).then(() => {
    throw new Error('Preview: simulated bridge failure');
  });
}

function at(dayOffset: number, hours: number, minutes: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

function ymd(dayOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sampleState() {
  const now = new Date();
  const nowStart = new Date(now.getTime() - 25 * 60_000);
  const nowEnd = new Date(now.getTime() + 35 * 60_000);
  return {
    apps: [
      { id: 'youtube.leanback.v4', title: 'YouTube', icon: sampleIcon('#b8322c', 'tri') },
      { id: 'tv.twitch.tv.starshot.lg', title: 'Twitch', icon: sampleIcon('#6c46c4', 'bars') },
      { id: 'spotify-beehive', title: 'Spotify', icon: sampleIcon('#1f8f50', 'wave') },
      { id: 'netflix', title: 'Netflix', icon: sampleIcon('#141414', 'ring') },
      { id: 'amazon', title: 'Prime Video', icon: sampleIcon('#1d6fa8', 'dot') },
      { id: 'com.disney.disneyplus-prod', title: 'Disney+' },
      { id: 'sample.mediathek', title: 'Sample Mediathek', icon: sampleIcon('#2a6f6a', 'plus') },
      { id: 'sample.radio', title: 'Sample Radio' },
    ],
    inputs: [
      { id: 'com.webos.app.hdmi1', title: 'HDMI 1', connected: true },
      { id: 'com.webos.app.hdmi2', title: 'HDMI 2', connected: false },
      { id: 'com.webos.app.hdmi3', title: 'HDMI 3' },
      { id: 'com.webos.app.hdmi4', title: 'HDMI 4', connected: false },
    ],
    recent: [
      { id: 'netflix', title: 'Netflix' },
      { id: 'youtube.leanback.v4', title: 'YouTube' },
      { id: 'spotify-beehive', title: 'Spotify' },
      { id: 'sample.mediathek', title: 'Sample Mediathek' },
    ],
    health: {
      temperature: 46,
      memoryUsedPercent: 41,
      uptimeSeconds: 3 * 86_400 + 4 * 3600 + 720,
      model: 'Sample TV',
      firmware: 'sample',
    },
    privacy: { summary: 'Sample: 3 telemetry hosts blocked', trackingOff: true, adBlocking: true },
    calendar: {
      configured: true,
      updatedAt: now.getTime() - 6 * 60_000,
      events: [
        {
          title: 'Sample · Laundry running',
          start: nowStart.toISOString(),
          end: nowEnd.toISOString(),
        },
        { title: 'Sample · Film night', start: at(0, 20, 15), end: at(0, 22, 0) },
        { title: 'Sample · Recycling day', start: ymd(1) },
        { title: 'Sample · Dentist', start: at(1, 9, 30), end: at(1, 10, 0) },
        { title: 'Sample · Football', start: at(2, 18, 0), end: at(2, 19, 30) },
      ],
    },
    weather: {
      configured: true,
      temperature: 9,
      condition: 'Light rain',
      city: 'Sample City',
      updatedAt: now.getTime() - 12 * 60_000,
    },
    smartHome: { configured: false, devices: [] },
  };
}

const EMPTY_STATE = {
  apps: [],
  inputs: [],
  recent: [],
  health: {},
  privacy: {},
  calendar: { configured: false, events: [] },
  weather: { configured: false },
  smartHome: { configured: false, devices: [] },
};

function sampleWeather() {
  const start = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  return {
    configured: true,
    city: 'Sample City',
    temperature: 9,
    feelsLike: 7,
    code: 3,
    wind: 12,
    humidity: 78,
    isDay: true,
    updatedAt: Date.now(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    location: { latitude: 48, longitude: 11 },
    hourly: Array.from({ length: 24 }, (_, i) => ({
      time: start + i * 3_600_000,
      temperature: 9 + Math.round(Math.sin(i / 5) * 4),
      code: i < 6 ? 61 : 3,
      probability: i < 6 ? 60 + i * 4 : 20,
      precipitation: i < 6 ? 0.4 : 0,
      wind: 12,
    })),
    daily: Array.from({ length: 7 }, (_, i) => ({
      time: Date.now() + i * 86_400_000,
      code: i % 3 === 0 ? 61 : 3,
      high: 12 + (i % 3),
      low: 4 + (i % 3),
      probability: 30 + i * 5,
      precipitation: i % 3,
      wind: 15,
      sunrise: Date.now(),
      sunset: Date.now() + 36_000_000,
    })),
  };
}

const SAMPLE_PLACES = [
  { label: 'Sample City', region: 'Sample Region, Sample Country', latitude: 10, longitude: 20 },
  { label: 'Sample Town', region: 'Sample Region, Sample Country', latitude: 11, longitude: 21 },
  { label: 'Sample Place', region: 'Sample Region, Sample Country', latitude: 12, longitude: 22 },
  { label: 'Sample Village', region: 'Sample Region, Sample Country', latitude: 13, longitude: 23 },
];

export function makePreviewBridge(kind: PreviewKind): TvBridge {
  // The sample is fixed when the preview starts, like a TV's state at that moment.
  const sample = sampleState();
  const ok = (): Promise<unknown> =>
    kind === 'error' ? fail(500) : later(250).then(() => ({ ok: true, preview: true }));
  return {
    getState: () => {
      if (kind === 'error') {
        return fail(400);
      }
      return later(300).then(() => structuredClone(kind === 'empty' ? EMPTY_STATE : sample));
    },
    getWeather: () =>
      later(200).then(() => {
        if (kind === 'error') {
          throw new Error('Preview unavailable');
        }
        if (kind === 'empty') {
          return { configured: false };
        }
        return sampleWeather();
      }),
    capabilities: { configureWeather: kind === 'sample' },
    launch: ok,
    setSleepTimer: ok,
    screenOff: ok,
    openLgHome: ok,
    openSettings: ok,
    ...(kind === 'sample'
      ? {
          configureWeather: ok,
          searchWeather: () => later(100).then(() => ({ places: structuredClone(SAMPLE_PLACES) })),
        }
      : {}),
  };
}
