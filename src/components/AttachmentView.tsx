import { useEffect, useState } from 'react';
import type { SongAttachment } from '../lib/model';
import { loadPdfJs } from '../services/fileImport';

/** En sida att visa: en bild, eller en sida ur en PDF som ritats till en bild. */
export interface FilePage {
  src: string;
  width: number;
  height: number;
}

/**
 * Alla sidor i låtens filer (bilder och PDF:er) i tur och ordning. Sidorna kommer en i taget
 * medan PDF:erna ritas.
 */
export function useFilePages(files: SongAttachment[]): { pages: FilePage[]; status: string } {
  const [pages, setPages] = useState<FilePage[]>([]);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    const destroy: (() => void)[] = [];
    const found: FilePage[] = [];
    const add = (p: FilePage) => {
      if (cancelled) return;
      found.push(p);
      setPages([...found]);
    };
    setPages([]);
    setStatus(files.length ? 'Laddar…' : '');
    (async () => {
      let failed = '';
      for (const [i, a] of files.entries()) {
        const of = files.length > 1 ? ` (fil ${i + 1} av ${files.length})` : '';
        try {
          if (a.kind === 'image') {
            const { width, height } = await imageSize(a.dataUrl);
            add({ src: a.dataUrl, width, height });
            continue;
          }
          const pdfjs = await loadPdfJs();
          const data = new Uint8Array(await (await fetch(a.dataUrl)).arrayBuffer());
          const task = pdfjs.getDocument({ data });
          destroy.push(() => void task.destroy());
          const doc = await task.promise;
          // Rita i skarp upplösning; storleken på skärmen styrs av CSS
          const dpr = window.devicePixelRatio || 1;
          const target = Math.min(2400, Math.max(1200, Math.max(window.innerWidth, window.innerHeight) * dpr));
          for (let n = 1; n <= doc.numPages && !cancelled; n++) {
            setStatus(doc.numPages > 1 ? `Laddar sida ${n} av ${doc.numPages}${of}…` : `Laddar${of}…`);
            const page = await doc.getPage(n);
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: target / base.width });
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(viewport.width);
            canvas.height = Math.round(viewport.height);
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvas, canvasContext: ctx, viewport }).promise;
            const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
            if (!blob || cancelled) continue;
            const src = URL.createObjectURL(blob);
            urls.push(src);
            add({ src, width: canvas.width, height: canvas.height });
          }
        } catch {
          failed = `${a.name} kunde inte visas på den här enheten.`;
        }
      }
      if (!cancelled) setStatus(failed);
    })();
    return () => {
      cancelled = true;
      destroy.forEach((d) => d());
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [files]);

  return { pages, status };
}

function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Visar en låt som är sparad som fil (t.ex. noter): sidorna under varandra, eller en sida i
 * taget som bläddras i sidled. zoom = 1 fyller låtytans bredd (under varandra) eller visar hela
 * sidan (i sidled).
 */
export function AttachmentView(props: {
  pages: FilePage[];
  status: string;
  zoom: number;
  /** En sida i taget, i sidled */
  paged?: { page: number; drag: number; dragging: boolean; viewHeight: number };
}) {
  const { pages, status, zoom, paged } = props;
  if (!paged) {
    return (
      <div className="attachment-view">
        {status && <p className="muted small-text">{status}</p>}
        <div className="attachment-pages" style={{ width: `${Math.round(zoom * 100)}%` }}>
          {pages.map((p, i) => (
            <img key={i} className="attachment-page" src={p.src} alt="" />
          ))}
        </div>
      </div>
    );
  }
  const { page, drag, dragging, viewHeight } = paged;
  return (
    <div className="file-pager">
      {status && (!pages.length || !status.startsWith('Laddar')) && <p className="muted small-text">{status}</p>}
      <div
        className="file-strip"
        style={{
          transform: `translateX(calc(${-page * 100}% + ${drag}px))`,
          transition: dragging ? 'none' : undefined,
        }}
      >
        {pages.map((p, i) => (
          <div key={i} className="file-slide" aria-hidden={i !== page}>
            {/* Bara sidorna intill visas, så att många sidor inte tar minne i onödan */}
            {Math.abs(i - page) <= 2 && (
              <img
                className="attachment-page"
                src={p.src}
                alt={`Sida ${i + 1}`}
                draggable={false}
                style={{ width: `min(100%, ${Math.round((Math.max(200, viewHeight) * p.width * zoom) / p.height)}px)` }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
