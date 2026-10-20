// Sammanslagning av poster från flera enheter. Senast ändrad vinner (per post).

import type { LibraryData, SyncRecord } from './model';

export interface MergeResult<T> {
  /** Poster där den andra sidan var nyare – ska sparas lokalt */
  incoming: T[];
}

export function mergeRecords<T extends SyncRecord>(local: T[], remote: T[]): MergeResult<T> {
  const byId = new Map(local.map((r) => [r.id, r]));
  const incoming: T[] = [];
  for (const r of remote) {
    if (!r || typeof r.id !== 'string' || typeof r.updatedAt !== 'number') continue;
    const mine = byId.get(r.id);
    if (!mine || r.updatedAt > mine.updatedAt) {
      incoming.push(r);
      byId.set(r.id, r);
    }
  }
  return { incoming };
}

export function mergeLibrary(local: LibraryData, remote: LibraryData): LibraryData {
  return {
    songs: mergeRecords(local.songs, remote.songs).incoming,
    setlists: mergeRecords(local.setlists, remote.setlists).incoming,
    categories: mergeRecords(local.categories, remote.categories).incoming,
  };
}

/**
 * Återställning från backup i "slå ihop"-läge: poster som saknas eller har raderats lokalt
 * återskapas, befintliga poster behålls om de är nyare.
 */
export function restoreMerge<T extends SyncRecord>(local: T[], backup: T[], now: number): T[] {
  const byId = new Map(local.map((r) => [r.id, r]));
  const out: T[] = [];
  for (const b of backup) {
    const mine = byId.get(b.id);
    if (!mine || mine.deletedAt || b.updatedAt > mine.updatedAt) {
      out.push({ ...b, deletedAt: undefined, updatedAt: now });
    }
  }
  return out;
}
