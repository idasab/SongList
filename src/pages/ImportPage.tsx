import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ChevronDown, ChevronUp, ClipboardPaste, FileUp, Image as ImageIcon, Lightbulb, Pencil, X } from 'lucide-react';
import { SongRenderer } from '../components/SongRenderer';
import { TagInput } from '../components/TagInput';
import { CategorySelect, SAME_AS_ALL } from '../components/CategorySelect';
import { Header, Segmented, Sheet, toast, toastError } from '../components/ui';
import { parseChordPro, shapesToSounding } from '../lib/chordpro';
import {
  SOURCE_FONTS,
  canvasMeasure,
  isChordProFileName,
  looksLikeChordPro,
  suggestSourceFont,
  textToChordPro,
  titleFromFileName,
  type SourceFont,
} from '../lib/textImport';
import { newId, type Song } from '../lib/model';
import { canUseDocumentScanner, recognizeImageFile, scanDocument } from '../services/ocr';
import { pickFiles } from '../services/files';
import { attachmentToFile, expandFiles, interpretFile } from '../services/fileImport';
import { allTags, categoryName, liveSongs, normalizeTags, useStore, type DuplicateAction, type ImportQueueItem } from '../store/useStore';
import { findDuplicates, type Duplicate } from '../lib/duplicates';
import {
  existingSongs,
  importSharedSetlist,
  isSharedSetlistFile,
  receiveSharedText,
  useIncomingShare,
  type SharedSetlist,
} from '../services/setlistShare';
import { formatDate } from './SetlistsPage';

type ImportItem = ImportQueueItem;

/** Kategori och taggar som en låt får vid import. */
function resolveMeta(it: ImportItem, common: { tags: string[]; categoryId: string }) {
  return {
    categoryId: it.categoryId === undefined ? common.categoryId : it.categoryId,
    tags: [...common.tags, ...(it.tags ?? [])],
  };
}

function convert(item: ImportItem): string {
  if (item.kind === 'chordpro') return item.raw;
  return textToChordPro(item.raw, { measure: canvasMeasure(item.font), fileName: item.fileName });
}

/** Låtens text vid import: bara titeln när filen ska visas som original. */
function contentFor(item: ImportItem): string {
  if (item.display !== 'file') return convert(item);
  const title = parseChordPro(convert(item)).meta.title || titleFromFileName(item.fileName);
  return `{title: ${title}}\n`;
}

/** Låtens text som den sparas (ackord skrivna som grepp skrivs om). */
function savedContent(item: ImportItem): string {
  return item.display === 'file' ? contentFor(item) : shapesToSounding(contentFor(item));
}

/** Förval för en dubblett: en likadan låt hoppas över, annars läggs den till. */
function duplicateAction(item: ImportItem, dup: Duplicate | undefined): DuplicateAction {
  if (!dup) return 'add';
  const chosen = item.duplicate ?? (dup.identical ? 'skip' : 'add');
  // Ersätta går bara när dubbletten finns i biblioteket
  return chosen === 'replace' && !dup.song ? 'add' : chosen;
}

// Valet för PDF och bilder sparas under sessionen
const importPrefs = { keepOriginals: true };

const ACCEPT =
  '.cho,.chopro,.chordpro,.crd,.pro,.txt,.text,text/plain,.pdf,application/pdf,.zip,application/zip,image/*,.songlist';

export function ImportPage() {
  const navigate = useNavigate();
  const importSongs = useStore((s) => s.importSongs);
  const saveSong = useStore((s) => s.saveSong);
  const setDraft = useStore((s) => s.setDraft);
  const songsRec = useStore((s) => s.songs);
  const categoriesRec = useStore((s) => s.categories);
  // Importlistan ligger i appens minne, så att den finns kvar när man byter sida
  const queue = useStore((s) => s.importQueue);
  const updateQueue = useStore((s) => s.updateImportQueue);
  const resetQueue = useStore((s) => s.resetImportQueue);
  const { items, tags, categoryId } = queue;
  const setItems = (next: ImportItem[] | ((cur: ImportItem[]) => ImportItem[])) =>
    updateQueue((q) => ({ ...q, items: typeof next === 'function' ? next(q.items) : next }));
  const setTags = (t: string[]) => updateQueue((q) => ({ ...q, tags: t }));
  const setCategoryId = (id: string) => updateQueue((q) => ({ ...q, categoryId: id }));
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [busy, setBusy] = useState<{ message: string; progress?: number } | null>(null);
  const [keepOriginals, setKeepOriginals] = useState(importPrefs.keepOriginals);

  // Förslag: taggar från sparade låtar och taggar som lagts till i importlistan
  const tagSuggestions = useMemo(
    () =>
      normalizeTags([...allTags(songsRec), ...tags, ...items.flatMap((it) => it.tags ?? [])]).sort((a, b) =>
        a.localeCompare(b, 'sv'),
      ),
    [songsRec, tags, items],
  );

  const addRaw = (fileName: string, input: string, extra: Partial<ImportItem> = {}) => {
    // å, ä och ö som bokstav + prick/ring görs om till ett tecken
    const raw = input.normalize('NFC');
    // Filändelsen avgör först (.cho, .chopro …), annars innehållet
    const kind =
      extra.kind ?? (isChordProFileName(fileName) || looksLikeChordPro(raw) ? 'chordpro' : 'text');
    const font = kind === 'text' ? suggestSourceFont(raw, canvasMeasure) : 'monospace';
    setItems((cur) => [...cur, { id: newId(), fileName, raw, font, ...extra, kind }]);
  };

  const chooseFiles = async () => {
    const picked = await pickFiles({ accept: ACCEPT, multiple: true });
    // En delad setlista (.songlist) importeras för sig
    const shared = picked.filter((f) => isSharedSetlistFile(f.name));
    if (shared.length) await receiveSharedText(await shared[0].text());
    const files = picked.filter((f) => !isSharedSetlistFile(f.name));
    if (!files.length) return;
    setBusy({ message: 'Läser filer…' });
    try {
      const { items: found, skipped } = await expandFiles(files, (message, progress) => setBusy({ message, progress }), {
        keepOriginals,
      });
      for (const c of found)
        addRaw(c.fileName, c.raw, {
          kind: c.kind,
          origin: c.origin,
          imageDataUrl: c.imageDataUrl,
          original: c.original,
          previewDataUrl: c.previewDataUrl,
          display: c.display,
          interpreted: c.interpreted,
        });
      if (skipped.length) {
        const list = skipped.slice(0, 3).map((x) => `${x.name} (${x.reason})`).join(', ');
        toast(`${skipped.length} ${skipped.length === 1 ? 'fil' : 'filer'} hoppades över: ${list}${skipped.length > 3 ? ' …' : ''}`, {
          error: true,
        });
      } else if (found.length > 1) {
        toast(`${found.length} låtar lades till i listan`);
      }
    } catch (e) {
      toastError(e, 'Kunde inte läsa filerna');
    } finally {
      setBusy(null);
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

  // Låtar som redan finns i biblioteket eller tidigare i importen
  const duplicates = useMemo(
    () =>
      findDuplicates(
        items.map((it) => {
          const content = savedContent(it);
          const meta = parseChordPro(content).meta;
          return {
            title: meta.title?.trim() || titleFromFileName(it.fileName),
            artist: meta.artist ?? '',
            content,
            fileData: it.display === 'file' ? it.original?.dataUrl : undefined,
          };
        }),
        liveSongs(songsRec),
      ),
    [items, songsRec],
  );
  const actions = items.map((it, i) => duplicateAction(it, duplicates[i]));
  const dupCount = duplicates.filter(Boolean).length;
  const toImport = actions.filter((a) => a !== 'skip').length;
  const setAllDuplicates = (action: DuplicateAction) =>
    setItems((cur) => cur.map((x, i) => (duplicates[i] ? { ...x, duplicate: action } : x)));

  const [importing, setImporting] = useState(false);
  // Spärr som slår till direkt: ett dubbeltryck ska inte importera allt två gånger
  const importingRef = useRef(false);
  const importAll = async () => {
    if (importingRef.current) return;
    importingRef.current = true;
    setImporting(true);
    const list = items
      .filter((_, i) => actions[i] === 'add')
      .map((it) => ({
        content: contentFor(it),
        attachment: it.display === 'file' ? it.original : undefined,
        ...resolveMeta(it, { tags, categoryId }),
      }));
    let songs: Awaited<ReturnType<typeof importSongs>>;
    let replaced = 0;
    try {
      songs = await importSongs(list);
      // Ersätt: låtens text eller fil byts, taggar läggs till och kategorin behålls om ingen valts
      for (const [i, it] of items.entries()) {
        const old = duplicates[i]?.song;
        if (actions[i] !== 'replace' || !old) continue;
        const meta = resolveMeta(it, { tags, categoryId });
        await saveSong({
          id: old.id,
          content: savedContent(it),
          attachment: it.display === 'file' ? it.original : null,
          tags: [...old.tags, ...meta.tags],
          categoryId: meta.categoryId || old.categoryId,
        });
        replaced++;
      }
    } catch (e) {
      importingRef.current = false;
      setImporting(false);
      toastError(e, 'Importen misslyckades');
      return;
    }
    importingRef.current = false;
    setImporting(false);
    const skipped = items.length - songs.length - replaced;
    toast(
      [
        songs.length || !replaced ? `${songs.length} ${songs.length === 1 ? 'låt' : 'låtar'} importerade` : '',
        replaced ? `${replaced} ${replaced === 1 ? 'ersatt' : 'ersatta'}` : '',
        skipped ? `${skipped} hoppades över` : '',
      ]
        .filter(Boolean)
        .join(', '),
    );
    resetQueue();
    if (songs.length === 1 && !replaced) navigate(`/song/${songs[0].id}`);
    else navigate('/');
  };

  const openInEditor = (it: ImportItem) => {
    // Låten ligger kvar i listan tills den sparas i editorn
    setDraft({
      // Ackord skrivna som grepp skrivs om redan här, så att editorn visar det som sparas
      content: it.display === 'file' ? contentFor(it) : shapesToSounding(contentFor(it)),
      imageDataUrl: it.display === 'file' ? undefined : it.imageDataUrl,
      attachment: it.display === 'file' ? it.original : undefined,
      importItemId: it.id,
      ...resolveMeta(it, { tags, categoryId }),
    });
    navigate('/new');
  };

  const nativeScanner = canUseDocumentScanner();

  return (
    <div className="screen">
      <Header title="Importera" />
      <div className="content narrow">
        <div>
          <div className="toggle-row choice-row import-mode">
            <div>
              <div>PDF och bilder</div>
              <div className="muted small-text">Behåll som fil passar t.ex. noter. Du kan ändra per fil i listan.</div>
            </div>
            <Segmented
              value={keepOriginals ? 'file' : 'chordpro'}
              onChange={(v) => {
                importPrefs.keepOriginals = v === 'file';
                setKeepOriginals(v === 'file');
              }}
              options={[
                { value: 'file', label: 'Behåll som fil' },
                { value: 'chordpro', label: 'Tolka text och ackord' },
              ]}
            />
          </div>

          <div className="import-actions">
            <button className="big-action" onClick={chooseFiles}>
              <FileUp size={22} />
              <b>Välj filer</b>
              <span>ChordPro, textfiler, PDF, bilder eller en zip-fil med flera</span>
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

              <div className="card">
                <h2 style={{ marginBottom: 4 }}>För alla låtar</h2>
                <p className="muted small-text" style={{ marginTop: 0 }}>
                  Gäller alla låtar nedan. Du kan välja en annan kategori och lägga till fler taggar på varje låt.
                </p>
                <div className="grid-2">
                  <label className="field">
                    <span>Kategori</span>
                    <CategorySelect value={categoryId} onChange={setCategoryId} />
                  </label>
                  <div className="field">
                    <span>Taggar</span>
                    <TagInput value={tags} onChange={setTags} suggestions={tagSuggestions} />
                  </div>
                </div>
              </div>

              {dupCount > 0 && (
                <div className="card dup-summary">
                  <div>
                    <b>
                      {dupCount} {dupCount === 1 ? 'låt finns' : 'låtar finns'} redan
                    </b>
                    <div className="muted small-text">
                      Likadana låtar hoppas över, övriga läggs till. Du kan välja för varje låt nedan.
                    </div>
                  </div>
                  <div className="btn-row">
                    <button className="btn small" onClick={() => setAllDuplicates('skip')}>
                      Hoppa över alla
                    </button>
                    <button className="btn small" onClick={() => setAllDuplicates('add')}>
                      Lägg till alla
                    </button>
                  </div>
                </div>
              )}

              {items.map((it, i) => (
                <ImportItemCard
                  key={it.id}
                  item={it}
                  duplicate={duplicates[i]}
                  action={actions[i]}
                  onChange={(next) => setItems((cur) => cur.map((x) => (x.id === it.id ? next : x)))}
                  onPatch={(patch) => setItems((cur) => cur.map((x) => (x.id === it.id ? { ...x, ...patch } : x)))}
                  onRemove={() => setItems((cur) => cur.filter((x) => x.id !== it.id))}
                  onEdit={() => openInEditor(it)}
                  commonCategoryName={categoryName(categoriesRec, categoryId)}
                  tagSuggestions={tagSuggestions}
                />
              ))}

              <div className="card">
                <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn" onClick={() => setItems([])}>
                    Rensa
                  </button>
                  <button className="btn primary" disabled={importing || !toImport} onClick={importAll}>
                    Importera {toImport} {toImport === 1 ? 'låt' : 'låtar'}
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

      <SharedSetlistSheet />

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
  duplicate,
  action,
  onChange,
  onPatch,
  onRemove,
  onEdit,
  commonCategoryName,
  tagSuggestions,
}: {
  item: ImportItem;
  duplicate?: Duplicate;
  action: DuplicateAction;
  onChange: (i: ImportItem) => void;
  /** Ändrar bara de angivna fälten i den aktuella versionen (för resultat som kommer senare) */
  onPatch: (patch: Partial<ImportItem>) => void;
  onRemove: () => void;
  onEdit: () => void;
  commonCategoryName?: string;
  tagSuggestions: string[];
}) {
  const [open, setOpen] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [bigPreview, setBigPreview] = useState(false);
  const [interpreting, setInterpreting] = useState('');
  const notation = useStore((s) => s.settings.notation);
  // Som den blir efter importen (ackord skrivna som grepp skrivs om)
  const content = useMemo(() => shapesToSounding(convert(item)), [item]);
  const parsed = useMemo(() => parseChordPro(content), [content]);
  const asFile = item.display === 'file';

  const setDisplay = async (display: 'chordpro' | 'file') => {
    if (display === 'file' || item.interpreted || !item.original) {
      onChange({ ...item, display });
      return;
    }
    // Filen har inte tolkats än: gör det nu
    try {
      setInterpreting('Tolkar…');
      const file = await attachmentToFile(item.original);
      const res = await interpretFile(file, item.original.kind, (m) => setInterpreting(m));
      // Bara tolkningens fält: annat som ändrats medan tolkningen pågick ska vara kvar
      onPatch({ raw: res.raw, imageDataUrl: res.imageDataUrl, interpreted: true, display: 'chordpro' });
    } catch {
      toast('Hittade ingen text och inga ackord att tolka i filen', { error: true });
    } finally {
      setInterpreting('');
    }
  };

  return (
    <div className={`import-item${action === 'skip' ? ' skipped' : ''}`}>
      <div className="head">
        {item.previewDataUrl && (
          <button className="import-thumb" onClick={() => setBigPreview(true)} aria-label="Visa filen större">
            <img src={item.previewDataUrl} alt="" />
          </button>
        )}
        <div className="main">
          <div style={{ fontWeight: 600 }}>{(asFile ? null : parsed.meta.title) || titleFromFileName(item.fileName)}</div>
          <div className="muted small-text">
            {parsed.meta.artist ? parsed.meta.artist + ' · ' : ''}
            {item.fileName}
          </div>
        </div>
        {item.origin && (
          <span className="badge review" title="Tolkat automatiskt – granska innan du importerar">
            {item.origin === 'pdf' ? 'PDF' : 'Bild'}
          </span>
        )}
        <span className="badge">{asFile ? 'Fil' : item.kind === 'chordpro' ? 'ChordPro' : 'Text'}</span>
        <button className="btn ghost icon" aria-label="Ta bort" onClick={onRemove}>
          <X size={18} />
        </button>
      </div>
      {duplicate && (
        <div className="opts dup-row">
          <div className="small-text">
            <b>{duplicate.song ? 'Finns redan' : 'Finns redan i importen'}</b>
            {duplicate.identical ? ', likadan' : ''}: {duplicate.title}
            {duplicate.song?.artist ? ` – ${duplicate.song.artist}` : ''}
            {duplicate.otherPage && <div className="muted">Kan vara en annan sida av samma noter.</div>}
          </div>
          <Segmented
            value={action}
            onChange={(v) => onChange({ ...item, duplicate: v })}
            options={[
              { value: 'add', label: 'Lägg till' },
              { value: 'skip', label: 'Hoppa över' },
              ...(duplicate.song ? [{ value: 'replace' as const, label: 'Ersätt' }] : []),
            ]}
          />
        </div>
      )}
      {item.original && (
        <div className="opts">
          <Segmented
            value={item.display ?? 'chordpro'}
            onChange={(v) => void setDisplay(v)}
            options={[
              { value: 'file', label: item.original.kind === 'pdf' ? 'Originalfil (PDF)' : 'Originalfil (bild)' },
              { value: 'chordpro', label: 'Text och ackord' },
            ]}
          />
          {interpreting && <span className="muted small-text">{interpreting}</span>}
        </div>
      )}
      <div className="opts">
        {item.kind === 'text' && !asFile && (
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
        {!asFile && (
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
        )}
        <label className="small-text" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          Kategori
          <CategorySelect
            value={item.categoryId ?? SAME_AS_ALL}
            onChange={(v) => onChange({ ...item, categoryId: v === SAME_AS_ALL ? undefined : v })}
            sameAsAllLabel={`Som för alla${commonCategoryName ? ` (${commonCategoryName})` : ''}`}
          />
        </label>
        <button className={`btn small${showTags || item.tags?.length ? ' active' : ''}`} onClick={() => setShowTags((v) => !v)}>
          Taggar{item.tags?.length ? ` (${item.tags.length})` : ''}
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn small" onClick={onEdit}>
          <Pencil size={15} /> Öppna i editor
        </button>
        <button className="btn small" onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />} Förhandsvisa
        </button>
      </div>
      {showTags && (
        <div className="opts" style={{ display: 'block' }}>
          <TagInput value={item.tags ?? []} onChange={(t) => onChange({ ...item, tags: t })} suggestions={tagSuggestions} />
        </div>
      )}
      {bigPreview && item.previewDataUrl && (
        <Sheet title={item.fileName} onClose={() => setBigPreview(false)}>
          <img className="import-big-preview" src={item.previewDataUrl} alt={item.fileName} />
          {item.original?.kind === 'pdf' && <p className="muted small-text">Första sidan av PDF:en.</p>}
        </Sheet>
      )}
      {open && asFile && item.previewDataUrl && (
        <div className="import-preview">
          <img className="import-big-preview" src={item.previewDataUrl} alt={item.fileName} />
        </div>
      )}
      {open && !asFile && (
        <div className="import-preview">
          <SongRenderer
            song={parsed}
            opts={{
              transpose: 0,
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

/** En delad setlista från någon annan med SongList: visar vad som läggs till och importerar. */
function SharedSetlistSheet() {
  const navigate = useNavigate();
  const shared = useIncomingShare((s) => s.shared);
  const setShared = useIncomingShare((s) => s.setShared);
  const songs = useStore((s) => s.songs);
  const [busy, setBusy] = useState(false);
  if (!shared) return null;
  const run = async () => {
    setBusy(true);
    try {
      const sl = await importSharedSetlist(shared);
      setShared(null);
      toast(`Setlistan ${sl.name} är tillagd`);
      navigate(`/setlists/${sl.id}`);
    } catch (e) {
      toastError(e, 'Setlistan kunde inte importeras');
    } finally {
      setBusy(false);
    }
  };
  return <SharedSetlistSummary shared={shared} songs={songs} busy={busy} onClose={() => setShared(null)} onImport={run} />;
}

function SharedSetlistSummary({
  shared,
  songs,
  busy,
  onClose,
  onImport,
}: {
  shared: SharedSetlist;
  songs: Record<string, Song>;
  busy: boolean;
  onClose: () => void;
  onImport: () => void;
}) {
  const have = useMemo(() => existingSongs(shared, songs).size, [shared, songs]);
  const total = shared.songs.length;
  const added = total - have;
  return (
    <Sheet
      title="Importera setlista"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Avbryt
          </button>
          <button className="btn primary" disabled={busy} onClick={onImport}>
            {busy ? 'Importerar…' : 'Importera'}
          </button>
        </>
      }
    >
      <h2 style={{ margin: '0 0 2px' }}>{shared.setlist.name}</h2>
      {shared.setlist.date && <div className="muted small-text">{formatDate(shared.setlist.date)}</div>}
      <p>
        {total} {total === 1 ? 'låt' : 'låtar'}
        {have > 0 ? `, varav ${have} redan finns och används som de är` : ''}.
        {added > 0 ? ` ${added} läggs till i ditt bibliotek.` : ''}
      </p>
      <div className="list small-text">
        {shared.songs.map((s) => (
          <div className="list-item" key={s.id}>
            <div className="main">
              <div className="title">{s.title}</div>
              {s.artist && <div className="sub">{s.artist}</div>}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
