/* Translation and locale formatting for the dashboard's current language. */

import { type LanguagePack, translate } from './i18n';
import { STRINGS, type StringKey, TEXT_DE, type TextKey } from './strings';
import { isObj, pad } from './util';
import { WEATHER_STRINGS } from './weather-strings';

/** The two preferences translation depends on. */
export interface LanguageChoice {
  readonly language: string;
  readonly languagePack: LanguagePack | null;
}

let current: () => LanguageChoice | null = () => null;

/** Where t() reads the language from: the dashboard's live preferences. */
export function useLanguage(source: () => LanguageChoice): void {
  current = source;
}

function german(language: string): boolean {
  return language.split('-')[0] === 'de';
}

export type TextVars = Readonly<Record<string, string | number>>;

/** A dashboard string in the current language, with {placeholders} filled in. */
export function t(key: StringKey, vars?: TextVars): string {
  const choice = current();
  const lang = choice && german(choice.language) ? 'de' : 'en';
  let s = STRINGS[lang][key] ?? STRINGS.en[key];
  if (choice) {
    s = translate(choice.languagePack, choice.language, key, s);
  }
  if (vars) {
    s = s.replace(/\{(\w+)\}/g, (m, k: string) => {
      const v = vars[k];
      return v === undefined ? m : String(v);
    });
  }
  return s;
}

/** A `text:` string (keyed by its English wording) in the current language. */
export function calText(en: TextKey): string {
  const choice = current();
  const language = choice ? choice.language : 'en';
  return translate(
    choice ? choice.languagePack : null,
    language,
    `text:${en}`,
    german(language) ? TEXT_DE[en] : en,
  );
}

/**
 * Every key a language pack may translate: the dashboard strings, the weather strings
 * (`weather:` keys) and the pack's own `text:` keys, each with its English text.
 */
export function languageBase(pack: unknown): Record<string, string> {
  const base: Record<string, string> = { ...STRINGS.en };
  for (const [k, v] of Object.entries(WEATHER_STRINGS)) {
    base[`weather:${k}`] = v;
  }
  const strings = isObj(pack) && isObj(pack.strings) ? pack.strings : {};
  for (const k of Object.keys(strings)) {
    if (k.startsWith('text:')) {
      base[k] = k.slice(5);
    }
  }
  return base;
}

/** The locale for dates and numbers (English means British formats). */
export function loc(): string {
  const language = current()?.language ?? 'en';
  return language === 'en' ? 'en-GB' : language;
}

export function fmtTime(d: Date): string {
  try {
    return new Intl.DateTimeFormat(loc(), { hour: '2-digit', minute: '2-digit' }).format(d);
  } catch {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}

export function fmtDate(d: Date, opts?: Intl.DateTimeFormatOptions): string {
  try {
    return d.toLocaleDateString(loc(), opts || { weekday: 'long', day: 'numeric', month: 'long' });
  } catch {
    return d.toDateString();
  }
}

export function fmtNum(n: number, digits?: number): string {
  try {
    return new Intl.NumberFormat(loc(), { maximumFractionDigits: digits || 0 }).format(n);
  } catch {
    return String(Math.round(n));
  }
}

export function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86_400);
  const hh = Math.floor((sec % 86_400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) {
    return `${d} ${t('u.d')} ${hh} ${t('u.h')}`;
  }
  if (hh) {
    return `${hh} ${t('u.h')} ${m} ${t('u.min')}`;
  }
  return `${m} ${t('u.min')}`;
}
