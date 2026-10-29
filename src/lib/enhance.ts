/**
 * Skarpare bild av en fil (t.ex. ett foto av noter): som en skanner. Papperet blir vitt även
 * där ljuset är ojämnt, noterna blir svarta och kanterna skärps. Resultatet är i gråskala.
 */

/** Hur mörkt (andel av papperets ljushet) som blir helt svart, och hur ljust som blir vitt */
const BLACK = 0.35;
const WHITE = 0.88;
/** Skärpning: hur mycket skillnaden mot grannpixlarna förstärks */
const SHARPEN = 0.8;

/**
 * Gör om RGBA-pixlarna (som i ImageData) på plats.
 */
export function enhancePixels(data: Uint8ClampedArray, w: number, h: number) {
  const n = w * h;
  const gray = new Uint8ClampedArray(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }

  // Papperets ljushet i rutor: den ljusaste pixeln i varje ruta, spridd till grannrutorna (så
  // att en ruta som är helt täckt av t.ex. en tjock balk får papperet runt omkring) och utjämnad
  const block = Math.max(8, Math.round(Math.max(w, h) / 96));
  const gw = Math.ceil(w / block);
  const gh = Math.ceil(h / block);
  let grid: Float32Array = new Float32Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const row = ((y / block) | 0) * gw;
    for (let x = 0; x < w; x++) {
      const g = gray[y * w + x];
      const k = row + ((x / block) | 0);
      if (g > grid[k]) grid[k] = g;
    }
  }
  grid = neighbours(grid, gw, gh, Math.max);
  grid = neighbours(grid, gw, gh, mean);
  grid = neighbours(grid, gw, gh, mean);

  // Varje pixel i förhållande till papperet bakom den (papperet blir 255)
  for (let y = 0; y < h; y++) {
    const gy = Math.min(gh - 1, Math.max(0, y / block - 0.5));
    const y0 = gy | 0;
    const y1 = Math.min(gh - 1, y0 + 1);
    const fy = gy - y0;
    for (let x = 0; x < w; x++) {
      const gx = Math.min(gw - 1, Math.max(0, x / block - 0.5));
      const x0 = gx | 0;
      const x1 = Math.min(gw - 1, x0 + 1);
      const fx = gx - x0;
      const top = grid[y0 * gw + x0] * (1 - fx) + grid[y0 * gw + x1] * fx;
      const bottom = grid[y1 * gw + x0] * (1 - fx) + grid[y1 * gw + x1] * fx;
      const bg = top * (1 - fy) + bottom * fy;
      const i = y * w + x;
      gray[i] = (gray[i] / Math.max(bg, 1)) * 255;
    }
  }

  // Skärpa (mot medelvärdet av de 3×3 närmaste) och kontrast: mörkt blir svart, ljust vitt
  const lo = BLACK * 255;
  const scale = 255 / ((WHITE - BLACK) * 255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = gray[i];
      if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
        const m =
          (gray[i - w - 1] + gray[i - w] + gray[i - w + 1] + gray[i - 1] + v + gray[i + 1] + gray[i + w - 1] + gray[i + w] + gray[i + w + 1]) / 9;
        v += SHARPEN * (v - m);
      }
      const out = (v - lo) * scale;
      const p = i * 4;
      data[p] = data[p + 1] = data[p + 2] = out;
      data[p + 3] = 255;
    }
  }
}

function mean(...v: number[]) {
  let s = 0;
  for (const x of v) s += x;
  return s / v.length;
}

/** Varje ruta får f av sig själv och sina (upp till 8) grannar. */
function neighbours(grid: Float32Array, gw: number, gh: number, f: (...v: number[]) => number): Float32Array {
  const out = new Float32Array(grid.length);
  const v: number[] = [];
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      v.length = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) v.push(grid[yy * gw + xx]);
        }
      }
      out[y * gw + x] = f(...v);
    }
  }
  return out;
}

/** Gör om det som ritats på canvasen. */
export function enhanceCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  enhancePixels(img.data, canvas.width, canvas.height);
  ctx.putImageData(img, 0, 0);
}

/** Längsta sidan på en bild som görs skarpare (större foton skalas ner, så att det går fort) */
const MAX_SIDE = 3000;

/** En bild (data-URL) som skarpare bild på en canvas. */
export async function enhancedImageCanvas(src: string): Promise<HTMLCanvasElement> {
  const im = new Image();
  im.src = src;
  await im.decode();
  const k = Math.min(1, MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(im.naturalWidth * k));
  canvas.height = Math.max(1, Math.round(im.naturalHeight * k));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(im, 0, 0, canvas.width, canvas.height);
  enhanceCanvas(canvas);
  return canvas;
}
