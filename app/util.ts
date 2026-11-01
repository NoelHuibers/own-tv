/* Small value checks and formatters shared by the dashboard modules. */

/** A plain object (not null, not an array): the shape of every JSON record we accept. */
export function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** `key` of `o` when `o` is an object, else undefined. */
export function field(o: unknown, key: string): unknown {
  return isObj(o) ? o[key] : undefined;
}

export function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function str(v: unknown): string {
  if (typeof v === 'string') {
    return v;
  }
  return typeof v === 'number' ? String(v) : '';
}

export function clip(s: unknown, n: number): string {
  const text = String(s);
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function pad(n: number): string {
  return `${n < 10 ? '0' : ''}${n}`;
}

/** Minutes after midnight as HH:MM, wrapping around the day. */
export function hm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** HH:MM as minutes after midnight, or null. */
export function parseHM(s: unknown): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// Anything that smells like a link or credential is refused outright.
const SECRET_RE =
  /:\/\/|webcal|\.ics\b|token|secret|passw|api[_-]?key|bearer|calendar\.proton|[A-Za-z0-9_-]{32,}/i;

export function looksSecret(s: string): boolean {
  return SECRET_RE.test(s);
}

/** `v` without control characters and with collapsed spaces, or null if too long. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') {
    return null;
  }
  const s = v
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? null : s;
}

/** The message of a caught error. */
export function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** `value` when it is one of `choices`. */
export function oneOf<T extends string | number>(
  choices: readonly T[],
  value: unknown,
): value is T {
  return choices.some((choice) => choice === value);
}
