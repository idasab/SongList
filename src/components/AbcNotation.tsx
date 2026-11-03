import { useEffect, useRef, useState } from 'react';
import { ABC_STAFF_WIDTH, ABC_WIDTH_EM, abcForDisplay, loadAbcjs } from '../lib/abc';

/** Färgen på en vald not */
const SELECTED = '#e0457b';

/**
 * Noter i ABC-format som notskrift. Bredden följer textstorleken (em), så att anteckningar ligger kvar.
 * Med onNoteClick går noterna att trycka på (start och slut i ABC-texten); selected visas markerad.
 */
export function AbcNotation({
  abc,
  transpose,
  swedish,
  ln,
  onNoteClick,
  selected,
}: {
  abc: string;
  transpose: number;
  swedish: boolean;
  ln: number;
  onNoteClick?: (start: number, end: number) => void;
  selected?: [number, number] | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const onClick = useRef(onNoteClick);
  onClick.current = onNoteClick;
  const clickable = !!onNoteClick;
  const [selStart, selEnd] = selected ?? [-1, -1];
  useEffect(() => {
    let cancelled = false;
    loadAbcjs()
      .then((lib) => {
        if (cancelled || !ref.current) return;
        const [tune] = lib.renderAbc(ref.current, abcForDisplay(abc), {
          responsive: 'resize',
          visualTranspose: transpose,
          // Svensk notation: H i ackordnamnen
          germanAlphabet: swedish,
          add_classes: true,
          foregroundColor: 'currentColor',
          staffwidth: ABC_STAFF_WIDTH,
          paddingtop: 0,
          paddingbottom: 0,
          paddingleft: 0,
          paddingright: 0,
          ...(clickable && {
            selectTypes: ['note'],
            selectionColor: SELECTED,
            clickListener: (el) => {
              const at = el as { startChar?: number; endChar?: number; pitches?: unknown[] };
              if (at.pitches?.length && at.startChar !== undefined && at.endChar !== undefined) {
                onClick.current?.(at.startChar, at.endChar);
              }
            },
          }),
        });
        // Den valda noten är markerad även efter att noterna ritats om
        if (selStart >= 0) (tune as unknown as { engraver?: { rangeHighlight(a: number, b: number): void } }).engraver?.rangeHighlight(selStart, selEnd);
        setError('');
      })
      .catch(() => !cancelled && setError('Noterna kunde inte visas'));
    return () => {
      cancelled = true;
    };
  }, [abc, transpose, swedish, clickable, selStart, selEnd]);
  // Får noterna inte plats trycks de ihop; anteckningarna följer med (data-em-width)
  return (
    <div className="abc-wrap" data-ln={ln} data-em-width={ABC_WIDTH_EM} style={{ width: `${ABC_WIDTH_EM}em` }}>
      <div className={`abc-block${clickable ? ' abc-editable' : ''}`} ref={ref} />
      {error && <div className="muted small-text">{error}</div>}
    </div>
  );
}
