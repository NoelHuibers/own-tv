/* Preferences (non-secret only), stored under owntv.preferences.v1 and mirrored to the
   TV helper. sanitizePrefs whitelists every field of stored, imported and synced copies. */

import { CATALOG, validAppKey } from './catalog';
import { type LanguagePack, locale, validatePack } from './i18n';
import { languageBase, t } from './text';
import {
  cleanText,
  clip,
  finite,
  hm,
  isObj,
  looksSecret,
  message,
  oneOf,
  parseHM,
  round2,
} from './util';

export const WIDGETS = ['weather', 'calendar', 'sleep', 'health', 'smartHome', 'inputs'] as const;
export type WidgetKey = (typeof WIDGETS)[number];
// accepted silently from older exports, then dropped
const LEGACY_WIDGETS: readonly string[] = ['dayRuler', 'recent'];
export const STYLES = ['ambient', 'quiet', 'compact'] as const;
export type Style = (typeof STYLES)[number];
export const IDLE_CHOICES = [0, 2, 5, 10, 20] as const;
export type IdleMinutes = (typeof IDLE_CHOICES)[number];
export const THEME_MODES = ['auto', 'day', 'night'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
export const AUTO_SOURCES = ['schedule', 'system', 'sun'] as const;
export type AutoSource = (typeof AUTO_SOURCES)[number];
export const MOTIONS = ['system', 'reduced'] as const;
export type Motion = (typeof MOTIONS)[number];
export type AppSort = 'recent' | 'manual';

export interface ThemePrefs {
  mode: ThemeMode;
  autoSource: AutoSource;
  /** HH:MM */
  dayStart: string;
  /** HH:MM */
  nightStart: string;
}

export interface AppPrefs {
  sort: AppSort;
  /** Catalogue keys and `app:<id>` keys, in rail order. */
  order: string[];
  hidden: string[];
  /** Names of `app:` entries, remembered for when the TV doesn't list them. */
  labels: Record<string, string>;
}

export interface WeatherPrefs {
  label: string;
  latitude: number | null;
  longitude: number | null;
}

export interface Prefs {
  schema: 1;
  language: string;
  languagePack: LanguagePack | null;
  name: string;
  style: Style;
  theme: ThemePrefs;
  motion: Motion;
  idleDimMinutes: IdleMinutes;
  pixelShift: boolean;
  apps: AppPrefs;
  widgets: Record<WidgetKey, boolean>;
  weather: WeatherPrefs;
}

/** Errors block an import; warnings report dropped values. */
export interface ImportReport {
  errors: string[];
  warnings: string[];
}

const DAY_START = '07:00';
const NIGHT_START = '19:30';
const DAY_START_MINUTES = 7 * 60;
const NIGHT_START_MINUTES = 19 * 60 + 30;

export function defaultPrefs(): Prefs {
  return {
    schema: 1,
    language: 'en',
    languagePack: null,
    name: '',
    style: 'ambient',
    theme: { mode: 'auto', autoSource: 'schedule', dayStart: DAY_START, nightStart: NIGHT_START },
    motion: 'system',
    idleDimMinutes: 5,
    pixelShift: true,
    apps: { sort: 'recent', order: CATALOG.map((c) => c.key), hidden: [], labels: {} },
    widgets: {
      weather: true,
      calendar: true,
      sleep: true,
      health: true,
      smartHome: true,
      inputs: false,
    },
    weather: { label: '', latitude: null, longitude: null },
  };
}

const KNOWN = new Set([
  'schema',
  'language',
  'languagePack',
  'name',
  'style',
  'theme',
  'motion',
  'idleDimMinutes',
  'pixelShift',
  'apps',
  'widgets',
  'weather',
]);
const THEME_KEYS: readonly string[] = ['mode', 'autoSource', 'dayStart', 'nightStart'];

/** A clean copy of `raw` with every unknown or invalid value dropped (and reported). */
export function sanitizePrefs(
  raw: unknown,
  rep: ImportReport = { errors: [], warnings: [] },
): Prefs {
  const out = defaultPrefs();
  if (!isObj(raw)) {
    rep.errors.push(t('imp.notObject'));
    return out;
  }
  for (const k of Object.keys(raw)) {
    if (!KNOWN.has(k)) {
      rep.warnings.push(t('imp.unknown', { key: clip(k, 32) }));
    }
  }
  const bad = (key: string): void => {
    rep.warnings.push(t('imp.invalid', { key }));
  };
  const secret = (key: string): void => {
    rep.errors.push(t('imp.secret', { key }));
  };

  if ('language' in raw) {
    const language = locale(raw.language);
    if (language) {
      out.language = language;
    } else {
      bad('language');
    }
  }
  if (raw.languagePack) {
    try {
      out.languagePack = validatePack(raw.languagePack, languageBase(raw.languagePack));
    } catch (e) {
      rep.errors.push(message(e));
    }
  }
  if ('style' in raw) {
    const style = raw.style;
    if (oneOf(STYLES, style)) {
      out.style = style;
    } else {
      bad('style');
    }
  }
  if ('name' in raw) {
    const n = cleanText(raw.name, 24);
    if (n === null) {
      bad('name');
    } else if (looksSecret(n)) {
      secret('name');
    } else {
      out.name = n;
    }
  }
  if ('theme' in raw) {
    sanitizeTheme(raw.theme, out.theme, rep, bad);
  }
  if ('motion' in raw) {
    const motion = raw.motion;
    if (oneOf(MOTIONS, motion)) {
      out.motion = motion;
    } else {
      bad('motion');
    }
  }
  if ('idleDimMinutes' in raw) {
    const idle = raw.idleDimMinutes;
    if (oneOf(IDLE_CHOICES, idle)) {
      out.idleDimMinutes = idle;
    } else {
      bad('idleDimMinutes');
    }
  }
  if ('pixelShift' in raw) {
    if (typeof raw.pixelShift === 'boolean') {
      out.pixelShift = raw.pixelShift;
    } else {
      bad('pixelShift');
    }
  }
  if ('apps' in raw) {
    sanitizeApps(raw.apps, out.apps, rep, bad, secret);
  }
  if ('widgets' in raw) {
    const w = raw.widgets;
    if (isObj(w)) {
      for (const k of Object.keys(w)) {
        if (LEGACY_WIDGETS.includes(k)) {
          continue;
        }
        if (!oneOf(WIDGETS, k)) {
          rep.warnings.push(t('imp.unknown', { key: `widgets.${clip(k, 24)}` }));
          continue;
        }
        const on = w[k];
        if (typeof on === 'boolean') {
          out.widgets[k] = on;
        } else {
          bad(`widgets.${k}`);
        }
      }
    } else {
      bad('widgets');
    }
  }
  if ('weather' in raw) {
    const wx = raw.weather;
    if (isObj(wx)) {
      const label = wx.label === undefined || wx.label === null ? '' : cleanText(wx.label, 40);
      const lat = finite(wx.latitude);
      const lon = finite(wx.longitude);
      if (label === null) {
        bad('weather.label');
      } else if (looksSecret(label)) {
        secret('weather.label');
      } else if (lat === null && lon === null && wx.latitude == null && wx.longitude == null) {
        out.weather.label = label;
      } else if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        bad('weather.coordinates');
      } else {
        out.weather = { label, latitude: round2(lat), longitude: round2(lon) };
      }
    } else {
      bad('weather');
    }
  }
  return out;
}

function sanitizeTheme(
  th: unknown,
  out: ThemePrefs,
  rep: ImportReport,
  bad: (key: string) => void,
): void {
  if (!isObj(th)) {
    bad('theme');
    return;
  }
  if ('mode' in th) {
    const mode = th.mode;
    if (oneOf(THEME_MODES, mode)) {
      out.mode = mode;
    } else {
      bad('theme.mode');
    }
  }
  if ('autoSource' in th) {
    const source = th.autoSource;
    if (oneOf(AUTO_SOURCES, source)) {
      out.autoSource = source;
    } else {
      bad('theme.autoSource');
    }
  }
  let ds = 'dayStart' in th ? parseHM(th.dayStart) : DAY_START_MINUTES;
  let ns = 'nightStart' in th ? parseHM(th.nightStart) : NIGHT_START_MINUTES;
  if (ds === null) {
    bad('theme.dayStart');
    ds = DAY_START_MINUTES;
  }
  if (ns === null) {
    bad('theme.nightStart');
    ns = NIGHT_START_MINUTES;
  }
  if (ds === ns) {
    rep.warnings.push(t('imp.sameHours'));
  } else {
    out.dayStart = hm(ds);
    out.nightStart = hm(ns);
  }
  for (const k of Object.keys(th)) {
    if (!THEME_KEYS.includes(k)) {
      rep.warnings.push(t('imp.unknown', { key: `theme.${clip(k, 24)}` }));
    }
  }
}

function sanitizeApps(
  a: unknown,
  out: AppPrefs,
  rep: ImportReport,
  bad: (key: string) => void,
  secret: (key: string) => void,
): void {
  if (!isObj(a)) {
    bad('apps');
    return;
  }
  if (a.sort === 'manual' || a.sort === 'recent') {
    out.sort = a.sort;
  }
  const seen = new Set<string>();
  const order: string[] = [];
  for (const k of Array.isArray(a.order) ? a.order : []) {
    if (typeof k === 'string' && looksSecret(k) && !validAppKey(k)) {
      secret('apps.order');
      continue;
    }
    if (!validAppKey(k)) {
      rep.warnings.push(t('imp.appKey'));
      continue;
    }
    if (!seen.has(k)) {
      seen.add(k);
      order.push(k);
    }
  }
  if (!Array.isArray(a.order) && 'order' in a) {
    bad('apps.order');
  }
  // Must-have favourites are always present (append any that are missing).
  for (const c of CATALOG) {
    if (!seen.has(c.key)) {
      seen.add(c.key);
      order.push(c.key);
    }
  }
  out.order = order;
  const hidden: unknown[] = Array.isArray(a.hidden) ? a.hidden : [];
  out.hidden = hidden
    .filter((k): k is string => validAppKey(k) && seen.has(k))
    .filter((k, i, arr) => arr.indexOf(k) === i);
  const labels = a.labels;
  if (isObj(labels)) {
    for (const k of Object.keys(labels)) {
      if (!(validAppKey(k) && k.startsWith('app:'))) {
        rep.warnings.push(t('imp.appKey'));
        continue;
      }
      const l = cleanText(labels[k], 48);
      if (l === null) {
        bad('apps.labels');
        continue;
      }
      if (looksSecret(l)) {
        secret('apps.labels');
        continue;
      }
      out.labels[k] = l;
    }
  }
}
