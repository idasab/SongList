import { useLayoutEffect, useState, type RefObject } from 'react';
import {
  INK_COLORS,
  NOTE_COLORS,
  anchorToPx,
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
      const base = el.getBoundingClientRect().top;
      const tops: number[] = [];
      el.querySelectorAll<HTMLElement>('[data-ln]').forEach((n) => {
        tops[Number(n.dataset.ln)] = n.getBoundingClientRect().top - base;
      });
      for (let i = 0; i < tops.length; i++) if (tops[i] === undefined) tops[i] = i ? tops[i - 1] : 0;
      const fontPx = parseFloat(getComputedStyle(el).fontSize) || 16;
      setMetrics((prev) =>
        prev && prev.fontPx === fontPx && prev.tops.length === tops.length && prev.tops.every((t, i) => Math.abs(t - tops[i]) < 0.5)
          ? prev
          : { tops, fontPx },
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
  return (
    <div className={`annot-layer${interactive ? ' on' : ''}`} aria-hidden={!interactive}>
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
        const c = anchorToPx(metrics, n.anchor);
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
