import { create } from 'zustand';
import { parseChordPro, shapesToSounding } from '../lib/chordpro';
import {
  DEFAULT_SETTINGS,
  filesFields,
  newId,
  songFiles,
  type Category,
  type LibraryData,
  type Setlist,
  type SetlistFolder,
  type Settings,
  type Song,
  type SongAttachment,
} from '../lib/model';
import type { SourceFont } from '../lib/textImport';
import { db, requestPersistentStorage } from './db';
import { SAMPLE_SONG } from './sample';

export interface Draft {
  content: string;
  /** Bild från skanning som visas som referens i editorn */
  imageDataUrl?: string;
  tags?: string[];
  categoryId?: string;
  /** Låten kommer från importlistan och tas bort därifrån när den sparas */
  importItemId?: string;
  /** Originalfil som ska sparas med låten */
  attachment?: SongAttachment;
}

/** En låt som väntar i importlistan. */
export interface ImportQueueItem {
  id: string;
  fileName: string;
  raw: string;
  kind: 'chordpro' | 'text';
  font: SourceFont;
  /** Tolkat från PDF eller bild – bör granskas */
  origin?: 'pdf' | 'image';
  imageDataUrl?: string;
  /** Egen kategori för låten; undefined = samma som för alla, '' = ingen */
  categoryId?: string;
  /** Egna taggar som läggs till de gemensamma */
  tags?: string[];
  /** Originalfilen (PDF eller bild) */
  original?: SongAttachment;
  /** Liten bild av filen (första sidan) för förhandsvisning */
  previewDataUrl?: string;
  /** Visa som text och ackord, eller som originalfil */
  display?: 'chordpro' | 'file';
  /** Sant om innehållet har tolkats (OCR/PDF-text); annars bara en titel */
  interpreted?: boolean;
  /** Valet för en låt som redan finns (undefined = förvalet) */
  duplicate?: DuplicateAction;
  /** Filen hör till låten ovanför i listan och blir en sida till i den (undefined = förvalet) */
  joinPrev?: boolean;
  /** Redigerad i editorn: raw är låtens ChordPro som den ska sparas (även för en fil) */
  edited?: boolean;
}

/** merge: filerna läggs till i låten som redan finns (t.ex. sida 2 av noterna) */
export type DuplicateAction = 'add' | 'skip' | 'replace' | 'merge';

/** Importlistan finns kvar när man byter sida (men sparas inte mellan omstarter). */
export interface ImportQueue {
  items: ImportQueueItem[];
  tags: string[];
  categoryId: string;
}

const EMPTY_IMPORT_QUEUE: ImportQueue = { items: [], tags: [], categoryId: '' };

interface State {
  ready: boolean;
  deviceId: string;
  songs: Record<string, Song>;
  setlists: Record<string, Setlist>;
  categories: Record<string, Category>;
  folders: Record<string, SetlistFolder>;
  settings: Settings;
  draft: Draft | null;
  importQueue: ImportQueue;
  /** Ökar vid varje lokal ändring (används för att trigga synk) */
  revision: number;

  init(): Promise<void>;
  saveSong(input: {
    id?: string;
    content: string;
    tags?: string[];
    categoryId?: string;
    /** Byter låtens filer mot den här (null tar bort dem) */
    attachment?: SongAttachment | null;
    /** Byter låtens filer mot de här (tom lista tar bort dem) */
    files?: SongAttachment[];
  }): Promise<Song>;
  importSongs(
    contents: { content: string; tags?: string[]; categoryId?: string; files?: SongAttachment[] }[],
  ): Promise<Song[]>;
  updateSongPrefs(id: string, prefs: Partial<Pick<Song, 'transpose' | 'scrollSpeed' | 'annotations'>>): Promise<void>;
  deleteSong(id: string): Promise<void>;
  /** Ändrar flera låtar på en gång: lägger till taggar och/eller sätter kategori (null = ingen). */
  editSongs(ids: string[], change: { addTags?: string[]; categoryId?: string | null }): Promise<number>;
  saveSetlist(input: Partial<Setlist> & { name: string }): Promise<Setlist>;
  deleteSetlist(id: string): Promise<void>;
  saveCategory(input: { id?: string; name: string }): Promise<Category>;
  deleteCategory(id: string): Promise<void>;
  saveFolder(input: { id?: string; name: string }): Promise<SetlistFolder>;
  deleteFolder(id: string): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  /** Tar emot poster från synk/backup utan att ändra deras tidsstämplar */
  applyIncoming(data: LibraryData, opts?: { local?: boolean }): Promise<void>;
  exportLibrary(includeDeleted: boolean): LibraryData;
  setDraft(d: Draft | null): void;
  updateImportQueue(fn: (q: ImportQueue) => ImportQueue): void;
  resetImportQueue(): void;
}

export function deriveSongMeta(content: string) {
  const { meta } = parseChordPro(content);
  const capo = meta.capo ? parseInt(meta.capo, 10) : undefined;
  return {
    title: meta.title?.trim() || 'Namnlös',
    subtitle: meta.subtitle?.trim() || undefined,
    artist: (meta.artist ?? '').trim(),
    key: meta.key?.trim() || undefined,
    capo: capo && !Number.isNaN(capo) ? capo : undefined,
    tempo: meta.tempo?.trim() || undefined,
  };
}

function toRecord<T extends { id: string }>(list: T[]): Record<string, T> {
  return Object.fromEntries(list.map((x) => [x.id, x]));
}

let initPromise: Promise<void> | null = null;

export const SAMPLE_SONG_ID = 'songlist-exempel';

/**
 * Tidigare tolkades {subtitle} som artist när artist saknades. Nu är det en alternativ titel:
 * räkna om fälten för låtar som har en {subtitle} men saknar det nya fältet.
 */
function withSubtitle(s: Song): Song {
  if (s.subtitle !== undefined || s.deletedAt || !/\{\s*(subtitle|st|su)\s*:/i.test(s.content)) return s;
  const meta = deriveSongMeta(s.content);
  return { ...s, subtitle: meta.subtitle, artist: meta.artist };
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  deviceId: '',
  songs: {},
  setlists: {},
  categories: {},
  folders: {},
  settings: DEFAULT_SETTINGS,
  draft: null,
  importQueue: EMPTY_IMPORT_QUEUE,
  revision: 0,

  init() {
    // Körs bara en gång även om den anropas flera gånger samtidigt (t.ex. i StrictMode)
    initPromise ??= (async () => {
      void requestPersistentStorage();
      const [songs, setlists, categories, folders, settings, deviceId, firstRun] = await Promise.all([
        db.songs.all(),
        db.setlists.all(),
        db.categories.all(),
        db.folders.all(),
        db.getSettings(),
        db.getDeviceId(),
        db.isFirstRun(),
      ]);
      set({
        songs: toRecord(songs.map(withSubtitle)),
        setlists: toRecord(setlists),
        categories: toRecord(categories),
        folders: toRecord(folders),
        settings,
        deviceId,
        ready: true,
      });
      if (firstRun && songs.length === 0) {
        // Fast id och gammal tidsstämpel: alla enheter får samma exempellåt i stället för en ny
        // per enhet, och har den raderats på en annan enhet vinner raderingen vid synk
        const sample: Song = {
          id: SAMPLE_SONG_ID,
          createdAt: 1,
          updatedAt: 1,
          transpose: 0,
          ...deriveSongMeta(SAMPLE_SONG),
          content: SAMPLE_SONG,
          tags: ['exempel'],
        };
        set((s) => ({ songs: { ...s.songs, [sample.id]: sample } }));
        await db.songs.put(sample);
      }
    })();
    // Gick det inte: låt nästa försök börja om
    initPromise.catch(() => {
      initPromise = null;
    });
    return initPromise;
  },

  async saveSong({ id, content: input, tags, categoryId, attachment, files }) {
    // å, ä och ö som bokstav + prick/ring görs om till ett tecken (annars känns t.ex.
    // "Refräng:" inte igen och titlar sorteras fel)
    const content = input.normalize('NFC');
    const now = Date.now();
    const existing = id ? get().songs[id] : undefined;
    const song: Song = {
      id: existing?.id ?? id ?? newId(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      transpose: existing?.transpose ?? 0,
      scrollSpeed: existing?.scrollSpeed,
      annotations: existing?.annotations,
      ...filesFields(files ?? (attachment !== undefined ? (attachment ? [attachment] : []) : existing ? songFiles(existing) : [])),
      ...deriveSongMeta(content),
      content,
      tags: normalizeTags(tags ?? existing?.tags ?? []),
      // Bara kategorier som finns kvar (en raderad kategori ska inte hamna på låten)
      categoryId: liveCategoryId(get().categories, categoryId === undefined ? existing?.categoryId : categoryId),
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
      ...deriveSongMeta(it.content.normalize('NFC')),
      // Ackord skrivna som grepp för kapot skrivs om till tonarten
      content: it.files?.length ? it.content.normalize('NFC') : shapesToSounding(it.content.normalize('NFC')),
      tags: normalizeTags(it.tags ?? []),
      categoryId: liveCategoryId(get().categories, it.categoryId),
      ...filesFields(it.files ?? []),
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
    const tomb: Song = {
      ...song,
      content: '',
      tags: [],
      annotations: undefined,
      attachment: undefined,
      extraAttachments: undefined,
      deletedAt: now,
      updatedAt: now,
    };
    set((s) => ({ songs: { ...s.songs, [id]: tomb }, revision: s.revision + 1 }));
    await db.songs.put(tomb);
  },

  async editSongs(ids, { addTags, categoryId }) {
    const now = Date.now();
    const songs = get().songs;
    // Bara kategorier som finns kvar
    const category = categoryId === undefined ? undefined : liveCategoryId(get().categories, categoryId ?? undefined);
    const changed: Song[] = [];
    for (const id of ids) {
      const song = songs[id];
      if (!song || song.deletedAt) continue;
      const tags = addTags ? normalizeTags([...song.tags, ...addTags]) : song.tags;
      const nextCategory = categoryId === undefined ? song.categoryId : category;
      if (tags.length === song.tags.length && nextCategory === song.categoryId) continue;
      changed.push({ ...song, tags, categoryId: nextCategory, updatedAt: now });
    }
    if (!changed.length) return 0;
    set((s) => ({ songs: { ...s.songs, ...toRecord(changed) }, revision: s.revision + 1 }));
    await db.songs.putMany(changed);
    return changed.length;
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

  async saveFolder({ id, name }) {
    const now = Date.now();
    const existing = id ? get().folders[id] : undefined;
    const f: SetlistFolder = {
      id: existing?.id ?? newId(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      name: name.trim(),
    };
    set((s) => ({ folders: { ...s.folders, [f.id]: f }, revision: s.revision + 1 }));
    await db.folders.put(f);
    return f;
  },

  async deleteFolder(id) {
    const f = get().folders[id];
    if (!f) return;
    const now = Date.now();
    const tomb: SetlistFolder = { ...f, deletedAt: now, updatedAt: now };
    // Setlistorna i mappen flyttas ut (hamnar under "Utan mapp")
    const moved = Object.values(get().setlists)
      .filter((sl) => sl.folderId === id)
      .map((sl) => ({ ...sl, folderId: undefined, updatedAt: now }));
    set((s) => ({
      folders: { ...s.folders, [id]: tomb },
      setlists: { ...s.setlists, ...toRecord(moved) },
      revision: s.revision + 1,
    }));
    await Promise.all([db.folders.put(tomb), db.setlists.putMany(moved)]);
  },

  async updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await db.saveSettings(settings);
  },

  async applyIncoming(data, opts) {
    if (!data.songs.length && !data.setlists.length && !data.categories.length && !data.folders.length) return;
    set((s) => ({
      songs: { ...s.songs, ...toRecord(data.songs) },
      setlists: { ...s.setlists, ...toRecord(data.setlists) },
      categories: { ...s.categories, ...toRecord(data.categories) },
      folders: { ...s.folders, ...toRecord(data.folders) },
      // Ändringar från en återställning ska synkas vidare; ändringar från synk behöver inte det
      revision: opts?.local ? s.revision + 1 : s.revision,
    }));
    await Promise.all([
      db.songs.putMany(data.songs),
      db.setlists.putMany(data.setlists),
      db.categories.putMany(data.categories),
      db.folders.putMany(data.folders),
    ]);
  },

  exportLibrary(includeDeleted) {
    const s = get();
    const keep = <T extends { deletedAt?: number }>(x: T) => includeDeleted || !x.deletedAt;
    return {
      songs: Object.values(s.songs).filter(keep),
      setlists: Object.values(s.setlists).filter(keep),
      categories: Object.values(s.categories).filter(keep),
      folders: Object.values(s.folders).filter(keep),
    };
  },

  setDraft(d) {
    set({ draft: d });
  },

  updateImportQueue(fn) {
    set((s) => ({ importQueue: fn(s.importQueue) }));
  },

  resetImportQueue() {
    set({ importQueue: EMPTY_IMPORT_QUEUE });
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

function liveCategoryId(categories: Record<string, Category>, id: string | undefined): string | undefined {
  return id && categories[id] && !categories[id].deletedAt ? id : undefined;
}

/** Namnet på en kategori som finns kvar, annars undefined (t.ex. om den har raderats). */
export function categoryName(categories: Record<string, Category>, id: string | undefined): string | undefined {
  const c = id ? categories[id] : undefined;
  return c && !c.deletedAt ? c.name : undefined;
}

export function liveCategories(categories: Record<string, Category>): Category[] {
  return Object.values(categories)
    .filter((c) => !c.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}

export function liveFolders(folders: Record<string, SetlistFolder>): SetlistFolder[] {
  return Object.values(folders)
    .filter((f) => !f.deletedAt)
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
}

export function allTags(songs: Record<string, Song>): string[] {
  const set = new Set<string>();
  for (const s of liveSongs(songs)) for (const t of s.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b, 'sv'));
}
