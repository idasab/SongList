import { memo, type CSSProperties } from 'react';
import type { Line, ParsedSong, Section, Segment } from '../lib/chordpro';
import { formatChord, formatKey, parseKey, type ChordContext } from '../lib/chords';

export interface RenderOptions {
  transpose: number;
  preferFlats: boolean;
  notation: ChordContext['notation'];
  showChords: boolean;
  fontSize: number;
  /** Visa titel/artist/tonart överst */
  showHeader?: boolean;
  onChordClick?: (chord: string) => void;
}

/** Delar upp segment ord för ord så att raderna kan radbrytas mellan orden. */
function splitWords(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const parts = s.text.match(/\S*\s*/g)?.filter(Boolean) ?? [];
    if (parts.length <= 1) {
      out.push(s);
      continue;
    }
    parts.forEach((p, i) => out.push({ chord: i === 0 ? s.chord : undefined, text: p }));
  }
  return out;
}

function LineView({ line, ctx, opts }: { line: Line; ctx: ChordContext; opts: RenderOptions }) {
  switch (line.type) {
    case 'empty':
      return <div className="ln-empty" />;
    case 'comment':
      return <div className={`comment ${line.style}`}>{line.text}</div>;
    case 'pre':
      return <div className="pre">{line.text || ' '}</div>;
    case 'lyrics': {
      const hasChord = opts.showChords && line.segments.some((s) => s.chord !== undefined);
      if (!hasChord) {
        const text = line.segments.map((s) => s.text).join('');
        return <div className="ln plain">{text.trim() ? text : ' '}</div>;
      }
      const lyricsEmpty = line.segments.every((s) => !s.text.trim());
      return (
        <div className="ln">
          {splitWords(line.segments).map((s, i) => {
            const annot = s.chord?.startsWith('*');
            const chord = s.chord !== undefined ? formatChord(s.chord, ctx) : '';
            return (
              <span className="seg" key={i}>
                <span
                  className={`ch${annot ? ' annot' : ''}`}
                  onClick={chord && !annot && opts.onChordClick ? () => opts.onChordClick!(chord) : undefined}
                >
                  {chord || ' '}
                </span>
                {!lyricsEmpty && <span className="ly">{s.text || ' '}</span>}
              </span>
            );
          })}
        </div>
      );
    }
  }
}

function SectionView({ section, ctx, opts }: { section: Section; ctx: ChordContext; opts: RenderOptions }) {
  const cls = ['sec', section.type, section.isRepeat ? 'repeat' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      {section.label && <div className="sec-label">{section.label}</div>}
      {section.lines.map((l, i) => (
        <LineView key={i} line={l} ctx={ctx} opts={opts} />
      ))}
    </div>
  );
}

export const SongRenderer = memo(function SongRenderer({ song, opts }: { song: ParsedSong; opts: RenderOptions }) {
  const ctx: ChordContext = {
    transpose: opts.transpose,
    preferFlats: opts.preferFlats,
    notation: opts.notation,
    hNotation: song.hNotation,
  };
  const { meta } = song;
  const key = parseKey(meta.key, { hNotation: song.hNotation });
  const capo = meta.capo ? parseInt(meta.capo, 10) : 0;
  const style: CSSProperties = { fontSize: opts.fontSize };

  return (
    <div className={`song${opts.showChords ? '' : ' no-chords'}`} style={style}>
      {opts.showHeader !== false && (
        <div className="song-head">
          <h2>{meta.title || 'Namnlös'}</h2>
          {(meta.artist || meta.subtitle) && <div className="artist">{meta.artist || meta.subtitle}</div>}
          <div className="song-info">
            {key && (
              <span>
                Tonart <span className="chordish">{formatKey(key, opts.transpose, opts.notation)}</span>
              </span>
            )}
            {capo > 0 && (
              <span>
                Kapo <b>{capo}</b>
                {key && (
                  <>
                    {' '}
                    (klingar <span className="chordish">{formatKey(key, opts.transpose + capo, opts.notation)}</span>)
                  </>
                )}
              </span>
            )}
            {meta.tempo && (
              <span>
                Tempo <b>{meta.tempo}</b>
              </span>
            )}
            {meta.time && (
              <span>
                Takt <b>{meta.time}</b>
              </span>
            )}
            {meta.composer && <span>Musik: {meta.composer}</span>}
            {meta.lyricist && <span>Text: {meta.lyricist}</span>}
          </div>
        </div>
      )}
      {song.sections.map((s, i) => (
        <SectionView key={i} section={s} ctx={ctx} opts={opts} />
      ))}
    </div>
  );
});
