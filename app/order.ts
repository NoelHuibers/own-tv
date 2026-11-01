/* Stable app ordering shared by the TV and browser preview. */

export interface RecentEntry {
  readonly id?: unknown;
}

export interface Orderable {
  readonly launchId: string;
}

/** Recently used apps first (most recent first), the rest in their original order. */
export function recentFirst<T extends Orderable>(
  items: readonly T[],
  recent: readonly (RecentEntry | null | undefined)[] | null | undefined,
  manual: boolean,
): T[] {
  if (manual) {
    return items.slice();
  }
  const ranks = new Map<string, number>();
  for (const [i, entry] of (recent ?? []).entries()) {
    if (entry && typeof entry.id === 'string' && !ranks.has(entry.id)) {
      ranks.set(entry.id, i);
    }
  }
  return items
    .map((app, index) => ({
      app,
      index,
      rank: ranks.get(app.launchId) ?? Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.app);
}
