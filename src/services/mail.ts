// Skicka filer med e-post.
//
// - iOS-appen: Apples mejlfönster med mottagare, ämne, text och bifogade filer ifyllda.
//   Finns inget e-postkonto i Mail används delningsmenyn i stället.
// - Webben: en webbsida kan inte bifoga filer i ett mejl. Där delas filerna via systemets
//   delningsmeny (om webbläsaren stöder det), annars laddas de ner och ett mejl öppnas med
//   mottagare, ämne och text ifyllda så att filerna kan bifogas för hand.

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

export async function sendMail(req: MailRequest): Promise<MailOutcome> {
  if (hasNativePlugin()) {
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
      const uris: string[] = [];
      for (const a of attachments) {
        const { uri } = await Filesystem.writeFile({ path: a.name, data: a.data, directory: Directory.Cache });
        uris.push(uri);
      }
      await Share.share({ title: req.subject, text: req.body, files: uris });
      return 'shared';
    }
  }

  // Webben: delningsmenyn med filer om den finns (t.ex. Safari på iPad)
  const files = req.files.map((f) => new File([f.blob], f.name, { type: f.mime }));
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files })) {
    try {
      await navigator.share({ files, title: req.subject, text: req.body });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
      // Annars: fall tillbaka på nedladdning
    }
  }

  for (const f of req.files) await saveBinaryFile(f.name, f.blob, f.mime);
  const params = new URLSearchParams({ subject: req.subject, body: req.body });
  // URLSearchParams kodar mellanslag som "+", vilket mejlprogram inte tolkar
  const query = params.toString().replace(/\+/g, '%20');
  window.location.href = `mailto:${req.to.map(encodeURIComponent).join(',')}?${query}`;
  return 'downloaded';
}
