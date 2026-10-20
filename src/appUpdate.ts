// Hantering av nya versioner av webbappen.
//
// Filerna som laddas vid behov (t.ex. PDF-biblioteket) har versionsnummer i namnet. Om en ny
// version publiceras medan appen är öppen finns de gamla filerna inte längre kvar, och Safari
// svarar med "Importing a module script failed". Då laddar vi om sidan till den nya versionen.

const FLAG = 'songlist-reloaded-for-update';
/** Ladda inte om oftare än så här, så att ett bestående fel inte ger en omladdningsloop. */
const MIN_INTERVAL = 60_000;

function lastReload(): number {
  try {
    return Number(sessionStorage.getItem(FLAG) ?? 0);
  } catch {
    return 0;
  }
}

export function installUpdateHandler(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (!navigator.onLine || Date.now() - lastReload() < MIN_INTERVAL) return; // låt felet visas
    event.preventDefault();
    try {
      sessionStorage.setItem(FLAG, String(Date.now()));
    } catch {
      // Utan sessionStorage: ladda om ändå, intervallet skyddar inte men felet är ovanligt
    }
    window.location.reload();
  });
}

/** Sant (en gång) om appen just laddades om för att en ny version fanns. */
export function consumeUpdateNotice(): boolean {
  const t = lastReload();
  if (!t || Date.now() - t > MIN_INTERVAL) return false;
  try {
    // Behåll tidpunkten (skyddar mot loop) men visa bara meddelandet en gång
    if (sessionStorage.getItem(FLAG + '-shown') === String(t)) return false;
    sessionStorage.setItem(FLAG + '-shown', String(t));
  } catch {
    return false;
  }
  return true;
}

/** Sant om felet beror på att en del av appen inte kunde laddas (t.ex. efter en uppdatering). */
export function isChunkLoadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Unable to preload CSS/i.test(
    msg,
  );
}

/**
 * Hämtar delar som annars laddas först vid behov, i bakgrunden när appen är ledig. Då finns de
 * redan i minnet om en ny version publiceras medan appen är öppen.
 */
export function prefetchLazyParts(loaders: (() => Promise<unknown>)[]): void {
  const run = () => loaders.forEach((load) => void load().catch(() => undefined));
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback;
  window.setTimeout(() => (idle ? idle(run, { timeout: 5000 }) : run()), 3000);
}
