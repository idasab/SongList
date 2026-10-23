// Originalfiler (PDF:er och bilder) i säkerhetskopior i iCloud. Varje fil sparas en gång i
// Säkerhetskopior/Filer med ett namn efter innehållet; säkerhetskopiorna pekar på filen.

import type { BackupFile, SongAttachment } from './model';

/** Innehållet i en data-URL som base64, eller null om den inte är base64-kodad. */
export function dataUrlBase64(dataUrl: string): string | null {
  const m = /^data:[^,]*;base64,/.exec(dataUrl);
  return m ? dataUrl.slice(m[0].length) : null;
}

/** FNV-1a (64 bitar), om crypto.subtle inte finns. */
function fnv1a(bytes: Uint8Array): string {
  let h = 0xcbf29ce484222325n;
  for (const b of bytes) h = BigInt.asUintN(64, (h ^ BigInt(b)) * 0x100000001b3n);
  return h.toString(16).padStart(16, '0');
}

/** Ett namn som bara beror på filens innehåll. */
export async function contentHash(base64: string): Promise<string> {
  const bytes = new TextEncoder().encode(base64);
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return Array.from(digest.subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return fnv1a(bytes);
}

export function attachmentFileName(hash: string, a: SongAttachment): string {
  const ext = /\.[a-z0-9]{1,5}$/i.exec(a.name)?.[0].toLowerCase() ?? (a.kind === 'pdf' ? '.pdf' : '.jpg');
  return hash + ext;
}

/** Filerna som en säkerhetskopia pekar på. */
export function referencedFiles(backup: BackupFile): string[] {
  return backup.songs.flatMap((s) => (s.attachment?.file ? [s.attachment.file] : []));
}

/**
 * Låtar vars originalfil inte gick att hämta (t.ex. en iCloud-säkerhetskopia som återställs i
 * webbläsaren) behålls som vanliga låtar, med en anteckning om vad som saknas.
 */
export function markMissingAttachments(backup: BackupFile): BackupFile {
  if (!backup.songs.some((s) => s.attachment && !s.attachment.dataUrl)) return backup;
  return {
    ...backup,
    songs: backup.songs.map((s) =>
      s.attachment && !s.attachment.dataUrl
        ? {
            ...s,
            attachment: undefined,
            content: `${s.content.trim()}\n{comment: Originalfilen ${s.attachment.name} saknas – återställ i iOS-appen för att få med den}\n`,
          }
        : s,
    ),
  };
}
