/* Offline language packs. Text only: no scripts, markup, fonts or remote loads. */

export interface LanguagePack {
  readonly kind: 'own-tv-language';
  readonly schema: 1;
  readonly locale: string;
  readonly name: string;
  readonly strings: Readonly<Record<string, string>>;
}

export type Direction = 'ltr' | 'rtl';

const MAX_LOCALE = 64;
const MAX_NAME = 60;
const MAX_ENTRIES = 1200;
const MAX_KEY = 1000;
const MAX_TEXT = 2400;
const MAX_PACK = 48_000;
const RTL_SCRIPTS = /^(Arab|Hebr|Thaa|Nkoo|Adlm|Rohg|Syrc|Samr|Mand)$/;
const RTL_LANGUAGES = /^(ar|fa|he|ur|ps|dv|ckb)(-|$)/i;
const UNSAFE_NAME = /[<>\u0000-\u001f\u007f]/;
const UNSAFE_TEXT = /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const PLACEHOLDER = /\{\w+\}/g;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** The canonical BCP 47 form of `value`, or null when it isn't a locale. */
export function locale(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_LOCALE) {
    return null;
  }
  try {
    return Intl.getCanonicalLocales(value.trim().replace(/_/g, '-'))[0] ?? null;
  } catch {
    return null;
  }
}

export function matches(pack: LanguagePack | null | undefined, language: string): boolean {
  if (!pack) {
    return false;
  }
  return (
    pack.locale === language ||
    (!pack.locale.includes('-') && pack.locale === language.split('-')[0])
  );
}

export function direction(language: string): Direction {
  try {
    const script = new Intl.Locale(language).maximize().script ?? '';
    return RTL_SCRIPTS.test(script) ? 'rtl' : 'ltr';
  } catch {
    return RTL_LANGUAGES.test(language) ? 'rtl' : 'ltr';
  }
}

function placeholders(text: string): string {
  return (text.match(PLACEHOLDER) ?? []).sort().join('|');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Checks an imported pack and returns a clean copy. With `base` (the English strings),
 * every key must exist there and keep the same placeholders.
 */
export function validatePack(
  raw: unknown,
  base?: Readonly<Record<string, string>> | null,
): LanguagePack {
  const canonical = isRecord(raw) ? locale(raw.locale) : null;
  if (
    !isRecord(raw) ||
    raw.kind !== 'own-tv-language' ||
    raw.schema !== 1 ||
    !canonical ||
    !isRecord(raw.strings)
  ) {
    throw new Error('Use an Own TV language pack (schema 1).');
  }
  const name = String(raw.name || raw.locale).trim();
  if (!name || name.length > MAX_NAME || UNSAFE_NAME.test(name)) {
    throw new Error('Use a short, plain language name.');
  }
  const source = raw.strings;
  const keys = Object.keys(source);
  if (keys.length > MAX_ENTRIES) {
    throw new Error('Language pack has too many entries.');
  }
  const strings: Record<string, string> = {};
  for (const key of keys) {
    const text = source[key];
    if (
      FORBIDDEN_KEYS.has(key) ||
      key.length > MAX_KEY ||
      typeof text !== 'string' ||
      text.length > MAX_TEXT ||
      UNSAFE_TEXT.test(text)
    ) {
      throw new Error('Language packs must contain plain text only.');
    }
    const english = base && Object.hasOwn(base, key) ? base[key] : undefined;
    if (base && (english === undefined || placeholders(text) !== placeholders(english))) {
      throw new Error(`Unknown key or changed placeholders: ${key.slice(0, 70)}`);
    }
    if (text.trim()) {
      strings[key] = text;
    }
  }
  const result: LanguagePack = {
    kind: 'own-tv-language',
    schema: 1,
    locale: canonical,
    name,
    strings,
  };
  if (JSON.stringify(result).length > MAX_PACK) {
    throw new Error('Language pack is too large (48,000 characters maximum).');
  }
  return result;
}

export function translate(
  pack: LanguagePack | null | undefined,
  language: string,
  key: string,
  fallback: string,
): string {
  if (pack && matches(pack, language) && Object.hasOwn(pack.strings, key)) {
    return pack.strings[key] ?? fallback;
  }
  return fallback;
}
