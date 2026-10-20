import { useEffect } from 'react';
import { NavLink, Outlet, RouterProvider, createHashRouter } from 'react-router-dom';
import { FileUp, ListMusic, Music, Settings } from 'lucide-react';
import { Toaster } from './components/ui';
import { EditorPage } from './pages/EditorPage';
import { ImportPage } from './pages/ImportPage';
import { LibraryPage } from './pages/LibraryPage';
import { SetlistPage } from './pages/SetlistPage';
import { SetlistsPage } from './pages/SetlistsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SongPage } from './pages/SongPage';
import { startAutoSync } from './services/sync';
import { useStore } from './store/useStore';

function TabLayout() {
  return (
    <>
      <Outlet />
      <nav className="tabbar">
        <NavLink to="/" end>
          <Music size={22} />
          Låtar
        </NavLink>
        <NavLink to="/setlists">
          <ListMusic size={22} />
          Setlistor
        </NavLink>
        <NavLink to="/import">
          <FileUp size={22} />
          Importera
        </NavLink>
        <NavLink to="/settings">
          <Settings size={22} />
          Inställningar
        </NavLink>
      </nav>
    </>
  );
}

function Root() {
  return (
    <div className="app">
      <Outlet />
      <Toaster />
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

  useEffect(() => {
    useStore
      .getState()
      .init()
      .then(() => startAutoSync())
      .catch((e) => console.error('Uppstarten misslyckades', e));
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  if (!ready) return null;
  return <RouterProvider router={router} />;
}
