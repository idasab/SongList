// Skanning av papper med text och ackord. Allt sker på enheten:
// - iOS: Apples dokumentskanner + Vision (inbyggd textigenkänning)
// - Webb: Tesseract.js i webbläsaren

import { ocrToChordPro, type OcrLine, type OcrPage } from '../lib/ocrLayout';
import { canvasMeasure } from '../lib/textImport';
import { hasNativePlugin, SongListNative } from '../native/songlistNative';

export interface ScanResult {
  content: string;
  imageDataUrl?: string;
}

export type ProgressFn = (message: string, progress?: number) => void;

/** Gör om sidor med positionerad text (från OCR eller PDF) till ChordPro. */
export function pagesToChordPro(pages: OcrPage[]): string {
  return ocrToChordPro(pages, canvasMeasure('Arial')).normalize('NFC');
}

const toChordPro = pagesToChordPro;

export function canUseDocumentScanner(): boolean {
  return hasNativePlugin();
}

/** Öppnar iOS dokumentskanner. Returnerar null om användaren avbryter. */
export async function scanDocument(): Promise<ScanResult | null> {
  try {
    const res = await SongListNative.scanDocument();
    return { content: toChordPro(res.pages), imageDataUrl: res.imageDataUrl };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'CANCELLED') return null;
    throw e;
  }
}

/** Läser in en bild, skalar ner den och kör textigenkänning. */
export async function recognizeImageFile(file: File, onProgress?: ProgressFn): Promise<ScanResult> {
  onProgress?.('Förbereder bilden…');
  const canvas = await loadImageToCanvas(file, 2600);
  const imageDataUrl = canvas.toDataURL('image/jpeg', 0.8);

  const page = await recognizeCanvas(canvas, onProgress, imageDataUrl);
  return { content: toChordPro([page]), imageDataUrl };
}

/** Läser text från en uppritad bild (t.ex. en PDF-sida): Vision på iOS, Tesseract på webben. */
export async function recognizeCanvas(
  canvas: HTMLCanvasElement,
  onProgress?: ProgressFn,
  dataUrl?: string,
): Promise<OcrPage> {
  if (hasNativePlugin()) {
    onProgress?.('Läser text…');
    const { page } = await SongListNative.recognizeImage({ image: dataUrl ?? canvas.toDataURL('image/jpeg', 0.85) });
    return page;
  }
  return recognizeWithTesseract(canvas, onProgress);
}

export async function loadImageToCanvas(file: File, maxSize: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file).catch(async () => {
    // Äldre Safari: gå via <img>
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
  const w = 'naturalWidth' in bitmap ? bitmap.naturalWidth : bitmap.width;
  const h = 'naturalHeight' in bitmap ? bitmap.naturalHeight : bitmap.height;
  const scale = Math.min(1, maxSize / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const STATUS_SV: Record<string, string> = {
  'loading tesseract core': 'Laddar textigenkänning…',
  'initializing tesseract': 'Startar textigenkänning…',
  'loading language traineddata': 'Laddar språkdata…',
  'initializing api': 'Startar…',
  'recognizing text': 'Läser text…',
};

async function recognizeWithTesseract(canvas: HTMLCanvasElement, onProgress?: ProgressFn): Promise<OcrPage> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(['swe'], 1, {
    logger: (m: { status: string; progress: number }) => onProgress?.(STATUS_SV[m.status] ?? m.status, m.progress),
  });
  try {
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const W = canvas.width;
    const H = canvas.height;
    const lines: OcrLine[] = [];
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          const box = (b: { x0: number; y0: number; x1: number; y1: number }) => ({
            x: b.x0 / W,
            y: b.y0 / H,
            w: (b.x1 - b.x0) / W,
            h: (b.y1 - b.y0) / H,
          });
          lines.push({
            text: line.text.trim(),
            ...box(line.bbox),
            words: line.words
              .filter((w) => w.text.trim() && w.confidence > 20)
              .map((w) => ({ text: w.text.trim(), ...box(w.bbox) })),
          });
        }
      }
    }
    return { width: W, height: H, lines };
  } finally {
    await worker.terminate();
  }
}
