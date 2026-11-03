import { useEffect, useRef, useState } from 'react';
import { loadAbcjs } from '../lib/abc';

/** Notbildens bredd i em. Får den inte plats trycks den ihop; anteckningarna följer med (data-em-width). */
const WIDTH_EM = 36;

/** Noter i ABC-format som notskrift. Bredden följer textstorleken (em), så att anteckningar ligger kvar. */
export function AbcNotation({ abc, transpose, swedish, ln }: { abc: string; transpose: number; swedish: boolean; ln: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    loadAbcjs()
      .then((lib) => {
        if (cancelled || !ref.current) return;
        lib.renderAbc(ref.current, abc, {
          responsive: 'resize',
          visualTranspose: transpose,
          // Svensk notation: H i ackordnamnen
          germanAlphabet: swedish,
          add_classes: true,
          foregroundColor: 'currentColor',
          staffwidth: 740,
          paddingtop: 0,
          paddingbottom: 0,
          paddingleft: 0,
          paddingright: 0,
        });
        setError('');
      })
      .catch(() => !cancelled && setError('Noterna kunde inte visas'));
    return () => {
      cancelled = true;
    };
  }, [abc, transpose, swedish]);
  return (
    <div className="abc-wrap" data-ln={ln} data-em-width={WIDTH_EM} style={{ width: `${WIDTH_EM}em` }}>
      <div className="abc-block" ref={ref} />
      {error && <div className="muted small-text">{error}</div>}
    </div>
  );
}
