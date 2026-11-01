/* Weather timestamps are UTC milliseconds, including local-day boundaries. */

export interface SolarDay {
  readonly start: number;
  readonly end: number;
  readonly sunrise: number;
  readonly sunset: number;
}

export interface SolarWeather {
  readonly configured?: boolean;
  readonly error?: unknown;
  readonly updatedAt?: unknown;
  readonly solar?: unknown;
}

const STALE_BEFORE_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

function isSolarDay(value: unknown): value is SolarDay {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const d = value as Record<string, unknown>;
  return [d.start, d.end, d.sunrise, d.sunset].every(
    (v) => typeof v === 'number' && Number.isFinite(v),
  );
}

/** The local day containing `now`, if the forecast is fresh and its sun times are sane. */
export function period(
  weather: SolarWeather | null | undefined,
  nowValue: unknown,
): SolarDay | null {
  const now = Number(nowValue);
  const updatedAt = weather?.updatedAt;
  if (
    !weather?.configured ||
    weather.error ||
    !Number.isFinite(now) ||
    typeof updatedAt !== 'number' ||
    !Number.isFinite(updatedAt) ||
    now < updatedAt - STALE_BEFORE_MS ||
    now - updatedAt > STALE_AFTER_MS
  ) {
    return null;
  }
  const days: unknown[] = Array.isArray(weather.solar) ? weather.solar : [];
  for (const d of days) {
    if (
      isSolarDay(d) &&
      d.start <= now &&
      now < d.end &&
      d.start < d.sunrise &&
      d.sunrise < d.sunset &&
      d.sunset < d.end
    ) {
      return d;
    }
  }
  return null;
}

export function theme(
  weather: SolarWeather | null | undefined,
  now: number,
): 'day' | 'night' | null {
  const d = period(weather, now);
  if (!d) {
    return null;
  }
  return now >= d.sunrise && now < d.sunset ? 'day' : 'night';
}
