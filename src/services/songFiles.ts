// Alla låtar som egna filer: ChordPro (.cho) för låtar med text och ackord, och originalfilen
// (PDF eller bild) för låtar som sparats som fil. Används som läsbar backup i iCloud Drive och
// för att flytta låtarna till en annan app.

import type { Song } from '../lib/model';
import { hasNativePlugin, SongListNative } from '../native/songlistNative';
import { liveSongs, useStore } from '../store/useStore';
import { safeFileName, saveBinaryFile } from './files';

/** Mapp i iCloud Drive › SongList */
export const SONG_FILES_DIR = 'Låtar';

export interface SongFile {
  song: Song;
  name: string;
}

const FILE_EXT = /\.(cho|chopro|pdf|jpe?g|png|gif|webp|heic)$/i;

function extension(song: Song): string {
  const a = song.attachment;
  if (!a) return '.cho';
  return /\.[^.]+$/.exec(a.name)?.[0].toLowerCase() ?? (a.kind === 'pdf' ? '.pdf' : '.jpg');
}

/** Ett unikt filnamn per låt: "Titel – Artist.cho". */
export function songFileNames(songs: Song[]): SongFile[] {
  const used = new Set<string>();
  const sorted = [...songs].sort((a, b) => a.title.localeCompare(b.title, 'sv') || a.createdAt - b.createdAt);
  return sorted.map((song) => {
    const base = safeFileName(song.artist ? `${song.title} – ${song.artist}` : song.title);
    const ext = extension(song);
    let name = base + ext;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})${ext}`;
    used.add(name.toLowerCase());
    return { song, name };
  });
}

function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text.endsWith('\n') ? text : text + '\n');
}

async function fileBytes(f: SongFile): Promise<Uint8Array> {
  if (f.song.attachment) return new Uint8Array(await (await fetch(f.song.attachment.dataUrl)).arrayBuffer());
  return textBytes(f.song.content);
}

/**
 * Förteckning i mappen över vilken låt och version varje fil innehåller. Dold (punkt först),
 * så att den inte syns bland låtarna. Delas av alla enheter som skriver till mappen.
 */
const MANIFEST = `${SONG_FILES_DIR}/.songlist.json`;

type Manifest = Record<string, { id: string; updatedAt: number }>;

async function readManifest(): Promise<Manifest> {
  try {
    const { data } = await SongListNative.readFile({ scope: 'documents', path: MANIFEST });
    const m: unknown = JSON.parse(data);
    return m && typeof m === 'object' ? (m as Manifest) : {};
  } catch {
    return {};
  }
}

/**
 * Speglar alla låtar till iCloud Drive › SongList › Låtar. En fil skrivs om när den hör till
 * en annan låt än förut (t.ex. efter att en låt bytt namn eller raderats) eller när låten har
 * ändrats, även om ändringen kom via synk. Filer för raderade låtar tas bort.
 */
export async function mirrorSongsToICloud(): Promise<number> {
  if (!hasNativePlugin()) return 0;
  const files = songFileNames(liveSongs(useStore.getState().songs));
  const { files: existing } = await SongListNative.listFiles({ scope: 'documents', path: SONG_FILES_DIR });
  const present = new Set(existing.map((e) => e.name));
  const manifest = await readManifest();
  const next: Manifest = {};
  for (const f of files) {
    const known = manifest[f.name];
    next[f.name] = { id: f.song.id, updatedAt: f.song.updatedAt };
    if (present.has(f.name) && known?.id === f.song.id && known.updatedAt === f.song.updatedAt) continue;
    const path = `${SONG_FILES_DIR}/${f.name}`;
    if (f.song.attachment) {
      const data = f.song.attachment.dataUrl.replace(/^data:[^,]*,/, '');
      await SongListNative.writeFile({ scope: 'documents', path, data, base64: true });
    } else {
      await SongListNative.writeFile({ scope: 'documents', path, data: f.song.content.replace(/\n?$/, '\n') });
    }
  }
  for (const e of existing) {
    if (next[e.name] || !FILE_EXT.test(e.name)) continue;
    try {
      await SongListNative.deleteFile({ scope: 'documents', path: `${SONG_FILES_DIR}/${e.name}` });
    } catch {
      // Försök igen nästa gång
    }
  }
  await SongListNative.writeFile({ scope: 'documents', path: MANIFEST, data: JSON.stringify(next) });
  return files.length;
}

/** Alla låtar som filer i en zip-fil. */
export async function buildSongsZip(): Promise<{ zip: Uint8Array; count: number }> {
  const files = songFileNames(liveSongs(useStore.getState().songs));
  const { zipSync } = await import('fflate');
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = await fileBytes(f);
  return { zip: zipSync(entries, { level: 6 }), count: files.length };
}

/** Sparar alla låtar som filer i en zip-fil. */
export async function exportSongsZip(): Promise<number> {
  const { zip, count } = await buildSongsZip();
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await saveBinaryFile(`SongList låtar ${date}.zip`, new Blob([zip as BlobPart], { type: 'application/zip' }), 'application/zip');
  return count;
}
