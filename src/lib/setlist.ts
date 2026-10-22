// Hjälpfunktioner för punkterna i en setlista: låtar och mellanpunkter (t.ex. "Tal").

import type { SetlistItem, Song } from './model';

/** Låt-id i adressen när en mellanpunkt visas */
export const CUE_ROUTE_ID = '_mellan';

export function isCue(it: SetlistItem): boolean {
  return it.cue !== undefined;
}

/** Punkter som ska visas: mellanpunkter och låtar som finns kvar i biblioteket. */
export function liveItems(items: SetlistItem[], songs: Record<string, Song>): SetlistItem[] {
  return items.filter((it) => isCue(it) || (songs[it.songId] && !songs[it.songId].deletedAt));
}

export function itemTitle(it: SetlistItem, songs: Record<string, Song>): string {
  return isCue(it) ? it.cue || 'Paus' : songs[it.songId]?.title ?? '';
}

export function itemPath(setlistId: string, it: SetlistItem, index: number): string {
  return `/song/${isCue(it) ? CUE_ROUTE_ID : it.songId}?setlist=${setlistId}&i=${index}`;
}

export function songCount(items: SetlistItem[]): number {
  return items.filter((it) => !isCue(it)).length;
}
