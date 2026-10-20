import { useState } from 'react';
import { X } from 'lucide-react';
import { isValidEmail } from '../services/mail';

/** Fält för en eller flera e-postadresser, som visas som etiketter. */
export function EmailInput({
  value,
  onChange,
  suggestions,
}: {
  value: string[];
  onChange: (emails: string[]) => void;
  suggestions: string[];
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  /** Lägger till alla giltiga adresser i texten; returnerar ogiltiga delar. */
  const add = (input: string): string => {
    const parts = input.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
    const valid = parts.filter(isValidEmail).map((p) => p.toLowerCase());
    const invalid = parts.filter((p) => !isValidEmail(p));
    if (valid.length) onChange([...new Set([...value, ...valid])]);
    setError(invalid.length ? `"${invalid[0]}" ser inte ut som en e-postadress` : '');
    return invalid.join(' ');
  };

  const remaining = suggestions.filter((s) => !value.includes(s) && (!text || s.includes(text.toLowerCase())));

  return (
    <div>
      <div className="tag-input">
        {value.map((e) => (
          <span className="chip" key={e}>
            {e}
            <button aria-label={`Ta bort ${e}`} onClick={() => onChange(value.filter((x) => x !== e))}>
              <X size={14} />
            </button>
          </span>
        ))}
        <input
          type="email"
          inputMode="email"
          value={text}
          placeholder={value.length ? '' : 'namn@exempel.se'}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="email"
          aria-label="E-postadress"
          onChange={(e) => {
            const v = e.target.value;
            setError('');
            if (/[\s,;]$/.test(v)) setText(add(v));
            else setText(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) {
              e.preventDefault();
              setText(add(text));
            } else if (e.key === 'Backspace' && !text && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => text.trim() && setText(add(text))}
        />
      </div>
      {error && (
        <div className="small-text" style={{ color: 'var(--danger)', marginTop: 4 }}>
          {error}
        </div>
      )}
      {remaining.length > 0 && (
        <div className="suggestions">
          {remaining.slice(0, 8).map((s) => (
            <button key={s} className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange([...value, s])}>
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Sätter in nya adresser först i listan över senast använda (högst tio). */
export function rememberEmails(recent: string[] | undefined, used: string[]): string[] {
  return [...new Set([...used, ...(recent ?? [])])].slice(0, 10);
}
