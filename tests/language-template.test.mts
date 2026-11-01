// The translation template covers every translatable string and is itself a valid pack.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validatePack } from '../app/i18n.js';
import { languageBase } from '../app/text.js';
import { template } from '../tools/language-template.mjs';

describe('language template', () => {
  const pack = template('fr', 'Français');

  it('is a valid pack for the requested locale', () => {
    assert.equal(pack.locale, 'fr');
    assert.equal(pack.name, 'Français');
    assert.deepEqual(validatePack(pack), pack);
  });

  it('holds the dashboard, weather and text strings, in English and without markup', () => {
    const keys = Object.keys(pack.strings);
    assert.ok(keys.some((k) => k.startsWith('weather:')));
    assert.ok(keys.some((k) => k.startsWith('text:')));
    for (const [key, value] of Object.entries(pack.strings)) {
      assert.doesNotMatch(value, /<[^>]+>/, key);
      if (key.startsWith('text:')) {
        assert.equal(value, key.slice(5));
      }
    }
  });

  it('round-trips through the dashboard: a filled-in template imports unchanged', () => {
    // The dashboard validates imported packs against languageBase; the template must pass
    const base = languageBase(pack);
    assert.deepEqual(validatePack(pack, base).strings, pack.strings);
  });
});
