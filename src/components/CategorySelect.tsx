import { useMemo } from 'react';
import { askText } from './ui';
import { liveCategories, useStore } from '../store/useStore';

export const SAME_AS_ALL = '__same__';
const NEW_CATEGORY = '__new__';

/** Väljare för kategori där man också kan skapa en ny kategori direkt. */
export function CategorySelect({
  value,
  onChange,
  sameAsAllLabel,
}: {
  value: string;
  onChange: (id: string) => void;
  /** Visar valet "Som för alla" (värdet SAME_AS_ALL) */
  sameAsAllLabel?: string;
}) {
  const categoriesRec = useStore((s) => s.categories);
  const saveCategory = useStore((s) => s.saveCategory);
  const categories = useMemo(() => liveCategories(categoriesRec), [categoriesRec]);

  const choose = async (v: string) => {
    if (v !== NEW_CATEGORY) {
      onChange(v);
      return;
    }
    const name = await askText({ title: 'Ny kategori', label: 'Namn', placeholder: 't.ex. Psalmer', confirmLabel: 'Skapa' });
    if (!name) return;
    const existing = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    onChange(existing ? existing.id : (await saveCategory({ name })).id);
  };

  return (
    <select className="select" value={value} onChange={(e) => void choose(e.target.value)}>
      {sameAsAllLabel && <option value={SAME_AS_ALL}>{sameAsAllLabel}</option>}
      <option value="">Ingen</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
      <option value={NEW_CATEGORY}>+ Ny kategori…</option>
    </select>
  );
}
