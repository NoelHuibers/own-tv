import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectAgenda } from '../native/calendar-agenda.cjs';
import {
  type CalendarSettings,
  changeCalendar,
  publicCatalog,
  sourceId,
} from '../native/calendar-settings.cjs';
import catalog from '../native/holiday-catalog.json';

const privateFeed = { label: 'Home', feedUrl: 'https://calendar.example.com/private.ics' };
const ics = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:holiday',
  'DTSTART;VALUE=DATE:20261101',
  'DTEND;VALUE=DATE:20261102',
  'SUMMARY:Holiday title',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');
const feed = () => Promise.resolve(ics);

test('calendar switches preserve other connections and disabled feeds are never fetched or displayed', async () => {
  const cfg: CalendarSettings = { busyOnly: false, feeds: [privateFeed] };
  const id = sourceId(privateFeed);
  const now = Date.parse('2026-11-01T00:00:00Z');
  const initial = await collectAgenda(cfg, {}, feed, now);
  const disabled = changeCalendar(cfg, { id, enabled: false });
  assert.equal(cfg.feeds?.[0]?.enabled, undefined);
  const result = await collectAgenda(
    disabled,
    initial.cache,
    () => Promise.reject(new Error('must not fetch')),
    now + 1000,
  );
  assert.equal(result.calendar.events.length, 0);
  assert.equal(result.calendar.activeSources, 0);
  assert.equal(result.calendar.error, false);
  assert.equal(result.calendar.failedSources, 0);
  assert.equal(result.calendar.sources?.[0]?.enabled, false);
  assert.equal(
    changeCalendar(disabled, { id, enabled: true }).feeds?.[0]?.feedUrl,
    privateFeed.feedUrl,
  );
  assert.throws(() => changeCalendar(cfg, { id: 'unknown', enabled: false }));
  assert.throws(() => changeCalendar(cfg, { id, enabled: 'false' }));
});

test('the public catalogue contains no private feeds and selection never exposes subscription URLs', async () => {
  assert.equal(new Set(catalog.calendars.map((c) => c.id)).size, catalog.calendars.length);
  assert.ok(catalog.calendars.length > 70);
  for (const c of catalog.calendars) {
    assert.ok(c.url.startsWith('https://www.thunderbird.net/media/caldata/'));
  }
  const publicId = catalog.calendars.find((c) => c.name === 'Germany')?.id;
  const added = changeCalendar(
    { feeds: [privateFeed], busyOnly: true },
    { publicId, enabled: true },
  );
  assert.equal(added.feeds?.length, 2);
  assert.equal(added.feeds?.[0]?.feedUrl, privateFeed.feedUrl);
  const view = publicCatalog(added);
  assert.ok(view.calendars.find((c) => c.id === publicId)?.selected);
  assert.ok(!JSON.stringify(view).includes('.ics'));
  assert.ok(!JSON.stringify(view).includes('private'));
  assert.equal(changeCalendar(added, { publicId, enabled: true }).feeds?.length, 2);
  assert.deepEqual(changeCalendar(added, { publicId, enabled: false }).feeds, [privateFeed]);
  assert.throws(() => changeCalendar(added, { publicId: 'unknown', enabled: true }));
  const result = await collectAgenda(added, {}, feed, Date.parse('2026-11-01T00:00:00Z'));
  assert.equal(result.calendar.events.find((e) => e.calendar === 'Home')?.title, 'Busy');
  assert.equal(
    result.calendar.events.find((e) => e.calendar === 'Germany holidays')?.title,
    'Holiday title',
  );
  assert.equal(result.calendar.events[0]?.start, '2026-11-01');
  assert.equal(result.calendar.events[0]?.end, '2026-11-02');
});
