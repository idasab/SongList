// Historik för en låt: setlistorna den har ingått i, med datum, tonart och anteckningarna
// som låten hade när den senast visades i setlistan.

import type { Setlist, SetlistItem, Song } from './model';
import { liveItems } from './setlist';

export interface HistoryEntry {
  setlist: Setlist;
  item: SetlistItem;
  /** Punktens plats bland de punkter som visas (för att öppna låten i setlistan) */
  index: number;
}

/** Setlistor med låten: daterade först (senaste överst), sedan odaterade (senast ändrade överst). */
export function songHistory(songId: string, setlists: Record<string, Setlist>, songs: Record<string, Song>): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const sl of Object.values(setlists)) {
    if (sl.deletedAt) continue;
    const items = liveItems(sl.items, songs);
    const index = items.findIndex((it) => it.songId === songId);
    if (index >= 0) out.push({ setlist: sl, item: items[index], index });
  }
  return out.sort((a, b) => {
    const [da, db] = [a.setlist.date ?? '', b.setlist.date ?? ''];
    if (da !== db) return !da ? 1 : !db ? -1 : db.localeCompare(da);
    return b.setlist.updatedAt - a.setlist.updatedAt;
  });
}

/** Dagens datum som "ÅÅÅÅ-MM-DD" (lokal tid). */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Den senaste setlistan med ett datum som har varit (eller är i dag). */
export function lastPlayed(history: HistoryEntry[], today = todayIso()): HistoryEntry | undefined {
  return history.find((h) => h.setlist.date && h.setlist.date <= today);
}
