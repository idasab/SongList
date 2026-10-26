import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  INK_COLORS,
  NOTE_COLORS,
  anchorToPx,
  clampNoteCenter,
  smoothPath,
  strokeToPx,
  type Annotations,
  type InkColor,
  type LineMetrics,
} from '../lib/annotations';

/** Mäter var varje rad (data-ln) ligger i låten. Mäts om när låten ändrar storlek. */
export function useLineMetrics(ref: RefObject<HTMLDivElement | null>, deps: unknown[]): LineMetrics | null {
  const [metrics, setMetrics] = useState<LineMetrics | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      const tops: number[] = [];
      const lefts: number[] = [];
      // Spalter: radens spalt räknas fram från var raden börjar
      const body = el.querySelector<HTMLElement>('.song-body.two-col');
      const bodyBox = body?.getBoundingClientRect();
      const gap = body ? parseFloat(getComputedStyle(body).columnGap) || 0 : 0;
      const step = body && bodyBox ? (bodyBox.width + gap) / 2 : 0;
      el.querySelectorAll<HTMLElement>('[data-ln]').forEach((n) => {
        const r = n.getBoundingClientRect();
        const i = Number(n.dataset.ln);
        tops[i] = r.top - box.top;
        lefts[i] = step && bodyBox ? (bodyBox.left - box.left) + Math.floor((r.left - bodyBox.left + 1) / step) * step : 0;
      });
      for (let i = 0; i < tops.length; i++) {
        if (tops[i] === undefined) tops[i] = i ? tops[i - 1] : 0;
        if (lefts[i] === undefined) lefts[i] = i ? lefts[i - 1] : 0;
      }
      const fontPx = parseFloat(getComputedStyle(el).fontSize) || 16;
      const same = (a: number[] | undefined, b: number[]) => !!a && a.length === b.length && a.every((t, i) => Math.abs(t - b[i]) < 0.5);
      setMetrics((prev) =>
        prev && prev.fontPx === fontPx && same(prev.tops, tops) && same(prev.lefts ?? tops.map(() => 0), lefts)
          ? prev
          : { tops, fontPx, ...(step ? { lefts } : {}) },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, deps);
  return metrics;
}

export interface LiveStroke {
  points: number[];
  color: InkColor;
  width: number;
}

export function AnnotationLayer({
  annotations,
  metrics,
  live,
  interactive,
  selectedId,
  editingId,
  onTextChange,
  onTextDone,
}: {
  annotations: Annotations;
  metrics: LineMetrics;
  live: LiveStroke | null;
  interactive: boolean;
  selectedId: string | null;
  editingId: string | null;
  onTextChange: (id: string, text: string) => void;
  onTextDone: (id: string) => void;
}) {
  const fp = metrics.fontPx;
  // Låtens bredd: lappar hålls inom den
  const layerRef = useRef<HTMLDivElement>(null);
  const [areaWidth, setAreaWidth] = useState(0);
  useLayoutEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const update = () => setAreaWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={layerRef} className={`annot-layer${interactive ? ' on' : ''}`} aria-hidden={!interactive}>
      <svg className="annot-svg">
        {annotations.strokes.map((s) => (
          <path
            key={s.id}
            d={smoothPath(strokeToPx(metrics, s))}
            stroke={INK_COLORS[s.color]}
            strokeWidth={s.width * fp}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {live && live.points.length >= 2 && (
          <path
            d={smoothPath(live.points)}
            stroke={INK_COLORS[live.color]}
            strokeWidth={live.width * fp}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
      {annotations.notes.map((n) => {
        const c = clampNoteCenter(anchorToPx(metrics, n.anchor), n.w * fp, n.h * fp, areaWidth);
        const selected = interactive && selectedId === n.id;
        const editing = interactive && editingId === n.id;
        return (
          <div
            key={n.id}
            className={`note${selected ? ' selected' : ''}`}
            data-note-id={n.id}
            style={{
              left: c.x,
              top: c.y,
              width: `${n.w}em`,
              height: `${n.h}em`,
              transform: `translate(-50%, -50%) rotate(${n.rotation}deg)`,
              background: NOTE_COLORS[n.color],
            }}
          >
            {editing ? (
              <textarea
                className="note-text"
                style={{ fontSize: `${n.fontSize}em` }}
                value={n.text}
                autoFocus
                placeholder="Skriv här…"
                onChange={(e) => onTextChange(n.id, e.target.value)}
                onBlur={() => onTextDone(n.id)}
              />
            ) : (
              <div className="note-text" style={{ fontSize: `${n.fontSize}em` }}>
                {n.text || (selected ? <span className="note-hint">Tryck igen för att skriva</span> : null)}
              </div>
            )}
            {selected && !editing && (
              <>
                <span className="note-handle rotate" data-handle="rotate" aria-label="Snurra" />
                <span className="note-handle resize" data-handle="resize" aria-label="Ändra storlek" />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
