import { useState } from 'react';
import { X } from 'lucide-react';
import { normalizeTags } from '../store/useStore';

export function TagInput({
  value,
  onChange,
  suggestions,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
}) {
  const [text, setText] = useState('');

  const add = (t: string) => {
    const next = normalizeTags([...value, ...t.split(',')]);
    onChange(next);
    setText('');
  };

  const remaining = suggestions.filter((s) => !value.includes(s) && (!text || s.includes(text.toLowerCase())));

  return (
    <div>
      <div className="tag-input">
        {value.map((t) => (
          <span className="chip" key={t}>
            {t}
            <button aria-label={`Ta bort ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
              <X size={14} />
            </button>
          </span>
        ))}
        <input
          value={text}
          placeholder={value.length ? '' : 'Lägg till taggar…'}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(',')) add(v);
            else setText(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) {
              e.preventDefault();
              add(text);
            } else if (e.key === 'Backspace' && !text && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => text.trim() && add(text)}
        />
      </div>
      {remaining.length > 0 && (
        <div className="suggestions">
          {remaining.slice(0, 12).map((s) => (
            <button key={s} className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => add(s)}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
