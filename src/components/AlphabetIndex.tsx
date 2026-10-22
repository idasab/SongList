import { useEffect, useRef, useState } from 'react';

export const ALPHABET = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZÅÄÖ'];

/**
 * Alfabetsregister längs högerkanten. Man trycker eller drar fingret över bokstäverna;
 * onPick anropas med bokstaven under fingret. Bokstäver utan låtar visas nedtonade.
 */
export function AlphabetIndex({ available, onPick }: { available: Set<string>; onPick: (letter: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const [compact, setCompact] = useState(false);
  const last = useRef<string | null>(null);

  // Får inte alla bokstäver plats visas varannan, med en punkt emellan
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setCompact(el.clientHeight / ALPHABET.length < 13);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pickAt = (clientY: number) => {
    const el = ref.current;
    if (!el) return;
    // Bokstaven närmast fingret
    let best = 0;
    let bestDist = Infinity;
    Array.from(el.children).forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const d = Math.abs(clientY - (r.top + r.height / 2));
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    const letter = ALPHABET[best];
    setActive(letter);
    if (letter !== last.current) {
      last.current = letter;
      onPick(letter);
    }
  };

  const end = () => {
    setActive(null);
    last.current = null;
  };

  return (
    <>
      <div
        ref={ref}
        className="alpha-index"
        role="navigation"
        aria-label="Hoppa till bokstav"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          pickAt(e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) pickAt(e.clientY);
        }}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {ALPHABET.map((l, i) => (
          <span key={l} className={available.has(l) ? '' : 'off'}>
            {compact && i % 2 === 1 ? '•' : l}
          </span>
        ))}
      </div>
      {active && <div className="alpha-bubble">{active}</div>}
    </>
  );
}
