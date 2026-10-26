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

/** Transponeringen för en låt i setlistan: setlistans egen om den har en, annars låtens. */
export function itemTranspose(it: SetlistItem | undefined, song: Song): number {
  return typeof it?.transpose === 'number' ? it.transpose : song.transpose;
}

export function songCount(items: SetlistItem[]): number {
  return items.filter((it) => !isCue(it)).length;
}

/**
 * Flyttar en synlig punkt. Punkter som inte visas (låtar som raderats eller inte synkats än)
 * ligger kvar på sina platser, så att de inte försvinner när listan sparas.
 */
export function moveVisible(all: SetlistItem[], visible: SetlistItem[], from: number, to: number): SetlistItem[] {
  const order = [...visible];
  const [moved] = order.splice(from, 1);
  if (!moved) return all;
  order.splice(to, 0, moved);
  const shown = new Set(visible.map((it) => it.id));
  let k = 0;
  return all.map((it) => (shown.has(it.id) ? order[k++] : it));
}
