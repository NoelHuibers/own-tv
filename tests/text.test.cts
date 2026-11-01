// The dashboard's translation and formatting helpers, and its small value checks.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LanguagePack } from '../app/i18n';
import { calText, fmtNum, fmtUptime, languageBase, loc, t, useLanguage } from '../app/text';
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
  parseHM,
  str,
} from '../app/util';

function speak(language: string, languagePack: LanguagePack | null = null): void {
  useLanguage(() => ({ language, languagePack }));
}

const french: LanguagePack = {
  kind: 'own-tv-language',
  schema: 1,
  locale: 'fr',
  name: 'Français',
  strings: { 'u.min': 'mn', 'text:Apply locale': 'Appliquer' },
};

describe('translation', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    speak('en');
    assert.equal(t('greet.named', { greet: 'Hello', name: 'Ada' }), 'Hello, Ada');
    assert.equal(t('greet.named', { greet: 'Hello' }), 'Hello, {name}');
  });

  it('has German built in, for regional variants too', () => {
    speak('de-AT');
    assert.equal(t('u.min'), 'Min.');
    assert.equal(calText('Apply locale'), 'Sprache anwenden');
  });

  it('prefers an installed pack and falls back to English for the rest', () => {
    speak('fr-CA', french);
    assert.equal(t('u.min'), 'mn');
    assert.equal(t('u.h'), 'h');
    assert.equal(calText('Apply locale'), 'Appliquer');
    assert.equal(calText('Any language or regional locale'), 'Any language or regional locale');
  });

  it('ignores a pack for another language', () => {
    speak('es', french);
    assert.equal(t('u.min'), 'min');
  });

  it('offers packs every dashboard and weather key, plus their own text keys', () => {
    const base = languageBase({ strings: { 'text:Hello there': 'Salut' } });
    assert.equal(base['u.min'], 'min');
    assert.equal(base['weather:week'], '7 days');
    assert.equal(base['text:Hello there'], 'Hello there');
    assert.equal(languageBase(null)['text:Hello there'], undefined);
  });
});

describe('formatting', () => {
  it('uses British formats for English and the language itself otherwise', () => {
    speak('en');
    assert.equal(loc(), 'en-GB');
    assert.equal(fmtNum(1234.5), '1,235');
    speak('de');
    assert.equal(loc(), 'de');
    assert.equal(fmtNum(1234.56, 1), '1.234,6');
  });

  it('falls back to plain digits for a locale Intl rejects', () => {
    speak('not a locale!');
    assert.equal(fmtNum(41.6), '42');
  });

  it('shows uptime in its two largest units', () => {
    speak('en');
    assert.equal(fmtUptime(2 * 86_400 + 3 * 3600 + 59), '2 d 3 h');
    assert.equal(fmtUptime(3 * 3600 + 5 * 60), '3 h 5 min');
    assert.equal(fmtUptime(59), '0 min');
  });
});

describe('value checks', () => {
  it('accepts only plain objects as records', () => {
    assert.ok(isObj({}));
    assert.ok(!isObj(null));
    assert.ok(!isObj([]));
    assert.equal(field({ a: 1 }, 'a'), 1);
    assert.equal(field('a', 'length'), undefined);
  });

  it('keeps finite numbers and printable strings', () => {
    assert.equal(finite(3), 3);
    assert.equal(finite(Number.NaN), null);
    assert.equal(finite('3'), null);
    assert.equal(str(5), '5');
    assert.equal(str(null), '');
    assert.equal(clip('abcdef', 4), 'abc…');
    assert.equal(clip('abc', 4), 'abc');
  });

  it('converts between minutes and HH:MM, wrapping around midnight', () => {
    assert.equal(hm(0), '00:00');
    assert.equal(hm(-30), '23:30');
    assert.equal(hm(1440 + 61), '01:01');
    assert.equal(parseHM('07:05'), 425);
    assert.equal(parseHM('24:00'), null);
    assert.equal(parseHM('7:05'), null);
  });

  it('refuses text that looks like a link or a credential', () => {
    assert.ok(looksSecret('webcal://example.org/a.ics'));
    assert.ok(looksSecret('my api_key'));
    assert.ok(looksSecret('x'.repeat(32)));
    assert.ok(!looksSecret('Family'));
  });

  it('cleans control characters and spacing, and rejects long or non-text input', () => {
    assert.equal(cleanText('  Film\u0007  night\n', 20), 'Film night');
    assert.equal(cleanText('abcdef', 5), null);
    assert.equal(cleanText(5, 5), null);
  });

  it('reads error messages and checks choices', () => {
    assert.equal(message(new Error('boom')), 'boom');
    assert.equal(message('plain'), 'plain');
    assert.ok(oneOf(['a', 'b'] as const, 'a'));
    assert.ok(!oneOf([1, 2], '1'));
  });
});
