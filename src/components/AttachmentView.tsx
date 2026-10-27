import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
        // Bytt låt: sluta läsa in (och lämna inga dokument öppna)
        if (cancelled) break;
        const of = files.length > 1 ? ` (fil ${i + 1} av ${files.length})` : '';
        try {
          if (a.kind === 'image') {
            const { width, height } = await imageSize(a.dataUrl);
            add({ src: a.dataUrl, width, height });
            continue;
          }
          const pdfjs = await loadPdfJs();
          const data = new Uint8Array(await (await fetch(a.dataUrl)).arrayBuffer());
          if (cancelled) break;
          const task = pdfjs.getDocument({ data });
          destroy.push(() => void task.destroy());
          const doc = await task.promise;
          if (cancelled) {
            void task.destroy();
            break;
          }
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


/** Zoomning av sidan som visas: skala och förskjutning (px) från sidans övre vänstra hörn. */
export interface PageZoom {
  s: number;
  x: number;
  y: number;
}
export const NO_ZOOM: PageZoom = { s: 1, x: 0, y: 0 };
const MAX_ZOOM = 5;
const DOUBLE_TAP_MS = 300;

/** Inom gränserna: sidan täcker alltid sin egen yta, och nästan 1 räknas som ingen zoom. */
function clampZoom(z: PageZoom, w: number, h: number): PageZoom {
  const s = Math.min(MAX_ZOOM, z.s);
  if (s <= 1.02) return NO_ZOOM;
  return { s, x: Math.min(0, Math.max(w * (1 - s), z.x)), y: Math.min(0, Math.max(h * (1 - s), z.y)) };
}

/** Ny skala med punkten (cx, cy) på sidan kvar på samma ställe på skärmen. */
function zoomAround(z: PageZoom, s: number, cx: number, cy: number, w: number, h: number): PageZoom {
  const k = s / z.s;
  return clampZoom({ s, x: cx - (cx - z.x) * k, y: cy - (cy - z.y) * k }, w, h);
}

/**
 * Visar en låt som är sparad som fil (t.ex. noter): sidorna under varandra, eller en sida i
 * taget som bläddras i sidled. zoom = 1 fyller låtytans bredd (under varandra). I sidled visas
 * hela sidan, och man zoomar med två fingrar (eller dubbeltryck) och flyttar med ett.
 */
export function AttachmentView(props: {
  pages: FilePage[];
  status: string;
  zoom: number;
  /** En sida i taget, i sidled */
  paged?: PagedProps;
}) {
  const { pages, status, zoom, paged } = props;
  if (paged) return <PagedView pages={pages} status={status} {...paged} />;
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

interface PagedProps {
  page: number;
  drag: number;
  dragging: boolean;
  viewHeight: number;
  pageZoom: PageZoom;
  onZoom: (z: PageZoom) => void;
  /** En zoomning börjar: svepet för att byta sida ska släppas */
  onGestureStart: () => void;
  /** Zooma med knapparna: ett nytt id per tryck */
  zoomStep?: { id: number; factor: number };
}

function PagedView(props: PagedProps & { pages: FilePage[]; status: string }) {
  const { pages, status, page, drag, dragging, viewHeight, pageZoom, onZoom, onGestureStart, zoomStep } = props;
  const imgRef = useRef<HTMLImageElement>(null);
  const zoomRef = useRef(pageZoom);
  zoomRef.current = pageZoom;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  // Läget när gesten (eller dess senaste del) började; dist = 0 när man flyttar med ett finger
  const gesture = useRef<{ z: PageZoom; mid: { x: number; y: number }; dist: number; b: DOMRect } | null>(null);
  const moved = useRef(false);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const [active, setActive] = useState(false);

  // Sidans yta utan zoom (skärmkoordinater)
  const baseRect = (): DOMRect | null => {
    const r = imgRef.current?.getBoundingClientRect();
    if (!r) return null;
    const z = zoomRef.current;
    return new DOMRect(r.left - z.x, r.top - z.y, r.width / z.s, r.height / z.s);
  };

  const begin = () => {
    const b = baseRect();
    const pts = [...pointers.current.values()];
    if (!b || !pts.length) {
      gesture.current = null;
      return;
    }
    const two = pts.length > 1;
    gesture.current = {
      z: zoomRef.current,
      b,
      mid: two ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0],
      dist: two ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0,
    };
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse') return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) moved.current = false;
    // Två fingrar zoomar; med en zoomad sida flyttar ett finger den (i stället för att byta sida)
    if (pointers.current.size >= 2 || zoomRef.current.s > 1) {
      if (pointers.current.size >= 2) onGestureStart();
      begin();
      setActive(true);
      e.stopPropagation();
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    e.stopPropagation();
    const pts = [...pointers.current.values()];
    if (pts.length >= 2 && g.dist) {
      moved.current = true;
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const s = g.z.s * (Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / g.dist);
      // Punkten mellan fingrarna följer med när de flyttas
      const cx = (g.mid.x - g.b.left - g.z.x) / g.z.s;
      const cy = (g.mid.y - g.b.top - g.z.y) / g.z.s;
      onZoom(clampZoom({ s, x: mid.x - g.b.left - cx * s, y: mid.y - g.b.top - cy * s }, g.b.width, g.b.height));
    } else if (pts.length === 1 && !g.dist) {
      const dx = pts[0].x - g.mid.x;
      const dy = pts[0].y - g.mid.y;
      if (Math.hypot(dx, dy) > 4) moved.current = true;
      onZoom(clampZoom({ s: g.z.s, x: g.z.x + dx, y: g.z.y + dy }, g.b.width, g.b.height));
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (gesture.current) e.stopPropagation();
    if (pointers.current.size) {
      // Ett finger kvar: fortsätt flytta (om sidan är zoomad)
      if (zoomRef.current.s > 1) begin();
      else gesture.current = null;
      return;
    }
    gesture.current = null;
    setActive(false);
    if (e.type !== 'pointerup' || moved.current) return;
    // Dubbeltryck: zooma in där man trycker, eller ut igen
    const now = performance.now();
    const t = lastTap.current;
    if (now - t.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 30) {
      lastTap.current = { t: 0, x: 0, y: 0 };
      const b = baseRect();
      if (!b) return;
      const z = zoomRef.current;
      if (z.s > 1) onZoom(NO_ZOOM);
      else onZoom(zoomAround(z, 2.5, e.clientX - b.left, e.clientY - b.top, b.width, b.height));
    } else {
      lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    }
  };

  // Knapparna: zooma kring mitten av det som syns av sidan (bara när det trycks på dem)
  const stepId = zoomStep?.id;
  useEffect(() => {
    if (!zoomStep) return;
    const b = baseRect();
    if (!b) return;
    const visible = Math.min(b.height, viewHeight);
    onZoom(zoomAround(zoomRef.current, zoomRef.current.s * zoomStep.factor, b.width / 2, visible / 2, b.width, b.height));
  }, [stepId]);

  return (
    <div
      className="file-pager"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      // Efter att ha flyttat eller zoomat ska trycket inte visa/dölja kontrollerna
      onClickCapture={(e) => {
        if (moved.current) e.stopPropagation();
      }}
    >
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
                ref={i === page ? imgRef : undefined}
                className="attachment-page"
                src={p.src}
                alt={`Sida ${i + 1}`}
                draggable={false}
                style={{
                  width: `min(100%, ${Math.round((Math.max(200, viewHeight) * p.width) / p.height)}px)`,
                  ...(i === page && pageZoom.s > 1
                    ? { transform: `translate(${pageZoom.x}px, ${pageZoom.y}px) scale(${pageZoom.s})` }
                    : {}),
                  transformOrigin: '0 0',
                  transition: active ? 'none' : 'transform 0.2s ease-out',
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
