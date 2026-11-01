import type IcalModule from 'ical.js' with { 'resolution-mode': 'import' };
import { feedUrl } from './calendar-feed.cjs';
import type { CalendarFeed, CalendarSettings } from './calendar-settings.cjs';
import catalog from './holiday-catalog.json';
import type { WeatherLocation } from './weather.cjs';

export interface IntegrationsPatch {
  weather?: WeatherLocation;
  calendar?: CalendarSettings;
}

/** One agenda entry: no description, location, attendees or links. */
export interface CalendarEvent {
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly allDay: boolean;
}

// ical.js is only needed to read calendars, so it loads on first use, as before. Its
// CommonJS build exports the same object as the ES module's default export.
function ical(): typeof IcalModule {
  return require('ical.js');
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function field(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined;
}

function validateFeeds(feedsValue: unknown): CalendarFeed[] {
  if (!Array.isArray(feedsValue) || feedsValue.length === 0 || feedsValue.length > 16) {
    throw new Error('Use 1–16 calendar subscriptions.');
  }
  const seen = new Set<string>();
  const feeds: CalendarFeed[] = [];
  for (const [i, f] of feedsValue.entries()) {
    if (!isObject(f)) {
      throw new Error('Invalid calendar subscription');
    }
    const url = feedUrl(f.feedUrl);
    const label = String(f.label || `Calendar ${i + 1}`)
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim();
    if (label.length > 60 || /https?:|webcal:|[A-Za-z0-9_-]{40,}/i.test(label)) {
      throw new Error('Use a short calendar name without a subscription link.');
    }
    const catalogId = f.catalogId
      ? catalog.calendars.find((c) => c.id === f.catalogId && c.url === url)?.id
      : undefined;
    if (!seen.has(url)) {
      seen.add(url);
      feeds.push({
        feedUrl: url,
        label,
        enabled: f.enabled !== false,
        ...(catalogId ? { catalogId } : {}),
      });
    }
  }
  return feeds;
}

export function validateIntegrations(input: unknown): IntegrationsPatch {
  if (!isObject(input) || Array.isArray(input)) {
    throw new Error('Invalid integrations');
  }
  const out: IntegrationsPatch = {};
  const w = input.weather;
  if (w) {
    const latitude = field(w, 'latitude');
    const longitude = field(w, 'longitude');
    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      throw new Error('Invalid weather coordinates');
    }
    out.weather = {
      latitude,
      longitude,
      label: String(field(w, 'label') || 'Local weather').slice(0, 80),
    };
  }
  const c = input.calendar;
  if (c) {
    const busyOnly = field(c, 'busyOnly') !== false;
    const feeds = field(c, 'feeds');
    out.calendar =
      feeds === undefined
        ? { feedUrl: feedUrl(field(c, 'feedUrl')), busyOnly }
        : { feeds: validateFeeds(feeds), busyOnly };
  }
  return out;
}

export function expandCalendar(
  text: string,
  now: Date = new Date(),
  days = 14,
  busyOnly = true,
): CalendarEvent[] {
  const ICAL = ical();
  const root = new ICAL.Component(ICAL.parse(text));
  for (const zone of root.getAllSubcomponents('vtimezone')) {
    const id = zone.getFirstPropertyValue('tzid');
    if (typeof id === 'string' && id) {
      ICAL.TimezoneService.register(new ICAL.Timezone(zone), id);
    }
  }
  const lower = now.getTime();
  const upper = lower + days * 86400000;
  const events: CalendarEvent[] = [];
  const components = root.getAllSubcomponents('vevent');
  const exceptions = components
    .filter((c) => c.hasProperty('recurrence-id'))
    .map((c) => new ICAL.Event(c));
  for (const comp of components) {
    if (comp.hasProperty('recurrence-id')) {
      continue;
    }
    const event = new ICAL.Event(comp, {
      exceptions: exceptions.filter((e) => e.uid === comp.getFirstPropertyValue('uid')),
    });
    if (event.component.getFirstPropertyValue('status') === 'CANCELLED') {
      continue;
    }
    const append = (
      start: Date,
      end: Date,
      title: unknown,
      allDay: boolean,
      startDate: string,
      endDate: string,
    ) => {
      if (end.getTime() >= lower && start.getTime() < upper) {
        events.push({
          title: busyOnly ? 'Busy' : String(title || 'Event').slice(0, 180),
          start: allDay ? startDate : start.toISOString(),
          end: allDay ? endDate : end.toISOString(),
          allDay: Boolean(allDay),
        });
      }
    };
    if (!event.isRecurring()) {
      append(
        event.startDate.toJSDate(),
        event.endDate.toJSDate(),
        event.summary,
        event.startDate.isDate,
        event.startDate.toString(),
        event.endDate.toString(),
      );
      continue;
    }
    const it = event.iterator();
    let occurrence: ReturnType<typeof it.next> | null;
    let count = 0;
    // biome-ignore lint/suspicious/noAssignInExpressions: ical.js iterators signal the end with a null occurrence
    while ((occurrence = it.next()) && count++ < 20000) {
      if (occurrence.toJSDate().getTime() >= upper) {
        break;
      }
      const d = event.getOccurrenceDetails(occurrence);
      if (d.item.component.getFirstPropertyValue('status') === 'CANCELLED') {
        continue;
      }
      append(
        d.startDate.toJSDate(),
        d.endDate.toJSDate(),
        d.item.summary,
        d.startDate.isDate,
        d.startDate.toString(),
        d.endDate.toString(),
      );
      if (events.length >= 100) {
        break;
      }
    }
  }
  return events.sort((a, b) => a.start.localeCompare(b.start)).slice(0, 30);
}
