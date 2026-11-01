import { createHash } from 'node:crypto';
import { type CalendarSettings, feedsOf, sourceId } from './calendar-settings.cjs';
import { type CalendarEvent, expandCalendar } from './integrations.cjs';

interface CacheEntry {
  readonly at: number;
  readonly events: readonly CalendarEvent[];
}

/** calendar-cache.json: the expanded events per feed and privacy mode. */
export interface AgendaCache {
  readonly schema: 2;
  readonly entries: Record<string, CacheEntry>;
}

export interface AgendaSource {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly catalogId: string | null;
  readonly connected: boolean;
  readonly stale: boolean;
  readonly updatedAt: number | null;
}

export interface AgendaEvent extends CalendarEvent {
  readonly calendar: string;
}

export interface Agenda {
  readonly configured: boolean;
  readonly busyOnly?: boolean;
  readonly events: AgendaEvent[];
  readonly sources?: AgendaSource[];
  readonly sourceCount?: number;
  readonly activeSources?: number;
  readonly failedSources?: number;
  readonly partial?: boolean;
  readonly error?: boolean;
  readonly updatedAt?: number | null;
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function field(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined;
}

function isCalendarEvent(value: unknown): value is CalendarEvent {
  return (
    isObject(value) &&
    typeof value.title === 'string' &&
    typeof value.start === 'string' &&
    typeof value.end === 'string' &&
    typeof value.allDay === 'boolean'
  );
}

function isCacheEntry(value: unknown): value is CacheEntry {
  return (
    isObject(value) &&
    typeof value.at === 'number' &&
    Array.isArray(value.events) &&
    value.events.every(isCalendarEvent)
  );
}

// Every feed fails independently; old entries are never used after a privacy-mode change.
export async function collectAgenda(
  calendar: CalendarSettings | null | undefined,
  cached: unknown,
  fetchFeed: (url: string) => Promise<string>,
  now: number = Date.now(),
): Promise<{ calendar: Agenda; cache: AgendaCache }> {
  if (!calendar) {
    return { calendar: { configured: false, events: [] }, cache: { schema: 2, entries: {} } };
  }
  const feeds = feedsOf(calendar);
  const entries: Record<string, CacheEntry> = {};
  const events: AgendaEvent[] = [];
  const sources: AgendaSource[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < feeds.length) {
      const index = next++;
      const feed = feeds[index];
      if (!feed) {
        continue;
      }
      const busyOnly = calendar?.busyOnly !== false && !feed.catalogId;
      const key = createHash('sha256')
        .update(`${String(busyOnly)}\n${feed.feedUrl}`)
        .digest('hex');
      const source = {
        id: sourceId(feed),
        name: feed.label || 'Calendar',
        enabled: feed.enabled !== false,
        catalogId: feed.catalogId || null,
      };
      if (feed.enabled === false) {
        sources[index] = { ...source, connected: false, stale: false, updatedAt: null };
        continue;
      }
      const saved = field(cached, 'schema') === 2 ? field(field(cached, 'entries'), key) : null;
      const old = isCacheEntry(saved) ? saved : null;
      let item = old;
      let error = false;
      let stale = false;
      if (!old || now - old.at >= 15 * 60 * 1000) {
        try {
          item = {
            at: now,
            events: expandCalendar(await fetchFeed(feed.feedUrl), new Date(now), 14, busyOnly),
          };
        } catch {
          error = true;
          stale = Boolean(old);
        }
      }
      if (item) {
        entries[key] = item;
        for (const event of item.events) {
          if (Date.parse(event.end) > now) {
            events.push({ ...event, calendar: feed.label || 'Calendar' });
          }
        }
      }
      sources[index] = { ...source, connected: !error, stale, updatedAt: item?.at ?? null };
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, feeds.length) }, worker));
  const active = sources.filter((s) => s.enabled);
  const failures = active.filter((s) => !s.connected).length;
  const updated = sources.map((s) => s.updatedAt).filter((at): at is number => Number.isFinite(at));
  return {
    calendar: {
      configured: feeds.length > 0,
      busyOnly: calendar.busyOnly !== false,
      events: events.sort((a, b) => a.start.localeCompare(b.start)).slice(0, 100),
      sources,
      sourceCount: feeds.length,
      activeSources: active.length,
      failedSources: failures,
      partial: failures > 0,
      error: active.length > 0 && failures === active.length && events.length === 0,
      updatedAt: updated.length > 0 ? Math.min(...updated) : null,
    },
    cache: { schema: 2, entries },
  };
}
