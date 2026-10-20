// Datamodell för låtar, setlistor och kategorier.

import type { Instrument } from './chordShapes';
import type { Notation } from './chords';

/** Gemensamt för allt som synkas mellan enheter. */
export interface SyncRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Satt om posten är raderad (behålls som "gravsten" så att raderingen synkas) */
  deletedAt?: number;
}

export interface Song extends SyncRecord {
  title: string;
  artist: string;
  key?: string;
  capo?: number;
  tempo?: string;
  /** ChordPro-källtext – den sanna källan för text, ackord och metadata */
  content: string;
  tags: string[];
  categoryId?: string;
  /** Visningstransponering i halvtoner */
  transpose: number;
  /** Hastighet för automatisk scroll (1–10) */
  scrollSpeed?: number;
}

export interface SetlistItem {
  /** Unikt inom setlistan, så att samma låt kan förekomma flera gånger */
  id: string;
  songId: string;
}

export interface Setlist extends SyncRecord {
  name: string;
  date?: string;
  notes?: string;
  items: SetlistItem[];
}

export interface Category extends SyncRecord {
  name: string;
}

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  instrument: Instrument;
  notation: Notation;
  theme: Theme;
  fontSize: number;
  showDiagrams: boolean;
  autoSync: boolean;
  autoBackup: boolean;
  lastSyncAt?: number;
  lastBackupAt?: number;
  librarySort: 'title' | 'artist' | 'updated';
}

export const DEFAULT_SETTINGS: Settings = {
  instrument: 'guitar',
  notation: 'international',
  theme: 'system',
  fontSize: 20,
  showDiagrams: false,
  autoSync: true,
  autoBackup: true,
  librarySort: 'title',
};

export interface LibraryData {
  songs: Song[];
  setlists: Setlist[];
  categories: Category[];
}

export interface BackupFile extends LibraryData {
  format: 'songlist-backup' | 'songlist-sync';
  version: 1;
  createdAt: number;
  deviceId?: string;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** Validerar att en inläst fil ser ut som en SongList-backup. */
export function isBackupFile(data: unknown): data is BackupFile {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<BackupFile>;
  return (
    (d.format === 'songlist-backup' || d.format === 'songlist-sync') &&
    Array.isArray(d.songs) &&
    Array.isArray(d.setlists) &&
    Array.isArray(d.categories)
  );
}
