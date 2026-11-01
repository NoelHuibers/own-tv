/* Own TV dashboard: state, rendering, colour extraction, D-pad navigation, settings and
   preference sync. No dependencies and no network access of its own: all TV data comes
   from the bridge (bridge.ts). Sample data exists only in explicit browser preview mode
   (?preview=sample). */

import type { BridgeMethod, BridgeMethods, CalendarSourceChange, TvBridge } from './bridge';
import { APP_ID_RE, CATALOG_BY_KEY, EXTRA_ART, validAppKey } from './catalog';
import { hashStr, lumOf, mix, monoFor, readTone, type Tone } from './colour';
import { $, add, type Child, h, htmlAll, icon, isList, need } from './dom';
import { direction, locale, matches, translate, validatePack } from './i18n';
import { recentFirst } from './order';
import {
  AUTO_SOURCES,
  defaultPrefs,
  IDLE_CHOICES,
  type ImportReport,
  MOTIONS,
  type Prefs,
  STYLES,
  sanitizePrefs,
  THEME_MODES,
  type ThemeMode,
  WIDGETS,
  type WidgetKey,
} from './prefs';
import { makePreviewBridge, PREVIEW_KINDS, type PreviewKind } from './preview';
import { period as solarPeriod, theme as solarTheme } from './solar';
import type { CalendarEvent, CalendarSource, TvHealth, TvPrivacy, TvState } from './state';
import { normalizeState } from './state';
import type { StringKey } from './strings';
import { calText, fmtDate, fmtNum, fmtTime, fmtUptime, languageBase, t, useLanguage } from './text';
import {
  cleanText,
  clip,
  field,
  finite,
  hm,
  isObj,
  looksSecret,
  message,
  oneOf,
  pad,
  parseHM,
  round2,
  str,
} from './util';
import { VERSION } from './version';
import { createWeatherView, type WeatherView } from './weather-view';

const STORE_KEY = 'owntv.preferences.v1';
const EXPORT_KIND = 'owntv.preferences';
const POLL_MS = 60 * 1000;
const CALL_TIMEOUT_MS = 65 * 1000; // TV helper spawns node; allow cold starts
const STALE_MS = 3 * 60 * 1000;
const MAX_IMPORT_CHARS = 64 * 1024;
const UA = navigator.userAgent || '';
const IS_WEBOS = /Web0S|webOS|NetCast/i.test(UA) || typeof window.PalmSystem !== 'undefined';
const root = document.documentElement;
const SLEEP_CHOICES = [10, 30, 60, 90, 120] as const;

type Timer = ReturnType<typeof setTimeout>;
type ToastKind = 'info' | 'ok' | 'error';

/* ======================================================================
   Preferences: local storage and sync bookkeeping
   ====================================================================== */
let storageOk = true;
let hadStoredPrefs = false;
/* Revision-based sync with the TV helper (see DESIGN.md §8):
   - lastRemoteRevision: the helper revision our prefs correspond to.
   - prefsDirty: a local change that the helper has not confirmed yet.
   Both persist, so a reload never lets an older helper copy overwrite an
   unsaved local change, and a newer helper copy is adopted within a poll. */
const SYNC_KEY = 'owntv.sync.v1';
let lastRemoteRevision = 0;
let prefsDirty = false;

function loadSync(): void {
  try {
    const s: unknown = JSON.parse(window.localStorage.getItem(SYNC_KEY) || 'null');
    if (isObj(s)) {
      if (typeof s.revision === 'number' && Number.isFinite(s.revision) && s.revision >= 0) {
        lastRemoteRevision = s.revision;
      }
      prefsDirty = s.dirty === true;
    }
  } catch {
    /* ignore */
  }
}
function saveSync(): void {
  try {
    window.localStorage.setItem(
      SYNC_KEY,
      JSON.stringify({ revision: lastRemoteRevision, dirty: prefsDirty }),
    );
  } catch {
    /* ignore */
  }
}
function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) {
      return defaultPrefs();
    }
    hadStoredPrefs = true;
    return sanitizePrefs(JSON.parse(raw));
  } catch {
    return defaultPrefs();
  }
}
function savePrefs(quiet?: boolean): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
    storageOk = true;
  } catch {
    if (storageOk && !quiet) {
      toast(t('toast.storage'), 'error');
    }
    storageOk = false;
  }
}

let prefs: Prefs = defaultPrefs();

/* ======================================================================
   Rendering helpers
   ====================================================================== */
function na(text?: string): HTMLElement {
  return h('span', { class: 'na' }, text || t('na'));
}
/* Why a value is missing: no bridge, still loading, bridge failing, or not reported. */
function naText(): string {
  if (Bridge.mode === 'none') {
    return t('na.bridge');
  }
  if (!state.data) {
    return state.error ? t('na.error') : t('na.loading');
  }
  return t('na.field');
}

/* Replace a region's children only if the markup changed; keep focus stable.
   While focus is being restored, focus-driven behaviour (settings sections
   following focus) is paused so a re-render never changes the section. */
let restoringFocus = false;
function patch(container: HTMLElement, nodes: Child): boolean {
  const tmp = document.createElement('div');
  add(tmp, nodes);
  if (tmp.innerHTML === container.innerHTML) {
    return false;
  }
  const oldRail = container.querySelector('.cards');
  const railScroll = oldRail ? oldRail.scrollLeft : 0;
  const active = document.activeElement;
  const inside = active !== null && container.contains(active);
  const fid = inside ? active.getAttribute('data-fid') : null;
  const alt = inside ? active.getAttribute('data-fid-alt') : null;
  container.textContent = '';
  while (tmp.firstChild) {
    container.appendChild(tmp.firstChild);
  }
  const newRail = container.querySelector('.cards');
  if (newRail) {
    newRail.scrollLeft = railScroll;
  }
  if (fid) {
    restoringFocus = true;
    try {
      restoreFocus(fid, alt);
    } finally {
      restoringFocus = false;
    }
  }
  return true;
}
function restoreFocus(fid: string, alt: string | null): void {
  root.classList.add('no-anim');
  const el = findFid(fid) || (alt ? findFid(alt) : null);
  if (el && isFocusable(el)) {
    el.focus({ preventScroll: true });
  } else {
    focusDefault();
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('no-anim');
    });
  });
}
function findFid(fid: string): HTMLElement | null {
  try {
    const el = document.querySelector(`[data-fid="${CSS.escape(fid)}"]`);
    return el instanceof HTMLElement ? el : null;
  } catch {
    return null;
  }
}

/* ======================================================================
   App artwork
   Card colour comes from the TV's own icon (see colour.ts). Results are
   cached per icon.
   ====================================================================== */
const NIGHT_BG = '#000000';
const DAY_BG = '#f2ebdf';

const artCache = new Map<string, Tone | 'pending' | 'none'>();
let artRenderTimer: Timer | undefined;
function iconTone(src: string): Tone | null {
  const c = artCache.get(src);
  if (c === 'pending') {
    return null;
  }
  if (c) {
    return c === 'none' ? null : c;
  }
  artCache.set(src, 'pending');
  const img = new Image();
  img.onload = () => {
    artCache.set(src, readTone(img) || 'none');
    queueArtRender();
  };
  img.onerror = () => {
    artCache.set(src, 'none');
  };
  img.src = src;
  return null;
}
function queueArtRender(): void {
  clearTimeout(artRenderTimer);
  artRenderTimer = setTimeout(() => {
    renderApps();
    renderShelf();
    if (ui.settingsOpen) {
      renderSettings();
    }
    refreshAtmo();
  }, 60);
}

interface Art {
  readonly vars: Readonly<Record<string, string>>;
  readonly glowN: string;
  readonly glowD: string;
}

/* Card colours for both themes. Night fields stay deep (OLED, dark room);
   day fields are fuller over warm paper. `glow` feeds the atmosphere. */
function artFor(app: RailApp): Art {
  const src = app.icon;
  let tone: string | null = null;
  let neutral = false;
  if (src) {
    const r = iconTone(src);
    if (r) {
      tone = r.tone;
      neutral = r.neutral;
    }
  }
  if (!tone) {
    tone = app.art;
  }
  let nField: string;
  let dField: string;
  let nGlow: string;
  let dGlow: string;
  if (neutral) {
    const light = lumOf(tone) > 0.4;
    nField = light ? '#24211d' : '#151413';
    dField = light ? '#e6ddcf' : '#2b2622';
    nGlow = '#1c1a17';
    dGlow = '#e3d8c6';
  } else {
    nField = mix(tone, NIGHT_BG, 0.5);
    dField = mix(tone, DAY_BG, 0.86);
    nGlow = mix(tone, NIGHT_BG, 0.3);
    dGlow = mix(tone, DAY_BG, 0.22);
  }
  const ink = (f: string): string => (lumOf(f) > 0.42 ? '#1d1914' : '#fbf6ee');
  return {
    vars: { '--f-n': nField, '--i-n': ink(nField), '--f-d': dField, '--i-d': ink(dField) },
    glowN: nGlow,
    glowD: dGlow,
  };
}

/* Atmosphere: two stacked layers crossfade (opacity only, cheap on the TV)
   so the room light follows the focused card. Ambient style only (CSS). */
const atmo: { on: 0 | 1; key: string | null; timer: Timer | undefined } = {
  on: 0,
  key: null,
  timer: undefined,
};
function setAtmo(colour: string | null, xPct: number): void {
  const a = $('atmoA');
  const b = $('atmoB');
  if (!(a && b)) {
    return;
  }
  const layers = [a, b] as const;
  const key = colour ? `${colour}@${Math.round(xPct)}` : 'none';
  if (key === atmo.key) {
    return;
  }
  atmo.key = key;
  clearTimeout(atmo.timer);
  atmo.timer = setTimeout(() => {
    const cur = layers[atmo.on];
    const next = layers[atmo.on === 0 ? 1 : 0];
    if (colour) {
      next.style.setProperty('--ac', colour);
      next.style.setProperty('--ax', `${xPct.toFixed(1)}%`);
      next.classList.add('is-on');
    } else {
      next.classList.remove('is-on');
    }
    cur.classList.remove('is-on');
    atmo.on = atmo.on === 0 ? 1 : 0;
  }, 110);
}
function refreshAtmo(): void {
  if (
    document.hidden ||
    prefs.style !== 'ambient' ||
    prefs.motion === 'reduced' ||
    mqReduce?.matches
  ) {
    setAtmo(null, 50);
    return;
  }
  const el = document.activeElement;
  if (el?.classList?.contains('card') && !ui.settingsOpen) {
    const r = el.getBoundingClientRect();
    const x = ((r.left + r.width / 2) / Math.max(1, window.innerWidth)) * 100;
    const g = el.getAttribute(resolveTheme() === 'day' ? 'data-glow-d' : 'data-glow-n');
    setAtmo(g, x);
  } else {
    setAtmo(null, 50);
  }
}

/* ======================================================================
   Bridge adapter
   ====================================================================== */
const previewKind: PreviewKind | null = (() => {
  let p: string | null = null;
  try {
    p = new URLSearchParams(window.location.search).get('preview');
  } catch {
    p = null;
  }
  return !IS_WEBOS && oneOf(PREVIEW_KINDS, p) ? p : null;
})();

/** The real bridge for this page (bridge.ts), if any. */
let liveBridge: TvBridge | null = null;

type BridgeMode = 'live' | 'preview' | 'none';

class BridgeError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

const Bridge: {
  mode: BridgeMode;
  impl: TvBridge | null;
  via: 'preview' | 'tv' | 'editor' | 'unreachable' | 'missing';
  has(m: BridgeMethod): boolean;
  call<M extends BridgeMethod>(m: M, args: Parameters<BridgeMethods[M]>): Promise<unknown>;
} = {
  mode: 'none',
  impl: null,
  via: 'missing',
  // A method counts as available only if it exists and is not switched off in
  // the optional `capabilities` map (see DESIGN.md).
  has(m) {
    if (!this.impl || typeof this.impl[m] !== 'function') {
      return false;
    }
    const caps = this.impl.capabilities;
    return !(caps && typeof caps === 'object' && caps[m] === false);
  },
  call(m, args) {
    const impl = this.impl;
    if (!impl) {
      return Promise.reject(new BridgeError('nobridge'));
    }
    const fn = impl[m];
    if (typeof fn !== 'function') {
      return Promise.reject(new BridgeError('unsupported'));
    }
    let p: Promise<unknown>;
    try {
      p = Promise.resolve(Reflect.apply(fn, impl, args));
    } catch (e) {
      p = Promise.reject(e);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new BridgeError('timeout'));
      }, CALL_TIMEOUT_MS);
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e: unknown) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  },
};
function errText(e: unknown): string {
  if (field(e, 'code') === 'timeout') {
    return t('toast.timeout');
  }
  const name = field(e, 'name');
  if (name === 'SyntaxError') {
    return t('toast.badResponse');
  }
  if (name === 'TypeError' && /fetch|network/i.test(String(field(e, 'message')))) {
    return t('toast.unreachable');
  }
  const detail = field(e, 'message') || field(e, 'errorText') || field(e, 'error');
  const m = (detail ? String(detail) : String(e || '')).replace(/\s+/g, ' ').trim();
  return clip(m || 'unknown error', 140);
}

/* Mode selection:
   - live:    the bridge exists and can reach a TV (on the TV, or through the
              computer editor). A bridge that reports onTV:false and editor:false
              cannot reach anything and is treated as absent.
   - preview: explicit ?preview=… and provably not running on a TV.
   - none:    everything else. */
function attachBridge(): boolean {
  const live = liveBridge;
  const onTv = IS_WEBOS || live?.onTV === true;
  const usable =
    live !== null &&
    typeof live.getState === 'function' &&
    !(live.onTV === false && live.editor === false);
  if (previewKind && !onTv) {
    Bridge.mode = 'preview';
    Bridge.impl = makePreviewBridge(previewKind);
    Bridge.via = 'preview';
    return true;
  }
  if (usable) {
    Bridge.mode = 'live';
    Bridge.impl = live;
    Bridge.via = live.onTV !== true && live.editor === true ? 'editor' : 'tv';
    return true;
  }
  Bridge.mode = 'none';
  Bridge.impl = null;
  Bridge.via = live ? 'unreachable' : 'missing';
  return false;
}

/* ======================================================================
   State — missing means unavailable, never zero (see state.ts).
   ====================================================================== */
const state: {
  data: TvState | null;
  lastOk: number;
  error: unknown;
  loading: boolean;
  everFailed: boolean;
} = { data: null, lastOk: 0, error: null, loading: false, everFailed: false };
let sleepLocal: { endsAt: number } | null = null; // timer set from this dashboard (memory only)

/* ======================================================================
   Polling: once a minute, only while visible
   ====================================================================== */
let pollTimer: Timer | undefined;
function schedulePoll(): void {
  clearTimeout(pollTimer);
  if (document.hidden || weatherView) {
    return;
  }
  pollTimer = setTimeout(() => {
    refresh(false).then(schedulePoll);
  }, POLL_MS);
}
function refresh(manual: boolean): Promise<void> {
  if (!Bridge.impl) {
    renderAll();
    return Promise.resolve();
  }
  if (state.loading) {
    return Promise.resolve();
  }
  state.loading = true;
  renderTop();
  return Bridge.call('getState', [])
    .then(
      (raw) => {
        const wasFailing = Boolean(state.error);
        state.data = normalizeState(raw);
        adoptRemotePrefs(raw);
        state.lastOk = Date.now();
        state.error = null;
        if (wasFailing && state.everFailed) {
          toast(t('toast.stateBack'), 'ok');
        } else if (manual) {
          toast(t('toast.refreshed'), 'ok');
        }
      },
      (err: unknown) => {
        const first = !state.error;
        state.error = err;
        state.everFailed = true;
        if (first || manual) {
          toast(t('toast.stateErr', { msg: errText(err) }), 'error');
        }
      },
    )
    .then(() => {
      state.loading = false;
      renderAll();
    });
}

/* Adopt the helper's preferences when they are newer than ours and nothing
   local is waiting to be saved. Called on every successful getState(). */
let seededRemote = false;
function adoptRemotePrefs(raw: unknown): void {
  if (Bridge.mode !== 'live' || !isObj(raw)) {
    return;
  }
  let rev = Number(raw.preferencesRevision);
  if (!Number.isFinite(rev) || rev < 0) {
    rev = 0;
  }
  const remote = raw.preferences;
  if (!isObj(remote) || remote.schema !== 1) {
    // The helper has nothing yet: seed it once with this screen's preferences.
    if (hadStoredPrefs && !seededRemote && Bridge.has('savePreferences')) {
      seededRemote = true;
      syncPrefs();
    }
    return;
  }
  if (prefsDirty || syncInFlight) {
    // Our unsaved change wins; make sure it is on its way.
    if (prefsDirty && !syncInFlight && !syncTimer && Bridge.has('savePreferences')) {
      syncPrefs();
    }
    return;
  }
  if (hadStoredPrefs && rev <= lastRemoteRevision) {
    return;
  }
  const r: ImportReport = { errors: [], warnings: [] };
  const adopted = sanitizePrefs(remote, r);
  lastRemoteRevision = rev;
  hadStoredPrefs = true;
  saveSync();
  if (r.errors.length > 0) {
    return; // refuse a helper copy containing anything secret-shaped
  }
  if (JSON.stringify(adopted) === JSON.stringify(prefs)) {
    return;
  }
  prefs = adopted;
  ui.wxDraft = null;
  savePrefs(true);
  applyTheme();
}

/* ======================================================================
   Actions that reach the TV
   ====================================================================== */
function act<M extends BridgeMethod>(
  method: M,
  args: Parameters<BridgeMethods[M]>,
  label: string,
  onOk?: (reply: unknown) => void,
): Promise<boolean> {
  if (Bridge.mode === 'none') {
    toast(t('toast.noBridge', { action: label }), 'error');
    return Promise.resolve(false);
  }
  if (!Bridge.has(method)) {
    toast(t('toast.notSupported', { action: label }), 'error');
    return Promise.resolve(false);
  }
  return Bridge.call(method, args).then(
    (r) => {
      if (Bridge.mode === 'preview') {
        toast(t('toast.previewDid', { action: label }), 'info');
      }
      if (onOk) {
        onOk(r);
      }
      return true;
    },
    (err: unknown) => {
      const l = label.charAt(0).toUpperCase() + label.slice(1);
      toast(t('toast.err', { action: l, msg: errText(err) }), 'error');
      return false;
    },
  );
}

/* ======================================================================
   Apps: resolve rail entries against the bridge's app list
   ====================================================================== */
interface RailApp {
  readonly key: string;
  readonly title: string;
  readonly mono: string;
  readonly art: string;
  readonly launchId: string;
  readonly icon: string | null;
  /** Listed by the TV; null while the TV hasn't reported its apps. */
  readonly onTv: boolean | null;
  readonly builtin: boolean;
}

function norm(s: string | null | undefined): string {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
function resolveApp(key: string): RailApp {
  const apps = state.data?.apps;
  const reported = apps && apps.length > 0 ? false : null;
  const c = CATALOG_BY_KEY.get(key);
  if (c) {
    const found = apps?.find((a) => c.ids.includes(a.id) || c.names.includes(norm(a.title)));
    return {
      key,
      title: c.title,
      mono: c.mono,
      art: c.art,
      launchId: found ? found.id : c.ids[0],
      icon: found ? found.icon : null,
      onTv: found ? true : reported,
      builtin: true,
    };
  }
  const id = key.slice(4);
  const b = apps?.find((a) => a.id === id);
  const title = b?.title || prefs.apps.labels[key] || id;
  return {
    key,
    title,
    mono: monoFor(title),
    art: EXTRA_ART[hashStr(id) % EXTRA_ART.length] ?? EXTRA_ART[0],
    launchId: id,
    icon: b ? b.icon : null,
    onTv: b ? true : reported,
    builtin: false,
  };
}
function railApps(): RailApp[] {
  const items = prefs.apps.order.filter((k) => !prefs.apps.hidden.includes(k)).map(resolveApp);
  return recentFirst(items, state.data?.recent, prefs.apps.sort === 'manual');
}
function launchApp(app: RailApp, btn: Element | null): Promise<void> {
  if (btn) {
    btn.setAttribute('aria-busy', 'true');
  }
  return act('launch', [app.launchId], t('act.launch', { title: app.title })).then((ok) => {
    if (ok && state.data) {
      state.data.recent = [{ id: app.launchId, title: app.title }].concat(
        (state.data.recent || []).filter((a) => a.id !== app.launchId),
      );
      renderApps();
    }
    if (btn) {
      btn.removeAttribute('aria-busy');
    }
  });
}

/* ======================================================================
   Theme, motion, language
   ====================================================================== */
function media(query: string): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
}
const mqDark = media('(prefers-color-scheme: dark)');
const mqLight = media('(prefers-color-scheme: light)');
const mqReduce = media('(prefers-reduced-motion: reduce)');

function minutesNow(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}
function inDay(mins: number): boolean {
  const ds = parseHM(prefs.theme.dayStart) ?? 0;
  const ns = parseHM(prefs.theme.nightStart) ?? 0;
  return ds < ns ? mins >= ds && mins < ns : mins >= ds || mins < ns;
}
function resolveTheme(now?: Date): 'day' | 'night' {
  const m = prefs.theme.mode;
  if (m === 'day' || m === 'night') {
    return m;
  }
  if (prefs.theme.autoSource === 'sun') {
    const sun = solarTheme(state.data?.weather, Number(now || new Date()));
    if (sun) {
      return sun;
    }
  }
  if (prefs.theme.autoSource === 'system') {
    if (mqLight?.matches) {
      return 'day';
    }
    if (mqDark?.matches) {
      return 'night';
    }
  }
  return inDay(minutesNow(now || new Date())) ? 'day' : 'night';
}
function themeCaption(now?: Date): string {
  const shown = resolveTheme(now);
  const name = t(`theme.${shown}`);
  if (prefs.theme.mode !== 'auto') {
    return t('theme.cap.manual', { theme: name });
  }
  if (prefs.theme.autoSource === 'sun') {
    const solarDay = solarPeriod(state.data?.weather, Number(now || new Date()));
    return solarDay
      ? t('theme.cap.sun', {
          sunrise: fmtTime(new Date(solarDay.sunrise)),
          sunset: fmtTime(new Date(solarDay.sunset)),
        })
      : t('theme.cap.sunFallback');
  }
  if (prefs.theme.autoSource === 'system' && mqDark && (mqDark.matches || mqLight?.matches)) {
    return t('theme.cap.system', { theme: name });
  }
  return shown === 'day'
    ? t('theme.cap.schedule.day', { time: prefs.theme.nightStart })
    : t('theme.cap.schedule.night', { time: prefs.theme.dayStart });
}
function applyTheme(): void {
  const th = resolveTheme();
  let changed = false;
  if (root.getAttribute('data-theme') !== th) {
    root.setAttribute('data-theme', th);
    changed = true;
  }
  if (root.getAttribute('data-style') !== prefs.style) {
    root.setAttribute('data-style', prefs.style);
    changed = true;
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', th === 'day' ? DAY_BG : NIGHT_BG);
  }
  if (changed && $('atmoA')) {
    refreshAtmo();
  }
  if (changed && weatherView) {
    weatherView.themeChanged();
  }
  const reduce = prefs.motion === 'reduced' || mqReduce?.matches;
  root.setAttribute('data-motion', reduce ? 'reduced' : 'full');
  root.setAttribute('lang', prefs.language);
  root.setAttribute('dir', direction(prefs.language));
  document.title = t('doc.title');
}
function onMq(mq: MediaQueryList | null, fn: () => void): void {
  if (!mq) {
    return;
  }
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', fn);
  } else if (typeof mq.addListener === 'function') {
    mq.addListener(fn);
  }
}

/* ======================================================================
   Formatting
   ====================================================================== */
function greeting(d: Date): string {
  const hr = d.getHours();
  let g: StringKey = 'greet.night';
  if (hr >= 5 && hr < 12) {
    g = 'greet.morning';
  } else if (hr >= 12 && hr < 18) {
    g = 'greet.afternoon';
  } else if (hr >= 18 && hr < 23) {
    g = 'greet.evening';
  }
  return prefs.name ? t('greet.named', { greet: t(g), name: prefs.name }) : t(g);
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function dayLabel(d: Date, now: Date): string {
  const tom = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (sameDay(d, now)) {
    return t('cal.today');
  }
  if (sameDay(d, tom)) {
    return t('cal.tomorrow');
  }
  return fmtDate(d, { weekday: 'long', day: 'numeric', month: 'short' });
}

/* ======================================================================
   Render: banner + top bar
   ====================================================================== */
function bridgeStatus(): { dot: string; text: string } {
  if (Bridge.mode === 'preview' && previewKind) {
    return { dot: 'flag', text: t(`status.preview.${previewKind}`) };
  }
  if (Bridge.mode === 'none') {
    return { dot: 'hollow', text: t('status.none') };
  }
  if (!state.lastOk && state.error) {
    return { dot: 'bad', text: t('status.error') };
  }
  if (!state.lastOk) {
    return { dot: '', text: t('status.connecting') };
  }
  const stale = Date.now() - state.lastOk > STALE_MS || state.error;
  return stale
    ? { dot: 'warn', text: t('status.stale', { time: fmtTime(new Date(state.lastOk)) }) }
    : { dot: 'ok', text: t('status.updated', { time: fmtTime(new Date(state.lastOk)) }) };
}

function renderBanner(): void {
  const el = need('banner');
  root.classList.toggle('is-preview', Bridge.mode === 'preview');
  root.classList.toggle('is-nobridge', Bridge.mode === 'none');
  if (Bridge.mode === 'live') {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  const base = window.location.pathname;
  let nodes: Child;
  if (Bridge.mode === 'preview' && previewKind) {
    nodes = [
      h('strong', null, t('banner.label.preview')),
      h('span', { class: 'banner__text' }, t(`banner.preview.${previewKind}`)),
      previewKind === 'sample'
        ? null
        : h(
            'a',
            { href: `${base}?preview=sample`, 'data-fid': 'bn-sample' },
            t('banner.openSample'),
          ),
      previewKind === 'empty'
        ? null
        : h('a', { href: `${base}?preview=empty`, 'data-fid': 'bn-empty' }, t('banner.openEmpty')),
      h('a', { href: base, 'data-fid': 'bn-exit' }, t('banner.exit')),
    ];
  } else {
    nodes = [
      h('strong', null, t('banner.label.none')),
      h('span', { class: 'banner__text' }, IS_WEBOS ? t('banner.noneTv') : t('banner.none')),
      IS_WEBOS
        ? null
        : h(
            'a',
            { href: `${base}?preview=sample`, 'data-fid': 'bn-sample' },
            t('banner.openSample'),
          ),
      IS_WEBOS
        ? null
        : h('a', { href: `${base}?preview=empty`, 'data-fid': 'bn-empty' }, t('banner.openEmpty')),
    ];
  }
  patch(el, nodes);
}

/* Top bar: one clock, the date, and quiet icon actions whose labels unfold
   on focus. The bridge pill appears only when something needs attention. */
function topAction(
  action: string,
  fid: string,
  ic: string,
  label: string,
  extra?: { aria?: string; popup?: boolean },
): HTMLButtonElement {
  const props: Record<string, string> = {
    class: 'act',
    type: 'button',
    'data-action': action,
    'data-fid': fid,
    'aria-label': extra?.aria || label,
  };
  if (extra?.popup) {
    props['aria-haspopup'] = 'dialog';
  }
  return h('button', props, icon(ic), h('span', { class: 'act__l', 'aria-hidden': 'true' }, label));
}
function themeIcon(mode: ThemeMode): string {
  if (mode === 'auto') {
    return 'auto';
  }
  return mode === 'day' ? 'sun' : 'moon';
}
function renderTop(): void {
  const now = new Date();
  const st = bridgeStatus();
  const mode = prefs.theme.mode;
  const showPill = !(
    Bridge.mode === 'live' &&
    state.lastOk &&
    !state.error &&
    Date.now() - state.lastOk <= STALE_MS
  );
  patch(need('top'), [
    h(
      'div',
      { class: 'top__when' },
      h('span', { class: 'top__time', id: 'clock' }, fmtTime(now)),
      h('span', { class: 'top__date' }, fmtDate(now)),
      prefs.name ? h('span', { class: 'top__greet' }, greeting(now)) : null,
    ),
    h(
      'div',
      { class: 'top__right' },
      showPill
        ? h(
            'button',
            {
              class: 'pill',
              type: 'button',
              'data-action': 'refresh',
              'data-fid': 'm-status',
              'aria-label': t('status.refresh', { status: st.text }),
            },
            h('span', { class: `dot${st.dot ? ` dot--${st.dot}` : ''}` }),
            st.text,
          )
        : null,
      h(
        'nav',
        { class: 'top__actions', 'aria-label': 'TV' },
        topAction('theme-cycle', 'm-theme', themeIcon(mode), t(`theme.${mode}`), {
          aria: t('mast.themeAria', {
            mode: t(`theme.${mode}`),
            shown: t(`theme.${resolveTheme()}`),
          }),
        }),
        topAction('lg-home', 'm-home', 'home', t('mast.lgHome')),
        topAction('tv-settings', 'm-tvset', 'tvset', t('mast.tvSettings')),
        topAction('screen-off', 'm-off', 'power', t('mast.screenOff')),
        topAction('open-settings', 'm-settings', 'sliders', t('mast.settings'), { popup: true }),
      ),
    ),
  ]);
}

/* ======================================================================
   Render: app cards (the hero of the screen)
   ====================================================================== */
const OWN_APP_ID = 'io.github.noelhuibers.owntv';
function recentRank(app: RailApp): number {
  const rec = state.data?.recent;
  if (!rec || app.onTv !== true) {
    return -1;
  }
  const list = rec.filter((r) => r.id !== OWN_APP_ID && r.id !== 'com.webos.app.home');
  return list.findIndex((r) => r.id === app.launchId);
}
function artNode(app: RailApp, cls: string): HTMLElement {
  if (app.icon) {
    return h('img', { class: `${cls}__icon`, src: app.icon, alt: '' });
  }
  const long = app.title.length > 8;
  return h('span', { class: `${cls}__word${long ? ` ${cls}__word--long` : ''}` }, app.title);
}
function cardDetail(app: RailApp, rank: number): string {
  if (app.onTv === false) {
    return t('app.notReportedLong');
  }
  if (rank === 0) {
    return t('app.lastUsed');
  }
  return rank > 0 && rank < 4 ? t('app.usedRecently') : '';
}
function renderApps(): void {
  const el = need('apps');
  el.setAttribute('aria-label', t('sec.apps'));
  const apps = railApps();
  if (apps.length === 0) {
    patch(el, h('p', { class: 'empty-line' }, t('watch.empty')));
    return;
  }
  patch(
    el,
    h(
      'ul',
      { class: 'cards', 'data-nav-memory': 'rail' },
      apps.map((app) => {
        const art = artFor(app);
        const rank = recentRank(app);
        const detail = cardDetail(app, rank);
        const label =
          (app.onTv === false
            ? t('app.openFlag', { title: app.title })
            : t('app.open', { title: app.title })) + (rank === 0 ? `. ${t('app.lastUsed')}` : '');
        return h(
          'li',
          { class: 'cards__item' },
          h(
            'button',
            {
              class: `card${app.icon ? ' card--icon' : ' card--word'}${app.onTv === false ? ' card--missing' : ''}`,
              type: 'button',
              'data-action': 'launch',
              'data-arg': app.key,
              'data-fid': `plate:${app.key}`,
              'aria-label': label,
              'data-glow-n': art.glowN,
              'data-glow-d': art.glowD,
              style: art.vars,
            },
            h('span', { class: 'card__art', 'aria-hidden': 'true' }, artNode(app, 'card')),
            app.onTv === false
              ? h('span', { class: 'card__flag', 'aria-hidden': 'true' }, t('app.notReported'))
              : null,
          ),
          h(
            'p',
            { class: 'card__cap', 'aria-hidden': 'true' },
            h('span', { class: 'card__name' }, app.title),
            detail ? h('span', { class: 'card__detail' }, detail) : null,
          ),
        );
      }),
    ),
  );
}

/* ======================================================================
   Render: the shelf — compact widgets under the apps.
   Each shows one useful line; its details unfold above it on focus.
   ====================================================================== */
function wxIcon(cond: string | null, now: Date): string {
  const c = norm(cond);
  if (/thunder|storm|gewitter/.test(c)) {
    return 'storm';
  }
  if (/snow|sleet|schnee|graupel/.test(c)) {
    return 'snow';
  }
  if (/rain|drizzle|shower|regen|niesel|schauer/.test(c)) {
    return 'rain';
  }
  if (/fog|mist|haze|nebel|dunst/.test(c)) {
    return 'fog';
  }
  if (/cloud|overcast|wolk|bedeckt/.test(c)) {
    return 'cloud';
  }
  if (/clear|sun|fair|klar|sonn|heiter/.test(c)) {
    return resolveTheme(now) === 'night' || now.getHours() >= 19 || now.getHours() < 6
      ? 'moon'
      : 'sun';
  }
  return 'cloud';
}

/* glance(): one widget.
   o.action → the face is a single button (OK opens o.arg settings);
   o.body   → the face holds its own controls (recent apps, sleep chips…). */
interface Glance {
  readonly icon: string;
  readonly label: string;
  readonly value?: Child;
  readonly sub?: string | null;
  readonly tone?: string;
  readonly more?: Child;
  readonly okHint?: boolean;
  readonly action?: string | undefined;
  readonly arg?: string | undefined;
  readonly list?: Child;
  readonly body?: Child;
}
function glance(key: WidgetKey, o: Glance): HTMLElement {
  const moreId = `more-${key}`;
  const moreNodes: Child[] = [];
  if (o.more) {
    if (isList(o.more)) {
      moreNodes.push(...o.more);
    } else {
      moreNodes.push(o.more);
    }
  }
  if (o.action && o.okHint !== false) {
    moreNodes.push(h('p', { class: 'w__hint' }, t('glance.ok')));
  }
  const hintOnly = moreNodes.length === 1 && !o.more;
  const more =
    moreNodes.length > 0
      ? h('div', { class: `w__more${hintOnly ? ' w__more--hintonly' : ''}`, id: moreId }, moreNodes)
      : null;
  const labelNode = h('span', { class: 'w__label' }, icon(o.icon), h('span', null, o.label));
  const cls = `w w--${key}${o.tone ? ` w--${o.tone}` : ''}`;
  const value = o.value === undefined ? null : h('span', { class: 'w__value' }, o.value);
  const sub = o.sub ? h('span', { class: 'w__sub' }, o.sub) : null;
  if (o.action) {
    return h(
      'section',
      { class: cls, 'aria-label': o.label },
      h(
        'button',
        {
          class: 'w__face',
          type: 'button',
          'data-action': o.action,
          'data-arg': o.arg,
          'data-fid': `w:${key}`,
          'aria-describedby': more ? moreId : null,
        },
        labelNode,
        value,
        sub,
        o.list || null,
      ),
      more,
    );
  }
  return h(
    'section',
    { class: cls, 'aria-label': o.label },
    h('div', { class: 'w__face' }, labelNode, value, sub, o.body),
    more,
  );
}
function naGlance(
  key: WidgetKey,
  ic: string,
  label: string,
  action?: string,
  arg?: string,
): HTMLElement {
  return glance(key, {
    icon: ic,
    label,
    value: na(t('na')),
    tone: 'na',
    more: h('p', null, naText()),
    action,
    arg,
  });
}

function wWeather(now: Date): HTMLElement {
  const wx = state.data?.weather;
  const label = t('sec.weather');
  const solarDay = solarPeriod(wx, Number(now || new Date()));
  const hasLocal = prefs.weather.latitude !== null;
  if (!state.data || Bridge.mode === 'none') {
    return naGlance(
      'weather',
      'cloud',
      label,
      hasLocal && Bridge.has('getWeather') ? 'open-weather' : 'open-settings',
      'weather',
    );
  }
  if (wx?.configured) {
    const place = wx.city || prefs.weather.label;
    if (wx.temperature === null || wx.error) {
      return glance('weather', {
        icon: 'cloud',
        label,
        value: na(t('wx.na')),
        sub: place,
        tone: 'na',
        more: h('p', null, t('wx.error')),
        okHint: false,
        action: 'open-weather',
      });
    }
    return glance('weather', {
      icon: wxIcon(wx.condition, now),
      label,
      value: [
        h('span', { class: 'w__big' }, `${fmtNum(wx.temperature, 0)}°`),
        wx.condition ? h('span', { class: 'w__cond' }, wx.condition) : null,
      ],
      sub: place || null,
      more: [
        wx.updatedAt
          ? h('p', null, t('wx.updated', { time: fmtTime(new Date(wx.updatedAt)) }))
          : null,
        solarDay
          ? h(
              'p',
              { class: 'w__meta' },
              t('theme.cap.sun', {
                sunrise: fmtTime(new Date(solarDay.sunrise)),
                sunset: fmtTime(new Date(solarDay.sunset)),
              }),
            )
          : null,
      ],
      okHint: false,
      action: 'open-weather',
    });
  }
  if (hasLocal) {
    return glance('weather', {
      icon: 'pin',
      label,
      value: t('wx.pending.title'),
      tone: 'setup',
      more: h(
        'p',
        null,
        t('wx.pending.text', {
          label: prefs.weather.label || `${prefs.weather.latitude}, ${prefs.weather.longitude}`,
        }),
      ),
      action: 'open-settings',
      arg: 'weather',
    });
  }
  return glance('weather', {
    icon: 'plus',
    label,
    value: t('wx.setup.title'),
    tone: 'setup',
    more: h('p', null, t('wx.setup.text')),
    action: 'open-settings',
    arg: 'weather',
  });
}

function evRow(e: CalendarEvent, now: Date, withDay: boolean): HTMLElement {
  const live = now >= e.start && now < e.end && !e.allDay;
  let time = fmtTime(e.start);
  if (e.allDay) {
    time = t('cal.allDay');
  } else if (live) {
    time = t('cal.now');
  }
  const shownDay = e.start < now ? now : e.start;
  const day = withDay ? dayLabel(shownDay, now) : null;
  return h(
    'span',
    { class: `ev${live ? ' ev--now' : ''}` },
    h(
      'span',
      { class: 'ev__time' },
      day && !sameDay(shownDay, now) ? `${day} ${e.allDay ? '' : fmtTime(e.start)}` : time,
    ),
    h(
      'span',
      { class: 'ev__title', title: e.calendar ? `${e.calendar} · ${e.title}` : e.title },
      e.title,
    ),
    e.calendar ? h('small', { class: 'ev__calendar' }, e.calendar) : null,
  );
}
function wCalendar(now: Date): HTMLElement {
  const cal = state.data?.calendar;
  const label = t('sec.agenda');
  if (!cal) {
    return naGlance('calendar', 'calendar', label, 'open-settings', 'calendar');
  }
  if (cal.error) {
    return glance('calendar', {
      icon: 'calendar',
      label,
      value: na(t('na')),
      tone: 'na',
      more: h('p', null, t('cal.unavailable')),
      action: 'open-settings',
      arg: 'calendar',
    });
  }
  if (!cal.configured) {
    return glance('calendar', {
      icon: 'plus',
      label,
      value: t('cal.setup.title'),
      tone: 'setup',
      more: h('p', null, t('cal.setup.text')),
      action: 'open-settings',
      arg: 'calendar',
    });
  }
  const upcoming = cal.events.filter((e) => e.end > now);
  const stampLine = cal.updatedAt
    ? h('p', { class: 'w__meta' }, t('cal.updated', { time: fmtTime(new Date(cal.updatedAt)) }))
    : h('p', { class: 'w__meta' }, t('cal.source'));
  if (upcoming.length === 0) {
    return glance('calendar', {
      icon: 'calendar',
      label,
      value: t('cal.empty'),
      more: stampLine,
      action: 'open-settings',
      arg: 'calendar',
    });
  }
  const face = upcoming.slice(0, 2);
  const rest = upcoming.slice(2, 6);
  const more: Child[] = [];
  if (rest.length > 0) {
    more.push(
      h(
        'div',
        { class: 'w__evs' },
        rest.map((e) => evRow(e, now, true)),
      ),
    );
  }
  if (upcoming.length > 6) {
    more.push(h('p', { class: 'w__meta' }, t('cal.more', { n: upcoming.length - 6 })));
  }
  more.push(stampLine);
  if (cal.partial) {
    more.push(h('p', { class: 'w__meta' }, calText('Some calendars are temporarily unavailable.')));
  }
  return glance('calendar', {
    icon: 'calendar',
    label,
    list: h(
      'span',
      { class: 'w__evs' },
      face.map((e) => evRow(e, now, true)),
    ),
    more,
    action: 'open-settings',
    arg: 'calendar',
  });
}

interface SleepView {
  readonly off?: true;
  readonly endsAt?: number;
  readonly reported?: true;
  readonly local?: true;
  readonly unknown?: true;
}
function currentSleep(): SleepView {
  const now = Date.now();
  const st = state.data?.sleepTimer;
  if (st?.off) {
    return { off: true };
  }
  if (st?.endsAt && st.endsAt > now) {
    return { endsAt: st.endsAt, reported: true };
  }
  if (sleepLocal && sleepLocal.endsAt > now) {
    return { endsAt: sleepLocal.endsAt, local: true };
  }
  if (st) {
    return { off: true };
  }
  return { unknown: true };
}
function wSleep(): HTMLElement {
  const can = Bridge.has('setSleepTimer');
  const cur = currentSleep();
  const label = t('sec.sleep');
  let value: Child;
  let tone = '';
  if (cur.endsAt) {
    const mins = Math.max(1, Math.round((cur.endsAt - Date.now()) / 60_000));
    value = [
      h('span', null, t('sleep.at', { time: fmtTime(new Date(cur.endsAt)) })),
      h(
        'span',
        { class: 'w__cond' },
        t('sleep.in', { n: mins }) + (cur.local ? ` · ${t('sleep.setHere')}` : ''),
      ),
    ];
    tone = 'active';
  } else if (cur.off) {
    value = t('sleep.off');
  } else if (can) {
    value = na(t('sleep.unknown'));
  } else {
    value = na(t('na'));
    tone = 'na';
  }
  const chips = h(
    'span',
    { class: 'chips', role: 'group', 'aria-label': t('sleep.choose') },
    SLEEP_CHOICES.map((m) =>
      h(
        'button',
        {
          class: 'chip',
          type: 'button',
          'data-action': 'sleep',
          'data-arg': m,
          'data-fid': `sleep:${m}`,
          'aria-label': t('sleep.setAria', { n: m }),
          disabled: !can,
        },
        String(m),
      ),
    ),
    h(
      'button',
      {
        class: 'chip chip--off',
        type: 'button',
        'data-action': 'sleep',
        'data-arg': 0,
        'data-fid': 'sleep:0',
        'aria-label': t('sleep.cancelAria'),
        disabled: !can,
      },
      t('sleep.cancel'),
    ),
  );
  let more: HTMLElement;
  if (!can) {
    more = h('p', null, Bridge.mode === 'none' ? t('na.bridge') : t('sleep.na'));
  } else if (cur.unknown) {
    more = h('p', null, t('sleep.unknownSub'));
  } else {
    more = h('p', null, `${t('sleep.choose')} (${t('sleep.min')})`);
  }
  return glance('sleep', { icon: 'timer', label, value, sub: null, tone, body: chips, more });
}

type Health = Partial<TvHealth>;

function healthName(H: Health): string {
  return H.model ? (H.model.split('.')[0] ?? '') : t('sec.health');
}
function healthDetails(H: Health, pv: TvPrivacy | null | undefined, peek?: boolean): Child {
  const row = (k: string, v: string | null | undefined): HTMLElement =>
    h(
      'div',
      { class: 'kv' },
      h('dt', null, k),
      h('dd', null, v === null || v === undefined ? na() : v),
    );
  const badges: HTMLElement[] = [];
  if (pv && pv.trackingOff !== null) {
    badges.push(
      h(
        'span',
        { class: `badge ${pv.trackingOff ? 'badge--ok' : 'badge--warn'}` },
        icon(pv.trackingOff ? 'check' : 'alert'),
        t(pv.trackingOff ? 'p.trackingOff' : 'p.trackingOn'),
      ),
    );
  }
  if (pv && pv.adBlocking !== null) {
    badges.push(
      h(
        'span',
        { class: `badge ${pv.adBlocking ? 'badge--ok' : 'badge--warn'}` },
        icon(pv.adBlocking ? 'shield' : 'alert'),
        t(pv.adBlocking ? 'p.adsOn' : 'p.adsOff'),
      ),
    );
  }
  const metric = (label: string, value: string | null | undefined): HTMLElement =>
    h(
      'div',
      { class: 'health-stat' },
      h('dt', null, label),
      h('dd', null, value == null ? na() : value),
    );
  const panel = H.panelHours == null ? null : `${fmtNum(H.panelHours, 1)} h`;
  const uptime = H.uptimeSeconds == null ? null : fmtUptime(H.uptimeSeconds);
  if (peek) {
    return [
      h(
        'div',
        { class: 'health-peek' },
        h(
          'div',
          { class: 'health-heading' },
          h('span', null, healthName(H)),
          h('span', { class: 'health-system' }, H.webos ? `webOS ${H.webos}` : ''),
          h('div', { class: 'badges' }, badges),
        ),
        h(
          'dl',
          { class: 'health-stats' },
          metric(t('h.panelHours'), panel),
          metric(t('h.uptime'), uptime),
          metric(
            t('h.available'),
            H.memoryAvailableMB == null ? null : `${fmtNum(H.memoryAvailableMB, 0)} MiB`,
          ),
          metric(t('h.fw'), H.firmware),
        ),
      ),
      h('p', { class: 'w__hint' }, t('glance.ok')),
    ];
  }
  let available: string | null = null;
  if (H.memoryAvailableMB != null) {
    available =
      H.memoryTotalMB == null
        ? `${fmtNum(H.memoryAvailableMB, 0)} MiB`
        : `${fmtNum(H.memoryAvailableMB, 0)} / ${fmtNum(H.memoryTotalMB, 0)} MiB`;
  }
  return [
    h(
      'div',
      { class: 'health-heading' },
      h('span', null, healthName(H)),
      h('span', { class: 'health-system' }, H.webos ? `webOS ${H.webos}` : ''),
    ),
    h(
      'dl',
      { class: 'health-stats' },
      metric(t('h.panelHours'), panel),
      metric(t('h.uptime'), uptime),
    ),
    h(
      'dl',
      { class: 'kvs health-readings' },
      row(t('h.fw'), H.firmware),
      row(t('h.available'), available),
      row(t('h.cached'), H.memoryCachedMB == null ? null : `${fmtNum(H.memoryCachedMB, 0)} MiB`),
    ),
    h('p', { class: 'health-note' }, t('h.memoryNote')),
    badges.length > 0 ? h('div', { class: 'badges' }, badges) : null,
  ];
}

function wHealth(): HTMLElement {
  const label = t('sec.health');
  const pv = state.data?.privacy;
  if (!state.data || Bridge.mode === 'none') {
    return naGlance('health', 'chip', label, 'open-settings', 'about');
  }
  const H: Health = state.data.health || {};
  const allMissing =
    [H.temperature, H.memoryUsedPercent, H.uptimeSeconds, H.model, H.firmware].every(
      (v) => v === null || v === undefined,
    ) &&
    (!pv || (pv.summary === null && pv.trackingOff === null && pv.adBlocking === null));
  if (allMissing) {
    return glance('health', {
      icon: 'chip',
      label,
      value: na(t('na')),
      tone: 'na',
      more: h('p', null, t('na.field')),
      action: 'open-settings',
      arg: 'about',
    });
  }
  const temp = H.temperature;
  const mem = H.memoryUsedPercent;
  const readings = h(
    'span',
    { class: 'health-face' },
    h(
      'span',
      { class: 'health-face__reading' },
      h('span', { class: 'health-face__label' }, t('h.temp')),
      h(
        'span',
        null,
        temp == null ? na() : [h('strong', null, fmtNum(temp, 0)), h('small', null, ' °C')],
      ),
    ),
    h(
      'span',
      { class: 'health-face__reading' },
      h('span', { class: 'health-face__label' }, t('h.memShort')),
      h(
        'span',
        null,
        mem == null ? na() : [h('strong', null, fmtNum(mem, 0)), h('small', null, ' %')],
      ),
    ),
  );
  const sub =
    H.memoryAvailableMB == null
      ? null
      : t('h.availableShort', { n: fmtNum(H.memoryAvailableMB, 0) });
  return glance('health', {
    icon: 'chip',
    label,
    value: readings,
    sub,
    more: healthDetails(H, pv, true),
    okHint: false,
    action: 'open-settings',
    arg: 'about',
  });
}

function wSmartHome(): HTMLElement {
  const sh = state.data?.smartHome;
  const label = t('sec.smartHome');
  if (!sh && (Bridge.mode === 'none' || !state.data)) {
    return naGlance('smartHome', 'plug', label, 'open-settings', 'widgets');
  }
  if (!sh?.configured) {
    return glance('smartHome', {
      icon: 'plug',
      label,
      value: t('sh.setup.title'),
      tone: 'quiet',
      more: h('p', null, t('sh.setup.text')),
      action: 'open-settings',
      arg: 'widgets',
    });
  }
  const [first] = sh.devices;
  if (!first) {
    return glance('smartHome', {
      icon: 'plug',
      label,
      value: t('sh.empty'),
      action: 'open-settings',
      arg: 'widgets',
    });
  }
  return glance('smartHome', {
    icon: 'plug',
    label,
    value: first.name,
    sub: first.state || null,
    more:
      sh.devices.length > 1
        ? h(
            'dl',
            { class: 'kvs' },
            sh.devices
              .slice(1, 6)
              .map((d) =>
                h('div', { class: 'kv' }, h('dt', null, d.name), h('dd', null, d.state || '—')),
              ),
          )
        : null,
    action: 'open-settings',
    arg: 'widgets',
  });
}

// The widget is already labelled "Inputs": "HDMI 2" shows as "2", custom names stay short.
function shortInput(title: string): string {
  const m = /^HDMI\s*(\d+)$/i.exec(title);
  return m?.[1] ?? clip(title, 8);
}
function wInputs(): HTMLElement {
  const label = t('sec.inputs');
  const list = state.data?.inputs;
  if (!list) {
    return naGlance('inputs', 'input', label);
  }
  if (list.length === 0) {
    return glance('inputs', { icon: 'input', label, value: t('in.empty'), tone: 'quiet' });
  }
  return glance('inputs', {
    icon: 'input',
    label,
    body: h(
      'span',
      { class: 'chips chips--inputs' },
      list.slice(0, 4).map((inp) => {
        let sig = '';
        if (inp.connected === true) {
          sig = `, ${t('in.connected')}`;
        } else if (inp.connected === false) {
          sig = `, ${t('in.idle')}`;
        }
        return h(
          'button',
          {
            class: 'chip chip--input',
            type: 'button',
            'data-action': 'launch-id',
            'data-arg': inp.id,
            'data-label': inp.title,
            'data-fid': `in:${inp.id}`,
            'aria-label': t('in.open', { title: inp.title }) + sig,
          },
          inp.connected === true
            ? h('span', { class: 'dot dot--ok', 'aria-hidden': 'true' })
            : null,
          shortInput(inp.title),
        );
      }),
    ),
  });
}

const SHELF: readonly { readonly key: WidgetKey; readonly render: (now: Date) => HTMLElement }[] = [
  { key: 'weather', render: wWeather },
  { key: 'calendar', render: wCalendar },
  { key: 'sleep', render: wSleep },
  { key: 'health', render: wHealth },
  { key: 'smartHome', render: wSmartHome },
  { key: 'inputs', render: wInputs },
];
function renderShelf(): void {
  const el = need('shelf');
  const now = new Date();
  const cols = SHELF.filter((c) => prefs.widgets[c.key]);
  el.hidden = cols.length === 0;
  el.setAttribute('aria-label', t('sec.glance'));
  el.setAttribute('data-count', String(cols.length));
  patch(
    el,
    cols.map((c) => c.render(now)),
  );
}

/* ======================================================================
   Settings sheet
   ====================================================================== */
const SECTION_KEYS = [
  'apps',
  'widgets',
  'appearance',
  'language',
  'weather',
  'calendar',
  'backup',
  'about',
] as const;
type SectionKey = (typeof SECTION_KEYS)[number];
const SECTION_ICONS: Readonly<Record<SectionKey, string>> = {
  apps: 'grid',
  widgets: 'widgets',
  appearance: 'palette',
  language: 'globe',
  weather: 'sun',
  calendar: 'calendar',
  backup: 'archive',
  about: 'info',
};
const SECTION_LEDES: Readonly<Record<SectionKey, StringKey>> = {
  apps: 'set.apps.lede',
  widgets: 'set.w.lede',
  appearance: 'set.ap.lede',
  language: 'set.lang.lede',
  weather: 'set.wx.lede',
  calendar: 'set.cal.lede',
  backup: 'set.bk.lede',
  about: 'set.ab.lede',
};

interface WeatherDraft {
  label: string;
  lat: string;
  lon: string;
}
type WeatherField = keyof WeatherDraft;
const WEATHER_FIELDS: readonly WeatherField[] = ['label', 'lat', 'lon'];

const ui: {
  settingsOpen: boolean;
  section: SectionKey;
  returnFid: string | null;
  wxDraft: WeatherDraft | null;
  wxErrors: Partial<Record<WeatherField, string>>;
  exportShown: boolean;
  includeWx: boolean;
  importText: string;
  importReport: ImportReport | null;
  resetArmed: boolean;
  resetTimer: Timer | undefined;
  /** Setup directions returned by the bridge (e.g. configureWeather/openEditor). */
  hints: { weather?: string | null; editor?: string | null };
} = {
  settingsOpen: false,
  section: 'apps',
  returnFid: null,
  wxDraft: null,
  wxErrors: {},
  exportShown: false,
  includeWx: true,
  importText: '',
  importReport: null,
  resetArmed: false,
  resetTimer: undefined,
  hints: {},
};

interface SegOption {
  readonly action: string;
  readonly arg: string;
  readonly label: string;
  readonly icon?: string;
}
function seg(
  group: string,
  options: readonly SegOption[],
  current: string,
  fidPrefix: string,
  disabled?: boolean,
): HTMLElement {
  return h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': group },
    options.map((o) =>
      h(
        'button',
        {
          class: 'seg__b',
          type: 'button',
          'data-action': o.action,
          'data-arg': o.arg,
          'data-fid': `${fidPrefix}:${o.arg}`,
          'aria-pressed': String(o.arg === current),
          disabled: Boolean(disabled),
        },
        o.icon ? icon(o.icon) : null,
        o.label,
      ),
    ),
  );
}
function sw(
  action: string,
  arg: string,
  on: boolean | undefined,
  label: string,
  fid: string,
): Child {
  return [
    h(
      'span',
      { class: 'switch__label', 'aria-hidden': 'true' },
      on ? t('set.ap.on') : t('set.ap.off'),
    ),
    h('button', {
      class: 'switch',
      type: 'button',
      role: 'switch',
      'aria-checked': String(Boolean(on)),
      'aria-label': label,
      'data-action': action,
      'data-arg': arg,
      'data-fid': fid,
    }),
  ];
}
function srow(label: string, desc: string | null, ctl: Child, dim?: boolean): HTMLElement {
  return h(
    'div',
    { class: `srow${dim ? ' srow--dim' : ''}` },
    h(
      'div',
      null,
      h('div', { class: 'srow__label' }, label),
      desc ? h('div', { class: 'srow__desc' }, desc) : null,
    ),
    h('div', { class: 'srow__ctl' }, ctl),
  );
}
function head(key: SectionKey): HTMLElement {
  return h(
    'div',
    { class: 'sheet__head' },
    h('h1', { class: 'sheet__title', id: 'sheet-title' }, t(`set.nav.${key}`)),
    h('p', { class: 'sheet__lede' }, t(SECTION_LEDES[key])),
  );
}

function appSub(app: RailApp): string {
  if (app.onTv === true) {
    return t('app.onTv');
  }
  return app.onTv === false ? t('app.notReportedLong') : t('app.unknown');
}
function secApps(): Child {
  const order = prefs.apps.order;
  const rows = order.map((key, i) => {
    const app = resolveApp(key);
    const hidden = prefs.apps.hidden.includes(key);
    return h(
      'div',
      { class: `approw${hidden ? ' approw--hidden' : ''}` },
      h(
        'span',
        {
          class: `approw__art${app.icon ? ' approw__art--icon' : ''}`,
          'aria-hidden': 'true',
          style: artFor(app).vars,
        },
        app.icon ? h('img', { src: app.icon, alt: '' }) : app.mono,
      ),
      h(
        'div',
        null,
        h('div', { class: 'approw__t' }, app.title),
        h(
          'div',
          { class: 'approw__s' },
          (hidden ? `${t('set.apps.hidden')} · ` : '') + appSub(app),
        ),
      ),
      h(
        'div',
        { class: 'approw__ctl' },
        sw(
          'app-toggle',
          key,
          !hidden,
          t('set.apps.showAria', { title: app.title }),
          `ap-show:${key}`,
        ),
        h(
          'button',
          {
            class: 'btn btn--sq f',
            type: 'button',
            'data-action': 'app-move',
            'data-arg': `${key}|-1`,
            'data-fid': `ap-up:${key}`,
            'data-fid-alt': `ap-down:${key}`,
            'aria-label': t('set.apps.up', { title: app.title }),
            disabled: i === 0,
          },
          icon('up'),
        ),
        h(
          'button',
          {
            class: 'btn btn--sq f',
            type: 'button',
            'data-action': 'app-move',
            'data-arg': `${key}|1`,
            'data-fid': `ap-down:${key}`,
            'data-fid-alt': `ap-up:${key}`,
            'aria-label': t('set.apps.down', { title: app.title }),
            disabled: i === order.length - 1,
          },
          icon('down'),
        ),
        app.builtin
          ? null
          : h(
              'button',
              {
                class: 'btn btn--sq f',
                type: 'button',
                'data-action': 'app-remove',
                'data-arg': key,
                'data-fid': `ap-rm:${key}`,
                'aria-label': t('set.apps.remove', { title: app.title }),
              },
              icon('x'),
            ),
      ),
    );
  });
  const tvApps = state.data?.apps;
  let extra: HTMLElement;
  if (tvApps) {
    const used = new Set<string>();
    for (const k of order) {
      const r = resolveApp(k);
      if (r.onTv) {
        used.add(r.launchId);
      }
    }
    const candidates = tvApps
      .filter((a) => !used.has(a.id) && !order.includes(`app:${a.id}`) && APP_ID_RE.test(a.id))
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, 40);
    extra =
      candidates.length > 0
        ? h(
            'div',
            { class: 'addlist' },
            candidates.map((a) =>
              h(
                'button',
                {
                  class: 'btn f',
                  type: 'button',
                  'data-action': 'app-add',
                  'data-arg': a.id,
                  'data-fid': `ap-add:${a.id}`,
                  'aria-label': t('set.apps.addAria', { title: a.title }),
                },
                icon('plus'),
                a.title,
              ),
            ),
          )
        : h('p', { class: 'note' }, t('set.apps.addNone'));
  } else {
    extra = h('p', { class: 'note' }, t('set.apps.addNa'));
  }
  return [
    head('apps'),
    srow(
      t('set.apps.sort'),
      null,
      seg(
        t('set.apps.sort'),
        [
          { label: t('set.apps.recent'), arg: 'recent', action: 'app-sort' },
          { label: t('set.apps.manual'), arg: 'manual', action: 'app-sort' },
        ],
        prefs.apps.sort,
        'app-sort',
      ),
    ),
    h('h2', { class: 'subhead' }, t('set.apps.order')),
    rows,
    h('h2', { class: 'subhead' }, t('set.apps.add')),
    extra,
    h(
      'div',
      { class: 'formrow' },
      h(
        'button',
        { class: 'btn f', type: 'button', 'data-action': 'apps-reset', 'data-fid': 'ap-reset' },
        icon('refresh'),
        t('set.apps.reset'),
      ),
    ),
  ];
}

function secWidgets(): Child {
  return [
    head('widgets'),
    WIDGETS.map((k) =>
      srow(
        t(`set.w.${k}`),
        t(`set.w.${k}.d`),
        sw('widget-toggle', k, prefs.widgets[k], t(`set.w.${k}`), `w:${k}`),
      ),
    ),
  ];
}

type HourField = 'dayStart' | 'nightStart';
function stepper(which: HourField, label: string): HTMLElement {
  return h(
    'div',
    { class: 'stepper' },
    h(
      'button',
      {
        class: 'btn btn--sq f',
        type: 'button',
        'data-action': 'hour-step',
        'data-arg': `${which}|-15`,
        'data-fid': `hs:${which}:-`,
        'aria-label': t('set.ap.stepEarlier', { what: label }),
      },
      icon('down'),
    ),
    h('span', { class: 'stepper__v', 'aria-live': 'polite' }, prefs.theme[which]),
    h(
      'button',
      {
        class: 'btn btn--sq f',
        type: 'button',
        'data-action': 'hour-step',
        'data-arg': `${which}|15`,
        'data-fid': `hs:${which}:+`,
        'aria-label': t('set.ap.stepLater', { what: label }),
      },
      icon('up'),
    ),
  );
}
/* A miniature of each style, drawn in CSS from the live theme tokens. */
function styleMini(key: string): HTMLElement {
  const cards = [0, 1, 2, 3, 4].map((i) => h('i', { class: `mini__card mini__card--${i}` }));
  const wid = [0, 1, 2, 3].map(() => h('i', { class: 'mini__w' }));
  return h(
    'span',
    { class: `mini mini--${key}`, 'aria-hidden': 'true' },
    h('i', { class: 'mini__glow' }),
    h('i', { class: 'mini__top' }),
    h('span', { class: 'mini__cards' }, cards),
    h('span', { class: 'mini__shelf' }, wid),
  );
}
function secAppearance(): Child {
  const auto = prefs.theme.mode === 'auto';
  const sched = auto && prefs.theme.autoSource !== 'system';
  return [
    head('appearance'),
    h('h2', { class: 'subhead' }, t('set.ap.style')),
    h(
      'div',
      { class: 'styles', role: 'group', 'aria-label': t('set.ap.style') },
      STYLES.map((k) =>
        h(
          'button',
          {
            class: 'stylepick',
            type: 'button',
            'data-action': 'style-set',
            'data-arg': k,
            'data-fid': `style:${k}`,
            'aria-pressed': String(prefs.style === k),
            'aria-describedby': `style-d-${k}`,
          },
          styleMini(k),
          h(
            'span',
            { class: 'stylepick__t' },
            prefs.style === k ? icon('check') : null,
            t(`style.${k}`),
          ),
          h('span', { class: 'stylepick__d', id: `style-d-${k}` }, t(`style.${k}.d`)),
        ),
      ),
    ),
    h('h2', { class: 'subhead' }, t('set.ap.themeHead')),
    srow(
      t('set.ap.mode'),
      `${t('set.ap.mode.d')} ${themeCaption()}.`,
      seg(
        t('set.ap.mode'),
        [
          { action: 'theme-mode', arg: 'day', label: t('theme.day'), icon: 'sun' },
          { action: 'theme-mode', arg: 'night', label: t('theme.night'), icon: 'moon' },
          { action: 'theme-mode', arg: 'auto', label: t('theme.auto'), icon: 'auto' },
        ],
        prefs.theme.mode,
        'tm',
      ),
    ),
    srow(
      t('set.ap.source'),
      t('set.ap.source.d'),
      seg(
        t('set.ap.source'),
        [
          { action: 'theme-source', arg: 'sun', label: t('set.ap.sun') },
          { action: 'theme-source', arg: 'schedule', label: t('set.ap.schedule') },
          { action: 'theme-source', arg: 'system', label: t('set.ap.system') },
        ],
        prefs.theme.autoSource,
        'ts',
        !auto,
      ),
      !auto,
    ),
    srow(t('set.ap.dayStart'), null, stepper('dayStart', t('set.ap.dayStart')), !sched),
    srow(t('set.ap.nightStart'), null, stepper('nightStart', t('set.ap.nightStart')), !sched),
    h('h2', { class: 'subhead' }, t('set.ap.screen')),
    srow(
      t('set.ap.idle'),
      t('set.ap.idle.d'),
      seg(
        t('set.ap.idle'),
        IDLE_CHOICES.map((n) => ({
          action: 'idle-set',
          arg: String(n),
          label: n ? `${n} ${t('u.min')}` : t('set.ap.idleOff'),
        })),
        String(prefs.idleDimMinutes),
        'idle',
      ),
    ),
    srow(
      t('set.ap.shift'),
      t('set.ap.shift.d'),
      sw('shift-toggle', 'x', prefs.pixelShift, t('set.ap.shift'), 'shift'),
    ),
    srow(
      t('set.ap.motion'),
      t('set.ap.motion.d'),
      seg(
        t('set.ap.motion'),
        [
          { action: 'motion-set', arg: 'system', label: t('set.ap.motionSystem') },
          { action: 'motion-set', arg: 'reduced', label: t('set.ap.motionReduced') },
        ],
        prefs.motion,
        'mo',
      ),
    ),
  ];
}

let localeDraft: string | null = null;
let languageError: string | null = null;
function useLanguagePack(text: string): void {
  try {
    const raw: unknown = JSON.parse(text);
    const pack = validatePack(raw, languageBase(raw));
    prefs.languagePack = pack;
    prefs.language = pack.locale;
    localeDraft = null;
    languageError = null;
    commit();
  } catch (e) {
    languageError = message(e);
    renderSettings();
  }
}
function secLanguage(): Child {
  const pack = prefs.languagePack;
  const primary = prefs.language.split('-')[0];
  const isBuiltIn = primary === 'en' || primary === 'de';
  const count = pack && matches(pack, prefs.language) ? Object.keys(pack.strings).length : 0;
  const languages: SegOption[] = [
    { action: 'lang-set', arg: 'en', label: 'English' },
    { action: 'lang-set', arg: 'de', label: 'Deutsch' },
  ];
  if (pack) {
    languages.push({ action: 'lang-set', arg: pack.locale, label: pack.name });
  }
  return [
    head('language'),
    srow(t('set.lang.lang'), null, seg(t('set.lang.lang'), languages, prefs.language, 'lang')),
    h(
      'div',
      { class: 'locale-picker' },
      h(
        'label',
        { class: 'field' },
        h('span', null, calText('Any language or regional locale')),
        h('input', {
          type: 'text',
          maxlength: '64',
          dir: 'ltr',
          value: localeDraft === null ? prefs.language : localeDraft,
          'data-input': 'locale',
          'data-fid': 'locale',
          placeholder: 'fr-CA, es, ja, ar, zh-Hant…',
          autocomplete: 'off',
          spellcheck: 'false',
        }),
      ),
      h(
        'button',
        {
          class: 'btn f',
          type: 'button',
          'data-action': 'locale-apply',
          'data-fid': 'locale-apply',
        },
        calText('Apply locale'),
      ),
    ),
    h(
      'p',
      { class: 'note', role: 'status' },
      isBuiltIn
        ? calText(
            'Built-in interface translation. Regional date, time and number formats follow your locale.',
          )
        : `${calText('Offline pack entries: ')}${count}. ${calText('Missing translations use English. Date, time and number formats follow your locale.')}`,
    ),
    h(
      'div',
      { class: 'formrow' },
      IS_WEBOS
        ? h(
            'p',
            { class: 'note' },
            calText('Install language packs from the computer editor → Settings → Language.'),
          )
        : h(
            'label',
            { class: 'btn filepick' },
            icon('upload'),
            calText('Install language pack'),
            h('input', {
              type: 'file',
              accept: 'application/json,.json',
              'data-input': 'language-file',
              'data-fid': 'language-file',
              'aria-label': calText('Install language pack'),
            }),
          ),
      pack
        ? h(
            'button',
            {
              class: 'btn f',
              type: 'button',
              'data-action': 'language-remove',
              'data-fid': 'language-remove',
            },
            calText('Remove pack'),
          )
        : null,
    ),
    h(
      'p',
      { class: 'note' },
      calText(
        'Choose any BCP 47 locale. Packs are local JSON text files; nothing is sent to a translation service. See docs/LANGUAGES.md in the repository to create or contribute one.',
      ),
    ),
    languageError ? h('p', { class: 'callout callout--bad', role: 'alert' }, languageError) : null,
    srow(
      t('set.lang.name'),
      t('set.lang.name.d'),
      h(
        'div',
        { class: 'field' },
        h('input', {
          id: 'f-name',
          type: 'text',
          maxlength: '24',
          autocomplete: 'off',
          spellcheck: 'false',
          'data-input': 'name',
          'data-fid': 'f-name',
          placeholder: t('set.lang.namePh'),
          'aria-label': t('set.lang.name'),
          value: prefs.name,
        }),
      ),
    ),
  ];
}

interface Place {
  readonly label: string;
  readonly region: string;
  readonly latitude: number;
  readonly longitude: number;
}
function parsePlaces(reply: unknown): Place[] {
  const places = field(reply, 'places');
  if (!Array.isArray(places)) {
    return [];
  }
  const out: Place[] = [];
  for (const p of places.slice(0, 4)) {
    const latitude = finite(field(p, 'latitude'));
    const longitude = finite(field(p, 'longitude'));
    if (isObj(p) && latitude !== null && longitude !== null) {
      out.push({ label: str(p.label), region: str(p.region), latitude, longitude });
    }
  }
  return out;
}

const wxSearch: { busy: boolean; places: Place[]; error: string | null } = {
  busy: false,
  places: [],
  error: null,
};
let wxCoordinates = false;
function weatherStatus(): string {
  const wx = state.data?.weather;
  if (!wx) {
    return t('set.wx.st.na');
  }
  if (!wx.configured) {
    return t('set.wx.st.off');
  }
  return wx.city ? t('set.wx.st.on', { city: wx.city }) : t('set.wx.st.onNoCity');
}
function secWeather(): Child {
  const wx = state.data?.weather;
  const d = ui.wxDraft || {
    label: prefs.weather.label,
    lat: prefs.weather.latitude === null ? '' : String(prefs.weather.latitude),
    lon: prefs.weather.longitude === null ? '' : String(prefs.weather.longitude),
  };
  ui.wxDraft = d;
  const e = ui.wxErrors;
  const wxField = (
    id: string,
    key: WeatherField,
    label: string,
    hint: string | null,
    mode: string,
    max: number,
  ): HTMLElement =>
    h(
      'div',
      { class: 'field' },
      h('label', { for: id }, label + (hint ? ` (${hint})` : '')),
      h('input', {
        id,
        type: 'text',
        inputmode: mode || 'text',
        maxlength: String(max),
        autocomplete: 'off',
        spellcheck: 'false',
        'data-input': `wx-${key}`,
        'data-fid': id,
        value: d[key],
        'aria-invalid': e[key] ? 'true' : null,
        'aria-describedby': e[key] ? `${id}-err` : null,
      }),
    );
  const errs = WEATHER_FIELDS.filter((k) => e[k]);
  return [
    head('weather'),
    srow(
      t('set.wx.status'),
      null,
      h(
        'span',
        { class: 'note' },
        h('span', {
          class: `dot ${wx?.configured ? 'dot--ok' : ''}`,
          style: { display: 'inline-block', 'margin-right': '0.6rem' },
        }),
        weatherStatus(),
      ),
    ),
    h(
      'div',
      { class: 'weather-search' },
      wxField('f-wx-label', 'label', t('set.wx.city'), null, 'text', 40),
      h(
        'button',
        {
          class: 'btn f',
          type: 'button',
          'data-action': 'wx-search',
          'data-fid': 'wx-search',
          disabled: wxSearch.busy || !Bridge.has('searchWeather'),
        },
        t(wxSearch.busy ? 'set.wx.searching' : 'set.wx.search'),
      ),
    ),
    wxSearch.error ? h('p', { class: 'note', role: 'status' }, wxSearch.error) : null,
    wxSearch.places.length > 0
      ? h(
          'div',
          { class: 'weather-results' },
          wxSearch.places.map((p, i) =>
            h(
              'button',
              {
                class: 'place f',
                type: 'button',
                'data-action': 'wx-place',
                'data-arg': String(i),
                'data-fid': `wx-place:${i}`,
              },
              h('strong', null, p.label),
              h('span', null, p.region),
            ),
          ),
        )
      : null,
    h(
      'div',
      { class: 'formrow weather-coordinates-toggle' },
      h(
        'button',
        {
          class: 'btn f',
          type: 'button',
          'data-action': 'wx-coordinates',
          'data-fid': 'wx-coordinates',
          'aria-expanded': String(wxCoordinates),
        },
        t('set.wx.coordinates'),
      ),
      h('span', { class: 'note' }, d.lat && d.lon ? `${d.lat}°, ${d.lon}°` : t('set.wx.pick')),
    ),
    wxCoordinates
      ? h(
          'div',
          { class: 'weather-coordinates' },
          wxField('f-wx-lat', 'lat', t('set.wx.lat'), null, 'decimal', 10),
          wxField('f-wx-lon', 'lon', t('set.wx.lon'), null, 'decimal', 11),
        )
      : null,
    errs.length > 0
      ? h(
          'div',
          { class: 'callout callout--bad', role: 'alert' },
          icon('alert'),
          h(
            'div',
            null,
            errs.map((k) => h('p', { id: `f-wx-${k}-err` }, e[k])),
          ),
        )
      : null,
    h(
      'div',
      { class: 'formrow' },
      h(
        'button',
        {
          class: 'btn btn--primary f',
          type: 'button',
          'data-action': 'wx-save',
          'data-fid': 'wx-save',
        },
        icon('check'),
        t('set.wx.save'),
      ),
      h(
        'button',
        { class: 'btn f', type: 'button', 'data-action': 'wx-clear', 'data-fid': 'wx-clear' },
        icon('x'),
        t('set.wx.clear'),
      ),
    ),
    Bridge.has('configureWeather') && !ui.hints.weather
      ? null
      : h(
          'div',
          { class: 'callout callout--warn' },
          icon('info'),
          h(
            'div',
            null,
            h('div', { trustedHtml: t('set.wx.noApi') }),
            ui.hints.weather
              ? h(
                  'p',
                  { style: { 'margin-top': '0.5rem' } },
                  h('strong', null, `${t('set.hint.bridgeSays')} `),
                  ui.hints.weather,
                )
              : null,
          ),
        ),
    h('p', { class: 'note', style: { 'margin-top': '1rem' } }, t('set.wx.how')),
  ];
}

interface PublicCalendar {
  readonly id: string;
  readonly name: string;
  selected: boolean;
}
interface CalendarCatalog {
  readonly calendars: PublicCalendar[];
  readonly coverage: string;
}
function parseCatalog(reply: unknown): CalendarCatalog | null {
  if (!(isObj(reply) && Array.isArray(reply.calendars))) {
    return null;
  }
  const calendars: PublicCalendar[] = [];
  for (const c of reply.calendars) {
    if (isObj(c) && typeof c.id === 'string' && typeof c.name === 'string') {
      calendars.push({ id: c.id, name: c.name, selected: c.selected === true });
    }
  }
  return { calendars, coverage: str(reply.coverage) };
}

type CalendarPanel = 'agenda' | 'sources' | 'public';
const CALENDAR_PANELS: readonly CalendarPanel[] = ['agenda', 'sources', 'public'];
let calPanel: CalendarPanel = 'agenda';
let calPage = 0;
let calSearch = '';
let calQuery = '';
let calCatalog: CalendarCatalog | null = null;
let calBusy = false;
let calError: string | null = null;
function calendarPages(count: number, size: number): HTMLElement | null {
  const pages = Math.max(1, Math.ceil(count / size));
  calPage = Math.min(calPage, pages - 1);
  return pages > 1
    ? h(
        'div',
        { class: 'formrow calendar-pages' },
        h(
          'button',
          {
            class: 'btn f',
            type: 'button',
            'data-action': 'cal-page',
            'data-arg': '-1',
            'data-fid': 'cal-prev',
            disabled: calPage === 0,
          },
          calText('Previous'),
        ),
        h('span', { class: 'note' }, `${calPage + 1} / ${pages}`),
        h(
          'button',
          {
            class: 'btn f',
            type: 'button',
            'data-action': 'cal-page',
            'data-arg': '1',
            'data-fid': 'cal-next',
            disabled: calPage === pages - 1,
          },
          calText('Next'),
        ),
      )
    : null;
}
function loadCalendarCatalog(): void {
  if (calBusy || !Bridge.has('getCalendarCatalog')) {
    return;
  }
  calBusy = true;
  calError = null;
  renderSettings();
  Bridge.call('getCalendarCatalog', [])
    .then(
      (r) => {
        calCatalog = parseCatalog(r);
      },
      (e: unknown) => {
        calError = errText(e);
      },
    )
    .then(() => {
      calBusy = false;
      renderSettings();
    });
}
function changeCalendarSource(value: CalendarSourceChange): void {
  if (calBusy || !Bridge.has('setCalendarSource')) {
    return;
  }
  calBusy = true;
  calError = null;
  renderSettings();
  Bridge.call('setCalendarSource', [value])
    .then(
      () => {
        const affected =
          ('publicId' in value && value.publicId) ||
          ('id' in value
            ? (state.data?.calendar?.sources || []).find((s) => s.id === value.id)?.catalogId
            : undefined);
        if (calCatalog && affected) {
          for (const c of calCatalog.calendars) {
            if (c.id === affected) {
              c.selected = value.enabled;
            }
          }
        }
        return refresh(false);
      },
      (e: unknown) => {
        calError = errText(e);
      },
    )
    .then(() => {
      calBusy = false;
      renderSettings();
    });
}
function sourceState(source: CalendarSource): string {
  if (!source.enabled) {
    return calText('Hidden');
  }
  return source.connected ? calText('Connected') : calText('Temporarily unavailable');
}
function secCalendar(): Child {
  const cal = state.data?.calendar;
  const sources = cal?.sources || [];
  const now = new Date();
  const body: Child[] = [];
  const size = calPanel === 'agenda' ? 6 : 4;
  const events = cal?.events.filter((e) => e.end > now) || [];
  if (calPanel === 'agenda') {
    const paging = calendarPages(events.length, size);
    body.push(h('p', { class: 'note' }, calText('The next 14 days · enabled calendars only')));
    if (events.length > 0) {
      body.push(
        h(
          'div',
          { class: 'calendar-agenda' },
          events.slice(calPage * size, (calPage + 1) * size).map((e) =>
            h(
              'div',
              { class: 'calendar-event' },
              h(
                'div',
                { class: 'calendar-event__date' },
                fmtDate(e.start < now ? now : e.start, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                }),
                h(
                  'span',
                  null,
                  e.allDay ? t('cal.allDay') : `${fmtTime(e.start)} – ${fmtTime(e.end)}`,
                ),
              ),
              h('div', null, h('strong', null, e.title), h('small', null, e.calendar)),
            ),
          ),
        ),
      );
    } else {
      body.push(
        h('p', { class: 'calendar-empty' }, cal?.configured ? t('cal.empty') : t('cal.setup.text')),
      );
    }
    body.push(paging);
    if (cal?.partial) {
      body.push(
        h(
          'p',
          { class: 'note', role: 'status' },
          calText('Some calendars are unavailable. Your other calendars are still shown.'),
        ),
      );
    }
  } else if (calPanel === 'sources') {
    const sourcePages = calendarPages(sources.length, size);
    body.push(
      h(
        'p',
        { class: 'note' },
        calText(
          'Switch off a calendar to hide its events and stop fetching it. Your connection stays saved.',
        ),
      ),
    );
    body.push(
      sources.map((source, i) => {
        if (i < calPage * size || i >= (calPage + 1) * size) {
          return null;
        }
        return srow(
          source.name,
          sourceState(source),
          sw('cal-toggle', source.id, source.enabled, source.name, `cal-source:${source.id}`),
        );
      }),
    );
    if (sources.length === 0) {
      body.push(
        h(
          'p',
          { class: 'note' },
          calText(
            'No calendars connected yet. Add public holidays or connect a private subscription from your computer.',
          ),
        ),
      );
    }
    body.push(
      sourcePages,
      h(
        'p',
        { class: 'note' },
        cal && cal.busyOnly === false
          ? calText('Event titles and times are shown.')
          : calText('Only busy times are shown for private calendars.'),
      ),
    );
    body.push(
      Bridge.has('openEditor')
        ? h(
            'button',
            {
              class: 'btn f',
              type: 'button',
              'data-action': 'open-editor',
              'data-fid': 'cal-editor',
            },
            icon('sliders'),
            t('set.cal.editor'),
          )
        : h('p', { class: 'note' }, t('set.cal.noEditor')),
    );
  } else {
    body.push(
      h(
        'label',
        { class: 'field' },
        h('span', null, calText('Find a country or language')),
        h('input', {
          type: 'search',
          maxlength: '60',
          value: calSearch,
          'data-input': 'cal-search',
          'data-fid': 'cal-search',
          placeholder: calText('Search public holidays'),
        }),
      ),
      h(
        'button',
        { class: 'btn f', type: 'button', 'data-action': 'cal-find', 'data-fid': 'cal-find' },
        calText('Search'),
      ),
    );
    if (calCatalog) {
      const found = calCatalog.calendars.filter((c) =>
        c.name.toLowerCase().includes(calQuery.toLowerCase()),
      );
      const publicPages = calendarPages(found.length, size);
      body.push(
        h(
          'p',
          { class: 'note' },
          `${calCatalog.calendars.length} ${calText('calendars · Thunderbird ·')} ${calCatalog.coverage}`,
        ),
      );
      body.push(
        found
          .slice(calPage * size, (calPage + 1) * size)
          .map((c) =>
            srow(c.name, null, sw('cal-public', c.id, c.selected, c.name, `cal-public:${c.id}`)),
          ),
      );
      if (found.length === 0) {
        body.push(
          h(
            'p',
            { class: 'note' },
            calText(
              'No matching calendar. You can connect another HTTPS or webcal feed from the private editor.',
            ),
          ),
        );
      }
      body.push(
        publicPages,
        h(
          'p',
          { class: 'note' },
          calText(
            'Only selected calendars connect to the provider. Regional observances can differ; check important dates.',
          ),
        ),
      );
    } else {
      body.push(
        h(
          'button',
          {
            class: 'btn f',
            type: 'button',
            'data-action': 'cal-catalog',
            'data-fid': 'cal-load',
            disabled: calBusy || !Bridge.has('getCalendarCatalog'),
          },
          calBusy ? calText('Loading…') : calText('Load public calendars'),
        ),
      );
    }
  }
  return [
    head('calendar'),
    seg(
      calText('Calendar view'),
      [
        { action: 'cal-panel', arg: 'agenda', label: calText('Agenda') },
        { action: 'cal-panel', arg: 'sources', label: calText('My calendars') },
        { action: 'cal-panel', arg: 'public', label: calText('Public holidays') },
      ],
      calPanel,
      'cal-panel',
    ),
    h('div', { class: 'calendar-panel', 'aria-busy': String(calBusy) }, body),
    calError ? h('p', { class: 'callout callout--bad', role: 'alert' }, calError) : null,
    ui.hints.editor ? h('p', { class: 'note', role: 'status' }, ui.hints.editor) : null,
  ];
}

function exportPayload() {
  const p = structuredClone(prefs);
  if (!ui.includeWx) {
    p.weather = { label: '', latitude: null, longitude: null };
  }
  return {
    kind: EXPORT_KIND,
    schema: 1,
    exportedAt: new Date().toISOString(),
    app: `Own TV dashboard ${VERSION}`,
    note: 'Display preferences only. Contains no links, tokens or keys.',
    preferences: p,
  };
}
function secBackup(): Child {
  const rep = ui.importReport;
  let repEl: HTMLElement | null = null;
  if (rep) {
    if (rep.errors.length > 0) {
      repEl = h(
        'div',
        { class: 'callout callout--bad', role: 'alert' },
        icon('alert'),
        h(
          'div',
          null,
          h('strong', null, t('set.bk.fail')),
          h(
            'ul',
            null,
            rep.errors.concat(rep.warnings).map((m) => h('li', null, m)),
          ),
        ),
      );
    } else {
      repEl = h(
        'div',
        { class: 'callout callout--ok', role: 'status' },
        icon('check'),
        h(
          'div',
          null,
          h(
            'strong',
            null,
            rep.warnings.length > 0
              ? t('set.bk.okNotes', { n: rep.warnings.length })
              : t('set.bk.ok'),
          ),
          rep.warnings.length > 0
            ? h(
                'ul',
                null,
                rep.warnings.map((m) => h('li', null, m)),
              )
            : null,
        ),
      );
    }
  }
  return [
    head('backup'),
    h('h2', { class: 'subhead' }, t('set.bk.export')),
    srow(
      t('set.bk.includeWx'),
      t('set.bk.includeWx.d'),
      sw('bk-wx', 'x', ui.includeWx, t('set.bk.includeWx'), 'bk-wx'),
    ),
    h(
      'div',
      { class: 'formrow' },
      h(
        'button',
        {
          class: 'btn btn--primary f',
          type: 'button',
          'data-action': 'export-download',
          'data-fid': 'bk-dl',
        },
        icon('download'),
        t('set.bk.download'),
      ),
      h(
        'button',
        {
          class: 'btn f',
          type: 'button',
          'data-action': 'export-show',
          'data-fid': 'bk-show',
          'aria-expanded': String(ui.exportShown),
        },
        icon('archive'),
        t('set.bk.show'),
      ),
    ),
    ui.exportShown
      ? h(
          'textarea',
          {
            class: 'json',
            readonly: true,
            'aria-label': t('set.bk.export'),
            'data-fid': 'bk-json',
          },
          JSON.stringify(exportPayload(), null, 2),
        )
      : null,
    h('h2', { class: 'subhead' }, t('set.bk.import')),
    h('p', { class: 'note' }, t('set.bk.importLede')),
    h(
      'div',
      { class: 'formrow' },
      h(
        'label',
        { class: 'btn filepick' },
        icon('upload'),
        t('set.bk.choose'),
        h('input', {
          type: 'file',
          accept: 'application/json,.json',
          'data-input': 'import-file',
          'data-fid': 'bk-file',
          'aria-label': t('set.bk.choose'),
        }),
      ),
    ),
    h(
      'textarea',
      {
        class: 'json',
        'data-input': 'import-text',
        'data-fid': 'bk-paste',
        placeholder: t('set.bk.pastePh'),
        'aria-label': t('set.bk.pastePh'),
        spellcheck: 'false',
      },
      ui.importText,
    ),
    h(
      'div',
      { class: 'formrow' },
      h(
        'button',
        {
          class: 'btn btn--primary f',
          type: 'button',
          'data-action': 'import-apply',
          'data-fid': 'bk-apply',
        },
        icon('check'),
        t('set.bk.apply'),
      ),
    ),
    repEl,
    h('h2', { class: 'subhead' }, t('set.bk.resetZone')),
    h(
      'div',
      { class: 'formrow' },
      h(
        'button',
        {
          class: 'btn btn--danger f',
          type: 'button',
          'data-action': 'prefs-reset',
          'data-fid': 'bk-reset',
        },
        icon('refresh'),
        ui.resetArmed ? t('set.bk.resetConfirm') : t('set.bk.reset'),
      ),
    ),
  ];
}

interface FirmwareReply {
  readonly catalogueReachable: unknown;
  readonly eligible: unknown;
}
let firmwareReply: FirmwareReply | null = null;
let firmwareBusy = false;
let releasingIdle = false;
let memoryBusy = false;
let directHomeBusy = false;
let aboutDetails = false;
function firmwareText(): string {
  if (!firmwareReply) {
    return t('fw.description');
  }
  if (firmwareReply.catalogueReachable === false) {
    return t('fw.offline');
  }
  return firmwareReply.eligible ? t('fw.report') : t('fw.unknown');
}
function dashboardConnection(): string {
  if (Bridge.mode === 'live') {
    return calText('Connected to TV');
  }
  return Bridge.mode === 'preview' ? calText('Sample preview') : calText('Not connected');
}
function systemDetails(H: Health, pv: TvPrivacy | null | undefined): HTMLElement {
  return h(
    'div',
    { class: 'about-system' },
    healthDetails(H, pv),
    H.idleReleaseSupported
      ? srow(
          calText('Direct Home'),
          calText('Open Own TV directly when apps close. Off restores foreground routing.'),
          sw('direct-home', 'mode', H.directHome, calText('Direct Home'), 'direct-home'),
        )
      : null,
    H.directHomeFailure ? h('p', { class: 'note' }, H.directHomeFailure) : null,
    H.idleReleaseSupported
      ? srow(
          t('h.memoryMode'),
          t('h.memoryModeNote'),
          sw('memory-mode', 'mode', H.lowMemoryMode, t('h.memoryMode'), 'memory-mode'),
        )
      : null,
    H.idleReleaseSupported
      ? h(
          'div',
          { class: 'formrow' },
          h(
            'button',
            {
              class: 'btn f',
              type: 'button',
              'data-action': 'release-idle',
              'data-fid': 'release-idle',
              disabled: releasingIdle || !Bridge.has('releaseIdleApps'),
            },
            t(releasingIdle ? 'h.releasing' : 'h.release'),
          ),
        )
      : null,
    H.idleReleaseSupported ? h('p', { class: 'note' }, t('h.releaseNote')) : null,
    h(
      'div',
      { class: 'formrow' },
      h(
        'button',
        {
          class: 'btn f',
          type: 'button',
          'data-action': 'check-firmware',
          'data-fid': 'fw-check',
          disabled: firmwareBusy || !Bridge.has('checkFirmware'),
        },
        firmwareBusy ? t('fw.checking') : t('fw.check'),
      ),
    ),
    h('p', { class: 'note', role: 'status' }, firmwareText()),
    srow(
      t('set.ab.last'),
      null,
      h(
        'span',
        { class: 'note' },
        state.lastOk ? fmtTime(new Date(state.lastOk)) : t('set.ab.never'),
      ),
    ),
    h(
      'button',
      { class: 'btn f', type: 'button', 'data-action': 'refresh', 'data-fid': 'ab-refresh' },
      icon('refresh'),
      t('set.ab.refresh'),
    ),
  );
}
const REMOTE_KEYS = ['k1', 'k2', 'k3', 'k4', 'k6', 'k5'] as const;
function secAbout(): Child {
  const H: Health = state.data?.health || {};
  const pv = state.data?.privacy;
  const cal = state.data?.calendar;
  const wx = state.data?.weather;
  const count = cal?.sources ? cal.sources.filter((s) => s.enabled).length : 0;
  return [
    head('about'),
    h(
      'div',
      { class: 'about-identity' },
      h('strong', null, 'own/tv'),
      h('span', { class: 'note' }, `v${VERSION} · ${calText('Open source · MIT')}`),
    ),
    h(
      'p',
      { class: 'about-copy' },
      calText(
        'An independent home screen for LG webOS. Your apps up front, an atmosphere that follows your day, and useful details close by. Make it yours in Settings.',
      ),
    ),
    h('h2', { class: 'subhead' }, calText('Your data stays yours')),
    h(
      'p',
      { class: 'note' },
      calText(
        'No Own TV account, advertising or analytics. Preferences and subscription links are stored on your TV. Calendar access is read-only; passwords are never needed. Appearance exports exclude calendar links and events.',
      ),
    ),
    h(
      'p',
      { class: 'note' },
      calText(
        'When enabled, weather and calendar providers receive the requests needed for those features. Your selected weather location is sent to Open-Meteo. Streaming apps and LG services have their own privacy settings.',
      ),
    ),
    h('h2', { class: 'subhead' }, calText('Connected here')),
    srow(calText('Dashboard'), null, h('span', { class: 'note' }, dashboardConnection())),
    srow(
      t('set.nav.weather'),
      null,
      h('span', { class: 'note' }, wx?.configured ? wx.city || calText('Enabled') : calText('Off')),
    ),
    srow(
      t('set.nav.calendar'),
      null,
      h('span', { class: 'note' }, `${count} ${calText('calendars enabled')}`),
    ),
    h(
      'button',
      {
        class: 'btn f',
        type: 'button',
        'data-action': 'about-details',
        'data-fid': 'about-details',
        'aria-expanded': String(aboutDetails),
      },
      calText('TV & system details'),
    ),
    aboutDetails ? systemDetails(H, pv) : null,
    h('h2', { class: 'subhead' }, t('set.ab.keys')),
    h(
      'ul',
      { class: 'steps' },
      REMOTE_KEYS.map((k) => h('li', null, t(`set.ab.${k}`))),
    ),
    h('h2', { class: 'subhead' }, calText('Built in the open')),
    h('p', { class: 'note' }, 'github.com/NoelHuibers/own-tv'),
    h(
      'p',
      { class: 'note' },
      calText(
        'Weather: Open-Meteo · Radar: RainViewer · Map: Natural Earth · Calendar: ical.js · Holiday catalogue: Thunderbird.',
      ),
    ),
    h(
      'p',
      { class: 'note' },
      calText(
        'Independent of LG. TV controls require rooted webOS and Homebrew Channel. Firmware compatibility checks never install an update automatically.',
      ),
    ),
  ];
}

const SECTION_BODIES: Readonly<Record<SectionKey, () => Child>> = {
  apps: secApps,
  widgets: secWidgets,
  appearance: secAppearance,
  language: secLanguage,
  weather: secWeather,
  calendar: secCalendar,
  backup: secBackup,
  about: secAbout,
};
function renderSettings(): void {
  const sheet = need('sheet');
  if (!ui.settingsOpen) {
    if (!sheet.hidden) {
      sheet.hidden = true;
      sheet.textContent = '';
    }
    return;
  }
  sheet.hidden = false;
  const body = SECTION_BODIES[ui.section]();
  patch(sheet, [
    h(
      'nav',
      { class: 'sheet__nav', 'aria-label': t('set.title'), 'data-nav-memory': 'settings-nav' },
      h('p', { class: 'sheet__brand' }, t('set.title')),
      SECTION_KEYS.map((key) =>
        h(
          'button',
          {
            class: 'navbtn',
            type: 'button',
            'data-action': 'section',
            'data-arg': key,
            'data-fid': `nav:${key}`,
            'aria-current': key === ui.section ? 'true' : null,
          },
          icon(SECTION_ICONS[key]),
          t(`set.nav.${key}`),
        ),
      ),
      h(
        'div',
        { class: 'sheet__navfoot' },
        h(
          'button',
          {
            class: 'btn f',
            type: 'button',
            'data-action': 'close-settings',
            'data-fid': 'nav:close',
          },
          icon('back'),
          t('set.close'),
        ),
        h('p', { class: 'keyhint' }, t('set.keys')),
      ),
    ),
    h('div', { class: 'sheet__body', id: 'sheet-body', 'data-section': ui.section }, body),
  ]);
}

let weatherView: WeatherView | null = null;
function openWeather(): void {
  if (weatherView) {
    return;
  }
  if (ui.settingsOpen) {
    closeSettings();
  }
  clearTimeout(pollTimer);
  const stage = need('stage');
  stage.inert = true;
  stage.setAttribute('aria-hidden', 'true');
  weatherView = createWeatherView({
    host: need('weather-app'),
    language: prefs.language,
    city: state.data?.weather?.city || prefs.weather.label,
    preview: Bridge.mode === 'preview',
    onTV: IS_WEBOS,
    translate: (k, fallback) => translate(prefs.languagePack, prefs.language, k, fallback),
    call: (m, args) => Bridge.call(m, args),
    onInput: noteInput,
    onClose: closeWeather,
    onSetup: () => {
      closeWeather();
      openSettings('weather');
    },
  });
}
function closeWeather(): void {
  if (!weatherView) {
    return;
  }
  weatherView.close();
  weatherView = null;
  const stage = need('stage');
  stage.inert = false;
  stage.removeAttribute('aria-hidden');
  const tile = findFid('w:weather');
  if (tile) {
    tile.focus({ preventScroll: true });
  }
  refresh(false).then(schedulePoll);
}
function openSettings(section?: SectionKey | null): void {
  if (weatherView) {
    closeWeather();
  }
  if (!ui.settingsOpen) {
    const a = document.activeElement;
    ui.returnFid = a ? a.getAttribute('data-fid') : null;
  }
  ui.settingsOpen = true;
  if (section) {
    ui.section = section;
  }
  const stage = need('stage');
  stage.setAttribute('aria-hidden', 'true');
  stage.inert = true;
  renderSettings();
  const target = findFid(`nav:${ui.section}`);
  if (target) {
    target.focus({ preventScroll: true });
  }
  const body = $('sheet-body');
  if (body) {
    body.scrollTop = 0;
  }
}
function closeSettings(): void {
  ui.settingsOpen = false;
  ui.wxErrors = {};
  ui.importReport = null;
  const stage = need('stage');
  stage.removeAttribute('aria-hidden');
  stage.inert = false;
  renderSettings();
  renderAll();
  const el = ui.returnFid ? findFid(ui.returnFid) : null;
  if (el && isFocusable(el)) {
    el.focus({ preventScroll: true });
  } else {
    focusDefault();
  }
}

/* ======================================================================
   Render all
   ====================================================================== */
function renderAll(): void {
  applyTheme();
  renderBanner();
  renderTop();
  renderApps();
  renderShelf();
  renderSettings();
  if (!document.activeElement || document.activeElement === document.body) {
    focusDefault();
  }
}

/* ======================================================================
   Toasts
   ====================================================================== */
function toastIcon(kind: ToastKind): string {
  if (kind === 'error') {
    return 'alert';
  }
  return kind === 'ok' ? 'check' : 'info';
}
function toast(msg: string, kind: ToastKind = 'info'): void {
  const box = need('toasts');
  const el = h(
    'div',
    { class: `toast toast--${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    icon(toastIcon(kind)),
    h('span', null, msg),
  );
  box.appendChild(el);
  while (box.children.length > 3 && box.firstChild) {
    box.removeChild(box.firstChild);
  }
  setTimeout(
    () => {
      el.classList.add('toast--out');
      setTimeout(() => {
        el.remove();
      }, 350);
    },
    kind === 'error' ? 6000 : 3800,
  );
}

/* ======================================================================
   Spatial navigation (D-pad), Back, colour keys, Magic Remote pointer
   ====================================================================== */
const FOCUSABLE =
  // biome-ignore lint/security/noSecrets: a CSS selector, not a credential
  '[tabindex="0"], button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])';
type Direction = 'left' | 'up' | 'right' | 'down';
/** The last focused item of each remembered group (rail, settings nav). */
const navMemory = new WeakMap<Element, Element>();

function activeScope(): HTMLElement {
  if (weatherView) {
    return need('weather-app');
  }
  return ui.settingsOpen ? need('sheet') : need('stage');
}
function isFocusable(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement) || !el.matches(FOCUSABLE)) {
    return false;
  }
  if (el.closest('[hidden]') || el.closest('[inert]')) {
    return false;
  }
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
function focusables(scope: HTMLElement): HTMLElement[] {
  return Array.from(scope.querySelectorAll(FOCUSABLE)).filter(isFocusable);
}
function focusDefault(): void {
  const pref = ui.settingsOpen
    ? findFid(`nav:${ui.section}`)
    : document.querySelector('#apps .card');
  if (isFocusable(pref)) {
    pref.focus({ preventScroll: true });
    return;
  }
  const [first] = focusables(activeScope());
  if (first) {
    first.focus({ preventScroll: true });
  }
}
function navScore(a: DOMRect, b: DOMRect, dir: Direction): number | null {
  const acx = (a.left + a.right) / 2;
  const acy = (a.top + a.bottom) / 2;
  const bcx = (b.left + b.right) / 2;
  const bcy = (b.top + b.bottom) / 2;
  let primary: number;
  let orth: number;
  let overlap: number;
  if (dir === 'left' || dir === 'right') {
    if (dir === 'right' ? bcx <= acx + 1 : bcx >= acx - 1) {
      return null;
    }
    primary = dir === 'right' ? b.left - a.right : a.left - b.right;
    overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    orth = Math.abs(bcy - acy);
    // Left/right stay on the same line: at the end of a row, nothing happens.
    // (Home only; in settings, Right from the section list must always reach the content.)
    if (!ui.settingsOpen && overlap <= 0 && orth > Math.max(a.height, b.height)) {
      return null;
    }
  } else {
    if (dir === 'down' ? bcy <= acy + 1 : bcy >= acy - 1) {
      return null;
    }
    primary = dir === 'down' ? b.top - a.bottom : a.top - b.bottom;
    overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    orth = Math.abs(bcx - acx);
  }
  primary = Math.max(0, primary);
  return overlap > 0 ? primary + orth * 0.3 : primary + 60 + orth * 2;
}
function navigate(dir: Direction): void {
  const scope = activeScope();
  const cur = document.activeElement;
  const items = focusables(scope);
  if (!(cur instanceof HTMLElement) || cur === document.body || !scope.contains(cur)) {
    focusDefault();
    return;
  }
  // Rail order and scroll positions must not depend on animated rectangles.
  if (cur.classList.contains('card') && (dir === 'left' || dir === 'right')) {
    const rail = cur.closest('.cards');
    const railCards = rail ? htmlAll(rail, '.card') : [];
    const nextCard = railCards[railCards.indexOf(cur) + (dir === 'right' ? 1 : -1)];
    if (nextCard) {
      nextCard.focus({ preventScroll: true });
    }
    return;
  }
  const a = cur.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const el of items) {
    if (el === cur) {
      continue;
    }
    const s = navScore(a, el.getBoundingClientRect(), dir);
    if (s !== null && s < bestScore) {
      bestScore = s;
      best = el;
    }
  }
  if (!best) {
    return;
  }
  // Entering a remembered group (rail, settings nav) restores its last/current item.
  const group = best.closest('[data-nav-memory]');
  if (group && !group.contains(cur)) {
    const last = navMemory.get(group);
    const remembered =
      group.querySelector('[aria-current="true"]') ||
      (last && document.contains(last) ? last : null);
    if (
      isFocusable(remembered) &&
      (group.getAttribute('data-nav-memory') === 'settings-nav' || dir === 'up' || dir === 'down')
    ) {
      best = remembered;
    }
  }
  best.focus({ preventScroll: true });
  if (!best.classList.contains('card')) {
    best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
function revealCard(card: Element): void {
  const rail = card.closest('.cards');
  if (!rail || getComputedStyle(rail).overflowX !== 'auto') {
    return;
  }
  const item = card.parentElement;
  if (!item) {
    return;
  }
  const gutter = Number.parseFloat(getComputedStyle(rail).paddingLeft);
  // Offset coordinates describe the layout before focus zoom and include no scroll.
  const left =
    item.getBoundingClientRect().left - rail.getBoundingClientRect().left + rail.scrollLeft;
  const right = left + item.offsetWidth;
  let target = rail.scrollLeft;
  if (left - gutter < target) {
    target = left - gutter;
  } else if (right + gutter > target + rail.clientWidth) {
    target = right + gutter - rail.clientWidth;
  }
  rail.scrollLeft = Math.max(0, Math.min(rail.scrollWidth - rail.clientWidth, target));
}
function onFocusIn(e: FocusEvent): void {
  const target = e.target;
  if (!(target instanceof Element)) {
    return;
  }
  const g = target.closest('[data-nav-memory]');
  if (g) {
    navMemory.set(g, target);
  }
  if (target.classList.contains('card')) {
    revealCard(target);
  }
  if (!ui.settingsOpen) {
    refreshAtmo();
  }
  // Settings sections follow focus, like the TV's own menus.
  if (ui.settingsOpen && !restoringFocus && target.getAttribute('data-action') === 'section') {
    const key = target.getAttribute('data-arg');
    if (key && key !== ui.section) {
      handle('section', key, target);
    }
  }
}

function isTextField(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement {
  return (
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement &&
      /^(text|search|number|email|url|tel|password)$/i.test(el.type || 'text'))
  );
}
function caretAtEdge(el: HTMLInputElement | HTMLTextAreaElement, dir: Direction): boolean {
  try {
    if (el.selectionStart !== el.selectionEnd) {
      return false;
    }
    if (dir === 'left' || dir === 'up') {
      return el.selectionStart === 0;
    }
    return el.selectionEnd === el.value.length;
  } catch {
    return true;
  }
}

function goBack(): void {
  if (weatherView) {
    closeWeather();
    return;
  }
  if (ui.settingsOpen) {
    const a = document.activeElement;
    const body = $('sheet-body');
    if (a && body?.contains(a)) {
      const nav = findFid(`nav:${ui.section}`);
      if (nav) {
        nav.focus({ preventScroll: true });
        return;
      }
    }
    closeSettings();
    return;
  }
  const first = document.querySelector('#apps .card');
  if (first instanceof HTMLElement && document.activeElement !== first) {
    first.focus({ preventScroll: true });
    return;
  }
  toast(t('toast.backHome'), 'info');
}

const KEY_DIR: Readonly<Record<number, Direction>> = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
};
function onKeyDown(e: KeyboardEvent): void {
  if (wakeFromIdle()) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const k = e.keyCode;
  if (weatherView?.key(e)) {
    e.preventDefault();
    return;
  }
  const dir = KEY_DIR[k];
  const tgt = e.target;
  const typing = isTextField(tgt);
  if (dir) {
    if (typing) {
      if (tgt instanceof HTMLTextAreaElement && !caretAtEdge(tgt, dir)) {
        return;
      }
      if ((dir === 'left' || dir === 'right') && !caretAtEdge(tgt, dir)) {
        return;
      }
    }
    e.preventDefault();
    navigate(dir);
    return;
  }
  if (k === 461 || k === 27 || (k === 8 && !typing)) {
    e.preventDefault();
    goBack();
    return;
  }
  if (k === 405) {
    // yellow
    e.preventDefault();
    cycleTheme();
    return;
  }
  if (k === 403) {
    // red
    e.preventDefault();
    cycleStyle();
    return;
  }
  if (k === 406) {
    // blue
    e.preventDefault();
    if (ui.settingsOpen) {
      closeSettings();
    } else {
      openSettings();
    }
  }
}

// Magic Remote / mouse: hovering focuses, so pointer and D-pad share one focus.
let pointerOn = false;
function onMouseOver(e: MouseEvent): void {
  if (!pointerOn || idle) {
    return;
  }
  const el = e.target instanceof Element ? e.target.closest(FOCUSABLE) : null;
  if (!el || !activeScope().contains(el) || el === document.activeElement) {
    return;
  }
  if (isTextField(document.activeElement)) {
    return;
  }
  if (isFocusable(el)) {
    el.focus({ preventScroll: true });
  }
}

/* ======================================================================
   Click / input delegation
   ====================================================================== */
function onClick(e: MouseEvent): void {
  const el = e.target instanceof Element ? e.target.closest('[data-action]') : null;
  if (!el || (el instanceof HTMLButtonElement && el.disabled)) {
    return;
  }
  noteInput();
  handle(el.getAttribute('data-action'), el.getAttribute('data-arg'), el);
}

function stepHour(arg: string): void {
  const [which, step] = arg.split('|');
  if (which !== 'dayStart' && which !== 'nightStart') {
    return;
  }
  const delta = Number.parseInt(step ?? '', 10);
  const other = which === 'dayStart' ? 'nightStart' : 'dayStart';
  let v = (parseHM(prefs.theme[which]) ?? 0) + delta;
  v = ((v % 1440) + 1440) % 1440;
  if (v === parseHM(prefs.theme[other])) {
    v = (((v + delta) % 1440) + 1440) % 1440;
  }
  prefs.theme[which] = hm(v);
  commit();
}
function moveApp(arg: string): void {
  const [key = '', step = ''] = arg.split('|');
  const d = Number.parseInt(step, 10);
  const o = prefs.apps.order;
  const i = o.indexOf(key);
  const j = i + d;
  if (i < 0 || j < 0 || j >= o.length) {
    return;
  }
  prefs.apps.sort = 'manual';
  o.splice(i, 1);
  o.splice(j, 0, key);
  commit();
}
function addApp(arg: string): void {
  const k = `app:${arg}`;
  if (!validAppKey(k) || prefs.apps.order.includes(k)) {
    return;
  }
  const src = state.data?.apps ? state.data.apps.find((a) => a.id === arg) : null;
  prefs.apps.order.push(k);
  if (src) {
    const lbl = cleanText(src.title, 48);
    if (lbl && !looksSecret(lbl)) {
      prefs.apps.labels[k] = lbl;
    }
  }
  commit();
  const nf = findFid(`ap-show:${k}`);
  if (nf) {
    nf.focus({ preventScroll: true });
    nf.scrollIntoView({ block: 'nearest' });
  }
}
function removeApp(arg: string): void {
  if (CATALOG_BY_KEY.has(arg)) {
    return;
  }
  prefs.apps.order = prefs.apps.order.filter((x) => x !== arg);
  prefs.apps.hidden = prefs.apps.hidden.filter((x) => x !== arg);
  delete prefs.apps.labels[arg];
  commit();
}
function searchWeather(): void {
  if (wxSearch.busy) {
    return;
  }
  wxSearch.busy = true;
  wxSearch.error = null;
  wxSearch.places = [];
  renderSettings();
  Bridge.call('searchWeather', [ui.wxDraft?.label || ''])
    .then(
      (r) => {
        wxSearch.places = parsePlaces(r);
        if (wxSearch.places.length === 0) {
          wxSearch.error = t('set.wx.noResults');
        }
      },
      (e: unknown) => {
        wxSearch.error = errText(e);
      },
    )
    .then(() => {
      wxSearch.busy = false;
      renderSettings();
      const place = findFid('wx-place:0');
      if (place) {
        place.focus({ preventScroll: true });
      }
    });
}
function pickPlace(arg: string | null): void {
  const place = wxSearch.places[Number(arg)];
  if (!place) {
    return;
  }
  ui.wxDraft = {
    label: place.label,
    lat: String(round2(place.latitude)),
    lon: String(round2(place.longitude)),
  };
  ui.wxErrors = {};
  wxSearch.places = [];
  renderSettings();
  const save = findFid('wx-save');
  if (save) {
    save.focus({ preventScroll: true });
  }
}
function clearWeather(): void {
  prefs.weather = { label: '', latitude: null, longitude: null };
  ui.wxDraft = null;
  ui.wxErrors = {};
  commit();
  if (Bridge.has('clearWeather')) {
    act('clearWeather', [], t('set.wx.clear')).then(() => refresh(false));
  }
  wxSearch.places = [];
  wxSearch.error = null;
  toast(t('set.wx.cleared'), 'ok');
}
function resetPrefs(): void {
  if (ui.resetArmed) {
    ui.resetArmed = false;
    clearTimeout(ui.resetTimer);
    prefs = defaultPrefs();
    ui.wxDraft = null;
    commit();
    toast(t('toast.reset'), 'ok');
    return;
  }
  ui.resetArmed = true;
  renderSettings();
  clearTimeout(ui.resetTimer);
  ui.resetTimer = setTimeout(() => {
    ui.resetArmed = false;
    renderSettings();
  }, 5000);
}
function toggleDirectHome(): void {
  if (directHomeBusy) {
    return;
  }
  directHomeBusy = true;
  act('setDirectHome', [!state.data?.health?.directHome], calText('Direct Home')).then(() => {
    directHomeBusy = false;
    refresh(false);
  });
}
function toggleMemoryMode(): void {
  if (memoryBusy) {
    return;
  }
  memoryBusy = true;
  act('setMemoryMode', [!state.data?.health?.lowMemoryMode], t('h.memoryMode'), (r) => {
    if (state.data?.health) {
      state.data.health.lowMemoryMode = field(r, 'enabled') === true;
    }
    renderSettings();
  }).then(() => {
    memoryBusy = false;
    refresh(true);
  });
}
function releaseIdle(): void {
  if (releasingIdle) {
    return;
  }
  releasingIdle = true;
  renderSettings();
  act('releaseIdleApps', [], t('h.release'), (reply) => {
    const closed = field(reply, 'closed');
    toast(t('h.released', { n: Array.isArray(closed) ? closed.length : 0 }), 'ok');
  }).then(() => {
    releasingIdle = false;
    refresh(true);
    renderSettings();
  });
}
function checkFirmware(): void {
  if (firmwareBusy) {
    return;
  }
  firmwareBusy = true;
  renderSettings();
  act('checkFirmware', [], t('fw.check'), (reply) => {
    firmwareReply = {
      catalogueReachable: field(reply, 'catalogueReachable'),
      eligible: field(reply, 'eligible'),
    };
  }).then(() => {
    firmwareBusy = false;
    renderSettings();
  });
}
function setSleep(arg: string | null): void {
  const m = Number.parseInt(arg ?? '', 10) || 0;
  act('setSleepTimer', [m], t('act.sleep'), () => {
    sleepLocal = m ? { endsAt: Date.now() + m * 60_000 } : null;
    if (state.data?.sleepTimer) {
      state.data.sleepTimer = m ? { endsAt: Date.now() + m * 60_000 } : { off: true };
    }
    if (Bridge.mode !== 'preview') {
      toast(m ? t('toast.sleepSet', { n: m }) : t('toast.sleepOff'), 'ok');
    }
    renderShelf();
  });
}
function openEditor(): void {
  if (!Bridge.has('openEditor')) {
    return;
  }
  Bridge.call('openEditor', []).then(
    () => {
      ui.hints.editor = null;
      renderSettings();
    },
    (err: unknown) => {
      ui.hints.editor = errText(err);
      renderSettings();
    },
  );
}

function handle(action: string | null, arg: string | null, el: Element): void {
  switch (action) {
    case 'cal-panel': {
      const panel = CALENDAR_PANELS.find((p) => p === arg);
      if (panel) {
        calPanel = panel;
        calPage = 0;
        renderSettings();
        if (panel === 'public' && !calCatalog) {
          loadCalendarCatalog();
        }
      }
      break;
    }
    case 'cal-catalog':
      loadCalendarCatalog();
      break;
    case 'cal-find':
      calQuery = calSearch.trim();
      calPage = 0;
      renderSettings();
      break;
    case 'cal-page':
      calPage = Math.max(0, calPage + Number(arg));
      renderSettings();
      break;
    case 'cal-toggle': {
      const source = (state.data?.calendar?.sources || []).find((s) => s.id === arg);
      if (source) {
        changeCalendarSource({ id: source.id, enabled: !source.enabled });
      }
      break;
    }
    case 'cal-public': {
      const publicCal = calCatalog?.calendars.find((c) => c.id === arg);
      if (publicCal) {
        changeCalendarSource({ publicId: publicCal.id, enabled: !publicCal.selected });
      }
      break;
    }
    case 'about-details':
      aboutDetails = !aboutDetails;
      renderSettings();
      break;
    case 'direct-home':
      toggleDirectHome();
      break;
    case 'memory-mode':
      toggleMemoryMode();
      break;
    case 'release-idle':
      releaseIdle();
      break;
    case 'check-firmware':
      checkFirmware();
      break;
    case 'launch':
      if (arg !== null) {
        launchApp(resolveApp(arg), el);
      }
      break;
    case 'launch-id':
      if (arg !== null) {
        act('launch', [arg], t('act.launch', { title: el.getAttribute('data-label') || arg }));
      }
      break;
    case 'sleep':
      setSleep(arg);
      break;
    case 'screen-off':
      act('screenOff', [], t('act.screenOff'), () => {
        if (Bridge.mode !== 'preview') {
          toast(t('toast.screenOff'), 'info');
        }
      });
      break;
    case 'lg-home':
      act('openLgHome', [], t('act.lgHome'));
      break;
    case 'tv-settings':
      act('openSettings', [], t('act.tvSettings'));
      break;
    case 'refresh':
      if (Bridge.mode !== 'none') {
        refresh(true);
      } else if (attachBridge()) {
        refresh(true);
      } else {
        toast(t('toast.noBridge', { action: t('act.refresh') }), 'error');
      }
      break;
    case 'theme-cycle':
      cycleTheme();
      break;
    case 'open-weather':
      openWeather();
      break;
    case 'open-settings':
      openSettings(oneOf(SECTION_KEYS, arg) ? arg : null);
      break;
    case 'close-settings':
      closeSettings();
      break;
    case 'section': {
      if (oneOf(SECTION_KEYS, arg)) {
        ui.section = arg;
      }
      ui.importReport = null;
      ui.wxErrors = {};
      ui.exportShown = false;
      renderSettings();
      const b = $('sheet-body');
      if (b) {
        b.scrollTop = 0;
      }
      break;
    }

    case 'theme-mode':
      if (oneOf(THEME_MODES, arg)) {
        prefs.theme.mode = arg;
      }
      commit();
      break;
    case 'style-set':
      if (oneOf(STYLES, arg)) {
        prefs.style = arg;
        commit();
      }
      break;
    case 'theme-source':
      if (oneOf(AUTO_SOURCES, arg)) {
        prefs.theme.autoSource = arg;
      }
      commit();
      break;
    case 'hour-step':
      if (arg !== null) {
        stepHour(arg);
      }
      break;
    case 'idle-set': {
      const minutes = Number.parseInt(arg ?? '', 10) || 0;
      if (oneOf(IDLE_CHOICES, minutes)) {
        prefs.idleDimMinutes = minutes;
      }
      commit();
      break;
    }
    case 'shift-toggle':
      prefs.pixelShift = !prefs.pixelShift;
      if (!prefs.pixelShift) {
        need('stage').style.transform = '';
      }
      commit();
      break;
    case 'motion-set':
      if (oneOf(MOTIONS, arg)) {
        prefs.motion = arg;
      }
      commit();
      break;
    case 'lang-set':
      prefs.language = locale(arg) || 'en';
      localeDraft = null;
      languageError = null;
      commit();
      break;
    case 'locale-apply': {
      const language = locale(localeDraft === null ? prefs.language : localeDraft);
      if (!language) {
        languageError = calText('Use a valid locale, such as fr-CA, es or ar.');
        renderSettings();
        break;
      }
      prefs.language = language;
      localeDraft = null;
      languageError = null;
      commit();
      break;
    }
    case 'language-remove':
      prefs.languagePack = null;
      commit();
      break;
    case 'widget-toggle':
      if (oneOf(WIDGETS, arg)) {
        prefs.widgets[arg] = !prefs.widgets[arg];
      }
      commit();
      break;

    case 'app-sort':
      prefs.apps.sort = arg === 'manual' ? 'manual' : 'recent';
      commit();
      break;
    case 'app-toggle':
      if (arg !== null) {
        const hi = prefs.apps.hidden.indexOf(arg);
        if (hi >= 0) {
          prefs.apps.hidden.splice(hi, 1);
        } else {
          prefs.apps.hidden.push(arg);
        }
      }
      commit();
      break;
    case 'app-move':
      if (arg !== null) {
        moveApp(arg);
      }
      break;
    case 'app-add':
      if (arg !== null) {
        addApp(arg);
      }
      break;
    case 'app-remove':
      if (arg !== null) {
        removeApp(arg);
      }
      break;
    case 'apps-reset':
      prefs.apps = defaultPrefs().apps;
      commit();
      break;

    case 'wx-coordinates':
      wxCoordinates = !wxCoordinates;
      renderSettings();
      break;
    case 'wx-search':
      searchWeather();
      break;
    case 'wx-place':
      pickPlace(arg);
      break;
    case 'wx-save':
      saveWeather();
      break;
    case 'wx-clear':
      clearWeather();
      break;
    case 'open-editor':
      openEditor();
      break;

    case 'bk-wx':
      ui.includeWx = !ui.includeWx;
      renderSettings();
      break;
    case 'export-show':
      ui.exportShown = !ui.exportShown;
      renderSettings();
      break;
    case 'export-download':
      downloadExport();
      break;
    case 'import-apply':
      importText(ui.importText);
      break;
    case 'prefs-reset':
      resetPrefs();
      break;
    default:
      break;
  }
}

function commit(): void {
  savePrefs();
  syncPrefs();
  applyTheme();
  renderAll();
}

/* Mirror non-secret preferences to the TV helper (bridge.savePreferences).
   Debounced; one request in flight at a time; edits made while a save is in
   flight trigger another save afterwards. Only a confirmed save marks clean. */
let syncTimer: Timer | null = null;
let syncWarned = false;
let syncInFlight = false;
let editSeq = 0;
function syncPrefs(): void {
  if (Bridge.mode === 'preview') {
    return;
  }
  editSeq++;
  prefsDirty = true;
  saveSync();
  if (Bridge.mode !== 'live' || !Bridge.has('savePreferences')) {
    return; // stays dirty; sent once a bridge is live
  }
  if (syncTimer) {
    clearTimeout(syncTimer);
  }
  syncTimer = setTimeout(flushPrefs, 1500);
}
function flushPrefs(): void {
  syncTimer = null;
  if (syncInFlight) {
    return; // the running save reschedules when it ends
  }
  const seq = editSeq;
  syncInFlight = true;
  Bridge.call('savePreferences', [structuredClone(prefs)]).then(
    (reply) => {
      syncInFlight = false;
      syncWarned = false;
      const rev = Number(field(reply, 'revision'));
      if (Number.isFinite(rev) && rev > lastRemoteRevision) {
        lastRemoteRevision = rev;
      }
      if (seq === editSeq) {
        prefsDirty = false;
      } else if (!syncTimer) {
        syncTimer = setTimeout(flushPrefs, 400);
      }
      saveSync();
    },
    (err: unknown) => {
      syncInFlight = false;
      if (!syncWarned) {
        syncWarned = true;
        toast(t('toast.syncErr', { msg: errText(err) }), 'error');
      }
      saveSync(); // still dirty; the next poll retries
    },
  );
}
function cycleStyle(): void {
  prefs.style = STYLES[(STYLES.indexOf(prefs.style) + 1) % STYLES.length] ?? 'ambient';
  commit();
  toast(t(`style.${prefs.style}`), 'info');
}
const THEME_CYCLE: readonly ThemeMode[] = ['day', 'night', 'auto'];
function cycleTheme(): void {
  prefs.theme.mode =
    THEME_CYCLE[(THEME_CYCLE.indexOf(prefs.theme.mode) + 1) % THEME_CYCLE.length] ?? 'day';
  commit();
}

let nameTimer: Timer | undefined;
function onInput(e: Event): void {
  const target = e.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    return;
  }
  const key = target.getAttribute('data-input');
  if (!key) {
    return;
  }
  noteInput();
  if (key === 'locale') {
    localeDraft = target.value;
    return;
  }
  if (key === 'name') {
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => {
      const v = cleanText(target.value, 24);
      if (v === null || looksSecret(v)) {
        return;
      }
      prefs.name = v;
      savePrefs();
      syncPrefs();
      renderTop();
    }, 400);
  } else if (key.startsWith('wx-')) {
    ui.wxDraft = ui.wxDraft || { label: '', lat: '', lon: '' };
    const which = key.slice(3);
    if (oneOf(WEATHER_FIELDS, which)) {
      ui.wxDraft[which] = target.value;
    }
  } else if (key === 'cal-search') {
    calSearch = target.value;
  } else if (key === 'import-text') {
    ui.importText = target.value;
  }
}
function readFile(file: File, onText: (text: string) => void, onError: () => void): void {
  const reader = new FileReader();
  reader.onload = () => {
    onText(typeof reader.result === 'string' ? reader.result : '');
  };
  reader.onerror = onError;
  reader.readAsText(file);
}
function onChange(e: Event): void {
  const target = e.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  const key = target.getAttribute('data-input');
  if (key === 'language-file') {
    const languageFile = target.files?.[0];
    if (!languageFile) {
      return;
    }
    if (languageFile.size > 65_536) {
      languageError = 'Language pack is too large.';
      renderSettings();
      return;
    }
    readFile(languageFile, useLanguagePack, () => {
      languageError = 'Could not read language pack.';
      renderSettings();
    });
    target.value = '';
    return;
  }
  if (key !== 'import-file') {
    return;
  }
  const file = target.files?.[0];
  if (!file) {
    return;
  }
  if (file.size > MAX_IMPORT_CHARS) {
    ui.importReport = { errors: [t('imp.tooBig')], warnings: [] };
    renderSettings();
    return;
  }
  readFile(
    file,
    (text) => {
      ui.importText = text;
      importText(ui.importText);
    },
    () => {
      ui.importReport = { errors: [t('imp.json')], warnings: [] };
      renderSettings();
    },
  );
  target.value = '';
}

/* ---------- Weather location ---------- */
function parseCoord(input: string): number | null {
  const s = String(input || '')
    .trim()
    .replace(/[−–]/g, '-')
    .replace(',', '.');
  if (!/^-?\d{1,3}(\.\d+)?$/.test(s)) {
    return null;
  }
  return Number.parseFloat(s);
}
function saveWeather(): void {
  const d = ui.wxDraft || { label: '', lat: '', lon: '' };
  const errs: Partial<Record<WeatherField, string>> = {};
  const label = cleanText(d.label || '', 40);
  if (!label || looksSecret(label)) {
    errs.label = t('set.wx.err.label');
  }
  const lat = parseCoord(d.lat);
  const lon = parseCoord(d.lon);
  if (lat === null || lat < -90 || lat > 90) {
    errs.lat = t('set.wx.err.lat');
  }
  if (lon === null || lon < -180 || lon > 180) {
    errs.lon = t('set.wx.err.lon');
  }
  ui.wxErrors = errs;
  const firstError = WEATHER_FIELDS.find((k) => errs[k] !== undefined);
  if (firstError || !label || lat === null || lon === null) {
    if (errs.lat || errs.lon) {
      wxCoordinates = true;
    }
    renderSettings();
    const f = findFid(`f-wx-${firstError}`);
    if (f) {
      f.focus();
    }
    return;
  }
  prefs.weather = { label, latitude: round2(lat), longitude: round2(lon) };
  prefs.widgets.weather = true;
  ui.wxDraft = {
    label,
    lat: String(prefs.weather.latitude),
    lon: String(prefs.weather.longitude),
  };
  commit();
  if (Bridge.has('configureWeather')) {
    Bridge.call('configureWeather', [
      { latitude: prefs.weather.latitude, longitude: prefs.weather.longitude, label },
    ]).then(
      () => {
        ui.hints.weather = null;
        toast(
          Bridge.mode === 'preview'
            ? t('toast.previewDid', { action: t('act.wx') })
            : t('toast.wxSent'),
          Bridge.mode === 'preview' ? 'info' : 'ok',
        );
        renderSettings();
        refresh(false);
      },
      (err: unknown) => {
        // The bridge declined: keep the local copy and show its directions in place.
        ui.hints.weather = errText(err);
        toast(t('toast.wxLocal'), 'ok');
        renderSettings();
      },
    );
  } else {
    toast(t('toast.wxLocal'), 'ok');
  }
}

/* ---------- Export / import ---------- */
function downloadExport(): void {
  const json = JSON.stringify(exportPayload(), null, 2);
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const d = new Date();
    const a = h('a', {
      href: url,
      download: `own-tv-preferences-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`,
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 2000);
    toast(t('toast.exported'), 'ok');
  } catch {
    ui.exportShown = true;
    renderSettings();
  }
}
function importText(input: string): void {
  const rep: ImportReport = { errors: [], warnings: [] };
  const text = String(input || '');
  if (!text.trim()) {
    rep.errors.push(t('imp.empty'));
  } else if (text.length > MAX_IMPORT_CHARS) {
    rep.errors.push(t('imp.tooBig'));
  }
  let obj: unknown = null;
  if (rep.errors.length === 0) {
    try {
      obj = JSON.parse(text);
    } catch {
      rep.errors.push(t('imp.json'));
    }
  }
  let raw: unknown = null;
  if (rep.errors.length === 0) {
    if (!isObj(obj)) {
      rep.errors.push(t('imp.notObject'));
    } else if ('kind' in obj) {
      if (obj.kind !== EXPORT_KIND) {
        rep.errors.push(t('imp.kind'));
      } else if (obj.schema === 1) {
        raw = obj.preferences;
      } else {
        rep.errors.push(t('imp.schema', { v: clip(String(obj.schema), 8) }));
      }
    } else if (obj.schema === 1) {
      raw = obj;
    } else {
      rep.errors.push(t('imp.kind'));
    }
  }
  let next: Prefs | null = null;
  if (rep.errors.length === 0) {
    next = sanitizePrefs(raw, rep);
  }
  ui.importReport = rep;
  if (rep.errors.length === 0 && next) {
    prefs = next;
    ui.importText = '';
    ui.wxDraft = null;
    commit();
    toast(t('toast.imported'), 'ok');
  } else {
    renderSettings();
  }
  const target = findFid('bk-apply');
  if (target && document.activeElement === document.body) {
    target.focus();
  }
}

/* ======================================================================
   Idle dimming + pixel shift (OLED care)
   ====================================================================== */
let lastInput = Date.now();
let idle = false;
function noteInput(): void {
  lastInput = Date.now();
  if (idle) {
    setIdle(false);
  }
}
function wakeFromIdle(): boolean {
  lastInput = Date.now();
  if (idle) {
    setIdle(false);
    return true;
  }
  return false;
}
function setIdle(on: boolean): void {
  idle = on;
  root.classList.toggle('is-idle', on);
  if (on) {
    placeIdleClock();
    if (weatherView) {
      weatherView.suspend();
    }
  }
}
function placeIdleClock(): void {
  const c = need('idleClock');
  const now = new Date();
  c.textContent = '';
  add(c, [
    fmtTime(now),
    h('small', null, fmtDate(now, { weekday: 'long', day: 'numeric', month: 'long' })),
  ]);
  c.style.left = `${(8 + Math.random() * 62).toFixed(1)}%`;
  c.style.top = `${(10 + Math.random() * 65).toFixed(1)}%`;
}
function idleCheck(): void {
  const m = prefs.idleDimMinutes;
  if (!(document.hidden || idle) && m && Date.now() - lastInput > m * 60_000) {
    setIdle(true);
  }
}
function pixelShift(): void {
  if (document.hidden || !prefs.pixelShift) {
    return;
  }
  const x = Math.round(Math.random() * 6 - 3);
  const y = Math.round(Math.random() * 6 - 3);
  need('stage').style.transform = `translate(${x}px,${y}px)`;
}

/* ======================================================================
   Clock tick (minute-aligned), visibility, heartbeat
   ====================================================================== */
function msToNextMinute(): number {
  const now = new Date();
  return (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50;
}
function tick(): void {
  if (!document.hidden) {
    applyTheme();
    if (!weatherView) {
      renderTop();
      renderShelf();
    }
    if (idle) {
      placeIdleClock();
    }
  }
  setTimeout(tick, msToNextMinute());
}

function homeHeartbeat(): void {
  if (window.OWN_TV_SYSTEM_HOME && !document.hidden && Bridge.has('homeHeartbeat')) {
    Bridge.call('homeHeartbeat', [
      {
        version: VERSION,
        rendered: Boolean($('stage')),
        connected: Boolean(state.lastOk),
        apps: document.querySelectorAll('.card').length,
      },
    ]).catch(() => undefined);
  }
}
function onVisibility(): void {
  homeHeartbeat();
  if (document.hidden) {
    clearTimeout(pollTimer);
    return;
  }
  noteInput();
  refresh(false).then(schedulePoll);
}

/* ======================================================================
   Boot
   ====================================================================== */
function boot(): void {
  attachBridge();
  applyTheme();
  renderAll();
  requestAnimationFrame(homeHeartbeat);
  focusDefault();
  if (Bridge.mode !== 'none') {
    refresh(false).then(schedulePoll);
  }
  setTimeout(tick, msToNextMinute());
  if (Bridge.mode === 'preview') {
    // biome-ignore lint/suspicious/noConsole: the preview announces its simulated bridge on purpose
    console.info(`[own-tv] Preview mode "${previewKind}": simulated bridge, sample data only.`);
  }
}

/** Starts the dashboard on the page, with the TV bridge if this page has one. */
export function startDashboard(bridge: TvBridge | null): void {
  liveBridge = bridge;
  root.setAttribute('data-version', VERSION);
  useLanguage(() => prefs);
  loadSync();
  prefs = loadPrefs();

  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener(
    'mousemove',
    () => {
      pointerOn = true;
      noteInput();
    },
    { passive: true },
  );
  document.addEventListener('cursorStateChange', (e) => {
    pointerOn = 'detail' in e && Boolean(field(e.detail, 'visibility'));
  });
  document.addEventListener('mouseover', onMouseOver);
  document.addEventListener('wheel', noteInput, { passive: true });
  document.addEventListener(
    'mousedown',
    (e) => {
      if (idle) {
        wakeFromIdle();
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  setInterval(idleCheck, 10_000);
  setInterval(pixelShift, 4 * 60_000);
  setInterval(homeHeartbeat, 10_000);
  document.addEventListener('visibilitychange', onVisibility);
  onMq(mqDark, applyTheme);
  onMq(mqLight, () => {
    applyTheme();
    renderAll();
  });
  onMq(mqReduce, applyTheme);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
