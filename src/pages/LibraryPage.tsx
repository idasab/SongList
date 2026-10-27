import { memo, useCallback, useDeferredValue, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Files, Folder, ListChecks, ListMusic, Music, Plus, Search, SlidersHorizontal, Tag, Tags, User, X } from 'lucide-react';
import { Header, Sheet, toast } from '../components/ui';
import { TagInput } from '../components/TagInput';
import { CategorySelect } from '../components/CategorySelect';
import { NO_ARTIST_GROUP, NO_CATEGORY, filterSongs, groupLetter, keyIdLabel, keysInLibrary, songKey, sortSongs } from '../lib/search';
import { formatKey } from '../lib/chords';
import { allTags, categoryName, liveCategories, liveSongs, normalizeTags, useStore } from '../store/useStore';
import { songFiles, type Song } from '../lib/model';
import { mergeKey, pieceGroups, pieceTitle } from '../lib/fileGroups';
import { mergeSongs } from '../services/mergeSongs';
import { askSubtitleArtist, subtitleToArtist } from '../lib/subtitleArtist';
import { useRememberScroll } from '../hooks/useRememberScroll';
import { ALPHABET, AlphabetIndex } from '../components/AlphabetIndex';

// Filtret sparas mellan sidbyten under sessionen
const session = {
  query: '',
  fullText: false,
  tags: [] as string[],
  categoryId: undefined as string | undefined,
  keyId: undefined as string | undefined,
  showFilters: false,
};

export function LibraryPage() {
  const navigate = useNavigate();
  const scrollRef = useRememberScroll<HTMLDivElement>('library', 'data-song');
  const songsRec = useStore((s) => s.songs);
  const categoriesRec = useStore((s) => s.categories);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const editSongs = useStore((s) => s.editSongs);

  const [query, setQuery] = useState(session.query);
  const [fullText, setFullText] = useState(session.fullText);
  const [tags, setTags] = useState<string[]>(session.tags);
  const [chosenCategory, setCategoryId] = useState(session.categoryId);
  // Ett filter på en kategori som raderats gäller inte längre
  const categoryId = chosenCategory === NO_CATEGORY || categoryName(categoriesRec, chosenCategory) ? chosenCategory : undefined;
  const [key, setKey] = useState(session.keyId);
  const [showFilters, setShowFilters] = useState(session.showFilters || !!categoryId || !!key);
  Object.assign(session, { query, fullText, tags, categoryId, keyId: key, showFilters });

  const songs = useMemo(() => liveSongs(songsRec), [songsRec]);
  // Låtar som ser ut att vara sidor av samma noter ("Låt (1)", "Låt (2)"): förslag att slå ihop
  const [showMerge, setShowMerge] = useState(false);
  // Låtar där undertiteln ser ut att vara artisten
  const [showArtists, setShowArtists] = useState(false);
  const artistSuggestions = useMemo(() => songs.filter(askSubtitleArtist), [songs]);
  const mergeGroups = useMemo(() => {
    const dismissed = new Set(settings.dismissedMerges ?? []);
    return pieceGroups(songs.map((s) => ({ ...s, isFile: !!s.attachment }))).filter((g) => !dismissed.has(mergeKey(g)));
  }, [songs, settings.dismissedMerges]);
  const tagList = useMemo(() => allTags(songsRec), [songsRec]);
  const categories = useMemo(() => liveCategories(categoriesRec), [categoriesRec]);
  const keys = useMemo(() => keysInLibrary(songs), [songs]);
  const sort = settings.librarySort;

  // Sökfältet svarar direkt; listan filtreras om när det finns tid över mellan tangenttrycken
  const deferredQuery = useDeferredValue(query);
  const visible = useMemo(
    () =>
      sortSongs(
        filterSongs(songs, {
          query: deferredQuery,
          fullText,
          tags,
          categoryId,
          keyId: key,
          liveCategories: new Set(categories.map((c) => c.id)),
        }),
        sort,
      ),
    [songs, deferredQuery, fullText, tags, categoryId, key, sort, categories],
  );

  // Markera låtar: i den ordning de valdes (blir ordningen i en ny setlista)
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [sheet, setSheet] = useState<'tags' | 'category' | null>(null);
  const toggleSelected = useCallback(
    (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])),
    [],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allVisibleSelected = visible.length > 0 && visible.every((s) => selectedSet.has(s.id));
  const toggleAll = () => {
    const ids = new Set(visible.map((s) => s.id));
    setSelected(allVisibleSelected ? selected.filter((id) => !ids.has(id)) : [...selected, ...visible.filter((s) => !selectedSet.has(s.id)).map((s) => s.id)]);
  };
  const stopSelecting = () => {
    setSelecting(false);
    setSelected([]);
    setSheet(null);
  };

  // Filter i filterpanelen (taggarna ligger i en egen rad under sökfältet)
  const activeFilters = (categoryId ? 1 : 0) + (key ? 1 : 0);
  // Valda taggar först, så att de syns utan att man behöver svepa
  const tagRow = useMemo(() => [...tags.filter((t) => tagList.includes(t)), ...tagList.filter((t) => !tags.includes(t))], [tags, tagList]);

  const toggleTag = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  // Gruppera på första bokstaven vid sortering på titel/artist
  const groups = useMemo(() => {
    if (sort === 'updated') return [{ letter: '', songs: visible }];
    const out: { letter: string; songs: Song[] }[] = [];
    const byLetter = new Map<string, { letter: string; songs: Song[] }>();
    for (const s of visible) {
      const letter = sort === 'artist' && !s.artist.trim() ? NO_ARTIST_GROUP : groupLetter(sort === 'artist' ? s.artist : s.title);
      // En grupp per bokstav, även om sorteringen och bokstaven någon gång inte går ihop
      let g = byLetter.get(letter);
      if (!g) {
        g = { letter, songs: [] };
        byLetter.set(letter, g);
        out.push(g);
      }
      g.songs.push(s);
    }
    return out;
  }, [visible, sort]);

  // Alfabetsregister när listan är grupperad på bokstav
  const showIndex = groups.length >= 3 && groups[0].letter !== '';
  const available = useMemo(() => new Set(groups.map((g) => g.letter)), [groups]);
  const jumpTo = (letter: string) => {
    const container = scrollRef.current;
    if (!container) return;
    // Närmaste bokstav med låtar, från den valda och framåt (annars den sista)
    const want = ALPHABET.indexOf(letter);
    let best: string | undefined;
    for (const g of groups) {
      const idx = ALPHABET.indexOf(g.letter);
      if (idx >= want && (best === undefined || idx < ALPHABET.indexOf(best))) best = g.letter;
    }
    best ??= groups[groups.length - 1].letter;
    const target = container.querySelector<HTMLElement>(`[data-letter="${CSS.escape(best)}"]`);
    if (!target) return;
    container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top;
  };

  return (
    <div className="screen">
      {selecting ? (
        <Header title={selected.length ? `${selected.length} valda` : 'Välj låtar'}>
          <button className="btn" onClick={toggleAll}>
            {allVisibleSelected ? 'Avmarkera alla' : 'Markera alla'}
          </button>
          <button className="btn" onClick={stopSelecting}>
            Klar
          </button>
        </Header>
      ) : (
        <Header title="Låtar">
          {songs.length > 0 && (
            <button className="btn" onClick={() => setSelecting(true)}>
              <ListChecks size={18} /> Välj
            </button>
          )}
          <button className="btn primary icon-mobile" aria-label="Ny låt" onClick={() => navigate('/new')}>
            <Plus size={18} /> <span className="hide-mobile">Ny låt</span>
          </button>
        </Header>
      )}
      <div className="indexed-body">
      <div className={`content narrow${showIndex ? ' has-index' : ''}`} ref={scrollRef}>
        <div>
          <div className="search-bar">
            <div className="search-input">
              <Search size={18} />
              <input
                className="input"
                type="search"
                placeholder={fullText ? 'Sök i titel, artist och text' : 'Sök titel eller artist'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoCorrect="off"
              />
            </div>
            <button
              className={`btn icon${showFilters || activeFilters ? ' active' : ''}`}
              aria-label="Filter"
              onClick={() => setShowFilters((v) => !v)}
            >
              <SlidersHorizontal size={20} />
            </button>
          </div>

          {tagList.length > 0 && (
            <div className="chips scroll tag-row" aria-label="Filtrera på taggar">
              {tags.length > 0 && (
                <button className="chip" onClick={() => setTags([])} aria-label="Rensa taggar">
                  <X size={14} /> Rensa
                </button>
              )}
              {tagRow.map((t) => (
                <button
                  key={t}
                  className={`chip${tags.includes(t) ? ' on' : ''}`}
                  aria-pressed={tags.includes(t)}
                  onClick={() => toggleTag(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          )}

          {showFilters && (
            <div className="filter-panel card">
              <div className="chips">
                <button className={`chip${fullText ? ' on' : ''}`} onClick={() => setFullText((v) => !v)}>
                  Sök även i texterna
                </button>
              </div>

              <div className="label">Sortera</div>
              <div className="chips">
                {(
                  [
                    ['title', 'Titel'],
                    ['artist', 'Artist'],
                    ['updated', 'Senast ändrad'],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} className={`chip${sort === v ? ' on' : ''}`} onClick={() => updateSettings({ librarySort: v })}>
                    {l}
                  </button>
                ))}
              </div>

              {categories.length > 0 && (
                <>
                  <div className="label">Kategori</div>
                  <div className="chips">
                    <button className={`chip${!categoryId ? ' on' : ''}`} onClick={() => setCategoryId(undefined)}>
                      Alla
                    </button>
                    <button
                      className={`chip${categoryId === NO_CATEGORY ? ' on' : ''}`}
                      onClick={() => setCategoryId(categoryId === NO_CATEGORY ? undefined : NO_CATEGORY)}
                    >
                      Utan kategori
                    </button>
                    {categories.map((c) => (
                      <button
                        key={c.id}
                        className={`chip${categoryId === c.id ? ' on' : ''}`}
                        onClick={() => setCategoryId(categoryId === c.id ? undefined : c.id)}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {keys.length > 0 && (
                <>
                  <div className="label">Tonart</div>
                  <div className="chips">
                    <button className={`chip${!key ? ' on' : ''}`} onClick={() => setKey(undefined)}>
                      Alla
                    </button>
                    {keys.map((k) => (
                      <button key={k} className={`chip${key === k ? ' on' : ''}`} onClick={() => setKey(key === k ? undefined : k)}>
                        {keyIdLabel(k, settings.notation)}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {activeFilters > 0 && (
                <div style={{ marginTop: 10 }}>
                  <button
                    className="btn small"
                    onClick={() => {
                      setCategoryId(undefined);
                      setKey(undefined);
                    }}
                  >
                    <X size={16} /> Rensa filter
                  </button>
                </div>
              )}
            </div>
          )}

          {songs.length === 0 ? (
            <div className="empty">
              <Music size={48} />
              <p>Inga låtar ännu.</p>
              <div className="btn-row" style={{ justifyContent: 'center' }}>
                <button className="btn primary" onClick={() => navigate('/new')}>
                  Skriv en låt
                </button>
                <button className="btn" onClick={() => navigate('/import')}>
                  Importera
                </button>
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div className="empty">
              <p>Inga låtar matchar.</p>
            </div>
          ) : (
            <>
              {mergeGroups.length > 0 && !selecting && (
                <div className="tip small-text merge-tip">
                  <Files size={18} />
                  <div style={{ flex: 1 }}>
                    {mergeGroups.length === 1
                      ? `${mergeGroups[0].length} låtar ser ut att vara sidor av samma noter (${pieceTitle(mergeGroups[0][0].title)}).`
                      : `${mergeGroups.length} låtar ser ut att bestå av flera sidor, t.ex. ${pieceTitle(mergeGroups[0][0].title)}.`}
                  </div>
                  <button className="btn small primary" onClick={() => setShowMerge(true)}>
                    Slå ihop…
                  </button>
                </div>
              )}
              {artistSuggestions.length > 0 && !selecting && (
                <div className="tip small-text merge-tip">
                  <User size={18} />
                  <div style={{ flex: 1 }}>
                    {artistSuggestions.length === 1
                      ? `Undertiteln på ${artistSuggestions[0].title} ser ut att vara artisten (${artistSuggestions[0].subtitle}).`
                      : `${artistSuggestions.length} låtar har en undertitel som ser ut att vara artisten.`}
                  </div>
                  <button className="btn small primary" onClick={() => setShowArtists(true)}>
                    Visa…
                  </button>
                </div>
              )}
              <div className="muted small-text" style={{ margin: '0 4px 6px' }}>
                {visible.length} {visible.length === 1 ? 'låt' : 'låtar'}
              </div>
              {groups.map((g) => (
                <div key={g.letter || 'all'} data-letter={g.letter || undefined}>
                  {g.letter && <div className="letter-head">{g.letter}</div>}
                  <div className="list song-list">
                    {g.songs.map((s) => (
                      <SongRow
                        key={s.id}
                        song={s}
                        categoryName={categoryName(categoriesRec, s.categoryId)}
                        selected={selecting ? selectedSet.has(s.id) : undefined}
                        onToggle={toggleSelected}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      {showIndex && <AlphabetIndex available={available} onPick={jumpTo} />}
      </div>
      {selecting && (
        <div className="select-bar">
          <button className="btn" disabled={!selected.length} onClick={() => setSheet('tags')}>
            <Tags size={18} /> Tagg
          </button>
          <button className="btn" disabled={!selected.length} onClick={() => setSheet('category')}>
            <Tag size={18} /> Kategori
          </button>
          <button
            className="btn primary"
            disabled={!selected.length}
            onClick={() => navigate('/setlists', { state: { newSetlistSongs: selected } })}
          >
            <ListMusic size={18} /> Setlista
          </button>
        </div>
      )}
      {showArtists && <SubtitleArtistSheet songs={artistSuggestions} onClose={() => setShowArtists(false)} />}
      {showMerge && (
        <MergeSheet
          groups={mergeGroups}
          onClose={() => setShowMerge(false)}
          onDismiss={(gs) => void updateSettings({ dismissedMerges: [...(settings.dismissedMerges ?? []), ...gs.map(mergeKey)] })}
        />
      )}
      {sheet === 'tags' && (
        <AddTagsSheet
          count={selected.length}
          suggestions={tagList}
          onClose={() => setSheet(null)}
          onSave={async (add) => {
            const n = await editSongs(selected, { addTags: add });
            toast(n ? `${add.length === 1 ? 'Taggen' : 'Taggarna'} lades till på ${songCountText(n)}` : 'Låtarna hade redan taggarna');
            stopSelecting();
          }}
        />
      )}
      {sheet === 'category' && (
        <CategorySheet
          count={selected.length}
          onClose={() => setSheet(null)}
          onSave={async (id) => {
            const n = await editSongs(selected, { categoryId: id || null });
            const name = categoryName(useStore.getState().categories, id);
            toast(n ? `${songCountText(n)} ${name ? `fick kategorin ${name}` : 'har nu ingen kategori'}` : 'Låtarna hade redan den kategorin');
            stopSelecting();
          }}
        />
      )}
    </div>
  );
}

// Raden ritas bara om när låten själv ändras, inte vid varje ändring i listan
const SongRow = memo(function SongRow({
  song,
  categoryName,
  selected,
  onToggle,
}: {
  song: Song;
  categoryName?: string;
  /** Satt i valläget: om låten är markerad */
  selected?: boolean;
  onToggle: (id: string) => void;
}) {
  const notation = useStore((s) => s.settings.notation);
  const key = songKey(song);
  const selecting = selected !== undefined;
  return (
    <Link
      className={`list-item${selected ? ' selected' : ''}`}
      to={`/song/${song.id}`}
      data-song={song.id}
      aria-pressed={selecting ? selected : undefined}
      onClick={(e) => {
        if (!selecting) return;
        e.preventDefault();
        onToggle(song.id);
      }}
    >
      {selecting && (
        <span className={`select-mark${selected ? ' on' : ''}`}>{selected && <Check size={16} strokeWidth={3} />}</span>
      )}
      <div className="main">
        <div className="title">
          {song.title}
          {song.subtitle && <span className="alt-title"> · {song.subtitle}</span>}
        </div>
        {song.artist && <div className="sub">{song.artist}</div>}
        {/* Kategorin på samma rad som taggarna */}
        {(song.tags.length > 0 || categoryName) && (
          <div className="meta">
            {categoryName && (
              <span className="chip tag category-tag" title="Kategori">
                <Folder size={12} /> {categoryName}
              </span>
            )}
            {song.tags.map((t) => (
              <span className="chip tag" key={t}>
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      {song.attachment ? (
        <span className="badge" title={songFiles(song).map((a) => a.name).join(', ')}>
          {song.attachment.kind === 'pdf' ? 'PDF' : 'Bild'}
          {song.extraAttachments?.length ? ` · ${song.extraAttachments.length + 1}` : ''}
        </span>
      ) : key && (
        <div
          className={`key-badge${key.guessed ? ' guessed' : ''}`}
          title={key.guessed ? 'Tonarten är gissad från första ackordet' : undefined}
        >
          {formatKey(key.key, 0, notation)}
        </div>
      )}
    </Link>
  );
});

function songCountText(n: number): string {
  return `${n} ${n === 1 ? 'låt' : 'låtar'}`;
}

function AddTagsSheet({
  count,
  suggestions,
  onClose,
  onSave,
}: {
  count: number;
  suggestions: string[];
  onClose: () => void;
  onSave: (tags: string[]) => void;
}) {
  const [tags, setTags] = useState<string[]>([]);
  // Även en tagg som skrivits men inte bekräftats med Enter räknas
  const [text, setText] = useState('');
  const all = normalizeTags([...tags, ...text.split(',')]);
  return (
    <Sheet
      title={`Tagga ${songCountText(count)}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Avbryt
          </button>
          <button className="btn primary" disabled={!all.length} onClick={() => onSave(all)}>
            Lägg till
          </button>
        </>
      }
    >
      <div className="field">
        <span>Taggar att lägga till</span>
        <TagInput value={tags} onChange={setTags} suggestions={suggestions} onTextChange={setText} />
      </div>
      <p className="muted small-text">Låtarnas andra taggar finns kvar.</p>
    </Sheet>
  );
}

function CategorySheet({ count, onClose, onSave }: { count: number; onClose: () => void; onSave: (id: string) => void }) {
  const [id, setId] = useState('');
  return (
    <Sheet
      title={`Kategori för ${songCountText(count)}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Avbryt
          </button>
          <button className="btn primary" onClick={() => onSave(id)}>
            Spara
          </button>
        </>
      }
    >
      <label className="field">
        <span>Kategori</span>
        <CategorySelect value={id} onChange={setId} />
      </label>
      <p className="muted small-text">Ersätter låtarnas nuvarande kategori. Välj Ingen för att ta bort den.</p>
    </Sheet>
  );
}

/** Förslag att slå ihop sidor av samma noter: varje grupp kan väljas bort. */
function MergeSheet({ groups, onClose, onDismiss }: { groups: Song[][]; onClose: () => void; onDismiss: (groups: Song[][]) => void }) {
  const [chosen, setChosen] = useState(() => new Set(groups.map(mergeKey)));
  const [busy, setBusy] = useState(false);
  const picked = groups.filter((g) => chosen.has(mergeKey(g)));
  const toggle = (g: Song[]) =>
    setChosen((cur) => {
      const next = new Set(cur);
      if (next.has(mergeKey(g))) next.delete(mergeKey(g));
      else next.add(mergeKey(g));
      return next;
    });
  const merge = async () => {
    setBusy(true);
    try {
      for (const g of picked) await mergeSongs(g.map((s) => s.id));
      // De som valdes bort föreslås inte igen
      onDismiss(groups.filter((g) => !chosen.has(mergeKey(g))));
      toast(picked.length === 1 ? 'Låtarna är ihopslagna' : `${picked.length} låtar är ihopslagna`);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Slå ihop sidor" onClose={onClose}>
      <p className="muted small-text" style={{ marginTop: 0 }}>
        Varje grupp blir en låt med filerna i tur och ordning. Setlistor som har låtarna får den ihopslagna låten.
      </p>
      <div className="merge-groups">
        {groups.map((g) => (
          <label key={mergeKey(g)} className={`merge-group${chosen.has(mergeKey(g)) ? ' on' : ''}`}>
            <input type="checkbox" checked={chosen.has(mergeKey(g))} onChange={() => toggle(g)} />
            <div>
              <b>{pieceTitle(g[0].title)}</b>
              {g[0].artist && <span className="muted"> – {g[0].artist}</span>}
              <div className="muted small-text">{g.map((s) => s.title).join(' + ')}</div>
            </div>
          </label>
        ))}
      </div>
      <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button
          className="btn"
          disabled={busy}
          onClick={() => {
            onDismiss(groups);
            onClose();
          }}
        >
          Föreslå inte igen
        </button>
        <button className="btn primary" disabled={busy || !picked.length} onClick={() => void merge()}>
          {busy ? 'Slår ihop…' : picked.length === groups.length ? 'Slå ihop alla' : `Slå ihop ${picked.length}`}
        </button>
      </div>
    </Sheet>
  );
}

/** Undertitlar som ser ut att vara artisten: de valda flyttas, de andra frågas det inte om igen. */
function SubtitleArtistSheet({ songs, onClose }: { songs: Song[]; onClose: () => void }) {
  const saveSong = useStore((s) => s.saveSong);
  const updateSongPrefs = useStore((s) => s.updateSongPrefs);
  // Låtarna när rutan öppnades, så att listan inte krymper medan man sparar
  const [list] = useState(songs);
  const [chosen, setChosen] = useState(() => new Set(songs.map((s) => s.id)));
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) =>
    setChosen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const apply = async () => {
    setBusy(true);
    try {
      for (const s of list) {
        if (chosen.has(s.id)) await saveSong({ id: s.id, content: subtitleToArtist(s.content, s.subtitle!) });
        else await updateSongPrefs(s.id, { subtitleNotArtist: s.subtitle });
      }
      const n = list.filter((s) => chosen.has(s.id)).length;
      toast(n ? `Artisten är ändrad på ${songCountText(n)}` : 'Undertitlarna står kvar');
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Undertitel eller artist?" onClose={onClose}>
      <p className="muted small-text" style={{ marginTop: 0 }}>
        De valda låtarna får undertiteln som artist. För de andra står undertiteln kvar, och appen frågar inte igen.
      </p>
      <div className="merge-groups">
        {list.map((s) => (
          <label key={s.id} className={`merge-group${chosen.has(s.id) ? ' on' : ''}`}>
            <input type="checkbox" checked={chosen.has(s.id)} onChange={() => toggle(s.id)} />
            <div>
              <b>{s.title}</b>
              <div className="muted small-text">Artist: {s.subtitle}</div>
            </div>
          </label>
        ))}
      </div>
      <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn" disabled={busy} onClick={onClose}>
          Senare
        </button>
        <button className="btn primary" disabled={busy} onClick={() => void apply()}>
          {busy ? 'Sparar…' : chosen.size ? `Gör ${chosen.size} till artist` : 'Inga är artister'}
        </button>
      </div>
    </Sheet>
  );
}
