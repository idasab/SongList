// Datamodell för låtar, setlistor och kategorier.

import type { Annotations } from './annotations';
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
  /** Alternativ titel ({subtitle}) */
  subtitle?: string;
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
  /** Post-it-lappar och handritade anteckningar */
  annotations?: Annotations;
  /** Låten visas som en bifogad fil (t.ex. noter) i stället för text och ackord */
  attachment?: SongAttachment;
}

/** En PDF eller bild som sparas med låten. */
export interface SongAttachment {
  name: string;
  mime: string;
  /** Filens innehåll som data-URL (base64). Tom i iCloud-säkerhetskopior, se file. */
  dataUrl: string;
  kind: 'pdf' | 'image';
  /**
   * Bara i säkerhetskopior i iCloud: filen ligger i Säkerhetskopior/Filer med detta namn
   * (efter innehållet), så att samma notblad bara sparas en gång.
   */
  file?: string;
}

export interface SetlistItem {
  /** Unikt inom setlistan, så att samma låt kan förekomma flera gånger */
  id: string;
  /** Tom för mellanpunkter */
  songId: string;
  /** Mellanpunkt i stället för en låt, t.ex. "Tal": texten som visas på skärmen */
  cue?: string;
  /** Transponering som bara gäller i den här setlistan (annars låtens egen) */
  transpose?: number;
}

export interface Setlist extends SyncRecord {
  name: string;
  /** Mapp som setlistan ligger i */
  folderId?: string;
  date?: string;
  notes?: string;
  items: SetlistItem[];
}

export interface Category extends SyncRecord {
  name: string;
}

/** Mapp för att organisera setlistor */
export interface SetlistFolder extends SyncRecord {
  name: string;
}

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  instrument: Instrument;
  notation: Notation;
  theme: Theme;
  fontSize: number;
  showDiagrams: boolean;
  showAnnotations: boolean;
  autoSync: boolean;
  autoBackup: boolean;
  lastSyncAt?: number;
  lastBackupAt?: number;
  librarySort: 'title' | 'artist' | 'updated';
  /** Förenklade ackord i låtvyn (Cmaj7 → C, G/B → G); låtarna ändras inte */
  simplifyChords?: boolean;
  /** Två spalter på en bred skärm i liggande läge, när låten då får plats (förval: på) */
  twoColumns?: boolean;
  /** Om en tonartsändring i en setlista bara gäller där (förval) eller för låten överallt */
  transposeScope?: 'setlist' | 'global';
  /** Senast använda e-postadresser för export (sparas bara på enheten) */
  recentEmails?: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  instrument: 'guitar',
  notation: 'international',
  theme: 'system',
  fontSize: 20,
  showDiagrams: false,
  showAnnotations: true,
  autoSync: true,
  autoBackup: true,
  librarySort: 'title',
};

export interface LibraryData {
  songs: Song[];
  setlists: Setlist[];
  categories: Category[];
  folders: SetlistFolder[];
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
  // Äldre säkerhetskopior saknar mappar
  if (d.folders === undefined) d.folders = [];
  return (
    Array.isArray(d.folders) &&
    (d.format === 'songlist-backup' || d.format === 'songlist-sync') &&
    Array.isArray(d.songs) &&
    Array.isArray(d.setlists) &&
    Array.isArray(d.categories)
  );
}

const isRecord = (r: unknown): r is SyncRecord =>
  !!r && typeof r === 'object' && typeof (r as SyncRecord).id === 'string' && typeof (r as SyncRecord).updatedAt === 'number';

/**
 * Fyller i saknade fält i poster från synk eller säkerhetskopior (t.ex. från en äldre version
 * eller en skadad fil), så att appen inte kraschar på dem. Poster utan id eller tidsstämpel
 * hoppas över.
 */
export function sanitizeLibrary<T extends LibraryData>(data: T): T {
  return {
    ...data,
    songs: data.songs.filter(isRecord).map((s) => ({
      ...s,
      title: typeof s.title === 'string' ? s.title : 'Namnlös',
      artist: typeof s.artist === 'string' ? s.artist : '',
      content: typeof s.content === 'string' ? s.content : '',
      tags: Array.isArray(s.tags) ? s.tags.filter((t) => typeof t === 'string') : [],
      transpose: typeof s.transpose === 'number' ? s.transpose : 0,
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : s.updatedAt,
      // En bifogad fil behålls så länge innehållet (eller en hänvisning till det) finns
      attachment:
        s.attachment && (typeof s.attachment.dataUrl === 'string' || typeof s.attachment.file === 'string')
          ? {
              ...s.attachment,
              dataUrl: typeof s.attachment.dataUrl === 'string' ? s.attachment.dataUrl : '',
              name: typeof s.attachment.name === 'string' && s.attachment.name ? s.attachment.name : 'fil',
            }
          : undefined,
    })),
    setlists: data.setlists.filter(isRecord).map((sl) => ({
      ...sl,
      name: typeof sl.name === 'string' ? sl.name : 'Setlista',
      items: Array.isArray(sl.items)
        ? sl.items
            .filter((it) => it && typeof it.id === 'string')
            .map((it) => (it.transpose === undefined || typeof it.transpose === 'number' ? it : { ...it, transpose: undefined }))
        : [],
    })),
    categories: data.categories.filter(isRecord).map((c) => ({ ...c, name: typeof c.name === 'string' ? c.name : '' })),
    folders: data.folders.filter(isRecord).map((f) => ({ ...f, name: typeof f.name === 'string' ? f.name : '' })),
  };
}
