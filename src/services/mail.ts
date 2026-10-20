// Skicka filer med e-post.
//
// - iOS-appen: Apples mejlfönster med mottagare, ämne, text och bifogade filer ifyllda.
//   Finns inget konto i appen Mail används delningsmenyn i stället.
// - Webben: en webbsida kan inte fylla i mottagare när filer bifogas. Där delas filerna via
//   delningsmenyn (mottagarna kopieras så att de kan klistras in), eller så laddas filerna
//   ner och ett mejl öppnas med mottagare, ämne och text ifyllda.

import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { hasNativePlugin, SongListNative } from '../native/songlistNative';
import type { ExportFile } from './setlistExport';
import { readFileAsDataUrl, saveBinaryFile } from './files';

export interface MailRequest {
  to: string[];
  subject: string;
  body: string;
  files: ExportFile[];
}

/** Hur mejlet hanterades, för att kunna visa rätt meddelande. */
export type MailOutcome = 'sent' | 'saved' | 'cancelled' | 'shared' | 'downloaded';

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

async function toBase64(blob: Blob): Promise<string> {
  const url = await readFileAsDataUrl(blob);
  return url.slice(url.indexOf(',') + 1);
}

/** Kopierar mottagarna så att de kan klistras in i Till-fältet. Returnerar om det lyckades. */
async function copyRecipients(to: string[]): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(to.join(', '));
    return true;
  } catch {
    return false;
  }
}

export const canComposeNatively = hasNativePlugin;

/** iOS-appen: Apples mejlfönster med allt ifyllt. */
export async function composeNativeMail(req: MailRequest): Promise<MailOutcome> {
  const attachments = await Promise.all(
    req.files.map(async (f) => ({ name: f.name, mime: f.mime, data: await toBase64(f.blob) })),
  );
  try {
    const { result } = await SongListNative.composeMail({
      to: req.to,
      subject: req.subject,
      body: req.body,
      attachments,
    });
    if (result === 'failed') throw new Error('Mejlet kunde inte skickas.');
    return result === 'sent' ? 'sent' : result === 'saved' ? 'saved' : 'cancelled';
  } catch (e) {
    if ((e as { code?: string }).code !== 'NO_MAIL') throw e;
    // Inget konto i Mail: dela filerna via delningsmenyn (t.ex. till Gmail eller Outlook)
    void copyRecipients(req.to);
    const uris: string[] = [];
    for (const a of attachments) {
      const { uri } = await Filesystem.writeFile({ path: a.name, data: a.data, directory: Directory.Cache });
      uris.push(uri);
    }
    await Share.share({ title: req.subject, text: req.body, files: uris });
    return 'shared';
  }
}

function asFiles(files: ExportFile[]): File[] {
  return files.map((f) => new File([f.blob], f.name, { type: f.mime }));
}

/** Sant om webbläsaren kan dela filer via systemets delningsmeny (t.ex. Safari på iPhone/iPad). */
export function canShareFiles(files: ExportFile[]): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: asFiles(files) });
}

/**
 * Webben: delar filerna via delningsmenyn. Måste anropas direkt från ett tryck, annars kan
 * Safari neka. Mottagarna kopieras samtidigt så att de kan klistras in i Mail.
 */
export async function shareFilesWeb(req: MailRequest): Promise<MailOutcome> {
  // Starta kopieringen utan att vänta, så att delningen sker inom samma tryck
  void copyRecipients(req.to);
  try {
    await navigator.share({ files: asFiles(req.files), title: req.subject, text: req.body });
    return 'shared';
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'cancelled';
    throw e;
  }
}

/** Öppnar ett nytt mejl med mottagare, ämne och text ifyllda (utan bilagor). */
export function openMailDraft(req: Omit<MailRequest, 'files'>): void {
  const query = new URLSearchParams({ subject: req.subject, body: req.body })
    .toString()
    // URLSearchParams kodar mellanslag som "+", vilket mejlprogram inte tolkar
    .replace(/\+/g, '%20');
  window.location.href = `mailto:${req.to.map(encodeURIComponent).join(',')}?${query}`;
}

/** Webben: laddar ner filerna och öppnar ett ifyllt mejl, så att filerna kan bifogas för hand. */
export async function downloadAndOpenMail(req: MailRequest): Promise<MailOutcome> {
  for (const f of req.files) await saveBinaryFile(f.name, f.blob, f.mime);
  openMailDraft(req);
  return 'downloaded';
}
