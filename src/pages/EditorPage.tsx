import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, Image as ImageIcon, Wand2 } from 'lucide-react';
import { SongRenderer } from '../components/SongRenderer';
import { TagInput } from '../components/TagInput';
import { Header, Segmented, toast } from '../components/ui';
import { parseChordPro, songPrefersFlats, upsertDirective } from '../lib/chordpro';
import { textToChordPro } from '../lib/textImport';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { allTags, liveCategories, useStore } from '../store/useStore';

const NEW_TEMPLATE = `{title: }
{artist: }
{key: }

{start_of_verse: Vers 1}

{end_of_verse}
`;

const KEYS = ['', 'C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const KEY_OPTIONS = [...KEYS, ...KEYS.filter(Boolean).map((k) => k + 'm')];

export function EditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const existing = useStore((s) => (id ? s.songs[id] : undefined));
  const draft = useStore((s) => s.draft);
  const setDraft = useStore((s) => s.setDraft);
  const saveSong = useStore((s) => s.saveSong);
  const songsRec = useStore((s) => s.songs);
  const categoriesRec = useStore((s) => s.categories);
  const settings = useStore((s) => s.settings);

  const initial = useRef({
    content: existing?.content ?? draft?.content ?? NEW_TEMPLATE,
    tags: existing?.tags ?? draft?.tags ?? [],
    categoryId: existing?.categoryId ?? draft?.categoryId ?? '',
  });
  const [refImage] = useState(id ? undefined : draft?.imageDataUrl);
  const [content, setContent] = useState(initial.current.content);
  const [tags, setTags] = useState<string[]>(initial.current.tags);
  const [categoryId, setCategoryId] = useState(initial.current.categoryId);
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [showMeta, setShowMeta] = useState(true);
  const [showImage, setShowImage] = useState(true);
  const [saved, setSaved] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const wide = useMediaQuery('(min-width: 900px)');

  // Utkastet är förbrukat när editorn har öppnats
  useEffect(() => {
    if (!id && draft) setDraft(null);
  }, [id, draft, setDraft]);

  const dirty =
    !saved &&
    (content !== initial.current.content ||
      tags.join() !== initial.current.tags.join() ||
      categoryId !== initial.current.categoryId);

  // Sätts direkt vid sparning, så att navigeringen till låten inte stoppas innan React
  // hunnit uppdatera "dirty" (annars frågar appen om man vill lämna utan att spara)
  const leavingAfterSave = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !leavingAfterSave.current && dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (confirm('Du har osparade ändringar. Lämna utan att spara?')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);

  const deferred = useDeferredValue(content);
  const parsed = useMemo(() => parseChordPro(deferred), [deferred]);
  const meta = useMemo(() => parseChordPro(content).meta, [content]);
  const tagSuggestions = useMemo(() => allTags(songsRec), [songsRec]);
  const categories = useMemo(() => liveCategories(categoriesRec), [categoriesRec]);

  const save = useCallback(async () => {
    const song = await saveSong({ id: existing?.id, content, tags, categoryId });
    setSaved(true);
    toast('Sparat');
    leavingAfterSave.current = true;
    navigate(`/song/${song.id}`, { replace: true });
  }, [saveSong, existing?.id, content, tags, categoryId, navigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const setMeta = (name: string, value: string) => setContent((c) => upsertDirective(c, name, value));

  /** Ersätter markeringen i textfältet och placerar markören. */
  const replaceSelection = (make: (selected: string) => { text: string; cursor?: number }) => {
    const ta = textRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = content.slice(start, end);
    const { text, cursor } = make(selected);
    const next = content.slice(0, start) + text + content.slice(end);
    setContent(next);
    const pos = start + (cursor ?? text.length);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  const insertChord = (chord = '') =>
    replaceSelection((sel) => (chord ? { text: `[${chord}]${sel}` } : { text: `[${sel}]`, cursor: sel ? sel.length + 2 : 1 }));

  const wrapSection = (env: 'verse' | 'chorus' | 'bridge', label: string) =>
    replaceSelection((sel) => {
      const startLine = `{start_of_${env}${label ? ': ' + label : ''}}\n`;
      const body = sel ? sel.replace(/\n$/, '') : '';
      const text = `${startLine}${body}\n{end_of_${env}}\n`;
      return { text, cursor: sel ? text.length : startLine.length };
    });

  const insertComment = () =>
    replaceSelection((sel) => {
      const text = `{comment: ${sel}}`;
      return { text, cursor: sel ? text.length : text.length - 1 };
    });

  const convertSelection = () => {
    const ta = textRef.current;
    if (!ta) return;
    const hasSel = ta.selectionEnd > ta.selectionStart;
    if (!hasSel) {
      if (!confirm('Konvertera hela texten från "ackord ovanför text" till ChordPro?')) return;
      setContent(textToChordPro(content));
      return;
    }
    replaceSelection((sel) => ({ text: textToChordPro(sel).replace(/\n$/, sel.endsWith('\n') ? '\n' : '') }));
  };

  const preferFlats = songPrefersFlats(parsed, 0);
  // Alla ackord i låten, i den ordning de först förekommer
  const quickChords = parsed.chords.filter((c) => !c.startsWith('*'));

  const preview = (
    <div className="preview">
      <SongRenderer
        song={parsed}
        opts={{ transpose: 0, preferFlats, notation: settings.notation, showChords: true, fontSize: Math.min(settings.fontSize, 20) }}
      />
    </div>
  );

  const editor = (
    <>
      {refImage && (
        <div className="ref-image" style={showImage ? undefined : { maxHeight: 0, borderBottom: 'none' }}>
          <img src={refImage} alt="Skannat original" />
        </div>
      )}
      <div className="editor-tools">
        <button className="btn small" onClick={() => wrapSection('verse', 'Vers')}>
          Vers
        </button>
        <button className="btn small" onClick={() => wrapSection('chorus', '')}>
          Refräng
        </button>
        <button className="btn small" onClick={() => wrapSection('bridge', '')}>
          Stick
        </button>
        <button className="btn small" onClick={insertComment}>
          Kommentar
        </button>
        <button className="btn small" onClick={() => replaceSelection(() => ({ text: '{chorus}\n' }))} title="Upprepa refrängen">
          Upprepa ref.
        </button>
        <button className="btn small" onClick={convertSelection} title="Konvertera ackord ovanför text till ChordPro">
          <Wand2 size={15} /> Konvertera
        </button>
        {refImage && (
          <button className={`btn small${showImage ? ' active' : ''}`} onClick={() => setShowImage((v) => !v)}>
            <ImageIcon size={15} /> Original
          </button>
        )}
      </div>
      <textarea
        ref={textRef}
        className="source"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        wrap="off"
      />
      <div className="chord-bar" aria-label="Ackord i låten">
        <button
          className="btn small chordbtn"
          title="Infoga ett tomt ackord"
          aria-label="Infoga ett tomt ackord"
          // Behåll fokus i texten så att tangentbordet inte stängs
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insertChord()}
        >
          [ ]
        </button>
        {quickChords.map((c) => (
          <button
            key={c}
            className="btn small chordbtn"
            title={`Infoga ${c}`}
            // Behåll fokus i texten så att tangentbordet inte stängs
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insertChord(c)}
          >
            {c}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className="screen">
      <Header title={existing ? 'Redigera' : 'Ny låt'} back={true}>
        {!wide && (
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'edit', label: 'Text' },
              { value: 'preview', label: 'Visa' },
            ]}
          />
        )}
        <button className="btn primary" onClick={save}>
          Spara
        </button>
      </Header>

      <div className="editor-meta" style={showMeta ? undefined : { paddingBottom: 0 }}>
        {showMeta && (
          <>
            <div className="grid-4">
              <label className="field">
                <span>Titel</span>
                <DirectiveInput value={meta.title ?? ''} onChange={(v) => setMeta('title', v)} />
              </label>
              <label className="field">
                <span>Artist</span>
                <DirectiveInput value={meta.artist ?? ''} onChange={(v) => setMeta('artist', v)} />
              </label>
              <label className="field">
                <span>Tonart</span>
                <select className="select" value={meta.key ?? ''} onChange={(e) => setMeta('key', e.target.value)}>
                  {!KEY_OPTIONS.includes(meta.key ?? '') && <option value={meta.key}>{meta.key}</option>}
                  {KEY_OPTIONS.map((k) => (
                    <option key={k} value={k}>
                      {k || '–'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Kapo</span>
                <select className="select" value={meta.capo ?? ''} onChange={(e) => setMeta('capo', e.target.value === '0' ? '' : e.target.value)}>
                  <option value="">–</option>
                  {Array.from({ length: 11 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid-2">
              <label className="field">
                <span>Kategori</span>
                <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">Ingen</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Tempo</span>
                <DirectiveInput inputMode="numeric" value={meta.tempo ?? ''} onChange={(v) => setMeta('tempo', v)} />
              </label>
            </div>
            <div className="field">
              <span>Taggar</span>
              <TagInput value={tags} onChange={setTags} suggestions={tagSuggestions} />
            </div>
          </>
        )}
        <div style={{ textAlign: 'center' }}>
          <button className="btn ghost small" onClick={() => setShowMeta((v) => !v)}>
            {showMeta ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {showMeta ? 'Dölj uppgifter' : `${meta.title || 'Namnlös'} – visa uppgifter`}
          </button>
        </div>
      </div>

      <div className="editor-layout">
        {wide ? (
          <>
            <div className="editor-pane">{editor}</div>
            <div className="editor-pane">{preview}</div>
          </>
        ) : (
          <div className="editor-pane">{view === 'edit' ? editor : preview}</div>
        )}
      </div>
    </div>
  );
}

/**
 * Fält som är kopplat till ett direktiv i ChordPro-texten (t.ex. {title: …}). Medan man skriver
 * behåller fältet sitt eget värde, eftersom direktivets värde trimmas och ett mellanslag i
 * slutet annars försvinner innan nästa ord hunnit skrivas.
 */
function DirectiveInput({
  value,
  onChange,
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  inputMode?: 'numeric' | 'text';
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    // Hämta värdet från texten (t.ex. om direktivet ändras i redigeringsfältet) när fältet inte används
    if (!focused.current) setText(value);
  }, [value]);
  return (
    <input
      className="input"
      inputMode={inputMode}
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        setText(value);
      }}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}
