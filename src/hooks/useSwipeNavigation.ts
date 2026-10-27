// Stor swipe åt vänster/höger för att byta låt (t.ex. i en setlista).
//
// Vertikal scroll sköts av webbläsaren som vanligt (touch-action: pan-y). Först när rörelsen
// tydligt går i sidled följer innehållet fingret, och om swipen är tillräckligt stor eller snabb
// byter vi låt. Swipar som börjar vid skärmkanten ignoreras – där har Safari sin bakåt-gest.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

const EDGE = 24; // px från skärmkanten där swipar ignoreras
const START = 12; // px innan vi avgör om rörelsen är i sidled
const MIN_FRACTION = 0.3; // andel av bredden som räcker för att byta låt
const FLICK_PX = 80; // eller en snabb svepning av minst så här många px …
const FLICK_MS = 300; // … på högst så här lång tid

export function useSwipeNavigation(opts: {
  enabled: boolean;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const [animating, setAnimating] = useState(false);
  const g = useRef<{ id: number; x: number; y: number; t: number; horizontal: boolean | null } | null>(null);
  const endedAt = useRef(0);

  const reset = () => {
    g.current = null;
    setAnimating(true);
    setOffset(0);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (!opts.enabled || e.pointerType === 'mouse' || g.current) return;
    if (e.clientX < EDGE || e.clientX > window.innerWidth - EDGE) return;
    g.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), horizontal: null };
    setAnimating(false);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const s = g.current;
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (s.horizontal === null) {
      if (Math.hypot(dx, dy) < START) return;
      s.horizontal = Math.abs(dx) > Math.abs(dy) * 1.5;
      if (!s.horizontal) {
        g.current = null; // vanlig scroll
        return;
      }
    }
    if (!s.horizontal) return;
    // Motstånd åt det håll där det inte finns någon låt
    const blocked = (dx > 0 && !opts.canPrev) || (dx < 0 && !opts.canNext);
    setOffset(blocked ? dx * 0.2 : dx);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const s = g.current;
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x;
    const dt = performance.now() - s.t;
    const width = (e.currentTarget as HTMLElement).clientWidth || window.innerWidth;
    const far = Math.abs(dx) >= width * MIN_FRACTION;
    const flick = Math.abs(dx) >= FLICK_PX && dt <= FLICK_MS;
    const wasHorizontal = s.horizontal === true;
    reset();
    if (wasHorizontal) endedAt.current = performance.now();
    if (!wasHorizontal || !(far || flick)) return;
    if (dx < 0 && opts.canNext) opts.onNext();
    else if (dx > 0 && opts.canPrev) opts.onPrev();
  };

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: reset },
    /** Hur långt fingret dragit i sidled just nu (för innehåll som flyttas på annat sätt) */
    offset,
    /** Stil för innehållet som följer fingret */
    style: offset
      ? { transform: `translateX(${offset}px)`, opacity: Math.max(0.5, 1 - Math.abs(offset) / 600) }
      : animating
        ? { transition: 'transform 0.2s ease-out, opacity 0.2s ease-out' }
        : undefined,
    /** Sant precis efter en swipe i sidled, så att den inte räknas som ett tryck */
    justSwiped: () => performance.now() - endedAt.current < 400,
  };
}
