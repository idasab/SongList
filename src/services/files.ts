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
