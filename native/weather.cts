// Open-Meteo forecasts and RainViewer radar metadata, reduced to what the dashboard shows.

/** A stored weather location (integrations.json). */
export interface WeatherLocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly label: string;
}

export interface SolarDay {
  readonly start: number;
  readonly end: number;
  readonly sunrise: number;
  readonly sunset: number;
}

export interface HourlyForecast {
  readonly time: number;
  readonly temperature: number | null;
  readonly code: number | null;
  readonly probability: number | null;
  readonly precipitation: number | null;
  readonly wind: number | null;
}

export interface DailyForecast {
  readonly time: number;
  readonly code: number | null;
  readonly low: number | null;
  readonly high: number | null;
  readonly probability: number | null;
  readonly precipitation: number | null;
  readonly wind: number | null;
  readonly sunrise: number | null;
  readonly sunset: number | null;
}

export interface WeatherDetails {
  feelsLike: number | null;
  humidity: number | null;
  wind: number | null;
  windDirection: number | null;
  isDay: boolean;
  hourly: HourlyForecast[];
  daily: DailyForecast[];
}

export interface Weather extends Partial<WeatherDetails> {
  configured: true;
  city: string;
  temperature: number;
  condition: string;
  code: number;
  updatedAt: unknown;
  timezone: unknown;
  solar: SolarDay[];
  location?: { latitude: number; longitude: number };
  error?: true;
}

export interface RadarFrame {
  readonly time: number;
  readonly path: string;
}

export interface Radar {
  readonly host: string;
  readonly generated: number;
  readonly frames: RadarFrame[];
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function field(value: unknown, key: string | number): unknown {
  return isObject(value) ? value[key] : undefined;
}

/** A provider list; missing means empty, anything else that is not a list is invalid. */
function list(value: unknown): readonly unknown[] {
  const items = value || [];
  if (!Array.isArray(items)) {
    throw new TypeError('Invalid weather response');
  }
  return items;
}

function weatherLabel(code: number): string {
  if (code === 0) {
    return 'Clear';
  }
  if (code === 1) {
    return 'Mostly clear';
  }
  if (code === 2) {
    return 'Partly cloudy';
  }
  if (code === 3) {
    return 'Overcast';
  }
  if (code === 45 || code === 48) {
    return 'Fog';
  }
  if (code >= 51 && code <= 57) {
    return 'Drizzle';
  }
  if (code >= 61 && code <= 67) {
    return 'Rain';
  }
  if (code >= 71 && code <= 77) {
    return 'Snow';
  }
  if (code >= 80 && code <= 82) {
    return 'Rain showers';
  }
  if (code >= 85 && code <= 86) {
    return 'Snow showers';
  }
  if (code >= 95) {
    return 'Thunderstorm';
  }
  return 'Weather';
}

function number(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function normalizeWeather(
  data: unknown,
  city: string,
  updatedAt: unknown,
  details = false,
  now: number = Date.now(),
): Weather {
  const current = field(data, 'current');
  const temperature = field(current, 'temperature_2m');
  const code = field(current, 'weather_code');
  if (
    !current ||
    typeof temperature !== 'number' ||
    !Number.isFinite(temperature) ||
    typeof code !== 'number' ||
    !Number.isFinite(code)
  ) {
    throw new Error('Invalid weather response');
  }
  const daily = field(data, 'daily') || {};
  const times = list(field(daily, 'time'));
  const solar = times
    .slice(0, -1)
    .map((start, i) => ({
      start: Number(start) * 1000,
      end: Number(times[i + 1]) * 1000,
      sunrise: Number(field(field(daily, 'sunrise'), i)) * 1000,
      sunset: Number(field(field(daily, 'sunset'), i)) * 1000,
    }))
    .filter(
      (d) =>
        Object.values(d).every((v) => Number.isFinite(v)) &&
        d.start < d.sunrise &&
        d.sunrise < d.sunset &&
        d.sunset < d.end,
    );
  const value: Weather = {
    configured: true,
    city,
    temperature,
    condition: weatherLabel(code),
    code,
    updatedAt,
    timezone: field(data, 'timezone'),
    solar,
  };
  if (details) {
    const h = field(data, 'hourly') || {};
    const d = field(data, 'daily') || {};
    const at = (series: string, i: number) => number(field(field(h, series), i));
    const on = (series: string, i: number) => number(field(field(d, series), i));
    const sun = (series: string, i: number) => {
      const v = field(field(d, series), i);
      return Number(v) > 0 ? Number(v) * 1000 : null;
    };
    const days = list(field(d, 'time'));
    Object.assign(value, {
      feelsLike: number(field(current, 'apparent_temperature')),
      humidity: number(field(current, 'relative_humidity_2m')),
      wind: number(field(current, 'wind_speed_10m')),
      windDirection: number(field(current, 'wind_direction_10m')),
      isDay: field(current, 'is_day') === 1,
      hourly: list(field(h, 'time'))
        .map(
          (time, i): HourlyForecast => ({
            time: Number(time) * 1000,
            temperature: at('temperature_2m', i),
            code: at('weather_code', i),
            probability: at('precipitation_probability', i),
            precipitation: at('precipitation', i),
            wind: at('wind_speed_10m', i),
          }),
        )
        .filter((hour) => hour.time >= Math.floor(now / 3600000) * 3600000)
        .slice(0, 24),
      daily: days
        .map(
          (time, i): DailyForecast => ({
            time: Number(time) * 1000,
            code: on('weather_code', i),
            low: on('temperature_2m_min', i),
            high: on('temperature_2m_max', i),
            probability: on('precipitation_probability_max', i),
            precipitation: on('precipitation_sum', i),
            wind: on('wind_speed_10m_max', i),
            sunrise: sun('sunrise', i),
            sunset: sun('sunset', i),
          }),
        )
        .filter((day, i) => {
          const next = days[i + 1];
          return (next ? Number(next) * 1000 : day.time + 86400000) > now;
        })
        .slice(0, 7),
    } satisfies WeatherDetails);
  }
  return value;
}

export function searchUrl(query: unknown): string {
  if (
    typeof query !== 'string' ||
    query.trim().length < 2 ||
    query.length > 80 ||
    /[\u0000-\u001f\u007f]/.test(query)
  ) {
    throw new Error('Enter a city or town name (2–80 characters).');
  }
  return `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim())}&count=4&language=en&format=json`;
}

export function forecastUrl(w: Pick<WeatherLocation, 'latitude' | 'longitude'>): string {
  const params = new URLSearchParams({
    latitude: String(w.latitude),
    longitude: String(w.longitude),
    current:
      'temperature_2m,weather_code,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability,precipitation,wind_speed_10m',
    daily:
      'sunrise,sunset,weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max',
    timezone: 'auto',
    timeformat: 'unixtime',
    forecast_days: '8',
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

export function normalizeRadar(raw: unknown): Radar {
  const host = field(raw, 'host');
  if (host !== 'https://tilecache.rainviewer.com') {
    throw new Error('Radar image host is unsupported.');
  }
  const frames = list(field(field(raw, 'radar'), 'past'))
    .flatMap((f): RadarFrame[] => {
      const time = field(f, 'time');
      const path = field(f, 'path');
      return typeof time === 'number' &&
        Number.isFinite(time) &&
        typeof path === 'string' &&
        /^\/v2\/radar\/[a-zA-Z0-9_-]{1,80}$/.test(path)
        ? [{ time: time * 1000, path }]
        : [];
    })
    .sort((a, b) => a.time - b.time)
    .slice(-13);
  if (frames.length === 0) {
    throw new Error('No radar frames available.');
  }
  return { host, generated: Number(field(raw, 'generated')) * 1000, frames };
}
