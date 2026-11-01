import { createHash } from 'node:crypto';
import catalog from './holiday-catalog.json';

/** One calendar subscription, as stored in integrations.json. */
export interface CalendarFeed {
  readonly feedUrl: string;
  readonly label?: string;
  readonly enabled?: boolean;
  readonly catalogId?: string;
}

/** The stored calendar settings: a list of feeds, or the older single feed. */
export interface CalendarSettings {
  readonly feeds?: readonly CalendarFeed[];
  readonly feedUrl?: string;
  readonly busyOnly?: boolean;
}

export interface CalendarChoice {
  readonly id: string;
  readonly name: string;
  readonly selected: boolean;
}

export interface PublicCatalog {
  readonly provider: string;
  readonly source: string;
  readonly coverage: string;
  readonly calendars: CalendarChoice[];
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function optional(value: unknown, type: 'string' | 'boolean'): boolean {
  return value === undefined || typeof value === type;
}

export function isCalendarFeed(value: unknown): value is CalendarFeed {
  return (
    isObject(value) &&
    typeof value.feedUrl === 'string' &&
    optional(value.label, 'string') &&
    optional(value.enabled, 'boolean') &&
    optional(value.catalogId, 'string')
  );
}

/** Settings as written by validateIntegrations and changeCalendar. */
export function isCalendarSettings(value: unknown): value is CalendarSettings {
  return (
    isObject(value) &&
    (value.feeds === undefined ||
      (Array.isArray(value.feeds) && value.feeds.every(isCalendarFeed))) &&
    optional(value.feedUrl, 'string') &&
    optional(value.busyOnly, 'boolean')
  );
}

export function sourceId(feed: Pick<CalendarFeed, 'feedUrl'>): string {
  return createHash('sha256').update(feed.feedUrl).digest('hex').slice(0, 24);
}

export function feedsOf(calendar: CalendarSettings | null | undefined): readonly CalendarFeed[] {
  return (
    calendar?.feeds || (calendar?.feedUrl ? [{ feedUrl: calendar.feedUrl, label: 'Calendar' }] : [])
  );
}

export function publicCatalog(calendar: CalendarSettings | null | undefined): PublicCatalog {
  const feeds = feedsOf(calendar);
  return {
    provider: catalog.provider,
    source: catalog.source,
    coverage: catalog.coverage,
    calendars: catalog.calendars.map((c) => ({
      id: c.id,
      name: c.name,
      selected: feeds.some((f) => f.catalogId === c.id && f.enabled !== false),
    })),
  };
}

export function changeCalendar(
  calendar: CalendarSettings | null | undefined,
  change: unknown,
): CalendarSettings {
  if (!isObject(change) || typeof change.enabled !== 'boolean') {
    throw new Error('Choose a calendar and whether to show it.');
  }
  const enabled = change.enabled;
  let feeds = feedsOf(calendar).map((f) => ({ ...f }));
  if (change.publicId) {
    const item = catalog.calendars.find((c) => c.id === change.publicId);
    if (!item) {
      throw new Error('Unknown public calendar.');
    }
    feeds = feeds.filter((f) => f.catalogId !== item.id);
    if (enabled) {
      if (feeds.length >= 16) {
        throw new Error('You can connect up to 16 calendars. Remove one before adding another.');
      }
      feeds.push({
        feedUrl: item.url,
        label: `${item.name} holidays`,
        catalogId: item.id,
        enabled: true,
      });
    }
  } else {
    const index = feeds.findIndex((f) => sourceId(f) === change.id);
    const item = feeds[index];
    if (!item) {
      throw new Error('Calendar no longer exists. Refresh and retry.');
    }
    feeds[index] = { ...item, enabled };
  }
  return { ...calendar, feeds, busyOnly: calendar?.busyOnly !== false };
}
