import { useEffect, useState } from 'react';
import { NavLink, Outlet, RouterProvider, createHashRouter } from 'react-router-dom';
import { FileUp, ListMusic, Music, Settings } from 'lucide-react';
import { AskTextHost, Toaster, toast } from './components/ui';
import { consumeUpdateNotice, prefetchLazyParts } from './appUpdate';
import { preloadChordDb } from './lib/chordShapes';
import { EditorPage } from './pages/EditorPage';
import { ImportPage } from './pages/ImportPage';
import { LibraryPage } from './pages/LibraryPage';
import { SetlistPage } from './pages/SetlistPage';
import { SetlistsPage } from './pages/SetlistsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SongPage } from './pages/SongPage';
import { listenForSharedFiles } from './services/setlistShare';
import { startAutoSync } from './services/sync';
import { useStore } from './store/useStore';

const TABS = [
  { to: '/', label: 'Låtar', Icon: Music },
  { to: '/setlists', label: 'Setlistor', Icon: ListMusic },
  { to: '/import', label: 'Importera', Icon: FileUp },
  { to: '/settings', label: 'Inställningar', Icon: Settings },
];

function TabLayout() {
  return (
    <>
      <Outlet />
      <nav className="tabbar">
        {TABS.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} aria-label={label} title={label}>
            <span className="tab-icon">
              <Icon size={22} />
            </span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}

/** Låter appen fylla den synliga ytan, så att innehåll längst ner hamnar ovanför tangentbordet. */
function useVisibleHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      document.documentElement.style.setProperty('--app-height', `${vv.height}px`);
      // iOS kan skjuta upp sidan när ett fält får fokus; håll den på plats
      if (window.scrollY) window.scrollTo(0, 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
}

function Root() {
  useVisibleHeight();
  return (
    <div className="app">
      <Outlet />
      <Toaster />
      <AskTextHost />
    </div>
  );
}

const router = createHashRouter([
  {
    element: <Root />,
    children: [
      {
        element: <TabLayout />,
        children: [
          { path: '/', element: <LibraryPage /> },
          { path: '/setlists', element: <SetlistsPage /> },
          { path: '/import', element: <ImportPage /> },
          { path: '/settings', element: <SettingsPage /> },
        ],
      },
      { path: '/song/:id', element: <SongPage /> },
      { path: '/song/:id/edit', element: <EditorPage /> },
      { path: '/new', element: <EditorPage /> },
      { path: '/setlists/:id', element: <SetlistPage /> },
      { path: '*', element: <LibraryPage /> },
    ],
  },
]);

export function App() {
  const ready = useStore((s) => s.ready);
  const theme = useStore((s) => s.settings.theme);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    useStore
      .getState()
      .init()
      .catch((e) => {
        // Biblioteket gick inte att öppna: visa felet i stället för en tom skärm
        setStartError(e instanceof Error ? e.message : String(e));
        throw e;
      })
      .then(() => {
        if (consumeUpdateNotice()) toast('SongList har uppdaterats till senaste versionen. Försök igen.');
        listenForSharedFiles();
        prefetchLazyParts([
          () => import('jspdf'),
          () => preloadChordDb(useStore.getState().settings.instrument),
        ]);
        return startAutoSync();
      })
      .catch((e) => console.error('Uppstarten misslyckades', e));
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  if (!ready) {
    if (!startError) return null;
    return (
      <div className="empty" style={{ padding: 24 }}>
        <p>Biblioteket kunde inte öppnas.</p>
        <p className="muted small-text">{startError}</p>
        <button className="btn primary" onClick={() => location.reload()}>
          Försök igen
        </button>
      </div>
    );
  }
  return <RouterProvider router={router} />;
}
