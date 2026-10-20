import { create } from 'zustand';
import { parseChordPro } from '../lib/chordpro';
import {
  DEFAULT_SETTINGS,
  newId,
  type Category,
  type LibraryData,
  type Setlist,
  type Settings,
  type Song,
} from '../lib/model';
import { db, requestPersistentStorage } from './db';
import { SAMPLE_SONG } from './sample';

export interface Draft {
  content: string;
  /** Bild från skanning som visas som referens i editorn */
  imageDataUrl?: string;
  tags?: string[];
}

interface State {
  ready: boolean;
  deviceId: string;
  songs: Record<string, Song>;
  setlists: Record<string, Setlist>;
  categories: Record<string, Category>;
  settings: Settings;
  draft: Draft | null;
  /** Ökar vid varje lokal ändring (används för att trigga synk) */
  revision: number;

  init(): Promise<void>;
  saveSong(input: { id?: string; content: string; tags?: string[]; categoryId?: string }): Promise<Song>;
  importSongs(contents: { content: string; tags?: string[]; categoryId?: string }[]): Promise<Song[]>;
  updateSongPrefs(id: string, prefs: Partial<Pick<Song, 'transpose' | 'scrollSpeed'>>): Promise<void>;
  deleteSong(id: string): Promise<void>;
  saveSetlist(input: Partial<Setlist> & { name: string }): Promise<Setlist>;
  deleteSetlist(id: string): Promise<void>;
  saveCategory(input: { id?: string; name: string }): Promise<Category>;
  deleteCategory(id: string): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  /** Tar emot poster från synk/backup utan att ändra deras tidsstämplar */
  applyIncoming(data: LibraryData, opts?: { local?: boolean }): Promise<void>;
  exportLibrary(includeDeleted: boolean): LibraryData;
  setDraft(d: Draft | null): void;
}

export function deriveSongMeta(content: string) {
  const { meta } = parseChordPro(content);
  const capo = meta.capo ? parseInt(meta.capo, 10) : undefined;
  return {
    title: meta.title?.trim() || 'Namnlös',
    artist: (meta.artist ?? meta.subtitle ?? '').trim(),
    key: meta.key?.trim() || undefined,
    capo: capo && !Number.isNaN(capo) ? capo : undefined,
    tempo: meta.tempo?.trim() || undefined,
  };
}

function toRecord<T extends { id: string }>(list: T[]): Record<string, T> {
  return Object.fromEntries(list.map((x) => [x.id, x]));
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  deviceId: '',
  songs: {},
  setlists: {},
  categories: {},
  settings: DEFAULT_SETTINGS,
  draft: null,
  revision: 0,

  async init() {
    if (get().ready) return;
    void requestPersistentStorage();
    const [songs, setlists, categories, settings, deviceId, firstRun] = await Promise.all([
      db.songs.all(),
      db.setlists.all(),
      db.categories.all(),
      db.getSettings(),
      db.getDeviceId(),
      db.isFirstRun(),
    ]);
    set({
      songs: toRecord(songs),
      setlists: toRecord(setlists),
      categories: toRecord(categories),
      settings,
      deviceId,
      ready: true,
    });
    if (firstRun && songs.length === 0) {
      await get().saveSong({ content: SAMPLE_SONG, tags: ['exempel'] });
    }
  },

  async saveSong({ id, content, tags, categoryId }) {
    const now = Date.now();
    const existing = id ? get().songs[id] : undefined;
    const song: Song = {
      id: existing?.id ?? id ?? newId(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      transpose: existing?.transpose ?? 0,
      scrollSpeed: existing?.scrollSpeed,
      ...deriveSongMeta(content),
      content,
      tags: normalizeTags(tags ?? existing?.tags ?? []),
      categoryId: categoryId === undefined ? existing?.categoryId : categoryId || undefined,
    };
    set((s) => ({ songs: { ...s.songs, [song.id]: song }, revision: s.revision + 1 }));
    await db.songs.put(song);
    return song;
  },

  async importSongs(items) {
    const now = Date.now();
    const songs: Song[] = items.map((it, i) => ({
      id: newId(),
      createdAt: now + i,
      updatedAt: now + i,
      transpose: 0,
      ...deriveSongMeta(it.content),
      content: it.content,
      tags: normalizeTags(it.tags ?? []),
      categoryId: it.categoryId || undefined,
    }));
    set((s) => ({ songs: { ...s.songs, ...toRecord(songs) }, revision: s.revision + 1 }));
    await db.songs.putMany(songs);
    return songs;
  },

  async updateSongPrefs(id, prefs) {
    const song = get().songs[id];
    if (!song) return;
    const next = { ...song, ...prefs, updatedAt: Date.now() };
    set((s) => ({ songs: { ...s.songs, [id]: next }, revision: s.revision + 1 }));
    await db.songs.put(next);
  },

  async deleteSong(id) {
    const song = get().songs[id];
    if (!song) return;
    const now = Date.now();
    // Behåll en gravsten utan innehåll så att raderingen synkas till andra enheter
    const tomb: Song = { ...song, content: '', tags: [], deletedAt: now, updatedAt: now };
    set((s) => ({ songs: { ...s.songs, [id]: tomb }, revision: s.revision + 1 }));
    await db.songs.put(tomb);
  },

  async saveSetlist(input) {
    const now = Date.now();
    const existing = input.id ? get().setlists[input.id] : undefined;
    const sl: Setlist = {
      items: [],
      ...existing,
      ...input,
      id: existing?.id ?? input.id ?? newId(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deletedAt: undefined,
    };
    set((s) => ({ setlists: { ...s.setlists, [sl.id]: sl }, revision: s.revision + 1 }));
    await db.setlists.put(sl);
    return sl;
  },

  async deleteSetlist(id) {
    const sl = get().setlists[id];
    if (!sl) return;
    const now = Date.now();
    const tomb: Setlist = { ...sl, items: [], deletedAt: now, updatedAt: now };
    set((s) => ({ setlists: { ...s.setlists, [id]: tomb }, revision: s.revision + 1 }));
    await db.setlists.put(tomb);
  },

  async saveCategory({ id, name }) {
    const now = Date.now();
    const existing = id ? get().categories[id] : undefined;
    const c: Category = {
      id: existing?.id ?? newId(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      name: name.trim(),
    };
    set((s) => ({ categories: { ...s.categories, [c.id]: c }, revision: s.revision + 1 }));
    await db.categories.put(c);
    return c;
  },

  async deleteCategory(id) {
    const c = get().categories[id];
    if (!c) return;
    const now = Date.now();
    const tomb: Category = { ...c, deletedAt: now, updatedAt: now };
    set((s) => ({ categories: { ...s.categories, [id]: tomb }, revision: s.revision + 1 }));
    await db.categories.put(tomb);
  },

  async updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await db.saveSettings(settings);
  },

  async applyIncoming(data, opts) {
    if (!data.songs.length && !data.setlists.length && !data.categories.length) return;
    set((s) => ({
      songs: { ...s.songs, ...toRecord(data.songs) },
      setlists: { ...s.setlists, ...toRecord(data.setlists) },
      categories: { ...s.categories, ...toRecord(data.categories) },
      // Ändringar från en återställning ska synkas vidare; ändringar från synk behöver inte det
      revision: opts?.local ? s.revision + 1 : s.revision,
    }));
    await Promise.all([
      db.songs.putMany(data.songs),
      db.setlists.putMany(data.setlists),
      db.categories.putMany(data.categories),
    ]);
  },

  exportLibrary(includeDeleted) {
    const s = get();
    const keep = <T extends { deletedAt?: number }>(x: T) => includeDeleted || !x.deletedAt;
    return {
      songs: Object.values(s.songs).filter(keep),
      setlists: Object.values(s.setlists).filter(keep),
      categories: Object.values(s.categories).filter(keep),
    };
  },

  setDraft(d) {
    set({ draft: d });
  },
}));

export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const v = t.trim().toLowerCase();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

// --- Selektorer ---

export function liveSongs(songs: Record<string, Song>): Song[] {
  return Object.values(songs).filter((s) => !s.deletedAt);
}

export function liveSetlists(setlists: Record<string, Setlist>): Setlist[] {
  return Object.values(setlists).filter((s) => !s.deletedAt);
}

export function liveCategories(categories: Record<string, Category>): Category[] {
  return Object.values(categories)
    .filter((c) => !c.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}

export function allTags(songs: Record<string, Song>): string[] {
  const set = new Set<string>();
  for (const s of liveSongs(songs)) for (const t of s.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b, 'sv'));
}
