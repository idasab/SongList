// Dela en setlista med alla dess låtar till någon annan med SongList: en .songlist-fil (JSON)
// som öppnas i appen. Låtar som mottagaren redan har (samma låt eller likadant innehåll)
// används som de är; övriga läggs till. Anteckningar och kategorier följer inte med.

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';
import { create } from 'zustand';
import { toast } from '../components/ui';
import { normalizeTranspose } from '../lib/chords';
import { findDuplicates } from '../lib/duplicates';
import { newId, songFiles, type Setlist, type Song, type SongAttachment } from '../lib/model';
import { isCue } from '../lib/setlist';
import { liveSongs, useStore } from '../store/useStore';

export const SHARE_EXTENSION = '.songlist';
const FORMAT = 'songlist-setlist';

interface SharedSong {
  id: string;
  title: string;
  artist: string;
  content: string;
  tags: string[];
  transpose: number;
  attachment?: SongAttachment;
  extraAttachments?: SongAttachment[];
}

export interface SharedSetlist {
  format: typeof FORMAT;
  version: 1;
  setlist: {
    name: string;
    date?: string;
    notes?: string;
    items: { songId: string; cue?: string; transpose?: number; capo?: number }[];
  };
  songs: SharedSong[];
}

/** Setlistan med de låtar den innehåller. */
export function buildSharedSetlist(setlist: Setlist, songs: Record<string, Song>): SharedSetlist {
  const items = setlist.items.filter((it) => isCue(it) || (songs[it.songId] && !songs[it.songId].deletedAt));
  const ids = [...new Set(items.filter((it) => !isCue(it)).map((it) => it.songId))];
  return {
    format: FORMAT,
    version: 1,
    setlist: {
      name: setlist.name,
      date: setlist.date,
      notes: setlist.notes,
      items: items.map((it) => (isCue(it) ? { songId: '', cue: it.cue } : { songId: it.songId, transpose: it.transpose, capo: it.capo })),
    },
    songs: ids.map((id) => {
      const s = songs[id];
      return {
        id: s.id,
        title: s.title,
        artist: s.artist,
        content: s.content,
        tags: s.tags,
        transpose: s.transpose,
        attachment: s.attachment,
        extraAttachments: s.extraAttachments,
      };
    }),
  };
}

export function isSharedSetlistFile(name: string): boolean {
  return name.toLowerCase().endsWith(SHARE_EXTENSION);
}

/** Läser en .songlist-fil; null om den inte är en delad setlista. */
export function parseSharedSetlist(text: string): SharedSetlist | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const d = data as Partial<SharedSetlist> | null;
  if (!d || d.format !== FORMAT || !d.setlist || typeof d.setlist.name !== 'string' || !Array.isArray(d.setlist.items) || !Array.isArray(d.songs)) {
    return null;
  }
  const songs = d.songs.filter(
    (s): s is SharedSong => !!s && typeof s.id === 'string' && typeof s.content === 'string' && typeof s.title === 'string',
  );
  return {
    format: FORMAT,
    version: 1,
    setlist: {
      name: d.setlist.name,
      date: typeof d.setlist.date === 'string' ? d.setlist.date : undefined,
      notes: typeof d.setlist.notes === 'string' ? d.setlist.notes : undefined,
      items: d.setlist.items
        .filter((it) => it && typeof it.songId === 'string')
        .map((it) => ({
          songId: it.songId,
          cue: typeof it.cue === 'string' ? it.cue : undefined,
          transpose: Number.isInteger(it.transpose) ? normalizeTranspose(it.transpose!) : undefined,
          capo: Number.isInteger(it.capo) && it.capo! >= 0 && it.capo! <= 11 ? it.capo : undefined,
        })),
    },
    songs: songs.map((s) => ({
      ...s,
      artist: typeof s.artist === 'string' ? s.artist : '',
      tags: Array.isArray(s.tags) ? s.tags.filter((t) => typeof t === 'string') : [],
      transpose: Number.isInteger(s.transpose) ? normalizeTranspose(s.transpose) : 0,
      ...sharedFiles(s),
    })),
  };
}

const validFile = (a: unknown): a is SongAttachment =>
  !!a && typeof a === 'object' && typeof (a as SongAttachment).dataUrl === 'string' && !!(a as SongAttachment).dataUrl;

/** Låtens filer i en delad fil, bara de som har innehåll. */
function sharedFiles(s: SharedSong): Pick<SharedSong, 'attachment' | 'extraAttachments'> {
  const files = [s.attachment, ...(Array.isArray(s.extraAttachments) ? s.extraAttachments : [])].filter(validFile);
  return { attachment: files[0], extraAttachments: files.length > 1 ? files.slice(1) : undefined };
}

/** Hur många av låtarna mottagaren redan har (används i stället för att läggas till). */
export function existingSongs(shared: SharedSetlist, library: Record<string, Song>): Map<string, string> {
  const live = liveSongs(library);
  const dups = findDuplicates(
    shared.songs.map((s) => ({ title: s.title, artist: s.artist, content: s.content, fileData: s.attachment?.dataUrl })),
    live,
  );
  const found = new Map<string, string>();
  shared.songs.forEach((s, i) => {
    if (library[s.id] && !library[s.id].deletedAt) found.set(s.id, s.id);
    else if (dups[i]?.identical && dups[i]?.song) found.set(s.id, dups[i]!.song!.id);
  });
  return found;
}

/** Lägger till setlistan (och låtarna som saknas). */
export async function importSharedSetlist(shared: SharedSetlist): Promise<Setlist> {
  const st = useStore.getState();
  const ids = existingSongs(shared, st.songs);
  for (const s of shared.songs) {
    if (ids.has(s.id)) continue;
    const saved = await st.saveSong({ content: s.content, tags: s.tags, files: songFiles(s) });
    if (s.transpose) await st.updateSongPrefs(saved.id, { transpose: s.transpose });
    ids.set(s.id, saved.id);
  }
  // Setlistan får samma tonarter som hos avsändaren, även om mottagarens låt är transponerad annorlunda
  const sender = new Map(shared.songs.map((s) => [s.id, s]));
  const songs = useStore.getState().songs;
  return st.saveSetlist({
    name: shared.setlist.name,
    date: shared.setlist.date,
    notes: shared.setlist.notes,
    items: shared.setlist.items
      .filter((it) => it.cue !== undefined || ids.has(it.songId))
      .map((it) => {
        if (it.cue !== undefined) return { id: newId(), songId: '', cue: it.cue };
        const songId = ids.get(it.songId)!;
        const wanted = it.transpose ?? sender.get(it.songId)?.transpose ?? 0;
        return { id: newId(), songId, transpose: wanted === (songs[songId]?.transpose ?? 0) ? undefined : wanted, capo: it.capo };
      }),
  });
}

// --- Ta emot ---

/** En delad setlista som väntar på att importeras (visas på importsidan). */
export const useIncomingShare = create<{ shared: SharedSetlist | null; setShared: (s: SharedSetlist | null) => void }>((set) => ({
  shared: null,
  setShared: (shared) => set({ shared }),
}));

/** Läser en .songlist-fil som öppnats i appen; visar ett fel om den inte går att läsa. */
export async function receiveSharedText(text: string): Promise<boolean> {
  const shared = parseSharedSetlist(text);
  if (!shared) {
    toast('Filen är ingen setlista från SongList', { error: true });
    return false;
  }
  useIncomingShare.getState().setShared(shared);
  return true;
}

/**
 * iOS: en .songlist-fil som öppnas med SongList (t.ex. från Mail eller Filer) visas på
 * importsidan, både när appen redan är igång och när den startas av filen.
 */
export function listenForSharedFiles() {
  if (!Capacitor.isNativePlatform()) return;
  // iOS kommer ihåg filen appen startades med även när webbvyn laddas om. Filen tas därför bort
  // ur appens inkorg när den lästs, och en startfil som inte finns längre hoppas över tyst.
  const reading = new Set<string>();
  const open = async (url: string | undefined, fromLaunch: boolean) => {
    if (!url || reading.has(url) || !isSharedSetlistFile(decodeURIComponent(url.split('?')[0]))) return;
    reading.add(url);
    try {
      const res = await fetch(Capacitor.convertFileSrc(url));
      if (!res.ok) throw new Error(String(res.status));
      const text = await res.text();
      if (url.includes('/Inbox/')) await Filesystem.deleteFile({ path: url }).catch(() => undefined);
      if (await receiveSharedText(text)) window.location.hash = '#/import';
    } catch {
      if (!fromLaunch) toast('Filen kunde inte läsas', { error: true });
    } finally {
      reading.delete(url);
    }
  };
  void App.addListener('appUrlOpen', ({ url }) => void open(url, false));
  void App.getLaunchUrl().then((r) => open(r?.url, true));
}
