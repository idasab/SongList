// Import av filer: ChordPro, text, PDF, bilder och zip-filer som innehåller sådana.
//
// - ChordPro och text läses som text (UTF-8 eller Windows-1252).
// - PDF med riktig text: texten läses med sina positioner och ackorden placeras efter var de
//   står på sidan, med samma logik som vid skanning.
// - PDF utan text (inskannade papper) och bilder: textigenkänning på enheten.
// - Zip: packas upp och varje fil hanteras enligt ovan. Mappar och systemfiler hoppas över.

import type { OcrLine, OcrPage, OcrWord } from '../lib/ocrLayout';
import { decodeText, isChordProFileName } from '../lib/textImport';
import { pagesToChordPro, recognizeCanvas, recognizeImageFile, type ProgressFn } from './ocr';

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
}

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
export async function expandFiles(files: File[], onProgress?: ProgressFn): Promise<ExpandResult> {
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
      const entries = unzipSync(new Uint8Array(await f.arrayBuffer()));
      const names = Object.keys(entries).filter((n) => !isJunk(n)).sort((a, b) => a.localeCompare(b, 'sv', { numeric: true }));
      for (const n of names) {
        if (fileType(n) === 'zip') {
          result.skipped.push({ name: n, reason: 'zip-fil inuti zip-fil' });
          continue;
        }
        queue.push(new File([entries[n]], baseName(n)));
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
      } else if (type === 'pdf') {
        progress('Läser PDF…');
        result.items.push(await readPdf(f, progress));
      } else if (type === 'image') {
        progress('Läser bild…');
        const res = await recognizeImageFile(f, progress);
        if (!res.content.trim()) throw new Error('hittade ingen text i bilden');
        result.items.push({ fileName: f.name, raw: res.content, kind: 'chordpro', origin: 'image', imageDataUrl: res.imageDataUrl });
      } else {
        result.skipped.push({ name: f.name, reason: 'okänd filtyp' });
      }
    } catch (e) {
      result.skipped.push({ name: f.name, reason: e instanceof Error ? e.message : 'kunde inte läsas' });
    }
  }
  return result;
}

// --- PDF ---

type PdfJs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
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
