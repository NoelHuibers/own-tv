import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { sourceId } from '../native/calendar-settings.cjs';
import { field, find, readJson } from './json.cjs';

test('saving or disconnecting a calendar preserves weather, and vice versa', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'own-tv-config-'));
  process.env.OWN_TV_DATA = dir;
  t.after(() => {
    delete process.env.OWN_TV_DATA;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  // The helper reads OWN_TV_DATA when it loads
  const { main } = await import('../native/helper.cjs');
  const integrations = () => readJson(fs.readFileSync(path.join(dir, 'integrations.json'), 'utf8'));
  const weather = { latitude: 10, longitude: 20, label: 'Sample city' };
  await main('configure', { weather });
  await main('configure', { calendar: { feedUrl: 'https://calendar.example.com/feed.ics' } });
  let config = integrations();
  assert.deepEqual(field(config, 'weather'), weather);
  assert.equal(field(config, 'calendar', 'busyOnly'), true);
  const feedUrl = field(config, 'calendar', 'feedUrl');
  assert.equal(typeof feedUrl, 'string');
  await main('calendarSource', { id: sourceId({ feedUrl: String(feedUrl) }), enabled: false });
  await main('calendarSource', { publicId: 'tb-germany', enabled: true });
  config = integrations();
  assert.deepEqual(field(config, 'weather'), weather);
  assert.equal(field(config, 'calendar', 'feeds', 0, 'enabled'), false);
  assert.equal(field(config, 'calendar', 'feeds', 'length'), 2);
  const catalogue = await main('calendarCatalog');
  assert.equal(field(find(field(catalogue, 'calendars'), 'id', 'tb-germany'), 'selected'), true);
  assert.ok(!JSON.stringify(catalogue).includes('feed.ics'));
  await main('calendarSource', { publicId: 'tb-germany', enabled: false });
  config = integrations();
  assert.equal(field(config, 'calendar', 'feeds', 'length'), 1);
  assert.deepEqual(field(config, 'weather'), weather);
  await main('configure', { calendar: null });
  config = integrations();
  assert.deepEqual(field(config, 'weather'), weather);
  assert.equal(field(config, 'calendar'), undefined);
  await main('configure', { calendar: { feedUrl: 'webcal://calendar.example.com/feed.ics' } });
  await main('configure', { weather: null });
  config = integrations();
  assert.equal(field(config, 'weather'), undefined);
  assert.equal(field(config, 'calendar', 'feedUrl'), 'https://calendar.example.com/feed.ics');
});
