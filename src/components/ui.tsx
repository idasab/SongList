import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { isChunkLoadError } from '../appUpdate';

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

/**
 * Den del av skärmen som faktiskt syns. På mobilen krymper den när tangentbordet visas,
 * medan fönstret (window) behåller sin höjd – därför hamnade ark bakom tangentbordet.
 */
function useVisibleViewport(): { top: number; height: number } | null {
  const [vp, setVp] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setVp({ top: vv.offsetTop, height: vv.height });
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return vp;
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
  const vp = useVisibleViewport();
  return (
    <div
      className="backdrop"
      onClick={onClose}
      style={vp ? { top: vp.top, height: vp.height, bottom: 'auto' } : undefined}
    >
      <div
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={vp ? { maxHeight: vp.height * 0.92 } : undefined}
      >
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
  if (isChunkLoadError(e)) {
    toast('En ny version av SongList finns. Ladda om sidan och försök igen.', { error: true });
    return;
  }
  const text = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Något gick fel';
  toast(prefix ? `${prefix}: ${text}` : text, { error: true });
}

// --- Textruta för ett namn (ersätter webbläsarens prompt(), som fungerar dåligt på iPhone) ---

interface AskTextRequest {
  title: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  resolve: (value: string | null) => void;
}

let askListener: ((r: AskTextRequest) => void) | null = null;

/** Visar en ruta där användaren skriver en text. Ger null om rutan stängs. */
export function askText(opts: Omit<AskTextRequest, 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => {
    if (!askListener) {
      resolve(null);
      return;
    }
    askListener({ ...opts, resolve });
  });
}

/** Monteras en gång i appen och visar rutorna från askText(). */
export function AskTextHost() {
  const [req, setReq] = useState<AskTextRequest | null>(null);
  const [value, setValue] = useState('');
  useEffect(() => {
    askListener = (r) => {
      setValue(r.initial ?? '');
      setReq(r);
    };
    return () => {
      askListener = null;
    };
  }, []);
  if (!req) return null;
  const close = (result: string | null) => {
    req.resolve(result);
    setReq(null);
  };
  const submit = () => {
    const v = value.trim();
    if (v) close(v);
  };
  return (
    <Sheet
      title={req.title}
      onClose={() => close(null)}
      footer={
        <>
          <button className="btn" onClick={() => close(null)}>
            Avbryt
          </button>
          <button className="btn primary" disabled={!value.trim()} onClick={submit}>
            {req.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      <label className="field">
        {req.label && <span>{req.label}</span>}
        <input
          className="input"
          autoFocus
          value={value}
          placeholder={req.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </label>
    </Sheet>
  );
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
