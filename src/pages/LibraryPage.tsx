import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Music, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { Header } from '../components/ui';
import { filterSongs, keyIdLabel, keysInLibrary, songKey, sortSongs } from '../lib/search';
import { formatKey } from '../lib/chords';
import { allTags, liveCategories, liveSongs, useStore } from '../store/useStore';
import type { Song } from '../lib/model';
import { useRememberScroll } from '../hooks/useRememberScroll';

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
  const scrollRef = useRememberScroll<HTMLDivElement>('library');
  const songsRec = useStore((s) => s.songs);
  const categoriesRec = useStore((s) => s.categories);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  const [query, setQuery] = useState(session.query);
  const [fullText, setFullText] = useState(session.fullText);
  const [tags, setTags] = useState<string[]>(session.tags);
  const [categoryId, setCategoryId] = useState(session.categoryId);
  const [key, setKey] = useState(session.keyId);
  const [showFilters, setShowFilters] = useState(session.showFilters || !!categoryId || !!key);
  Object.assign(session, { query, fullText, tags, categoryId, keyId: key, showFilters });

  const songs = useMemo(() => liveSongs(songsRec), [songsRec]);
  const tagList = useMemo(() => allTags(songsRec), [songsRec]);
  const categories = useMemo(() => liveCategories(categoriesRec), [categoriesRec]);
  const keys = useMemo(() => keysInLibrary(songs), [songs]);
  const sort = settings.librarySort;

  const visible = useMemo(
    () => sortSongs(filterSongs(songs, { query, fullText, tags, categoryId, keyId: key }), sort),
    [songs, query, fullText, tags, categoryId, key, sort],
  );

  // Filter i filterpanelen (taggarna ligger i en egen rad under sökfältet)
  const activeFilters = (categoryId ? 1 : 0) + (key ? 1 : 0);
  // Valda taggar först, så att de syns utan att man behöver svepa
  const tagRow = useMemo(() => [...tags.filter((t) => tagList.includes(t)), ...tagList.filter((t) => !tags.includes(t))], [tags, tagList]);

  const toggleTag = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  // Gruppera på första bokstaven vid sortering på titel/artist
  const groups = useMemo(() => {
    if (sort === 'updated') return [{ letter: '', songs: visible }];
    const out: { letter: string; songs: Song[] }[] = [];
    for (const s of visible) {
      const src = sort === 'artist' ? s.artist || '–' : s.title;
      const ch = src.charAt(0).toLocaleUpperCase('sv');
      const letter = /[A-ZÅÄÖ]/.test(ch) ? ch : '#';
      if (!out.length || out[out.length - 1].letter !== letter) out.push({ letter, songs: [] });
      out[out.length - 1].songs.push(s);
    }
    return out;
  }, [visible, sort]);

  return (
    <div className="screen">
      <Header title="Låtar">
        <button className="btn primary icon-mobile" aria-label="Ny låt" onClick={() => navigate('/new')}>
          <Plus size={18} /> <span className="hide-mobile">Ny låt</span>
        </button>
      </Header>
      <div className="content narrow" ref={scrollRef}>
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
              <div className="muted small-text" style={{ margin: '0 4px 6px' }}>
                {visible.length} {visible.length === 1 ? 'låt' : 'låtar'}
              </div>
              {groups.map((g) => (
                <div key={g.letter || 'all'}>
                  {g.letter && <div className="letter-head">{g.letter}</div>}
                  <div className="list">
                    {g.songs.map((s) => (
                      <SongRow key={s.id} song={s} categoryName={s.categoryId ? categoriesRec[s.categoryId]?.name : undefined} />
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SongRow({ song, categoryName }: { song: Song; categoryName?: string }) {
  const notation = useStore((s) => s.settings.notation);
  const key = songKey(song);
  return (
    <Link className="list-item" to={`/song/${song.id}`}>
      <div className="main">
        <div className="title">{song.title}</div>
        {(song.artist || categoryName) && (
          <div className="sub">
            {song.artist}
            {song.artist && categoryName ? ' · ' : ''}
            {categoryName}
          </div>
        )}
        {song.tags.length > 0 && (
          <div className="meta">
            {song.tags.map((t) => (
              <span className="chip tag" key={t}>
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      {key && (
        <div
          className={`key-badge${key.guessed ? ' guessed' : ''}`}
          title={key.guessed ? 'Tonarten är gissad från första ackordet' : undefined}
        >
          {formatKey(key.key, 0, notation)}
        </div>
      )}
    </Link>
  );
}
