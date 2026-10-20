import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function Header({
  title,
  back,
  children,
}: {
  title: ReactNode;
  back?: string | true;
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <header className="header">
      {back && (
        <button
          className="btn ghost icon"
          aria-label="Tillbaka"
          onClick={() => (back === true ? navigate(-1) : navigate(back))}
        >
          <ChevronLeft size={26} />
        </button>
      )}
      <h1>{title}</h1>
      {children}
    </header>
  );
}

export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="sheet-head">
          <h3>{title}</h3>
          <button className="btn ghost icon" onClick={onClose} aria-label="Stäng">
            <X size={22} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// --- Toast ---

type ToastMsg = { id: number; text: string; error?: boolean };
let listeners: ((t: ToastMsg) => void)[] = [];
let counter = 0;

export function toast(text: string, opts: { error?: boolean } = {}) {
  const msg = { id: ++counter, text, error: opts.error };
  listeners.forEach((l) => l(msg));
}

export function toastError(e: unknown, prefix = '') {
  const text = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Något gick fel';
  toast(prefix ? `${prefix}: ${text}` : text, { error: true });
}

export function Toaster() {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  useEffect(() => {
    const l = (t: ToastMsg) => setMsg(t);
    listeners.push(l);
    return () => {
      listeners = listeners.filter((x) => x !== l);
    };
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.error ? 5000 : 2600);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return (
    <div className={`toast${msg.error ? ' error' : ''}`} role="status" onClick={() => setMsg(null)}>
      {msg.text}
    </div>
  );
}
