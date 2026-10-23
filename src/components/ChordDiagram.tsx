import { useEffect, useState, type ReactElement } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getFrettedShapes, getPianoChord, type FrettedShapes, type FretPosition, type Instrument } from '../lib/chordShapes';
import { useStore } from '../store/useStore';
import { Sheet } from './ui';

const INSTRUMENT_NAMES: Record<Instrument, string> = {
  guitar: 'Gitarr',
  ukulele: 'Ukulele',
  piano: 'Piano',
};

export function FrettedSvg({ pos, strings, scale = 1 }: { pos: FretPosition; strings: number; scale?: number }) {
  const frets = 4;
  const sp = 12 * scale; // avstånd mellan strängar
  const fh = 15 * scale; // bandhöjd
  const left = 14 * scale;
  const top = 16 * scale;
  const width = left + sp * (strings - 1) + 12 * scale;
  const height = top + fh * frets + 6 * scale;
  const r = 4.6 * scale;
  const x = (s: number) => left + s * sp;
  const y = (f: number) => top + (f - 0.5) * fh;

  const barreEls = pos.barres.map((b) => {
    const idx = pos.frets.map((f, i) => (f === b ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 2) return null;
    const from = Math.min(...idx);
    const to = Math.max(...idx);
    return (
      <rect
        key={`b${b}`}
        x={x(from) - r}
        y={y(b) - r}
        width={x(to) - x(from) + 2 * r}
        height={2 * r}
        rx={r}
        fill="currentColor"
      />
    );
  });

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img">
      {/* Sadel eller bandnummer */}
      {pos.baseFret <= 1 ? (
        <rect x={x(0)} y={top - 3 * scale} width={x(strings - 1) - x(0)} height={3 * scale} fill="currentColor" />
      ) : (
        <text x={2} y={y(1) + 4 * scale} fontSize={9 * scale} fill="currentColor">
          {pos.baseFret}
        </text>
      )}
      {Array.from({ length: frets + 1 }, (_, i) => (
        <line key={`f${i}`} x1={x(0)} x2={x(strings - 1)} y1={top + i * fh} y2={top + i * fh} stroke="currentColor" strokeOpacity={0.5} strokeWidth={1} />
      ))}
      {Array.from({ length: strings }, (_, i) => (
        <line key={`s${i}`} x1={x(i)} x2={x(i)} y1={top} y2={top + frets * fh} stroke="currentColor" strokeOpacity={0.7} strokeWidth={1} />
      ))}
      {barreEls}
      {pos.frets.map((f, s) => {
        if (f === -1)
          return (
            <text key={`m${s}`} x={x(s)} y={top - 5 * scale} fontSize={9 * scale} textAnchor="middle" fill="currentColor">
              ×
            </text>
          );
        if (f === 0)
          return <circle key={`o${s}`} cx={x(s)} cy={top - 8 * scale} r={3 * scale} fill="none" stroke="currentColor" strokeWidth={1} />;
        return <circle key={`d${s}`} cx={x(s)} cy={y(f)} r={r} fill="currentColor" />;
      })}
    </svg>
  );
}

export function PianoSvg({ notes, bass, octaves, scale = 1 }: { notes: number[]; bass?: number; octaves: number; scale?: number }) {
  const whiteW = 11 * scale;
  const whiteH = 44 * scale;
  const blackW = 7 * scale;
  const blackH = 27 * scale;
  const whitePcs = [0, 2, 4, 5, 7, 9, 11];
  const blackPcs: [number, number][] = [
    [1, 0],
    [3, 1],
    [6, 3],
    [8, 4],
    [10, 5],
  ];
  const on = new Set(notes);
  const totalWhite = octaves * 7;
  const width = totalWhite * whiteW + 1;
  const keys: ReactElement[] = [];
  for (let o = 0; o < octaves; o++) {
    whitePcs.forEach((pc, i) => {
      const n = o * 12 + pc;
      const active = on.has(n);
      const isBass = bass === n;
      keys.push(
        <rect
          key={`w${n}`}
          x={(o * 7 + i) * whiteW + 0.5}
          y={0.5}
          width={whiteW}
          height={whiteH}
          fill={isBass ? 'var(--text-muted)' : active ? 'var(--chord)' : '#fff'}
          stroke="#555"
          strokeWidth={0.8}
        />,
      );
    });
  }
  for (let o = 0; o < octaves; o++) {
    blackPcs.forEach(([pc, after]) => {
      const n = o * 12 + pc;
      const active = on.has(n);
      const isBass = bass === n;
      keys.push(
        <rect
          key={`b${n}`}
          x={(o * 7 + after + 1) * whiteW - blackW / 2 + 0.5}
          y={0.5}
          width={blackW}
          height={blackH}
          fill={isBass ? 'var(--text-muted)' : active ? 'var(--chord)' : '#222'}
          stroke="#222"
          strokeWidth={0.8}
        />,
      );
    });
  }
  return (
    <svg width={width} height={whiteH + 1} viewBox={`0 0 ${width} ${whiteH + 1}`} role="img">
      {keys}
    </svg>
  );
}

/**
 * Ackordnamnen som visas följer vald notation. Med svensk notation betyder B samma som Bb
 * och H samma som B, så namnet måste tolkas därefter när greppet slås upp.
 */
function useHNotation(): boolean {
  return useStore((s) => s.settings.notation) === 'swedish';
}

function useFretted(instrument: Instrument, chord: string) {
  const hNotation = useHNotation();
  const [data, setData] = useState<FrettedShapes | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setData(undefined);
    if (instrument === 'piano') return;
    getFrettedShapes(instrument, chord, hNotation).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [instrument, chord, hNotation]);
  return data;
}

/** Litet diagram med namn, för diagramremsan. */
export function ChordDiagram({
  chord,
  instrument,
  scale = 1,
  variant = 0,
  onClick,
}: {
  chord: string;
  instrument: Instrument;
  scale?: number;
  variant?: number;
  onClick?: () => void;
}) {
  const fretted = useFretted(instrument, chord);
  const hNotation = useHNotation();
  let body: ReactElement;
  if (instrument === 'piano') {
    const p = getPianoChord(chord, hNotation);
    body = p ? <PianoSvg {...p} scale={scale} /> : <div className="missing">Saknas</div>;
  } else if (fretted === undefined) {
    body = <div className="missing">…</div>;
  } else if (fretted === null) {
    body = <div className="missing">Saknas</div>;
  } else {
    const pos = fretted.positions[variant % fretted.positions.length];
    body = <FrettedSvg pos={pos} strings={fretted.strings} scale={scale} />;
  }
  return (
    <div className="diagram" onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="name">{chord}</div>
      {body}
    </div>
  );
}

/** Större visning av ett ackord med möjlighet att bläddra mellan grepp. */
export function ChordSheet({ chord, instrument, onClose }: { chord: string; instrument: Instrument; onClose: () => void }) {
  const fretted = useFretted(instrument, chord);
  const hNotation = useHNotation();
  const [variant, setVariant] = useState(0);
  const count = fretted?.positions.length ?? 0;
  const piano = instrument === 'piano' ? getPianoChord(chord, hNotation) : null;

  return (
    <Sheet title={`${chord} – ${INSTRUMENT_NAMES[instrument]}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '8px 0 12px' }}>
        {instrument === 'piano' ? (
          piano ? (
            <PianoSvg {...piano} scale={2} />
          ) : (
            <p className="muted">Inget pianodiagram för det här ackordet.</p>
          )
        ) : fretted === undefined ? (
          <p className="muted">Laddar…</p>
        ) : fretted === null ? (
          <p className="muted">Hittade inget grepp för {chord}.</p>
        ) : (
          <>
            <FrettedSvg pos={fretted.positions[variant % count]} strings={fretted.strings} scale={2.4} />
            {fretted.approximate && <p className="muted small-text">Visar greppet utan basen.</p>}
            {count > 1 && (
              <div className="btn-row" style={{ alignItems: 'center' }}>
                <button className="btn icon" onClick={() => setVariant((v) => (v - 1 + count) % count)} aria-label="Föregående grepp">
                  <ChevronLeft />
                </button>
                <span className="muted">
                  Grepp {(variant % count) + 1} av {count}
                </span>
                <button className="btn icon" onClick={() => setVariant((v) => (v + 1) % count)} aria-label="Nästa grepp">
                  <ChevronRight />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
