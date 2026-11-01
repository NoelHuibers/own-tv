// A translation template with every English interface string: the dashboard strings,
// the weather app's strings (`weather:` keys) and the text keyed by its English wording
// (`text:` keys). Reads only the repository's own text, never device configuration.
//
//   pnpm --silent language-template fr Français > /tmp/own-tv-fr.json

import { type LanguagePack, validatePack } from '../app/i18n.js';
import { STRINGS, TEXT_DE } from '../app/strings.js';
import { WEATHER_STRINGS, WEATHER_TEXT_DE } from '../app/weather-strings.js';

/** Interface text may carry inline markup (<b>); packs are plain text. */
const plain = (text: string): string => text.replace(/<[^>]+>/g, '');

export function template(locale = 'und', name = 'Translation template'): LanguagePack {
  const strings: Record<string, string> = {};
  for (const [key, english] of Object.entries(STRINGS.en)) {
    strings[key] = plain(english);
  }
  for (const [key, english] of Object.entries(WEATHER_STRINGS)) {
    strings[`weather:${key}`] = plain(english);
  }
  for (const english of [...Object.keys(TEXT_DE), ...Object.keys(WEATHER_TEXT_DE)]) {
    strings[`text:${english}`] = plain(english);
  }
  return validatePack({ kind: 'own-tv-language', schema: 1, locale, name, strings });
}

if (process.argv[1] === import.meta.filename) {
  const [locale, name] = process.argv.slice(2);
  process.stdout.write(`${JSON.stringify(template(locale, name), null, 2)}\n`);
}
