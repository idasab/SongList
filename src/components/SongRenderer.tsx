import { memo, type CSSProperties, type ReactNode, type Ref } from 'react';
import { isChordRow, midWordBreaks, splitWords, type Line, type ParsedSong, type Section } from '../lib/chordpro';
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

/** Varje renderad rad får ett index (data-ln) som anteckningar fästs vid. 0 = låthuvudet. */
function sectionStarts(sections: Section[]): number[] {
  const starts: number[] = [];
  let n = 1;
  for (const s of sections) {
    starts.push(n);
    n += (s.label ? 1 : 0) + s.lines.length;
  }
  return starts;
}

function LineView({ line, ctx, opts, ln }: { line: Line; ctx: ChordContext; opts: RenderOptions; ln: number }) {
  switch (line.type) {
    case 'empty':
      return <div className="ln-empty" data-ln={ln} />;
    case 'comment':
      return (
        <div className={`comment ${line.style}`} data-ln={ln}>
          {line.text}
        </div>
      );
    case 'pre':
      return (
        <div className="pre" data-ln={ln}>
          {line.text || ' '}
        </div>
      );
    case 'lyrics': {
      const hasChord = opts.showChords && line.segments.some((s) => s.chord !== undefined);
      if (!hasChord) {
        const text = line.segments.map((s) => s.text).join('');
        return (
          <div className="ln plain" data-ln={ln}>
            {text.trim() ? text : ' '}
          </div>
        );
      }
      if (isChordRow(line.segments)) {
        // Ackord och taktsymboler på samma rad, t.ex. "C / / G/B / / | Am"
        return (
          <div className="ln chord-row" data-ln={ln}>
            {line.segments.map((s, i) => {
              const annot = s.chord?.startsWith('*');
              const chord = s.chord !== undefined ? formatChord(s.chord, ctx) : '';
              return (
                <span key={i}>
                  {chord && (
                    <span
                      className={`ch${annot ? ' annot' : ''}`}
                      onClick={!annot && opts.onChordClick ? () => opts.onChordClick!(chord) : undefined}
                    >
                      {chord}
                    </span>
                  )}
                  {s.text && <span className="sym">{s.text}</span>}
                </span>
              );
            })}
          </div>
        );
      }
      const lyricsEmpty = line.segments.every((s) => !s.text.trim());
      const segs = splitWords(line.segments);
      const breaks = midWordBreaks(segs);
      return (
        <div className="ln" data-ln={ln}>
          {segs.map((s, i) => {
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
                {!lyricsEmpty &&
                  (breaks[i] ? (
                    // Bindestreck i mellanrummet när ackordet är bredare än stavelsen
                    <span className="ly split">
                      {s.text}
                      <span className="hy" aria-hidden>
                        <span />
                        <span>-</span>
                      </span>
                    </span>
                  ) : (
                    <span className="ly">{s.text || ' '}</span>
                  ))}
              </span>
            );
          })}
        </div>
      );
    }
  }
}

function SectionView({
  section,
  ctx,
  opts,
  start,
}: {
  section: Section;
  ctx: ChordContext;
  opts: RenderOptions;
  start: number;
}) {
  const first = start + (section.label ? 1 : 0);
  const cls = ['sec', section.type, section.isRepeat ? 'repeat' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      {section.label && (
        <div className="sec-label" data-ln={start}>
          {section.label}
        </div>
      )}
      {section.lines.map((l, i) => (
        <LineView key={i} line={l} ctx={ctx} opts={opts} ln={first + i} />
      ))}
    </div>
  );
}

export const SongRenderer = memo(function SongRenderer({
  song,
  opts,
  containerRef,
  overlay,
}: {
  song: ParsedSong;
  opts: RenderOptions;
  /** Ref till låtens behållare (används för att mäta rader) */
  containerRef?: Ref<HTMLDivElement>;
  /** Lager som ritas ovanpå låten, t.ex. anteckningar */
  overlay?: ReactNode;
}) {
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
  const starts = sectionStarts(song.sections);

  return (
    <div className={`song${opts.showChords ? '' : ' no-chords'}`} style={style} ref={containerRef}>
      {opts.showHeader !== false && (
        <div className="song-head" data-ln={0}>
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
        <SectionView key={i} section={s} ctx={ctx} opts={opts} start={starts[i]} />
      ))}
      {overlay}
    </div>
  );
});
