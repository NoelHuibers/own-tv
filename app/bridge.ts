/* The TV bridge. The dashboard exposes fixed actions, never a shell or arbitrary URL
   runner. Calls reach the TV helper in one of three ways:
   - on the TV: Luna (PalmServiceBridge) runs the helper through Homebrew Channel
   - in the computer editor (window.OWN_TV_EDITOR): its local /api/action endpoint
   - under Direct Home (window.OWN_TV_HOME_BRIDGE): the TV's loopback bridge */

import type { Prefs } from './prefs';

export interface WeatherLocation {
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly label: string;
}

/** Switch a connected calendar (by id) or a public catalogue calendar (by publicId). */
export type CalendarSourceChange =
  | { readonly id: string; readonly enabled: boolean }
  | { readonly publicId: string; readonly enabled: boolean };

export interface HomeHeartbeat {
  readonly version: string;
  readonly rendered: boolean;
  readonly connected: boolean;
  readonly apps: number;
}

/** Every bridge action. Replies are unchecked JSON; callers validate what they read. */
export interface BridgeMethods {
  getState(): Promise<unknown>;
  getCalendarCatalog(): Promise<unknown>;
  setCalendarSource(value: CalendarSourceChange): Promise<unknown>;
  getWeather(force?: boolean): Promise<unknown>;
  getRadar(): Promise<unknown>;
  openWeatherSource(source: string): Promise<unknown>;
  checkFirmware(): Promise<unknown>;
  releaseIdleApps(): Promise<unknown>;
  setMemoryMode(enabled: boolean): Promise<unknown>;
  setDirectHome(enabled: boolean): Promise<unknown>;
  homeHeartbeat(value: HomeHeartbeat): Promise<unknown>;
  searchWeather(query: string): Promise<unknown>;
  launch(id: string): Promise<unknown>;
  setSleepTimer(minutes: number): Promise<unknown>;
  screenOff(): Promise<unknown>;
  openLgHome(): Promise<unknown>;
  openSettings(): Promise<unknown>;
  savePreferences(prefs: Prefs): Promise<unknown>;
  configureWeather(weather: WeatherLocation): Promise<unknown>;
  clearWeather(): Promise<unknown>;
  openEditor(): Promise<unknown>;
}

export type BridgeMethod = keyof BridgeMethods;

/**
 * A bridge implements any subset of the actions. A capability set to false hides an
 * action that exists.
 */
export interface TvBridge extends Partial<BridgeMethods> {
  readonly capabilities?: Readonly<Partial<Record<BridgeMethod, boolean>>>;
  /** Reaches a TV (running on it, or through Direct Home). */
  readonly onTV?: boolean;
  /** Runs in the computer editor. */
  readonly editor?: boolean;
}

type Reply = Record<string, unknown>;

function isReply(r: unknown): r is Reply {
  return typeof r === 'object' && r !== null;
}

function check(r: unknown): Reply {
  if (!isReply(r)) {
    throw new Error('TV operation failed');
  }
  if (r.ok === false) {
    throw new Error(String(r.error || 'TV operation failed'));
  }
  return r;
}

const TIMEOUT_MS = 60_000;

/**
 * The bridge for this page, or null where nothing can reach a TV: a plain browser, or a
 * browser preview (?preview=…), which uses the dashboard's simulated bridge instead.
 */
export function createBridge(): TvBridge | null {
  const Palm = window.PalmServiceBridge;
  const onTV = typeof Palm === 'function';
  const editor = window.OWN_TV_EDITOR === true;
  const home = window.OWN_TV_HOME_BRIDGE;
  if (!(onTV || editor || home)) {
    return null;
  }
  if (!onTV && /[?&]preview=(sample|empty|error)(?:&|$)/.test(location.search)) {
    return null;
  }

  function post(url: string, headers: Record<string, string>, action: string, value: unknown) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ action, value }),
    })
      .then((r): Promise<unknown> => r.json())
      .then(check);
  }

  function call(action: string, value?: unknown): Promise<Reply> {
    if (home) {
      return post(
        `http://127.0.0.1:${home.port}/action`,
        { Authorization: `Bearer ${home.token}` },
        action,
        value,
      );
    }
    if (editor && !onTV) {
      return post('/api/action', { 'X-OwnTV-Editor': '1' }, action, value);
    }
    if (typeof Palm !== 'function') {
      return Promise.reject(new Error('Preview only. Connect a TV through the local editor.'));
    }
    return new Promise((resolve, reject) => {
      const bridge = new Palm();
      let finished = false;
      const timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          try {
            bridge.cancel();
          } catch {
            // already closed
          }
          reject(new Error('TV did not respond'));
        }
      }, TIMEOUT_MS);
      // UTF-8 JSON as base64: one shell-safe argument
      const args =
        value === undefined ? '' : ` ${btoa(unescape(encodeURIComponent(JSON.stringify(value))))}`;
      if (!/^[a-zA-Z]+$/.test(action)) {
        reject(new Error('Invalid action'));
        return;
      }
      bridge.onservicecallback = (raw) => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timer);
        try {
          const r: unknown = JSON.parse(raw);
          if (!isReply(r)) {
            throw new Error('TV operation failed');
          }
          if (r.returnValue === false) {
            throw new Error(
              'Own TV needs its Homebrew Channel permission. Run the permission repair tool.',
            );
          }
          resolve(check(JSON.parse(String(r.stdoutString || '{}'))));
        } catch (e) {
          reject(e);
        } finally {
          try {
            bridge.cancel();
          } catch {
            // already closed
          }
        }
      };
      bridge.call(
        'luna://org.webosbrew.hbchannel.service/exec',
        JSON.stringify({ command: `/usr/bin/node /var/lib/own-tv/helper.cjs ${action}${args}` }),
      );
    });
  }

  return {
    getState: () => call('state'),
    getCalendarCatalog: () => call('calendarCatalog'),
    setCalendarSource: (value) => call('calendarSource', value),
    getWeather: (force) => call('weatherDetails', force === true),
    getRadar: () => call('radar'),
    openWeatherSource: (source) => call('weatherSource', source),
    checkFirmware: () => call('firmwareCheck'),
    releaseIdleApps: () => call('releaseIdleApps'),
    setMemoryMode: (enabled) => call('memoryMode', enabled),
    setDirectHome: (enabled) => call('directHome', enabled),
    homeHeartbeat: (value) => call('homeHeartbeat', value),
    searchWeather: (query) => call('weatherSearch', query),
    launch: (id) => {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(id)) {
        return Promise.reject(new Error('Invalid app'));
      }
      return call('launch', id);
    },
    setSleepTimer: (minutes) => call('sleep', Number(minutes)),
    screenOff: () => call('screenOff'),
    openLgHome: () => call('lgHome'),
    openSettings: () => call('settings'),
    savePreferences: (prefs) => call('preferences', prefs),
    configureWeather: (weather) => call('weather', weather),
    clearWeather: () => call('configure', { weather: null }),
    openEditor: () => {
      if (editor) {
        location.href = '/integrations';
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(
        new Error('On your computer, run: pnpm editor --ssh-config PATH --host YOUR_TV_ALIAS'),
      );
    },
    capabilities: { configureWeather: true, openEditor: editor },
    onTV: onTV || Boolean(home),
    editor,
  };
}
