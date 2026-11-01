import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as i18n from '../app/i18n';

test('locales preserve regional and script variants, and determine text direction', () => {
  assert.equal(i18n.locale(' fr_ca '), 'fr-CA');
  assert.equal(i18n.locale('zh-Hant-TW'), 'zh-Hant-TW');
  assert.equal(i18n.locale('not a locale'), null);
  assert.equal(i18n.direction('ar'), 'rtl');
  assert.equal(i18n.direction('he-IL'), 'rtl');
  assert.equal(i18n.direction('ar-Latn'), 'ltr');
  assert.equal(i18n.direction('ja-JP'), 'ltr');
});

test('offline packs match their locale, preserve placeholders and fall back without fetching', () => {
  const pack = i18n.validatePack(
    {
      kind: 'own-tv-language',
      schema: 1,
      locale: 'es',
      name: 'Español',
      strings: { greet: 'Hola {name}' },
    },
    { greet: 'Hello {name}', back: 'Back' },
  );
  assert.equal(i18n.translate(pack, 'es-MX', 'greet', 'Hello'), 'Hola {name}');
  assert.equal(i18n.translate(pack, 'es', 'back', 'Back'), 'Back');
  assert.equal(i18n.translate(pack, 'fr', 'greet', 'Hello'), 'Hello');
  assert.throws(() =>
    i18n.validatePack({ ...pack, strings: { greet: 'Hola' } }, { greet: 'Hello {name}' }),
  );
  assert.throws(() =>
    i18n.validatePack({ ...pack, strings: { unknown: 'Hola' } }, { greet: 'Hello {name}' }),
  );
  // biome-ignore lint/security/noSecrets: markup the pack validator must refuse
  for (const text of ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '\u0000']) {
    assert.throws(() => i18n.validatePack({ ...pack, strings: { greet: text } }));
  }
  const polluted: unknown = JSON.parse('{"__proto__":"polluted"}');
  assert.throws(() => i18n.validatePack({ ...pack, strings: polluted }));
  const big = Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [`key${i}`, 'x'.repeat(2000)]),
  );
  assert.throws(() => i18n.validatePack({ ...pack, strings: big }));
});
