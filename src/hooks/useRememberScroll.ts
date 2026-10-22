import { useLayoutEffect, useRef } from 'react';

// Scrollpositioner per lista, i minnet under sessionen
const positions = new Map<string, number>();

/**
 * Kommer ihåg hur långt en lista är scrollad och återställer det när sidan visas igen,
 * t.ex. när man går tillbaka från en låt till låtlistan.
 */
export function useRememberScroll<T extends HTMLElement>(key: string) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const saved = positions.get(key);
    if (saved) el.scrollTop = saved;
    const onScroll = () => positions.set(key, el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      positions.set(key, el.scrollTop);
      el.removeEventListener('scroll', onScroll);
    };
  }, [key]);
  return ref;
}
