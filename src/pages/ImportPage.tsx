import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ChevronDown, ChevronUp, ClipboardPaste, FileUp, Image as ImageIcon, Lightbulb, Pencil, X } from 'lucide-react';
import { SongRenderer } from '../components/SongRenderer';
import { TagInput } from '../components/TagInput';
import { Header, Sheet, toast, toastError } from '../components/ui';
import { parseChordPro, songPrefersFlats } from '../lib/chordpro';
import {
  SOURCE_FONTS,
  canvasMeasure,
  decodeText,
  isChordProFileName,
  looksLikeChordPro,
  suggestSourceFont,
  textToChordPro,
  type SourceFont,
} from '../lib/textImport';
import { newId } from '../lib/model';
import { canUseDocumentScanner, recognizeImageFile, scanDocument } from '../services/ocr';
import { pickFiles } from '../services/files';
import { allTags, liveCategories, useStore } from '../store/useStore';

interface ImportItem {
  id: string;
  fileName: string;
  raw: string;
  kind: 'chordpro' | 'text';
  font: SourceFont;
}

function convert(item: ImportItem): string {
  if (item.kind === 'chordpro') return item.raw;
  return textToChordPro(item.raw, { measure: canvasMeasure(item.font), fileName: item.fileName });
}

const ACCEPT = '.cho,.chopro,.chordpro,.crd,.pro,.txt,.text,text/plain';

export function ImportPage() {
  const navigate = useNavigate();
  const importSongs = useStore((s) => s.importSongs);
  const setDraft = useStore((s) => s.setDraft);
  const songsRec = useStore((s) => s.songs);
  const categoriesRec = useStore((s) => s.categories);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [busy, setBusy] = useState<{ message: string; progress?: number } | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState('');

  const tagSuggestions = useMemo(() => allTags(songsRec), [songsRec]);
  const categories = useMemo(() => liveCategories(categoriesRec), [categoriesRec]);

  const addRaw = (fileName: string, raw: string) => {
    // Filändelsen avgör först (.cho, .chopro …), annars innehållet
    const kind = isChordProFileName(fileName) || looksLikeChordPro(raw) ? 'chordpro' : 'text';
    const font = kind === 'text' ? suggestSourceFont(raw, canvasMeasure) : 'monospace';
    setItems((cur) => [...cur, { id: newId(), fileName, raw, kind, font }]);
  };

  const chooseFiles = async () => {
    const files = await pickFiles({ accept: ACCEPT, multiple: true });
    for (const f of files) {
      try {
        if (f.size > 2_000_000) throw new Error('Filen är för stor');
        addRaw(f.name, decodeText(await f.arrayBuffer()));
      } catch (e) {
        toastError(e, `Kunde inte läsa ${f.name}`);
      }
    }
  };

  const openScanResult = (content: string, imageDataUrl?: string) => {
    setDraft({ content, imageDataUrl, tags });
    navigate('/new');
  };

  const scanWithCamera = async () => {
    try {
      setBusy({ message: 'Läser text…' });
      const res = await scanDocument();
      setBusy(null);
      if (res) openScanResult(res.content, res.imageDataUrl);
    } catch (e) {
      setBusy(null);
      toastError(e, 'Skanningen misslyckades');
    }
  };

  const scanImage = async (capture: boolean) => {
    const [file] = await pickFiles({ accept: 'image/*', capture });
    if (!file) return;
    try {
      setBusy({ message: 'Förbereder…' });
      const res = await recognizeImageFile(file, (message, progress) => setBusy({ message, progress }));
      setBusy(null);
      if (!res.content.trim()) {
        toast('Hittade ingen text i bilden', { error: true });
        return;
      }
      openScanResult(res.content, res.imageDataUrl);
    } catch (e) {
      setBusy(null);
      toastError(e, 'Textigenkänningen misslyckades');
    }
  };

  const importAll = async () => {
    const list = items.map((it) => ({ content: convert(it), tags, categoryId }));
    const songs = await importSongs(list);
    toast(`${songs.length} ${songs.length === 1 ? 'låt' : 'låtar'} importerade`);
    setItems([]);
    if (songs.length === 1) navigate(`/song/${songs[0].id}`);
    else navigate('/');
  };

  const openInEditor = (it: ImportItem) => {
    setDraft({ content: convert(it), tags });
    setItems((cur) => cur.filter((x) => x.id !== it.id));
    navigate('/new');
  };

  const nativeScanner = canUseDocumentScanner();

  return (
    <div className="screen">
      <Header title="Importera" />
      <div className="content narrow">
        <div>
          <div className="import-actions">
            <button className="big-action" onClick={chooseFiles}>
              <FileUp size={22} />
              <b>Välj filer</b>
              <span>ChordPro (.cho, .chopro, .pro) eller textfiler med ackord ovanför texten</span>
            </button>
            <button className="big-action" onClick={() => setPasting(true)}>
              <ClipboardPaste size={22} />
              <b>Klistra in text</b>
              <span>Från en webbsida, ett dokument eller ett mejl</span>
            </button>
            <button className="big-action" onClick={nativeScanner ? scanWithCamera : () => scanImage(true)}>
              <Camera size={22} />
              <b>Skanna papper</b>
              <span>Fotografera ett papper med text och ackord – texten tolkas direkt på enheten</span>
            </button>
            <button className="big-action" onClick={() => scanImage(false)}>
              <ImageIcon size={22} />
              <b>Läs från bild</b>
              <span>Välj ett foto eller en skärmbild med text och ackord</span>
            </button>
          </div>

          {busy && (
            <div className="card">
              <b>{busy.message}</b>
              {busy.progress !== undefined && (
                <div className="progress">
                  <div style={{ width: `${Math.round(busy.progress * 100)}%` }} />
                </div>
              )}
              {!nativeScanner && (
                <p className="muted small-text" style={{ marginBottom: 0 }}>
                  Första gången laddas språkdata för textigenkänning ner (några MB).
                </p>
              )}
            </div>
          )}

          {items.length > 0 && (
            <>
              <div className="section-title">Att importera ({items.length})</div>
              {items.map((it) => (
                <ImportItemCard
                  key={it.id}
                  item={it}
                  onChange={(next) => setItems((cur) => cur.map((x) => (x.id === it.id ? next : x)))}
                  onRemove={() => setItems((cur) => cur.filter((x) => x.id !== it.id))}
                  onEdit={() => openInEditor(it)}
                />
              ))}

              <div className="card">
                <div className="grid-2">
                  <label className="field">
                    <span>Kategori för importerade låtar</span>
                    <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                      <option value="">Ingen</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="field">
                    <span>Taggar för importerade låtar</span>
                    <TagInput value={tags} onChange={setTags} suggestions={tagSuggestions} />
                  </div>
                </div>
                <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn" onClick={() => setItems([])}>
                    Rensa
                  </button>
                  <button className="btn primary" onClick={importAll}>
                    Importera {items.length} {items.length === 1 ? 'låt' : 'låtar'}
                  </button>
                </div>
              </div>
            </>
          )}

          {items.length === 0 && !busy && (
            <div className="tip small-text">
              <b>
                <Lightbulb size={16} /> Tips
              </b>
              <p style={{ margin: '6px 0 0' }}>
                Textfiler där ackorden står på raden ovanför texten konverteras automatiskt till ChordPro. Om filen
                skrevs i ett typsnitt utan fast teckenbredd (t.ex. Arial i Word) kan du välja typsnittet, så hamnar
                ackorden där de syntes i originalet – inte efter antal mellanslag.
              </p>
            </div>
          )}
        </div>
      </div>

      {pasting && (
        <Sheet
          title="Klistra in text"
          onClose={() => setPasting(false)}
          footer={
            <>
              <button className="btn" onClick={() => setPasting(false)}>
                Avbryt
              </button>
              <button
                className="btn primary"
                disabled={!pasteText.trim()}
                onClick={() => {
                  addRaw('Inklistrad text', pasteText);
                  setPasteText('');
                  setPasting(false);
                }}
              >
                Lägg till
              </button>
            </>
          }
        >
          <textarea
            className="textarea"
            style={{ fontFamily: 'var(--mono)', minHeight: '45vh' }}
            value={pasteText}
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'Klistra in ChordPro eller text med ackord ovanför raderna'}
          />
        </Sheet>
      )}
    </div>
  );
}

function ImportItemCard({
  item,
  onChange,
  onRemove,
  onEdit,
}: {
  item: ImportItem;
  onChange: (i: ImportItem) => void;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const notation = useStore((s) => s.settings.notation);
  const content = useMemo(() => convert(item), [item]);
  const parsed = useMemo(() => parseChordPro(content), [content]);

  return (
    <div className="import-item">
      <div className="head">
        <div className="main">
          <div style={{ fontWeight: 600 }}>{parsed.meta.title || item.fileName}</div>
          <div className="muted small-text">
            {parsed.meta.artist ? parsed.meta.artist + ' · ' : ''}
            {item.fileName}
          </div>
        </div>
        <span className="badge">{item.kind === 'chordpro' ? 'ChordPro' : 'Text'}</span>
        <button className="btn ghost icon" aria-label="Ta bort" onClick={onRemove}>
          <X size={18} />
        </button>
      </div>
      <div className="opts">
        {item.kind === 'text' && (
          <label className="small-text" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            Originalets typsnitt
            <select className="select" value={item.font} onChange={(e) => onChange({ ...item, font: e.target.value as SourceFont })}>
              {SOURCE_FONTS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="small-text" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          Format
          <select
            className="select"
            value={item.kind}
            onChange={(e) => onChange({ ...item, kind: e.target.value as ImportItem['kind'] })}
          >
            <option value="text">Ackord ovanför text</option>
            <option value="chordpro">ChordPro</option>
          </select>
        </label>
        <span style={{ flex: 1 }} />
        <button className="btn small" onClick={onEdit}>
          <Pencil size={15} /> Öppna i editor
        </button>
        <button className="btn small" onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />} Förhandsvisa
        </button>
      </div>
      {open && (
        <div className="import-preview">
          <SongRenderer
            song={parsed}
            opts={{
              transpose: 0,
              preferFlats: songPrefersFlats(parsed, 0),
              notation,
              showChords: true,
              fontSize: 16,
            }}
          />
        </div>
      )}
    </div>
  );
}
