// Import av filer: ChordPro, text, PDF, bilder och zip-filer som innehåller sådana.
//
// - ChordPro och text läses som text (UTF-8 eller Windows-1252).
// - PDF med riktig text: texten läses med sina positioner och ackorden placeras efter var de
//   står på sidan, med samma logik som vid skanning.
// - PDF utan text (inskannade papper) och bilder: textigenkänning på enheten.
// - Zip: packas upp och varje fil hanteras enligt ovan. Mappar och systemfiler hoppas över.

import type { SongAttachment } from '../lib/model';
import type { OcrLine, OcrPage, OcrWord } from '../lib/ocrLayout';
import { decodeText, isChordProFileName, titleFromFileName } from '../lib/textImport';
import { zipNameMap } from '../lib/zipNames';
import { readFileAsDataUrl } from './files';
import { loadImageToCanvas, pagesToChordPro, recognizeCanvas, recognizeImageFile, type ProgressFn } from './ocr';

export interface ImportCandidate {
  fileName: string;
  /** Texten (ChordPro eller text med ackord ovanför) */
  raw: string;
  /** Satt när innehållet redan är ChordPro, t.ex. efter PDF-läsning eller skanning */
  kind?: 'chordpro' | 'text';
  /** Var innehållet kom ifrån, om det tolkats och bör granskas */
  origin?: 'pdf' | 'image';
  /** Bild av originalet att visa som referens i editorn */
  imageDataUrl?: string;
  /** Originalfilen (PDF eller bild) */
  original?: SongAttachment;
  /** Liten bild av filen för förhandsvisning i importlistan */
  previewDataUrl?: string;
  /** Visa som text och ackord, eller som originalfil */
  display?: 'chordpro' | 'file';
  /** Sant om innehållet tolkats; annars bara en titel */
  interpreted?: boolean;
}

export interface ExpandOptions {
  /** Behåll PDF:er och bilder som filer i stället för att tolka dem (t.ex. noter) */
  keepOriginals?: boolean;
}

/** Största fil som sparas som original med låten */
const MAX_ORIGINAL_BYTES = 25_000_000;

export interface ExpandResult {
  items: ImportCandidate[];
  /** Filer som inte kunde läsas, med orsak */
  skipped: { name: string; reason: string }[];
}

const TEXT_EXT = /\.(txt|text)$/i;
const PDF_EXT = /\.pdf$/i;
const ZIP_EXT = /\.zip$/i;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i;

/** Filtypen utifrån namn (och MIME-typ som reserv). */
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

function mimeFromName(name: string): string {
  return MIME_BY_EXT[/\.([^.]+)$/.exec(name)?.[1].toLowerCase() ?? ''] ?? '';
}

function fileType(name: string, mime = ''): 'chordpro' | 'text' | 'pdf' | 'image' | 'zip' | null {
  if (isChordProFileName(name)) return 'chordpro';
  if (TEXT_EXT.test(name) || mime === 'text/plain') return 'text';
  if (PDF_EXT.test(name) || mime === 'application/pdf') return 'pdf';
  if (IMAGE_EXT.test(name) || mime.startsWith('image/')) return 'image';
  if (ZIP_EXT.test(name) || mime === 'application/zip' || mime === 'application/x-zip-compressed') return 'zip';
  return null;
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

/** Systemfiler och mappar i zip-filer som ska hoppas över. */
function isJunk(path: string): boolean {
  const name = baseName(path);
  return path.endsWith('/') || path.startsWith('__MACOSX/') || path.includes('/__MACOSX/') || name.startsWith('.') || name === 'Thumbs.db';
}

/** Gör om valda filer (även zip) till kandidater för import. */
export async function expandFiles(
  files: File[],
  onProgress?: ProgressFn,
  options: ExpandOptions = {},
): Promise<ExpandResult> {
  const result: ExpandResult = { items: [], skipped: [] };

  // Packa upp zip-filer först, så att förloppet kan visa rätt antal
  const queue: File[] = [];
  for (const f of files) {
    if (fileType(f.name, f.type) !== 'zip') {
      queue.push(f);
      continue;
    }
    try {
      onProgress?.(`Packar upp ${f.name}…`);
      const { unzipSync } = await import('fflate');
      const bytes = new Uint8Array(await f.arrayBuffer());
      const entries = unzipSync(bytes);
      const realNames = zipNameMap(bytes);
      const names = Object.keys(entries).filter((n) => !isJunk(n)).sort((a, b) => a.localeCompare(b, 'sv', { numeric: true }));
      for (const n of names) {
        if (fileType(n) === 'zip') {
          result.skipped.push({ name: n, reason: 'zip-fil inuti zip-fil' });
          continue;
        }
        const name = baseName(realNames.get(n) ?? n);
        // Filer i en zip-fil saknar filtyp; ta den från filändelsen
        queue.push(new File([entries[n] as BlobPart], name, { type: mimeFromName(name) }));
      }
      if (!names.length) result.skipped.push({ name: f.name, reason: 'zip-filen är tom' });
    } catch {
      result.skipped.push({ name: f.name, reason: 'zip-filen kunde inte packas upp' });
    }
  }

  for (let i = 0; i < queue.length; i++) {
    const f = queue[i];
    const step = queue.length > 1 ? ` (${i + 1} av ${queue.length})` : '';
    const progress: ProgressFn = (message, p) => onProgress?.(`${f.name}${step}: ${message}`, p);
    const type = fileType(f.name, f.type);
    try {
      if (type === 'chordpro' || type === 'text') {
        onProgress?.(`Läser ${f.name}${step}…`);
        if (f.size > 2_000_000) throw new Error('filen är för stor');
        result.items.push({ fileName: f.name, raw: decodeText(await f.arrayBuffer()), kind: type === 'chordpro' ? 'chordpro' : undefined });
      } else if (type === 'pdf' || type === 'image') {
        if (f.size > MAX_ORIGINAL_BYTES) throw new Error('filen är för stor (högst 25 MB)');
        const original: SongAttachment = {
          name: f.name,
          mime: f.type || mimeFromName(f.name) || (type === 'pdf' ? 'application/pdf' : 'image/jpeg'),
          dataUrl: await readFileAsDataUrl(f),
          kind: type,
        };
        progress('Skapar förhandsbild…');
        const previewDataUrl = await makePreview(f, type).catch(() => undefined);
        const asFile: ImportCandidate = {
          fileName: f.name,
          raw: `{title: ${titleFromFileName(f.name)}}\n`,
          kind: 'chordpro',
          origin: type,
          original,
          previewDataUrl,
          display: 'file',
          interpreted: false,
        };
        if (options.keepOriginals) {
          result.items.push(asFile);
        } else {
          try {
            const interp = await interpretFile(f, type, progress);
            result.items.push({ ...asFile, ...interp, display: 'chordpro', interpreted: true });
          } catch {
            // Ingen text att tolka (t.ex. noter): behåll som fil
            result.items.push(asFile);
          }
        }
      } else {
        result.skipped.push({ name: f.name, reason: 'okänd filtyp' });
      }
    } catch (e) {
      result.skipped.push({ name: f.name, reason: e instanceof Error ? e.message : 'kunde inte läsas' });
    }
  }
  return result;
}

/** Tolkar en PDF eller bild till text och ackord (PDF-text eller textigenkänning). */
export async function interpretFile(
  f: File,
  type: 'pdf' | 'image',
  onProgress: ProgressFn,
): Promise<{ raw: string; imageDataUrl?: string }> {
  if (type === 'pdf') {
    onProgress('Läser PDF…');
    const res = await readPdf(f, onProgress);
    return { raw: res.raw, imageDataUrl: res.imageDataUrl };
  }
  onProgress('Läser bild…');
  const res = await recognizeImageFile(f, onProgress);
  if (!res.content.trim()) throw new Error('hittade ingen text i bilden');
  return { raw: res.content, imageDataUrl: res.imageDataUrl };
}

/** Gör om en sparad originalfil till en File igen (t.ex. för att tolka den i efterhand). */
export async function attachmentToFile(a: SongAttachment): Promise<File> {
  const blob = await (await fetch(a.dataUrl)).blob();
  return new File([blob], a.name, { type: a.mime });
}

/** Liten bild av filen (bilden eller PDF:ens första sida). */
async function makePreview(f: File, type: 'pdf' | 'image'): Promise<string> {
  if (type === 'image') return (await loadImageToCanvas(f, 700)).toDataURL('image/jpeg', 0.75);
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 700 / Math.max(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.75);
  } finally {
    void task.destroy();
  }
}

// --- PDF ---

type PdfJs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfJs> | null = null;

export function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
    ([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    },
  );
  return pdfjsPromise;
}

/** Läser en PDF. Riktig text används i första hand, annars textigenkänning på sidorna. */
async function readPdf(file: File, onProgress: ProgressFn): Promise<ImportCandidate> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const pages: OcrPage[] = [];
    let chars = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress(`läser sida ${n} av ${doc.numPages}…`);
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const lines: OcrLine[] = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        // Textens position i sidans koordinater, origo uppe till vänster
        const [, , , , x, baseline] = pdfjs.Util.transform(viewport.transform, item.transform);
        const h = item.height || Math.hypot(item.transform[2], item.transform[3]) || 10;
        const top = baseline - h;
        const width = item.width || h * 0.5 * item.str.length;
        const words: OcrWord[] = [];
        const re = /\S+/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(item.str))) {
          words.push({
            text: m[0],
            x: (x + (width * m.index) / item.str.length) / viewport.width,
            y: top / viewport.height,
            w: (width * m[0].length) / item.str.length / viewport.width,
            h: h / viewport.height,
          });
        }
        chars += item.str.trim().length;
        lines.push({ text: item.str, x: x / viewport.width, y: top / viewport.height, w: width / viewport.width, h: h / viewport.height, words });
      }
      pages.push({ width: viewport.width, height: viewport.height, lines });
    }

    if (chars >= 20) {
      return { fileName: file.name, raw: pagesToChordPro(pages), kind: 'chordpro', origin: 'pdf' };
    }

    // Ingen text i PDF:en (inskannat papper): rita upp sidorna och läs texten med OCR
    const scanned: OcrPage[] = [];
    let preview: string | undefined;
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress(`skannar sida ${n} av ${doc.numPages}…`);
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, 2400 / Math.max(base.width, base.height)) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      if (n === 1) preview = dataUrl;
      scanned.push(await recognizeCanvas(canvas, onProgress, dataUrl));
    }
    const raw = pagesToChordPro(scanned);
    if (!raw.trim()) throw new Error('hittade ingen text i PDF:en');
    return { fileName: file.name, raw, kind: 'chordpro', origin: 'pdf', imageDataUrl: preview };
  } finally {
    void task.destroy();
  }
}
