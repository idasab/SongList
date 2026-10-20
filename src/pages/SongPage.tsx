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
  Pause,
  Pencil,
  Play,
  Plus,
  Trash,
  Wand2,
  X,
} from 'lucide-react';
import { ChordDiagram, ChordSheet } from '../components/ChordDiagram';
import { SongRenderer } from '../components/SongRenderer';
import { Header, Sheet, toast, toastError } from '../components/ui';
import { formatChord, normalizeTranspose } from '../lib/chords';
import { parseChordPro, songPrefersFlats, transposeSource } from '../lib/chordpro';
import { liveSetlists, useStore } from '../store/useStore';
import { safeFileName, saveTextFile } from '../services/files';
import { newId } from '../lib/model';
import { useWakeLock } from '../hooks/useWakeLock';

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

  useWakeLock(true);

  const parsed = useMemo(() => parseChordPro(song?.content ?? ''), [song?.content]);
  const transpose = song?.transpose ?? 0;
  const preferFlats = songPrefersFlats(parsed, transpose);
  const speed = song?.scrollSpeed ?? 3;

  // Position i setlistan
  const setlistIndex = setlist ? Number(params.get('i') ?? 0) : -1;
  const setlistItems = useMemo(
    () => (setlist ? setlist.items.filter((it) => songs[it.songId] && !songs[it.songId].deletedAt) : []),
    [setlist, songs],
  );

  const goSetlist = useCallback(
    (delta: number) => {
      if (!setlist) return;
      const next = setlistIndex + delta;
      if (next < 0 || next >= setlistItems.length) return;
      setScrolling(false);
      navigate(`/song/${setlistItems[next].songId}?setlist=${setlist.id}&i=${next}`, { replace: true });
    },
    [setlist, setlistIndex, setlistItems, navigate],
  );

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

  if (!song || song.deletedAt) {
    return (
      <div className="screen">
        <Header title="Låt" back="/" />
        <div className="empty">Låten finns inte.</div>
      </div>
    );
  }

  const ctx = { transpose, preferFlats, notation: settings.notation, hNotation: parsed.hNotation };
  const displayChords = parsed.chords.filter((c) => !c.startsWith('*')).map((c) => formatChord(c, ctx));
  const uniqueChords = [...new Set(displayChords)];

  const setTranspose = (n: number) => void updateSongPrefs(song.id, { transpose: normalizeTranspose(n) });
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

  return (
    <div className={`screen${stage ? ' stage' : ''}`}>
      {!stage && (
        <Header title={song.title} back={backTo}>
          <button className="btn ghost icon" aria-label="Redigera" onClick={() => navigate(`/song/${song.id}/edit`)}>
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

      {!controlsHidden && (
        <div className="song-toolbar" style={stage ? { paddingTop: 'calc(6px + var(--safe-top))', paddingRight: 64 } : undefined}>
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

          <div className="tool-group" title="Textstorlek">
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

      {settings.showDiagrams && showChords && uniqueChords.length > 0 && !controlsHidden && (
        <div className="diagram-strip">
          {uniqueChords.map((c) => (
            <ChordDiagram key={c} chord={c} instrument={settings.instrument} scale={0.9} onClick={() => setChordSheet(c)} />
          ))}
        </div>
      )}

      <div
        className="song-scroll"
        ref={scrollRef}
        onClick={(e) => {
          // I scenläge: tryck på texten för att visa/dölja kontrollerna
          if (stage && !(e.target as HTMLElement).closest('.ch')) setControlsHidden((v) => !v);
        }}
      >
        <SongRenderer
          song={parsed}
          opts={{
            transpose,
            preferFlats,
            notation: settings.notation,
            showChords,
            fontSize: settings.fontSize,
            onChordClick: setChordSheet,
          }}
        />
      </div>

      {setlist && (
        <div className="setlist-nav">
          <button className="btn" disabled={setlistIndex <= 0} onClick={() => goSetlist(-1)}>
            <ChevronLeft size={18} />
            <span className="hide-mobile">
              {setlistIndex > 0 ? songs[setlistItems[setlistIndex - 1].songId]?.title : 'Föregående'}
            </span>
          </button>
          <div className="pos">
            {setlist.name} · {setlistIndex + 1}/{setlistItems.length}
          </div>
          <button className="btn" disabled={setlistIndex >= setlistItems.length - 1} onClick={() => goSetlist(1)}>
            <span className="hide-mobile">
              {setlistIndex < setlistItems.length - 1 ? songs[setlistItems[setlistIndex + 1].songId]?.title : 'Nästa'}
            </span>
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      {chordSheet && <ChordSheet chord={chordSheet} instrument={settings.instrument} onClose={() => setChordSheet(null)} />}

      {menu && (
        <Sheet title={song.title} onClose={() => setMenu(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn" onClick={() => navigate(`/song/${song.id}/edit`)}>
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
                  {sl.items.length} låtar{sl.items.some((i) => i.songId === songId) ? ' · finns redan med' : ''}
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
