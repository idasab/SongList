import { useLayoutEffect, useRef } from 'react';

// Scrollpositioner per lista, i minnet under sessionen
const positions = new Map<string, { top: number; anchor?: string; offset?: number }>();

/**
 * Kommer ihåg hur långt en lista är scrollad och återställer det när sidan visas igen,
 * t.ex. när man går tillbaka från en låt till låtlistan.
 *
 * Med `anchorAttr` sparas även vilken rad (med det attributet) som låg överst. Den används
 * vid återställningen, eftersom rader som inte ritats än kan ha en annan höjd än förra gången.
 */
export function useRememberScroll<T extends HTMLElement>(key: string, anchorAttr?: string) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const saved = positions.get(key);
    if (saved) {
      const row = saved.anchor && anchorAttr ? el.querySelector(`[${anchorAttr}="${CSS.escape(saved.anchor)}"]`) : null;
      if (row) el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - (saved.offset ?? 0);
      else el.scrollTop = saved.top;
    }
    const onScroll = () => positions.set(key, { top: el.scrollTop });
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      const pos: { top: number; anchor?: string; offset?: number } = { top: el.scrollTop };
      if (anchorAttr && el.scrollTop > 0) {
        const top = el.getBoundingClientRect().top;
        for (const row of el.querySelectorAll(`[${anchorAttr}]`)) {
          const r = row.getBoundingClientRect();
          if (r.bottom > top) {
            pos.anchor = row.getAttribute(anchorAttr) ?? undefined;
            pos.offset = r.top - top;
            break;
          }
        }
      }
      positions.set(key, pos);
      el.removeEventListener('scroll', onScroll);
    };
  }, [key, anchorAttr]);
  return ref;
}
