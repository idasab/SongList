// Spara och dela filer: nedladdning på webben, delningsmenyn på iOS.

import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNative } from '../native/songlistNative';

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'namnlös';
}

export async function saveTextFile(fileName: string, text: string, mime = 'text/plain'): Promise<void> {
  if (isNative) {
    const { uri } = await Filesystem.writeFile({
      path: fileName,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({ title: fileName, files: [uri] });
    return;
  }
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Sparar en binär fil (t.ex. PDF): nedladdning på webben, delningsmenyn på iOS. */
export async function saveBinaryFile(fileName: string, blob: Blob, mime: string): Promise<void> {
  if (isNative) {
    const dataUrl = await readFileAsDataUrl(blob);
    const { uri } = await Filesystem.writeFile({
      path: fileName,
      data: dataUrl.slice(dataUrl.indexOf(',') + 1),
      directory: Directory.Cache,
    });
    await Share.share({ title: fileName, files: [uri] });
    return;
  }
  const url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export interface FileToSave {
  name: string;
  mime: string;
  blob: Blob;
}

/** Sparar eller delar flera filer: delningsmenyn med alla filerna på iOS, en nedladdning per fil på webben. */
export async function saveFiles(files: FileToSave[]): Promise<void> {
  if (isNative) {
    const uris: string[] = [];
    for (const f of files) {
      const dataUrl = await readFileAsDataUrl(f.blob);
      const { uri } = await Filesystem.writeFile({
        path: f.name,
        data: dataUrl.slice(dataUrl.indexOf(',') + 1),
        directory: Directory.Cache,
      });
      uris.push(uri);
    }
    await Share.share({ title: files.length === 1 ? files[0].name : `${files.length} filer`, files: uris });
    return;
  }
  for (const f of files) {
    await saveBinaryFile(f.name, f.blob, f.mime);
    // Webbläsaren hinner starta varje nedladdning
    await new Promise((r) => setTimeout(r, 250));
  }
}

function asFiles(files: FileToSave[]): File[] {
  return files.map((f) => new File([f.blob], f.name, { type: f.mime }));
}

/** Sant om webbläsaren kan dela filerna via systemets delningsmeny (t.ex. Safari på iPhone/iPad). */
export function canShareFiles(files: FileToSave[]): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: asFiles(files) });
}

/**
 * Webben: delar filerna via delningsmenyn. Måste anropas direkt från ett tryck, annars kan
 * Safari neka. Falskt om delningen avbröts.
 */
export async function shareFilesInBrowser(files: FileToSave[], extra: { title?: string; text?: string } = {}): Promise<boolean> {
  try {
    await navigator.share({ files: asFiles(files), ...extra });
    return true;
  } catch (e) {
    if ((e as Error).name === 'AbortError') return false;
    throw e;
  }
}

/** Öppnar filväljaren och returnerar valda filer. */
export function pickFiles(options: { accept?: string; multiple?: boolean; capture?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    // På iOS gråas filer med okända ändelser (.cho, .chopro) ut om accept anges.
    if (options.accept && !isNative) input.accept = options.accept;
    if (options.accept?.startsWith('image') && isNative) input.accept = 'image/*';
    if (options.multiple) input.multiple = true;
    if (options.capture) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(input.files ? Array.from(input.files) : []);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
