import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectAgenda } from '../native/calendar-agenda.cjs';
import { validateIntegrations } from '../native/integrations.cjs';

function event(title: string, time = '20261101T120000Z'): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `UID:${title}`,
    `DTSTART:${time}`,
    'DTEND:20261101T140000Z',
    `SUMMARY:${title}`,
    'DESCRIPTION:Never expose this',
    'LOCATION:Never expose this',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

test('multiple subscriptions merge without exposing links or extra event details, and cache independently', async () => {
  const now = Date.parse('2026-11-01T00:00:00Z');
  const cfg = validateIntegrations({
    calendar: {
      feeds: [
        { label: 'Work', feedUrl: 'https://calendar.example.com/first.ics' },
        { label: 'Home', feedUrl: 'https://calendar.example.com/second.ics' },
      ],
      busyOnly: false,
    },
  }).calendar;
  let calls = 0;
  const fetch = (url: string) => {
    calls++;
    return Promise.resolve(event(url.endsWith('first.ics') ? 'First' : 'Second'));
  };
  const result = await collectAgenda(cfg, {}, fetch, now);
  assert.equal(result.calendar.events.length, 2);
  assert.equal(result.calendar.sourceCount, 2);
  assert.equal(result.calendar.failedSources, 0);
  assert.equal(result.calendar.events[0]?.calendar, 'Work');
  assert.ok(!JSON.stringify(result.calendar).includes('https:'));
  assert.ok(!JSON.stringify(result.calendar).includes('Never expose'));
  await collectAgenda(cfg, result.cache, fetch, now + 1000);
  assert.equal(calls, 2);
  const partial = await collectAgenda(
    cfg,
    result.cache,
    (url) =>
      url.endsWith('first.ics')
        ? Promise.reject(new Error('private URL must not escape'))
        : Promise.resolve(event('Updated')),
    now + 16 * 60000,
  );
  assert.equal(partial.calendar.partial, true);
  assert.equal(partial.calendar.failedSources, 1);
  assert.equal(partial.calendar.events.length, 2);
  assert.equal(partial.calendar.sources?.[0]?.stale, true);
  const busy = await collectAgenda({ ...cfg, busyOnly: true }, result.cache, fetch, now + 1000);
  assert.ok(busy.calendar.events.every((e) => e.title === 'Busy'));
  assert.equal(calls, 4);
});

test('subscription validation bounds input and preserves legacy single-feed settings', () => {
  assert.ok(
    validateIntegrations({ calendar: { feedUrl: 'https://calendar.example.com/feed.ics' } })
      .calendar?.feedUrl,
  );
  assert.throws(() => validateIntegrations({ calendar: { feeds: [] } }));
  assert.throws(() =>
    validateIntegrations({
      calendar: { feeds: new Array(17).fill({ feedUrl: 'https://calendar.example.com/a.ics' }) },
    }),
  );
  const one = { feedUrl: 'https://calendar.example.com/a.ics' };
  assert.equal(
    validateIntegrations({ calendar: { feeds: [one, one] } }).calendar?.feeds?.length,
    1,
  );
  assert.throws(() =>
    validateIntegrations({
      calendar: { feeds: [{ label: 'https://private.example/secret.ics', feedUrl: one.feedUrl }] },
    }),
  );
});
