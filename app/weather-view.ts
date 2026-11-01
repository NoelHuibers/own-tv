/* Integrated weather UI. Providers and credentials stay behind the fixed bridge. */

import type { BridgeMethod, BridgeMethods } from './bridge';
import { type Child, h, htmlAll, type Props } from './dom';
import { type Coordinates, type Point, project, tileUrl, unproject } from './weather-map';
import {
  WEATHER_STRINGS,
  WEATHER_STRINGS_DE,
  WEATHER_TEXT_DE,
  type WeatherKey,
  type WeatherTextKey,
} from './weather-strings';

/** What the dashboard hands the weather view. */
export interface WeatherContext {
  readonly host: HTMLElement;
  readonly language: string;
  readonly city: string;
  readonly preview: boolean;
  readonly onTV: boolean;
  translate(key: string, fallback: string): string;
  call<M extends BridgeMethod>(method: M, args: Parameters<BridgeMethods[M]>): Promise<unknown>;
  onInput(): void;
  onClose(): void;
  onSetup(): void;
}

export interface WeatherView {
  /** Handles a remote key; true when the view used it. */
  key(e: KeyboardEvent): boolean;
  suspend(): void;
  close(): void;
  themeChanged(): void;
}

type Tab = 'today' | 'hours' | 'week' | 'radar';
const TABS: readonly Tab[] = ['today', 'hours', 'week', 'radar'];

interface Hour {
  readonly time: number | null;
  readonly temperature: number | null;
  readonly code: number | null;
  readonly probability: number | null;
  readonly precipitation: number | null;
}

interface Day {
  readonly time: number | null;
  readonly code: number | null;
  readonly high: number | null;
  readonly low: number | null;
  readonly probability: number | null;
  readonly precipitation: number | null;
  readonly wind: number | null;
  readonly sunrise: number | null;
  readonly sunset: number | null;
}

interface Forecast {
  readonly configured: boolean;
  readonly city: string | null;
  readonly temperature: number | null;
  readonly feelsLike: number | null;
  readonly code: number | null;
  readonly isDay: boolean | null;
  readonly wind: number | null;
  readonly humidity: number | null;
  readonly updatedAt: number | null;
  readonly timezone: string | null;
  readonly location: Coordinates | null;
  readonly hourly: readonly Hour[];
  readonly daily: readonly Day[];
  error: boolean;
}

interface Frame {
  readonly time: number;
  readonly path: string;
}

interface Radar {
  readonly frames: readonly Frame[];
  readonly location: Coordinates | null;
}

interface PendingImage {
  readonly promise: Promise<HTMLImageElement>;
  cancel(): void;
}

interface Drag {
  readonly x: number;
  readonly y: number;
  readonly center: Point;
  moved: boolean;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function records(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter(isObj) : [];
}

function coordinates(v: unknown): Coordinates | null {
  if (!isObj(v)) {
    return null;
  }
  const latitude = num(v.latitude);
  const longitude = num(v.longitude);
  return latitude === null || longitude === null ? null : { latitude, longitude };
}

function parseForecast(r: unknown): Forecast {
  const d = isObj(r) ? r : {};
  return {
    configured: Boolean(d.configured),
    city: typeof d.city === 'string' ? d.city : null,
    temperature: num(d.temperature),
    feelsLike: num(d.feelsLike),
    code: num(d.code),
    isDay: typeof d.isDay === 'boolean' ? d.isDay : null,
    wind: num(d.wind),
    humidity: num(d.humidity),
    updatedAt: num(d.updatedAt),
    timezone: typeof d.timezone === 'string' ? d.timezone : null,
    location: coordinates(d.location),
    hourly: records(d.hourly).map((x) => ({
      time: num(x.time),
      temperature: num(x.temperature),
      code: num(x.code),
      probability: num(x.probability),
      precipitation: num(x.precipitation),
    })),
    daily: records(d.daily).map((x) => ({
      time: num(x.time),
      code: num(x.code),
      high: num(x.high),
      low: num(x.low),
      probability: num(x.probability),
      precipitation: num(x.precipitation),
      wind: num(x.wind),
      sunrise: num(x.sunrise),
      sunset: num(x.sunset),
    })),
    error: Boolean(d.error),
  };
}

/** Radar metadata, or null unless it has at least one usable frame. */
function parseRadar(r: unknown): Radar | null {
  if (!isObj(r)) {
    return null;
  }
  const frames: Frame[] = [];
  for (const f of records(r.frames)) {
    const time = num(f.time);
    if (time !== null && typeof f.path === 'string') {
      frames.push({ time, path: f.path });
    }
  }
  return frames.length > 0 ? { frames, location: coordinates(r.location) } : null;
}

function clampLatitude(place: Coordinates): Coordinates {
  return {
    latitude: Math.max(-85, Math.min(85, place.latitude)),
    longitude: place.longitude,
  };
}

function svgIcon(name: string): SVGSVGElement {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'icon');
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(s.namespaceURI, 'use');
  u.setAttribute('href', `#i-${name}`);
  s.appendChild(u);
  return s;
}

function isSnow(code: number): boolean {
  return (code >= 71 && code <= 77) || code === 85 || code === 86;
}

function iconCode(code: number | null, day?: boolean | null): string {
  if (typeof code !== 'number') {
    return 'info';
  }
  if (code === 0 || code === 1) {
    return day === false ? 'moon' : 'sun';
  }
  if (code === 2 || code === 3) {
    return 'cloud';
  }
  if (code === 45 || code === 48) {
    return 'fog';
  }
  if (isSnow(code)) {
    return 'snow';
  }
  if (code >= 95) {
    return 'storm';
  }
  return code >= 51 ? 'rain' : 'cloud';
}

export function createWeatherView(ctx: WeatherContext): WeatherView {
  const host = ctx.host;
  const isGerman = ctx.language.split('-')[0] === 'de';
  const words: Readonly<Record<WeatherKey, string>> = isGerman
    ? WEATHER_STRINGS_DE
    : WEATHER_STRINGS;
  const lang = ctx.language === 'en' ? 'en-GB' : ctx.language;
  let data: Forecast | null = null;
  let busy = false;
  let tab: Tab = 'today';
  let selectedDay = 0;
  let dead = false;
  let generation = 0;
  let radar: Radar | null = null;
  let radarBusy = false;
  let radarError = false;
  let mapData: OwnTvMapData | null = null;
  let mapPromise: Promise<OwnTvMapData | null> | null = null;
  let mapScript: HTMLScriptElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let base: HTMLCanvasElement | null = null;
  let coverage: HTMLImageElement | null = null;
  let shown: HTMLImageElement | null = null;
  let drag: Drag | null = null;
  let suppressMapClick = false;
  let zoom = 6;
  let center: Coordinates | null = null;
  let frameIndex = 0;
  let shownIndex = -1;
  let playing = false;
  let playTimer: ReturnType<typeof setTimeout> | undefined;
  let paintTimer: ReturnType<typeof setTimeout> | undefined;
  let metadataTimer: ReturnType<typeof setTimeout> | undefined;
  let forecastTimer: ReturnType<typeof setTimeout> | undefined;
  let serial = 0;
  const images = new Map<string, PendingImage>();
  let requests: number[] = [];
  let mapPan = false;

  function t(k: WeatherKey): string {
    const fallback = words[k] || WEATHER_STRINGS[k] || k;
    return ctx.translate(`weather:${k}`, fallback);
  }
  function text(en: WeatherTextKey): string {
    return ctx.translate(`text:${en}`, isGerman ? WEATHER_TEXT_DE[en] : en);
  }
  function fmt(v: number | null, digits?: number): string {
    return typeof v === 'number' && Number.isFinite(v)
      ? v.toLocaleString(lang, { maximumFractionDigits: digits || 0 })
      : '—';
  }
  function zoneOptions(): Intl.DateTimeFormatOptions {
    return data?.timezone ? { timeZone: data.timezone } : {};
  }
  function time(v: number | null): string {
    if (v === null) {
      return '—';
    }
    try {
      return new Intl.DateTimeFormat(lang, {
        hour: '2-digit',
        minute: '2-digit',
        ...zoneOptions(),
      }).format(new Date(v));
    } catch {
      return '—';
    }
  }
  function dayName(v: number | null, long?: boolean): string {
    if (v === null) {
      return '—';
    }
    try {
      return new Intl.DateTimeFormat(lang, {
        weekday: long ? 'long' : 'short',
        day: 'numeric',
        month: 'short',
        ...zoneOptions(),
      }).format(new Date(v));
    } catch {
      return '—';
    }
  }
  function condition(code: number | null): string {
    if (typeof code !== 'number') {
      return '—';
    }
    const clear = [text('Clear'), text('Mostly clear'), text('Partly cloudy'), text('Overcast')];
    if (code >= 0 && code <= 3) {
      return clear[code] ?? '—';
    }
    if (code >= 95) {
      return text('Thunderstorm');
    }
    if (isSnow(code)) {
      return text('Snow');
    }
    if (code >= 51) {
      return text('Rain');
    }
    if (code === 45 || code === 48) {
      return text('Fog');
    }
    return t('title');
  }

  function button(action: string, label: Child, extra?: Props): HTMLButtonElement {
    return h('button', { type: 'button', class: 'wx-btn', 'data-wx': action, ...extra }, label);
  }
  function metric(label: string, value: string): HTMLElement {
    return h('div', { class: 'wx-metric' }, h('dt', {}, label), h('dd', {}, value));
  }
  function reading(value: number | null, unit: string): string {
    return fmt(value, unit === 'mm' ? 1 : 0) + (value == null ? '' : ` ${unit}`);
  }
  function credit(): HTMLElement {
    if (ctx.preview) {
      return h('footer', { class: 'wx-credit' }, text('Sample data · no TV data'));
    }
    return h(
      'footer',
      { class: 'wx-credit' },
      h(
        'a',
        {
          href: 'https://open-meteo.com/',
          'data-source': 'forecast',
          target: '_blank',
          rel: 'noopener',
          tabindex: '-1',
        },
        t('source'),
      ),
      h('span', {}, data?.updatedAt ? `${t('updated')} ${time(data.updatedAt)}` : ''),
      data?.error ? h('span', { class: 'wx-warning' }, t('stale')) : null,
    );
  }
  function focusKey(wxKey: string): void {
    const same = host.querySelector(`[data-wx-key="${wxKey}"]`);
    if (same instanceof HTMLElement) {
      same.focus({ preventScroll: true });
    }
  }
  function render(): void {
    if (dead) {
      return;
    }
    const focused = document.activeElement;
    const active = focused && host.contains(focused) ? focused.getAttribute('data-wx-key') : null;
    host.textContent = '';
    canvas = null;
    base = null;
    host.appendChild(
      h(
        'header',
        { class: 'wx-header' },
        button('close', [svgIcon('back'), t('back')], { 'data-wx-key': 'back' }),
        h(
          'div',
          { class: 'wx-heading' },
          h('p', {}, t('title')),
          h('h1', {}, data?.city || ctx.city || t('title')),
        ),
        h(
          'div',
          { class: 'wx-actions' },
          button('location', [svgIcon('pin'), t('location')], { 'data-wx-key': 'location' }),
          button('refresh', [svgIcon('refresh'), t('refresh')], {
            'data-wx-key': 'refresh',
            disabled: busy ? '' : null,
          }),
        ),
      ),
    );
    host.appendChild(
      h(
        'nav',
        { class: 'wx-tabs', 'aria-label': t('title') },
        TABS.map((k) =>
          button('tab', t(k), {
            'data-tab': k,
            'data-wx-key': `tab:${k}`,
            'aria-current': tab === k ? 'page' : null,
          }),
        ),
      ),
    );
    const content = h('main', { class: 'wx-content', 'data-page': tab });
    host.appendChild(content);
    if (tab === 'radar') {
      renderRadar(content);
    } else if (busy && !data) {
      content.appendChild(h('p', { class: 'wx-empty', role: 'status' }, t('loading')));
    } else if (!data?.configured || data.temperature == null) {
      const setup = data !== null && !data.configured;
      content.appendChild(
        h(
          'div',
          { class: 'wx-empty' },
          h('p', {}, setup ? t('setup') : t('failed')),
          button(setup ? 'location' : 'refresh', t(setup ? 'location' : 'retry'), {
            'data-wx-key': 'retry',
          }),
        ),
      );
    } else if (tab === 'today') {
      renderToday(content, data);
    } else if (tab === 'hours') {
      renderHours(content, data);
    } else if (tab === 'week') {
      renderWeek(content, data);
    }

    host.appendChild(credit());
    if (active) {
      focusKey(active);
    }
  }
  function hourCell(hour: Hour): HTMLElement {
    return h(
      'div',
      { class: 'wx-hour' },
      h('time', {}, time(hour.time)),
      svgIcon(iconCode(hour.code)),
      h('strong', {}, `${fmt(hour.temperature)}°`),
      h('span', { class: 'wx-hour__chance' }, `${fmt(hour.probability)} %`),
      h('small', {}, reading(hour.precipitation, 'mm')),
    );
  }
  function renderToday(node: HTMLElement, forecast: Forecast): void {
    const today = forecast.daily[0];
    const next = forecast.hourly.slice(0, 6);
    node.appendChild(
      h(
        'div',
        { class: 'wx-today' },
        h(
          'section',
          { class: 'wx-current' },
          h('div', { class: 'wx-current__icon' }, svgIcon(iconCode(forecast.code, forecast.isDay))),
          h(
            'div',
            { class: 'wx-current__temperature' },
            fmt(forecast.temperature),
            h('span', {}, '°'),
          ),
          h('p', { class: 'wx-condition' }, condition(forecast.code)),
          h(
            'p',
            { class: 'wx-muted' },
            `${t('feels')} ${fmt(forecast.feelsLike)}° · ${fmt(today?.high ?? null)}° / ${fmt(today?.low ?? null)}°`,
          ),
          h(
            'dl',
            { class: 'wx-current__metrics' },
            metric(t('wind'), reading(forecast.wind, 'km/h')),
            metric(t('humidity'), reading(forecast.humidity, '%')),
            metric(t('sunrise'), today?.sunrise ? time(today.sunrise) : '—'),
            metric(t('sunset'), today?.sunset ? time(today.sunset) : '—'),
          ),
        ),
        h(
          'section',
          { class: 'wx-next' },
          h(
            'div',
            { class: 'wx-section-heading' },
            h('h2', {}, t('next')),
            button('tab', t('hours'), { 'data-tab': 'hours', 'data-wx-key': 'more-hours' }),
          ),
          h('div', { class: 'wx-hour-grid wx-hour-grid--six' }, next.map(hourCell)),
          h('div', { class: 'wx-rain-heading' }, svgIcon('rain'), h('span', {}, t('rain'))),
          rainChart(forecast.hourly),
          h('p', { class: 'wx-muted' }, t('radarNote')),
        ),
      ),
    );
    node.appendChild(
      h(
        'section',
        { class: 'wx-day-strip', 'aria-label': t('week') },
        forecast.daily.map((d, i) =>
          button(
            'day',
            [
              h('span', {}, i === 0 ? t('today') : dayName(d.time)),
              svgIcon(iconCode(d.code)),
              h('strong', {}, `${fmt(d.high)}°`),
              h('small', {}, `${fmt(d.low)}°`),
              h('span', { class: 'wx-day-chance' }, `${fmt(d.probability)} %`),
            ],
            { 'data-day': i, 'data-wx-key': `quick-day:${i}`, class: 'wx-day-small' },
          ),
        ),
      ),
    );
  }
  function rainChart(hours: readonly Hour[]): HTMLElement {
    const chart = h('div', { class: 'wx-rain-chart', 'aria-label': t('rain') });
    hours.slice(0, 24).forEach((hour, i) => {
      chart.appendChild(
        h(
          'div',
          { class: 'wx-rain-bar', title: `${time(hour.time)} · ${reading(hour.probability, '%')}` },
          h('i', {
            style: { height: `${Math.max(2, Math.min(100, hour.probability || 0))}%` },
          }),
          i % 4 === 0 ? h('time', {}, time(hour.time)) : null,
        ),
      );
    });
    return chart;
  }
  function renderHours(node: HTMLElement, forecast: Forecast): void {
    node.appendChild(
      h(
        'div',
        { class: 'wx-section-heading' },
        h('h2', {}, t('hours')),
        h('span', { class: 'wx-muted' }, `${t('rain')} % · ${t('amount')} mm`),
      ),
    );
    const hours = forecast.hourly;
    node.appendChild(
      hours.length > 0
        ? h('div', { class: 'wx-hour-grid wx-hour-grid--full' }, hours.map(hourCell))
        : h('p', { class: 'wx-empty' }, t('notFound')),
    );
  }
  function renderWeek(node: HTMLElement, forecast: Forecast): void {
    const days = forecast.daily;
    const selected = days[selectedDay] || days[0];
    node.appendChild(
      h(
        'div',
        { class: 'wx-week' },
        days.map((d, i) =>
          button(
            'day',
            [
              h('span', {}, i === 0 ? t('today') : dayName(d.time)),
              svgIcon(iconCode(d.code)),
              h(
                'span',
                { class: 'wx-week__temp' },
                h('strong', {}, `${fmt(d.high)}°`),
                h('small', {}, `${fmt(d.low)}°`),
              ),
              h('span', { class: 'wx-week__condition' }, condition(d.code)),
              h('span', { class: 'wx-day-chance' }, `${fmt(d.probability)} %`),
              h('small', {}, reading(d.precipitation, 'mm')),
            ],
            {
              'data-day': i,
              'data-wx-key': `day:${i}`,
              class: 'wx-day',
              'aria-pressed': String(i === selectedDay),
            },
          ),
        ),
      ),
    );
    if (selected) {
      node.appendChild(
        h(
          'section',
          { class: 'wx-day-detail' },
          h(
            'div',
            {},
            h('p', { class: 'wx-muted' }, t('selected')),
            h('h2', {}, dayName(selected.time, true)),
            h('p', {}, condition(selected.code)),
          ),
          h(
            'dl',
            {},
            metric(t('wind'), reading(selected.wind, 'km/h')),
            metric(t('amount'), reading(selected.precipitation, 'mm')),
            metric(t('sunrise'), selected.sunrise ? time(selected.sunrise) : '—'),
            metric(t('sunset'), selected.sunset ? time(selected.sunset) : '—'),
          ),
        ),
      );
    }
  }
  function world(lat: number, lon: number): Point {
    return project(lat, lon, zoom);
  }
  function unworld(p: Point): Coordinates {
    return unproject(p, zoom);
  }
  function loadMap(): Promise<OwnTvMapData | null> {
    if (mapData) {
      return Promise.resolve(mapData);
    }
    if (mapPromise) {
      return mapPromise;
    }
    mapPromise = new Promise((resolve, reject) => {
      const script = h('script', { src: 'data/geography.js' });
      mapScript = script;
      script.onload = () => {
        if (dead) {
          window.OwnTVMapData = null;
          return;
        }
        mapData = window.OwnTVMapData ?? null;
        resolve(mapData);
      };
      script.onerror = () => {
        mapPromise = null;
        reject(new Error('Map data unavailable'));
      };
      document.head.appendChild(script);
    });
    return mapPromise;
  }
  function renderRadar(node: HTMLElement): void {
    if (!center && data?.location) {
      center = clampLatitude(data.location);
    }
    if (ctx.preview) {
      node.appendChild(h('div', { class: 'wx-empty' }, t('sample')));
      return;
    }
    if (!radar) {
      node.appendChild(
        h(
          'p',
          { class: 'wx-empty', role: 'status' },
          t(radarError ? 'radarFailed' : 'radarLoading'),
        ),
      );
      if (!(radarBusy || radarError)) {
        loadRadar();
      }
      return;
    }
    const current = radar;
    const mapWrap = h('div', { class: 'wx-map-wrap' });
    const map = h('canvas', {
      class: 'wx-map',
      width: '960',
      height: '600',
      tabindex: '0',
      role: 'button',
      'aria-label': t('pan'),
      'data-wx-key': 'map',
    });
    canvas = map;
    mapWrap.appendChild(map);
    mapWrap.appendChild(
      h('div', { class: 'wx-map-status', id: 'wx-map-status', role: 'status' }, ''),
    );
    const shownFrame = shownIndex >= 0 ? current.frames[shownIndex] : undefined;
    const control = h(
      'aside',
      { class: 'wx-radar-controls' },
      h('div', {}, h('h2', {}, t('radar')), h('p', { class: 'wx-muted' }, t('observations'))),
      h(
        'div',
        { class: 'wx-radar-time' },
        h('span', {}, t('frame')),
        h('strong', { id: 'wx-frame-time' }, shownFrame ? time(shownFrame.time) : '—'),
        h('small', { id: 'wx-frame-age' }, ''),
      ),
      h(
        'div',
        { class: 'wx-player' },
        button('previous', svgIcon('back'), {
          'aria-label': t('previous'),
          'data-wx-key': 'previous',
        }),
        button('play', t(playing ? 'pause' : 'play'), { 'data-wx-key': 'play', id: 'wx-play' }),
        button('next-frame', '→', { 'aria-label': t('nextFrame'), 'data-wx-key': 'next' }),
      ),
      h(
        'div',
        { class: 'wx-timeline', 'aria-label': t('observations') },
        current.frames.map((f, i) =>
          button('frame', '', {
            'data-frame': i,
            'data-wx-key': `frame:${i}`,
            'aria-label': time(f.time),
            'aria-current': i === frameIndex ? 'true' : null,
          }),
        ),
      ),
      h(
        'div',
        { class: 'wx-map-tools' },
        button('zoom-out', '−', {
          'aria-label': t('zoomOut'),
          'data-wx-key': 'minus',
          disabled: zoom <= 4 ? '' : null,
        }),
        button('center', t('recenter'), { 'data-wx-key': 'center' }),
        button('zoom-in', '+', {
          'aria-label': t('zoomIn'),
          'data-wx-key': 'plus',
          disabled: zoom >= 7 ? '' : null,
        }),
      ),
      h('p', { class: 'wx-muted' }, t('mapHelp')),
      h(
        'div',
        { class: 'wx-rain-legend' },
        h('span', {}, t('light')),
        h('i'),
        h('span', {}, t('heavy')),
      ),
      h('p', { class: 'wx-muted' }, t('noCoverage')),
      h('p', { class: 'wx-radar-note' }, t('radarNote')),
      h(
        'div',
        { class: 'wx-radar-credit' },
        h(
          'a',
          {
            href: 'https://www.rainviewer.com/',
            'data-source': 'radar',
            target: '_blank',
            rel: 'noopener',
            tabindex: '-1',
          },
          'Weather data by RainViewer',
        ),
        h('span', {}, 'Map: Natural Earth'),
        h('span', {}, t('limits')),
      ),
    );
    node.appendChild(h('section', { class: 'wx-radar-layout' }, mapWrap, control));
    armRadarRefresh();
    loadMap().then(
      () => {
        if (!dead && tab === 'radar') {
          paintBase();
          showFrame(frameIndex);
        }
      },
      () => {
        status(t('radarFailed'));
      },
    );
  }
  function status(message: string): void {
    const n = host.querySelector('#wx-map-status');
    if (n) {
      n.textContent = message;
    }
  }
  function paintBase(): void {
    if (!(canvas && mapData && center)) {
      return;
    }
    const map = mapData;
    const layer = document.createElement('canvas');
    base = layer;
    layer.width = canvas.width;
    layer.height = canvas.height;
    const c = layer.getContext('2d');
    if (!c) {
      return;
    }
    const w = layer.width;
    const ht = layer.height;
    const m = world(center.latitude, center.longitude);
    const scale = w / 256;
    const worldSize = 256 * 2 ** zoom;
    const dayMode = document.documentElement.dataset.theme === 'day';
    c.fillStyle = dayMode ? '#d9e2df' : '#0a151b';
    c.fillRect(0, 0, w, ht);
    const point = (lon: number, lat: number): Point => {
      const p = world(lat, lon);
      const dx =
        ((((p.x - m.x + worldSize / 2) % worldSize) + worldSize) % worldSize) - worldSize / 2;
      return { x: w / 2 + dx * scale, y: ht / 2 + (p.y - m.y) * scale };
    };
    c.fillStyle = dayMode ? '#eee9db' : '#19252a';
    c.strokeStyle = dayMode ? '#a5b2ab' : '#415055';
    c.lineWidth = 1;
    for (const poly of map.polygons) {
      c.beginPath();
      for (const ring of poly) {
        ring.forEach(([lon, lat], i) => {
          const q = point(lon, lat);
          if (i === 0) {
            c.moveTo(q.x, q.y);
          } else {
            c.lineTo(q.x, q.y);
          }
        });
        c.closePath();
      }
      c.fill('evenodd');
      c.stroke();
    }
    c.strokeStyle = dayMode ? 'rgba(30,70,70,.06)' : 'rgba(160,200,200,.04)';
    c.lineWidth = 1;
    for (let x = 0; x < w; x += 80) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, ht);
      c.stroke();
    }
    for (let y = 0; y < ht; y += 80) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
    const labels: { x: number; y: number; w: number }[] = [];
    c.font = '15px system-ui';
    for (const [lon, lat, name] of map.cities) {
      const p = point(lon, lat);
      if (p.x < 18 || p.x > w - 100 || p.y < 20 || p.y > ht - 20 || labels.length >= 18) {
        continue;
      }
      const width = c.measureText(name).width;
      if (
        labels.some((l) => Math.abs(l.x - p.x) < (l.w + width) / 2 + 22 && Math.abs(l.y - p.y) < 25)
      ) {
        continue;
      }
      labels.push({ x: p.x, y: p.y, w: width });
      c.fillStyle = dayMode ? '#54706c' : '#96aaa9';
      c.beginPath();
      c.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = dayMode ? '#eee9db' : '#19252a';
      c.lineWidth = 4;
      c.strokeText(name, p.x + 7, p.y - 5);
      c.fillText(name, p.x + 7, p.y - 5);
    }
    const marker = data?.location || radar?.location;
    if (marker) {
      const p = point(marker.longitude, marker.latitude);
      c.fillStyle = '#79d6c1';
      c.strokeStyle = '#fff';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(p.x, p.y, 6, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    const kmPerPixel =
      (Math.cos((center.latitude * Math.PI) / 180) * 40_075) / (256 * 2 ** zoom) / scale;
    let km = 500;
    if (zoom >= 7) {
      km = 50;
    } else if (zoom === 6) {
      km = 100;
    } else if (zoom === 5) {
      km = 200;
    }
    const len = km / kmPerPixel;
    c.strokeStyle = dayMode ? '#425f5b' : '#a8bcb8';
    c.fillStyle = c.strokeStyle;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(24, ht - 30);
    c.lineTo(24 + len, ht - 30);
    c.moveTo(24, ht - 35);
    c.lineTo(24, ht - 25);
    c.moveTo(24 + len, ht - 35);
    c.lineTo(24 + len, ht - 25);
    c.stroke();
    c.font = '13px system-ui';
    c.fillText(`${km} km`, 24, ht - 42);
    c.fillText('N ↑', w - 55, 28);
    draw();
  }
  function draw(): void {
    if (!(canvas && base)) {
      return;
    }
    const c = canvas.getContext('2d');
    if (!c) {
      return;
    }
    const w = canvas.width;
    const ht = canvas.height;
    c.clearRect(0, 0, w, ht);
    c.drawImage(base, 0, 0);
    const crop = (512 - (512 * ht) / w) / 2;
    if (shown) {
      c.globalAlpha = 0.85;
      c.drawImage(shown, 0, crop, 512, (512 * ht) / w, 0, 0, w, ht);
      c.globalAlpha = 1;
    }
    if (coverage) {
      c.globalAlpha = 0.55;
      c.drawImage(coverage, 0, crop, 512, (512 * ht) / w, 0, 0, w, ht);
      c.globalAlpha = 1;
    }
  }
  function imageUrl(path: string, coverageTile: boolean): string {
    return tileUrl(center, zoom, path, coverageTile);
  }
  function loadImage(url: string): Promise<HTMLImageElement> {
    const cached = images.get(url);
    if (cached) {
      return cached.promise;
    }
    const now = Date.now();
    requests = requests.filter((n) => now - n < 60_000);
    if (requests.length >= 70) {
      return Promise.reject(new Error('rate'));
    }
    requests.push(now);
    const img = new Image();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      timer = setTimeout(() => {
        img.src = '';
        reject(new Error('timeout'));
      }, 12_000);
      img.onload = () => {
        clearTimeout(timer);
        resolve(img);
      };
      img.onerror = () => {
        clearTimeout(timer);
        reject(new Error('image'));
      };
      img.referrerPolicy = 'no-referrer';
      img.src = url;
    });
    images.set(url, {
      promise,
      cancel: () => {
        clearTimeout(timer);
        img.onload = null;
        img.onerror = null;
        img.src = '';
      },
    });
    while (images.size > 15) {
      const first = images.keys().next();
      if (first.done) {
        break;
      }
      images.get(first.value)?.cancel();
      images.delete(first.value);
    }
    return promise;
  }
  function showFrame(index: number): void {
    clearTimeout(playTimer);
    if (!(canvas && radar && center) || dead) {
      return;
    }
    const current = radar;
    frameIndex = Math.max(0, Math.min(current.frames.length - 1, index));
    const frame = current.frames[frameIndex];
    if (!frame) {
      return;
    }
    const token = ++serial;
    status(t('waiting'));
    for (const b of htmlAll(host, '[data-frame]')) {
      b.setAttribute('aria-current', String(Number(b.dataset.frame) === frameIndex));
    }
    const mask = coverage
      ? Promise.resolve(coverage)
      : loadImage(imageUrl('/v2/coverage/0', true)).catch(() => null);
    Promise.all([loadImage(imageUrl(frame.path, false)), mask]).then(
      ([image, coverageImage]) => {
        if (dead || token !== serial || tab !== 'radar') {
          return;
        }
        shown = image;
        coverage = coverageImage;
        shownIndex = frameIndex;
        draw();
        const stamp = host.querySelector('#wx-frame-time');
        const age = host.querySelector('#wx-frame-age');
        const visible = current.frames[shownIndex];
        if (stamp && visible) {
          stamp.textContent = time(visible.time);
        }
        if (age && visible) {
          age.textContent = Date.now() - visible.time > 1_800_000 ? t('old') : '';
        }
        status(coverage ? '' : `${t('noCoverage')} (${text('mask unavailable')})`);
        if (playing) {
          playTimer = setTimeout(() => {
            showFrame((frameIndex + 1) % current.frames.length);
          }, 1000);
        }
      },
      (e: unknown) => {
        if (dead || token !== serial) {
          return;
        }
        pause();
        const rate = e instanceof Error && e.message === 'rate';
        status(t(rate ? 'rate' : shown ? 'missing' : 'radarFailed'));
      },
    );
  }
  function pause(): void {
    playing = false;
    clearTimeout(playTimer);
    const b = host.querySelector('#wx-play');
    if (b) {
      b.textContent = t('play');
    }
  }
  function clearRadar(): void {
    pause();
    clearTimeout(metadataTimer);
    mapPan = false;
    ++serial;
    clearTimeout(paintTimer);
    for (const p of images.values()) {
      p.cancel();
    }
    images.clear();
    coverage = null;
    shown = null;
    shownIndex = -1;
    canvas = null;
    base = null;
  }
  function armRadarRefresh(): void {
    clearTimeout(metadataTimer);
    metadataTimer = setTimeout(() => {
      if (dead || tab !== 'radar') {
        return;
      }
      if (document.hidden) {
        armRadarRefresh();
        return;
      }
      const keep = radar && frameIndex < radar.frames.length - 1 ? radar.frames[frameIndex] : null;
      const keepTime = keep ? keep.time : null;
      ctx.call('getRadar', []).then(
        (reply) => {
          if (dead || tab !== 'radar') {
            return;
          }
          const next = parseRadar(reply);
          if (!next) {
            status(t('radarFailed'));
            armRadarRefresh();
            return;
          }
          const resume = playing;
          clearRadar();
          radar = next;
          playing = resume;
          frameIndex = next.frames.length - 1;
          if (keepTime) {
            const i = next.frames.findIndex((f) => f.time === keepTime);
            if (i >= 0) {
              frameIndex = i;
            }
          }
          render();
        },
        () => {
          if (!dead && tab === 'radar') {
            status(t('radarFailed'));
            armRadarRefresh();
          }
        },
      );
    }, 300_000);
  }
  function loadRadar(): void {
    radarBusy = true;
    radarError = false;
    const failed = (): void => {
      if (dead) {
        return;
      }
      radarBusy = false;
      radarError = true;
      if (tab === 'radar') {
        render();
      }
    };
    ctx.call('getRadar', []).then((reply) => {
      if (dead) {
        return;
      }
      const next = parseRadar(reply);
      if (!next) {
        failed();
        return;
      }
      radar = next;
      if (!center && next.location) {
        center = clampLatitude(next.location);
      }
      frameIndex = next.frames.length - 1;
      radarBusy = false;
      if (tab === 'radar') {
        render();
      }
    }, failed);
  }
  function changeMap(): void {
    ++serial;
    status(t('waiting'));
    clearTimeout(playTimer);
    shown = null;
    coverage = null;
    shownIndex = -1;
    paintBase();
    clearTimeout(paintTimer);
    paintTimer = setTimeout(() => {
      showFrame(frameIndex);
    }, 250);
  }
  function setTab(next: Tab): void {
    if (next === tab) {
      return;
    }
    clearRadar();
    tab = next;
    render();
    const b = host.querySelector(`[data-tab="${next}"]`);
    if (b instanceof HTMLElement) {
      b.focus({ preventScroll: true });
    }
  }
  function armForecastRefresh(): void {
    clearTimeout(forecastTimer);
    forecastTimer = setTimeout(() => {
      if (dead) {
        return;
      }
      if (document.hidden) {
        armForecastRefresh();
        return;
      }
      load(false);
    }, 600_000);
  }
  function load(force: boolean): void {
    if (busy) {
      return;
    }
    busy = true;
    const token = ++generation;
    render();
    ctx.call('getWeather', [force]).then(
      (reply) => {
        if (dead || token !== generation) {
          return;
        }
        const forecast = parseForecast(reply);
        data = forecast;
        busy = false;
        armForecastRefresh();
        if (forecast.location && !center) {
          center = clampLatitude(forecast.location);
        }
        render();
      },
      () => {
        if (dead || token !== generation) {
          return;
        }
        busy = false;
        if (data) {
          data.error = true;
        }
        armForecastRefresh();
        render();
      },
    );
  }
  function togglePan(map: HTMLCanvasElement): void {
    mapPan = !mapPan;
    map.setAttribute('aria-pressed', String(mapPan));
    status(mapPan ? text('Arrows pan · OK or Back returns to controls') : '');
  }
  function clicked(e: MouseEvent): void {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) {
      return;
    }
    const source = target.closest('[data-source]');
    if (source instanceof HTMLElement && ctx.onTV) {
      e.preventDefault();
      ctx.call('openWeatherSource', [source.dataset.source ?? '']).catch(() => {
        status(source instanceof HTMLAnchorElement ? source.href : '');
      });
      return;
    }
    if (canvas && target === canvas) {
      ctx.onInput();
      if (suppressMapClick) {
        suppressMapClick = false;
        return;
      }
      togglePan(canvas);
      return;
    }
    const b = target.closest('[data-wx]');
    if (!(b instanceof HTMLElement) || (b instanceof HTMLButtonElement && b.disabled)) {
      return;
    }
    ctx.onInput();
    act(b);
  }
  function act(b: HTMLElement): void {
    const a = b.dataset.wx;
    if (a === 'close') {
      ctx.onClose();
      return;
    }
    if (a === 'location') {
      ctx.onSetup();
      return;
    }
    if (a === 'refresh') {
      clearRadar();
      radar = null;
      radarError = false;
      load(true);
      return;
    }
    if (a === 'tab') {
      const next = TABS.find((k) => k === b.dataset.tab);
      if (next) {
        setTab(next);
      }
      return;
    }
    if (a === 'day') {
      selectedDay = Number(b.dataset.day) || 0;
      tab = 'week';
      clearRadar();
      render();
      focusKey(`day:${selectedDay}`);
      return;
    }
    if (a === 'zoom-in' || a === 'zoom-out') {
      zoom = Math.max(4, Math.min(7, zoom + (a === 'zoom-in' ? 1 : -1)));
      clearRadar();
      render();
      return;
    }
    if (a === 'center') {
      const place = data?.location || radar?.location;
      if (place) {
        center = clampLatitude(place);
        changeMap();
      }
      return;
    }
    if (!radar) {
      return;
    }
    const count = radar.frames.length;
    if (a === 'play') {
      if (playing) {
        pause();
      } else {
        playing = true;
        b.textContent = t('pause');
        showFrame(frameIndex === count - 1 ? 0 : frameIndex);
      }
      return;
    }
    if (a === 'previous' || a === 'next-frame' || a === 'frame') {
      pause();
      showFrame(
        a === 'frame'
          ? Number(b.dataset.frame)
          : (frameIndex + (a === 'previous' ? -1 : 1) + count) % count,
      );
    }
  }
  function moveFocus(list: readonly HTMLElement[], cur: HTMLElement, k: number): void {
    const next = list[list.indexOf(cur) + (k === 39 ? 1 : -1)];
    if (next) {
      next.focus({ preventScroll: true });
    }
  }
  function key(e: KeyboardEvent): boolean {
    const focused = document.activeElement;
    const cur = focused instanceof HTMLElement ? focused : null;
    const k = e.keyCode;
    if (k === 406) {
      ctx.onSetup();
      return true;
    }
    if (canvas && cur === canvas) {
      if (k === 13) {
        togglePan(canvas);
        return true;
      }
      if (mapPan && (k === 8 || k === 27 || k === 461)) {
        mapPan = false;
        canvas.setAttribute('aria-pressed', 'false');
        status('');
        return true;
      }
      if (mapPan && k >= 37 && k <= 40 && center) {
        const p = world(center.latitude, center.longitude);
        if (k === 37) {
          p.x -= 30;
        } else if (k === 39) {
          p.x += 30;
        }
        if (k === 38) {
          p.y -= 30;
        } else if (k === 40) {
          p.y += 30;
        }
        center = unworld(p);
        changeMap();
        return true;
      }
    }

    if ((k === 37 || k === 39) && cur?.dataset.tab) {
      const tabs = htmlAll(host, '.wx-tabs [data-tab]');
      if (tabs.includes(cur)) {
        moveFocus(tabs, cur, k);
        return true;
      }
    }
    if ((k === 37 || k === 39) && cur?.dataset.day) {
      moveFocus(htmlAll(host, '[data-day]'), cur, k);
      return true;
    }
    return false;
  }
  function pointerDown(e: PointerEvent): void {
    if (!canvas || e.target !== canvas || !center) {
      return;
    }
    ctx.onInput();
    drag = {
      x: e.clientX,
      y: e.clientY,
      center: world(center.latitude, center.longitude),
      moved: false,
    };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // the pointer is already gone
    }
  }
  function pointerMove(e: PointerEvent): void {
    if (!(drag && canvas)) {
      return;
    }
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) < 5) {
      return;
    }
    drag.moved = true;
    const r = canvas.getBoundingClientRect();
    center = unworld({
      x: drag.center.x - (dx * 256) / r.width,
      y: drag.center.y - (dy * 256 * canvas.height) / canvas.width / r.height,
    });
    changeMap();
  }
  function pointerUp(): void {
    if (!drag) {
      return;
    }
    suppressMapClick = drag.moved;
    drag = null;
  }
  function visibility(): void {
    if (document.hidden) {
      pause();
    }
  }
  host.addEventListener('click', clicked);
  host.addEventListener('pointerdown', pointerDown);
  host.addEventListener('pointermove', pointerMove);
  host.addEventListener('pointerup', pointerUp);
  host.addEventListener('pointercancel', pointerUp);
  document.addEventListener('visibilitychange', visibility);
  host.setAttribute('aria-label', t('title'));
  host.hidden = false;
  load(false);
  focusKey('back');
  return {
    key,
    suspend: pause,
    close: () => {
      dead = true;
      clearTimeout(forecastTimer);
      ++generation;
      clearRadar();
      host.removeEventListener('click', clicked);
      host.removeEventListener('pointerdown', pointerDown);
      host.removeEventListener('pointermove', pointerMove);
      host.removeEventListener('pointerup', pointerUp);
      host.removeEventListener('pointercancel', pointerUp);
      document.removeEventListener('visibilitychange', visibility);
      host.hidden = true;
      host.textContent = '';
      mapData = null;
      window.OwnTVMapData = null;
      if (mapScript) {
        mapScript.remove();
      }
    },
    themeChanged: () => {
      if (canvas) {
        paintBase();
      }
    },
  };
}
