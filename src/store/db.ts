// Lokal lagring i IndexedDB via localForage. En "store" per posttyp.

import localforage from 'localforage';
import { DEFAULT_SETTINGS, newId, type Category, type Setlist, type SetlistFolder, type Settings, type Song } from '../lib/model';

const DB_NAME = 'SongList';

function store(storeName: string) {
  return localforage.createInstance({
    name: DB_NAME,
    storeName,
    driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
  });
}

const songsStore = store('songs');
const setlistsStore = store('setlists');
const categoriesStore = store('categories');
const foldersStore = store('folders');
const metaStore = store('meta');

async function all<T>(s: LocalForage): Promise<T[]> {
  const out: T[] = [];
  await s.iterate<T, void>((value) => {
    out.push(value);
  });
  return out;
}

export const db = {
  songs: {
    all: () => all<Song>(songsStore),
    put: (s: Song) => songsStore.setItem(s.id, s),
    putMany: (list: Song[]) => Promise.all(list.map((s) => songsStore.setItem(s.id, s))),
    clear: () => songsStore.clear(),
  },
  setlists: {
    all: () => all<Setlist>(setlistsStore),
    put: (s: Setlist) => setlistsStore.setItem(s.id, s),
    putMany: (list: Setlist[]) => Promise.all(list.map((s) => setlistsStore.setItem(s.id, s))),
  },
  categories: {
    all: () => all<Category>(categoriesStore),
    put: (c: Category) => categoriesStore.setItem(c.id, c),
    putMany: (list: Category[]) => Promise.all(list.map((c) => categoriesStore.setItem(c.id, c))),
  },
  folders: {
    all: () => all<SetlistFolder>(foldersStore),
    put: (f: SetlistFolder) => foldersStore.setItem(f.id, f),
    putMany: (list: SetlistFolder[]) => Promise.all(list.map((f) => foldersStore.setItem(f.id, f))),
  },
  async getSettings(): Promise<Settings> {
    const s = await metaStore.getItem<Partial<Settings>>('settings');
    return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  },
  saveSettings: (s: Settings) => metaStore.setItem('settings', s),
  async getDeviceId(): Promise<string> {
    let id = await metaStore.getItem<string>('deviceId');
    if (!id) {
      id = newId();
      await metaStore.setItem('deviceId', id);
    }
    return id;
  },
  async isFirstRun(): Promise<boolean> {
    const v = await metaStore.getItem<boolean>('initialized');
    if (!v) await metaStore.setItem('initialized', true);
    return !v;
  },
};

/** Be webbläsaren att inte rensa lagringen automatiskt (där det stöds). */
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    // Inte kritiskt
  }
}
