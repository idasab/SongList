import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Guitar,
  ListMusic,
  Minus,
  Moon,
  MoreHorizontal,
  PenLine,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash,
  Wand2,
  X,
} from 'lucide-react';
import { AnnotationLayer, useLineMetrics, type LiveStroke } from '../components/AnnotationLayer';
import { AnnotationToolbar } from '../components/AnnotationToolbar';
import { ChordDiagram, ChordSheet } from '../components/ChordDiagram';
import { SongRenderer } from '../components/SongRenderer';
import { Header, Sheet, toast, toastError } from '../components/ui';
import { formatChord, normalizeTranspose } from '../lib/chords';
import {
  capoOf,
  capoShapeShift,
  displayChordContext,
  parseChordPro,
  shapesToSounding,
  songPrefersFlats,
  transposeSource,
  upsertDirective,
} from '../lib/chordpro';
import { liveSetlists, useStore } from '../store/useStore';
import { safeFileName, saveTextFile } from '../services/files';
import { newId } from '../lib/model';
import { useWakeLock } from '../hooks/useWakeLock';
import { useSwipeNavigation } from '../hooks/useSwipeNavigation';
import { AttachmentView } from '../components/AttachmentView';
import { isCue, itemPath, itemTitle, liveItems, songCount } from '../lib/setlist';
import { useAnnotationGestures, type AnnotTool } from '../hooks/useAnnotationGestures';
import { EMPTY_ANNOTATIONS, INK_WIDTHS, type Annotations, type InkColor, type StickyNote } from '../lib/annotations';

const MIN_FONT = 12;
const MAX_FONT = 44;

function scrollPxPerSecond(level: number): number {
  return 4 + level * level * 1.2;
}

export function SongPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const song = useStore((s) => s.songs[id]);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const updateSongPrefs = useStore((s) => s.updateSongPrefs);
  const saveSong = useStore((s) => s.saveSong);
  const deleteSong = useStore((s) => s.deleteSong);
  const setlist = useStore((s) => (params.get('setlist') ? s.setlists[params.get('setlist')!] : undefined));
  const songs = useStore((s) => s.songs);

  const [stage, setStage] = useState(false);
  const [controlsHidden, setControlsHidden] = useState(false);
  const [showChords, setShowChords] = useState(true);
  const [scrolling, setScrolling] = useState(false);
  const [chordSheet, setChordSheet] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [addToSetlist, setAddToSetlist] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const songRef = useRef<HTMLDivElement>(null);

  // Anteckningar
  const [annotating, setAnnotating] = useState(false);
  const [tool, setTool] = useState<AnnotTool>('pen');
  const [inkColor, setInkColor] = useState<InkColor>('red');
  const [inkWidth, setInkWidth] = useState(INK_WIDTHS[1]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [live, setLive] = useState<LiveStroke | null>(null);
  /** Lokal version medan en gest pågår; sparas när gesten är klar */
  const [draft, setDraft] = useState<Annotations | null>(null);
  const history = useRef<Annotations[]>([]);

  useWakeLock(true);

  const parsed = useMemo(() => parseChordPro(song?.content ?? ''), [song?.content]);
  const transpose = song?.transpose ?? 0;
  const preferFlats = songPrefersFlats(parsed, transpose);
  const speed = song?.scrollSpeed ?? 3;

  const saved = song?.annotations ?? EMPTY_ANNOTATIONS;
  const annotations = draft ?? saved;
  const metrics = useLineMetrics(songRef, [parsed, showChords, settings.fontSize, transpose, stage, song?.id]);

  const updateAnnotations = useCallback(
    (next: Annotations, commit: boolean) => {
      if (!commit) {
        setDraft(next);
        return;
      }
      history.current.push(saved);
      if (history.current.length > 50) history.current.shift();
      setDraft(null);
      void updateSongPrefs(id, { annotations: next });
    },
    [id, saved, updateSongPrefs],
  );

  const gestures = useAnnotationGestures({
    enabled: annotating,
    tool,
    setTool,
    scrollRef,
    songRef,
    metrics,
    annotations,
    inkColor,
    inkWidth,
    update: updateAnnotations,
    selectedId,
    setSelectedId,
    editingId,
    setEditingId,
    setLive,
  });

  // När redigeringen av en lapp avslutas (även utan att textrutan hann tappa fokus): spara texten
  const prevEditing = useRef<string | null>(null);
  useEffect(() => {
    if (prevEditing.current && !editingId && draft) updateAnnotations(draft, true);
    prevEditing.current = editingId;
  }, [editingId, draft, updateAnnotations]);

  const annotatingRef = useRef(annotating);
  annotatingRef.current = annotating;

  // Ny låt: nollställ anteckningsläget
  useEffect(() => {
    // Även gesternas tillstånd, så att inget från förra låten hamnar på den nya
    gestures.reset();
    setAnnotating(false);
    setLive(null);
    setDraft(null);
    setSelectedId(null);
    setEditingId(null);
    history.current = [];
  }, [id]);

  // Position i setlistan
  const setlistIndex = setlist ? Number(params.get('i') ?? 0) : -1;
  const setlistItems = useMemo(
    () => (setlist ? liveItems(setlist.items, songs) : []),
    [setlist, songs],
  );

  const goSetlist = useCallback(
    (delta: number) => {
      if (!setlist) return;
      const next = setlistIndex + delta;
      if (next < 0 || next >= setlistItems.length) return;
      setScrolling(false);
      navigate(itemPath(setlist.id, setlistItems[next], next), { replace: true });
    },
    [setlist, setlistIndex, setlistItems, navigate],
  );

  // Stor swipe åt vänster/höger byter låt i setlistan
  const swipe = useSwipeNavigation({
    enabled: !!setlist && !annotating,
    canPrev: setlistIndex > 0,
    canNext: setlistIndex >= 0 && setlistIndex < setlistItems.length - 1,
    onPrev: () => goSetlist(-1),
    onNext: () => goSetlist(1),
  });

  // Börja om från toppen när låten byts
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [id]);

  // Automatisk scroll
  useEffect(() => {
    if (!scrolling) return;
    const el = scrollRef.current;
    if (!el) return;
    let last = performance.now();
    let acc = el.scrollTop;
    let raf = 0;
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // Om användaren har scrollat manuellt: fortsätt därifrån
      if (Math.abs(el.scrollTop - acc) > 2) acc = el.scrollTop;
      acc += scrollPxPerSecond(speed) * dt;
      el.scrollTop = acc;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
        setScrolling(false);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [scrolling, speed]);

  // Tangentbord: piltangenter/mellanslag (fungerar även med många bladvändarpedaler)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      // Inte medan en meny eller ruta är öppen, eller i anteckningsläget
      if (annotatingRef.current || document.querySelector('[role="dialog"]')) return;
      const el = scrollRef.current;
      if (e.key === ' ') {
        e.preventDefault();
        setScrolling((v) => !v);
      } else if (e.key === 'ArrowRight' && setlist) {
        goSetlist(1);
      } else if (e.key === 'ArrowLeft' && setlist) {
        goSetlist(-1);
      } else if ((e.key === 'PageDown' || e.key === 'ArrowDown') && el) {
        e.preventDefault();
        el.scrollBy({ top: el.clientHeight * 0.8, behavior: 'smooth' });
      } else if ((e.key === 'PageUp' || e.key === 'ArrowUp') && el) {
        e.preventDefault();
        el.scrollBy({ top: -el.clientHeight * 0.8, behavior: 'smooth' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goSetlist, setlist]);

  const setlistNav = setlist && (
    <div className="setlist-nav">
      <button className="btn" disabled={setlistIndex <= 0} onClick={() => goSetlist(-1)}>
        <ChevronLeft size={18} />
        <span className="hide-mobile">{setlistIndex > 0 ? itemTitle(setlistItems[setlistIndex - 1], songs) : 'Föregående'}</span>
      </button>
      <div className="pos">
        {setlist.name} · {setlistIndex + 1}/{setlistItems.length}
      </div>
      <button className="btn" disabled={setlistIndex >= setlistItems.length - 1} onClick={() => goSetlist(1)}>
        <span className="hide-mobile">
          {setlistIndex < setlistItems.length - 1 ? itemTitle(setlistItems[setlistIndex + 1], songs) : 'Nästa'}
        </span>
        <ChevronRight size={18} />
      </button>
    </div>
  );

  // Mellanpunkt i setlistan, t.ex. "Tal": visa texten stort
  const cueItem = setlist ? setlistItems[setlistIndex] : undefined;
  if (setlist && cueItem && isCue(cueItem)) {
    const next = setlistItems[setlistIndex + 1];
    return (
      <div className={`screen${stage ? ' stage' : ''}`}>
        {!stage && !controlsHidden && <Header title={setlist.name} back={`/setlists/${setlist.id}`} />}
        {stage && (
          <div className="stage-exit" style={{ top: 'calc(10px + var(--safe-top))' }}>
            <button className="btn icon" aria-label="Lämna scenläge" onClick={() => setStage(false)}>
              <X size={20} />
            </button>
          </div>
        )}
        <div className="song-area">
          <div
            className="song-scroll cue-scroll"
            ref={scrollRef}
            {...swipe.handlers}
            style={{ touchAction: 'pan-y' }}
            onClick={() => {
              if (swipe.justSwiped()) return;
              setControlsHidden((v) => !v);
            }}
          >
            <div className="cue-view" style={swipe.style}>
              <div className="cue-text" style={{ fontSize: Math.round(settings.fontSize * 2.6) }}>
                {itemTitle(cueItem, songs)}
              </div>
              {next && <div className="cue-next">Sedan: {itemTitle(next, songs)}</div>}
            </div>
          </div>
        </div>
        {setlistNav}
      </div>
    );
  }

  if (!song || song.deletedAt) {
    return (
      <div className="screen">
        <Header title="Låt" back="/" />
        <div className="empty">Låten finns inte.</div>
      </div>
    );
  }

  // Låten visas som en bifogad fil (t.ex. noter) i stället för text och ackord
  const isFile = !!song.attachment;
  // Ackorden visas som grepp när låten har kapo
  const ctx = displayChordContext(parsed, transpose, settings.notation);
  const capo = capoOf(parsed);
  const displayChords = parsed.chords.filter((c) => !c.startsWith('*')).map((c) => formatChord(c, ctx));
  const uniqueChords = [...new Set(displayChords)];

  const setTranspose = (n: number) => void updateSongPrefs(song.id, { transpose: normalizeTranspose(n) });
  // Kapot sparas i låten ({capo}), så att det följer med i synk, export och redigering
  const setCapo = (n: number) => {
    const next = Math.max(0, Math.min(11, n));
    if (next === capo) return;
    void saveSong({ id: song.id, content: upsertDirective(song.content, 'capo', next ? String(next) : '') });
  };
  const setFont = (n: number) => void updateSettings({ fontSize: Math.max(MIN_FONT, Math.min(MAX_FONT, n)) });
  const setSpeed = (n: number) => void updateSongPrefs(song.id, { scrollSpeed: Math.max(1, Math.min(10, n)) });

  const exportCho = async () => {
    setMenu(false);
    try {
      await saveTextFile(`${safeFileName(song.title)}.cho`, song.content);
    } catch (e) {
      toastError(e, 'Kunde inte exportera');
    }
  };

  const applyTranspose = async () => {
    setMenu(false);
    if (!transpose) return;
    if (!confirm('Skriva in transponeringen permanent i låttexten? Ackorden i källtexten ändras.')) return;
    const content = transposeSource(song.content, {
      transpose,
      preferFlats,
      notation: parsed.hNotation ? 'swedish' : 'international',
    });
    await saveSong({ id: song.id, content });
    await updateSongPrefs(song.id, { transpose: 0 });
    toast('Transponeringen är sparad i texten');
  };

  const remove = async () => {
    setMenu(false);
    if (!confirm(`Radera "${song.title}"?`)) return;
    await deleteSong(song.id);
    toast('Låten är raderad');
    navigate('/', { replace: true });
  };

  const backTo = setlist ? `/setlists/${setlist.id}` : '/';
  // Redigering från en setlista behåller platsen i setlistan
  const editPath = `/song/${song.id}/edit${setlist ? `?setlist=${setlist.id}&i=${setlistIndex}` : ''}`;
  const tapToHide = (stage || !!setlist) && !annotating;

  const selectedNote = annotations.notes.find((n) => n.id === selectedId) ?? null;
  const changeNote = (patch: Partial<StickyNote>) => {
    if (!selectedNote) return;
    updateAnnotations(
      { ...annotations, notes: annotations.notes.map((n) => (n.id === selectedNote.id ? { ...n, ...patch } : n)) },
      true,
    );
  };
  const startAnnotating = () => {
    setControlsHidden(false);
    setScrolling(false);
    setAnnotating(true);
    if (!settings.showAnnotations) void updateSettings({ showAnnotations: true });
  };
  const stopAnnotating = () => {
    if (draft) updateAnnotations(draft, true);
    gestures.reset();
    setAnnotating(false);
    setSelectedId(null);
    setEditingId(null);
    setLive(null);
  };
  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    gestures.reset();
    setDraft(null);
    setSelectedId(null);
    setEditingId(null);
    void updateSongPrefs(song.id, { annotations: prev });
  };
  const clearAnnotations = () => {
    if (!annotations.notes.length && !annotations.strokes.length) return;
    if (!confirm('Radera alla anteckningar på den här låten?')) return;
    updateAnnotations(EMPTY_ANNOTATIONS, true);
    setSelectedId(null);
  };
  const showLayer = metrics && (settings.showAnnotations || annotating);

  return (
    <div className={`screen${stage ? ' stage' : ''}`}>
      {!stage && !controlsHidden && (
        <Header title={song.title} back={backTo}>
          <button className="btn ghost icon" aria-label="Redigera" onClick={() => navigate(editPath)}>
            <Pencil size={20} />
          </button>
          <button className="btn ghost icon" aria-label="Mer" onClick={() => setMenu(true)}>
            <MoreHorizontal size={22} />
          </button>
        </Header>
      )}

      {stage && (
        <div className="stage-exit" style={{ top: 'calc(10px + var(--safe-top))' }}>
          <button className="btn icon" aria-label="Lämna scenläge" onClick={() => setStage(false)}>
            <X size={20} />
          </button>
        </div>
      )}

      {annotating && (
        <AnnotationToolbar
          style={stage ? { paddingTop: 'calc(6px + var(--safe-top))', paddingRight: 64 } : undefined}
          tool={tool}
          setTool={(t) => {
            setTool(t);
            if (t !== 'move') setSelectedId(null);
            setEditingId(null);
          }}
          inkColor={inkColor}
          setInkColor={setInkColor}
          inkWidth={inkWidth}
          setInkWidth={setInkWidth}
          canUndo={history.current.length > 0}
          onUndo={undo}
          visible={settings.showAnnotations}
          onToggleVisible={() => updateSettings({ showAnnotations: !settings.showAnnotations })}
          onClear={clearAnnotations}
          onDone={stopAnnotating}
          note={selectedNote}
          onNoteChange={changeNote}
          onNoteDelete={() => {
            if (!selectedNote) return;
            updateAnnotations({ ...annotations, notes: annotations.notes.filter((n) => n.id !== selectedNote.id) }, true);
            setSelectedId(null);
            setEditingId(null);
          }}
          onNoteEdit={() => selectedNote && setEditingId(selectedNote.id)}
        />
      )}

      {!controlsHidden && !annotating && (
        <div className="song-toolbar" style={stage ? { paddingTop: 'calc(6px + var(--safe-top))', paddingRight: 64 } : undefined}>
          {!isFile && (
          <div className="tool-group" title="Transponera">
            <button className="btn icon" aria-label="Transponera ner" onClick={() => setTranspose(transpose - 1)}>
              <Minus size={18} />
            </button>
            <span className="tool-value" onClick={() => setTranspose(0)}>
              {transpose > 0 ? `+${transpose}` : transpose === 0 ? '±0' : transpose}
            </span>
            <button className="btn icon" aria-label="Transponera upp" onClick={() => setTranspose(transpose + 1)}>
              <Plus size={18} />
            </button>
          </div>
          )}

          {!isFile && (
          <div className="tool-group" title="Kapo">
            <button className="btn icon" aria-label="Kapo ner" disabled={capo <= 0} onClick={() => setCapo(capo - 1)}>
              <Minus size={18} />
            </button>
            <span className="tool-value capo-value" onClick={() => setCapo(0)}>
              {capo ? `Kapo ${capo}` : 'Kapo'}
            </span>
            <button className="btn icon" aria-label="Kapo upp" disabled={capo >= 11} onClick={() => setCapo(capo + 1)}>
              <Plus size={18} />
            </button>
          </div>
          )}

          <div className="tool-group" title={isFile ? 'Zooma' : 'Textstorlek'}>
            <button className="btn icon" aria-label="Mindre text" onClick={() => setFont(settings.fontSize - 2)}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>A</span>
            </button>
            <button className="btn icon" aria-label="Större text" onClick={() => setFont(settings.fontSize + 2)}>
              <span style={{ fontSize: 19, fontWeight: 700 }}>A</span>
            </button>
          </div>

          <div className="tool-group" title="Automatisk scroll">
            <button
              className={`btn icon${scrolling ? ' active' : ''}`}
              aria-label={scrolling ? 'Pausa scroll' : 'Starta scroll'}
              onClick={() => setScrolling((v) => !v)}
            >
              {scrolling ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button className="btn icon" aria-label="Långsammare" onClick={() => setSpeed(speed - 1)}>
              <Minus size={16} />
            </button>
            <span className="tool-value">{speed}</span>
            <button className="btn icon" aria-label="Snabbare" onClick={() => setSpeed(speed + 1)}>
              <Plus size={16} />
            </button>
          </div>

          <div className="tool-group">
            {!isFile && (
            <>
            <button
              className={`btn icon${showChords ? '' : ' active'}`}
              aria-label={showChords ? 'Dölj ackord' : 'Visa ackord'}
              title={showChords ? 'Dölj ackord' : 'Visa ackord'}
              onClick={() => setShowChords((v) => !v)}
            >
              {showChords ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
            <button
              className={`btn icon${settings.showDiagrams ? ' active' : ''}`}
              aria-label="Ackorddiagram"
              title="Ackorddiagram"
              onClick={() => updateSettings({ showDiagrams: !settings.showDiagrams })}
            >
              <Guitar size={18} />
            </button>
            <button className="btn icon" aria-label="Anteckna" title="Anteckna och rita" onClick={startAnnotating}>
              <PenLine size={18} />
            </button>
            </>
            )}
            <button
              className={`btn icon${stage ? ' active' : ''}`}
              aria-label="Scenläge"
              title="Scenläge"
              onClick={() => setStage((v) => !v)}
            >
              <Moon size={18} />
            </button>
          </div>
        </div>
      )}

      {!isFile && settings.showDiagrams && showChords && uniqueChords.length > 0 && !controlsHidden && (
        <div className="diagram-strip">
          {uniqueChords.map((c) => (
            <ChordDiagram key={c} chord={c} instrument={settings.instrument} scale={0.9} onClick={() => setChordSheet(c)} />
          ))}
        </div>
      )}

      <div className="song-area">
        <div
          className={`song-scroll${annotating ? ' annotating' : ''}`}
          ref={scrollRef}
          onPointerDown={annotating ? gestures.onPointerDown : swipe.handlers.onPointerDown}
          onPointerMove={annotating ? gestures.onPointerMove : swipe.handlers.onPointerMove}
          onPointerUp={annotating ? gestures.onPointerUp : swipe.handlers.onPointerUp}
          onPointerCancel={annotating ? gestures.onPointerCancel : swipe.handlers.onPointerCancel}
          style={{
            ...(controlsHidden && !stage ? { paddingTop: 'calc(18px + var(--safe-top))' } : {}),
            // Webbläsaren sköter vertikal scroll; swipe i sidled hanteras av appen
            ...(setlist && !annotating ? { touchAction: 'pan-y' } : {}),
          }}
          onClick={(e) => {
            if (swipe.justSwiped()) return;
            // I setlistläge och scenläge: tryck på låten för att visa/dölja kontrollerna överst
            if (tapToHide && !(e.target as HTMLElement).closest('.ch')) setControlsHidden((v) => !v);
          }}
        >
          <div style={swipe.style}>
          {!isFile && !stage && !controlsHidden && !annotating && capoShapeShift(parsed) > 0 && (
            <div className="tip small-text capo-tip" onClick={(e) => e.stopPropagation()}>
              <div>
                Ackorden verkar vara skrivna som grepp för kapo {capo}, men tonarten är {parsed.meta.key}. Skriv om
                ackorden till {parsed.meta.key}, så visas greppen rätt med kapot.
              </div>
              <button
                className="btn small primary"
                onClick={() => void saveSong({ id: song.id, content: shapesToSounding(song.content) }).then(() => toast('Ackorden är omskrivna'))}
              >
                Skriv om till {parsed.meta.key}
              </button>
            </div>
          )}
          {isFile ? (
            <div className="song file-song" style={{ fontSize: settings.fontSize }}>
              <div className="song-head">
                <h2>{song.title}</h2>
                {song.artist && <div className="artist">{song.artist}</div>}
              </div>
              <AttachmentView attachment={song.attachment!} zoom={settings.fontSize / 20} />
            </div>
          ) : (
          <SongRenderer
            song={parsed}
            opts={{
              transpose,
              notation: settings.notation,
              showChords,
              fontSize: settings.fontSize,
              onChordClick: annotating ? undefined : setChordSheet,
            }}
            containerRef={songRef}
            overlay={
              showLayer ? (
                <AnnotationLayer
                  annotations={settings.showAnnotations || annotating ? annotations : EMPTY_ANNOTATIONS}
                  metrics={metrics}
                  live={live}
                  interactive={annotating}
                  selectedId={selectedId}
                  editingId={editingId}
                  onTextChange={(nid, text) =>
                    updateAnnotations(
                      { ...annotations, notes: annotations.notes.map((n) => (n.id === nid ? { ...n, text } : n)) },
                      false,
                    )
                  }
                  onTextDone={() => {
                    if (draft) updateAnnotations(draft, true);
                    setEditingId(null);
                  }}
                />
              ) : null
            }
          />
          )}
          </div>
        </div>
        <button
          className={`scroll-fab${scrolling ? ' on' : ''}`}
          aria-label={scrolling ? 'Pausa scroll' : 'Starta scroll'}
          onClick={() => setScrolling((v) => !v)}
        >
          {scrolling ? <Pause size={24} /> : <Play size={24} />}
        </button>
      </div>

      {setlistNav}

      {chordSheet && <ChordSheet chord={chordSheet} instrument={settings.instrument} onClose={() => setChordSheet(null)} />}

      {menu && (
        <Sheet title={song.title} onClose={() => setMenu(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn" onClick={() => navigate(editPath)}>
              <Pencil size={18} /> Redigera
            </button>
            <button
              className="btn"
              onClick={() => {
                setMenu(false);
                setAddToSetlist(true);
              }}
            >
              <ListMusic size={18} /> Lägg till i setlista
            </button>
            <button className="btn" disabled={!transpose} onClick={applyTranspose}>
              <Wand2 size={18} /> Skriv in transponeringen i texten
            </button>
            <button className="btn" onClick={exportCho}>
              <Download size={18} /> Exportera som ChordPro (.cho)
            </button>
            <button className="btn danger" onClick={remove}>
              <Trash size={18} /> Radera låten
            </button>
          </div>
        </Sheet>
      )}

      {addToSetlist && <AddToSetlistSheet songId={song.id} onClose={() => setAddToSetlist(false)} />}
    </div>
  );
}

function AddToSetlistSheet({ songId, onClose }: { songId: string; onClose: () => void }) {
  const setlistsRec = useStore((s) => s.setlists);
  const saveSetlist = useStore((s) => s.saveSetlist);
  const setlists = liveSetlists(setlistsRec).sort((a, b) => b.updatedAt - a.updatedAt);
  const [name, setName] = useState('');

  const add = async (id?: string) => {
    if (id) {
      const sl = setlistsRec[id];
      await saveSetlist({ ...sl, items: [...sl.items, { id: newId(), songId }] });
      toast(`Tillagd i ${sl.name}`);
    } else {
      if (!name.trim()) return;
      await saveSetlist({ name: name.trim(), items: [{ id: newId(), songId }] });
      toast(`Setlistan ${name.trim()} skapades`);
    }
    onClose();
  };

  return (
    <Sheet title="Lägg till i setlista" onClose={onClose}>
      {setlists.length > 0 && (
        <div className="list" style={{ marginBottom: 16 }}>
          {setlists.map((sl) => (
            <div key={sl.id} className="list-item" onClick={() => add(sl.id)}>
              <div className="main">
                <div className="title">{sl.name}</div>
                <div className="sub">
                  {songCount(sl.items)} låtar{sl.items.some((i) => i.songId === songId) ? ' · finns redan med' : ''}
                </div>
              </div>
              <Plus size={18} />
            </div>
          ))}
        </div>
      )}
      <div className="field">
        <span>Ny setlista</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" value={name} placeholder="Namn" onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" disabled={!name.trim()} onClick={() => add()}>
            Skapa
          </button>
        </div>
      </div>
    </Sheet>
  );
}
