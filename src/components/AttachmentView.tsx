import { useEffect, useRef, useState } from 'react';
import type { SongAttachment } from '../lib/model';
import { loadPdfJs } from '../services/fileImport';

/**
 * Visar en låt som är sparad som fil (t.ex. noter): en bild eller alla sidor i en PDF.
 * zoom = 1 fyller låtytans bredd.
 */
export function AttachmentView({ attachment, zoom }: { attachment: SongAttachment; zoom: number }) {
  const width = `${Math.round(zoom * 100)}%`;
  if (attachment.kind === 'image') {
    return (
      <div className="attachment-view">
        <img src={attachment.dataUrl} alt={attachment.name} style={{ width }} />
      </div>
    );
  }
  return <PdfPages attachment={attachment} width={width} />;
}

function PdfPages({ attachment, width }: { attachment: SongAttachment; width: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Laddar PDF…');

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;
    const el = holder.current;
    if (!el) return;
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const data = new Uint8Array(await (await fetch(attachment.dataUrl)).arrayBuffer());
        const task = pdfjs.getDocument({ data });
        destroy = () => void task.destroy();
        const doc = await task.promise;
        el.replaceChildren();
        // Rita i skarp upplösning; storleken på skärmen styrs av CSS-bredden (zoom)
        const target = Math.min(2400, Math.max(1200, el.clientWidth * (window.devicePixelRatio || 1) * 2));
        for (let n = 1; n <= doc.numPages && !cancelled; n++) {
          setStatus(doc.numPages > 1 ? `Laddar sida ${n} av ${doc.numPages}…` : '');
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: target / base.width });
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          canvas.className = 'attachment-page';
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          if (!cancelled) el.appendChild(canvas);
        }
        if (!cancelled) setStatus('');
      } catch {
        if (!cancelled) setStatus('PDF:en kunde inte visas på den här enheten.');
      }
    })();
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [attachment.dataUrl]);

  return (
    <div className="attachment-view">
      {status && <p className="muted small-text">{status}</p>}
      <div ref={holder} className="attachment-pages" style={{ width }} />
    </div>
  );
}
