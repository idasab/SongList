// Notläsning: foton eller PDF:er av notblad tolkas av Claude till noter i ABC-format.
// Anropet går direkt från appen till Anthropics API med användarens egen API-nyckel
// (sparas bara på enheten). Kräver internet.
//
// Allt skickas i en enda fråga (det håller nere kostnaden): varje sida i sin helhet och
// sedan varje notrad för sig, skarpare och med notlinjerna och tonnamnen markerade, så att
// det syns om en not ligger på en linje eller mellan två.
import Anthropic from '@anthropic-ai/sdk';
import { abcToChordPro } from '../lib/abc';
import { enhancePixels } from '../lib/enhance';
import { type Staff, findStaves, lineGap, pitchName } from '../lib/staffLines';
import { loadPdfJs } from './fileImport';
import { loadImageToCanvas } from './ocr';

/** En sida att läsa: en bild eller en PDF (som data-URL) */
export interface SheetSource {
  kind: 'image' | 'pdf';
  dataUrl: string;
}

const MODEL = 'claude-opus-5-5';
/** Pris i dollar per miljon tokens (in och ut) */
const PRICE_IN = 4;
const PRICE_OUT = 20;
/** Det största Claude läser (pixlar på längsta sidan); större bilder skalas ner av API:et */
const SEND_MAX = 2576;
/** Originalet sparas så här stort, så att notraderna blir skarpare än översikten (inom iOS gräns för canvas) */
const FULL_MAX = 3600;
/** Notraderna letas i en mindre bild (det går fortare) */
const FIND_MAX = 2000;
/** Högst så många bilder i frågan (API:ets gräns är 100) */
const MAX_IMAGES = 90;
/** Marginalerna (pixlar) för tonnamnen på var sida om en notrad */
const MARGIN = 52;

const SYSTEM = `You transcribe printed or handwritten sheet music from photos and PDFs into ABC notation (ABC standard 2.1, as rendered by abcjs).

Transcribe exactly what is written; never arrange, simplify or complete the music. Include:
- Header: X:1, T: (title), C: (composer/arranger, if printed), M:, L:, Q: (only if a tempo is marked), K: (key signature; use the key that the signature and the music imply, e.g. K:Em, and add clef=bass when the first staff is in bass clef).
- Every voice and staff. For more than one staff use %%score with braces or brackets as printed, e.g. %%score [(S A) (T B)] for a choir on two staves or %%score {RH | LH} for piano. Declare each voice with V: (id, clef, name or short name as printed) and prefix every music line with its inline voice field, e.g. [V:S]. Two voices sharing one staff (stems up/down) are two separate voices inside the same parentheses in %%score.
- Lyrics with w: lines directly after the voice line they belong to, using - between syllables and _ for melismas; several verses become several w: lines.
- Chord symbols printed above the staff as "G", "Am7", "D/F#" before the note they belong to.
- Accidentals, ties, slurs, triplets, rests, repeats, voltas (|1 :|2), fermatas, dynamics (!p!, !f!), and inline key or meter changes ([K:D], [M:3/4]).
Keep one ABC line per printed system, in the same order, so that line breaks match the original. Multiple images or pages are consecutive pages of the same piece unless they are clearly different pieces; transcribe them as one tune.

What you get: each page as a whole, followed by every staff found on it as a separate, sharpened, larger crop, top to bottom. In a crop, the staff's five lines are traced in red and the ledger-line positions (two above and two below) are dashed in blue. The left margin names the pitch of every line and space for a treble clef, the right margin for a bass clef. Use the page to see the layout (systems, clefs, title, tempo) and the crops to read the notes. If a crop has no red lines, or a red line does not lie on a printed staff line, read that staff without the guides. A page without crops must be read from the page itself.

Reading the pitches is the hard part, so work like this:
1. Look at the whole page first: layout, systems, clefs, key and time signatures, voices.
2. Read each note from its position in the crop: decide first whether the centre of the notehead lies on a red line or in the white space between two red lines (or on, above or below a dashed ledger-line position), then take the pitch name from the margin for that staff's clef at that height, following the staff if it slants. For an alto or tenor clef, count from the clef instead. The most common mistake is reading a note in a space as the line just below or above it: a notehead that only touches a line with its edge is in the space. Below a treble staff, a note on the first ledger line is C and a note hanging just below that ledger line is B,. Then apply the key signature and any accidental earlier in the same bar. Never fill in a melody from the lyrics, the title or a tune you recognise; the printed notes always win.
3. Handwritten music: noteheads vary in size and shape and are often just a small dot or a tiny circle at the end of the stem. The pitch is where that dot sits: at the bottom of a stem that goes up, at the top of a stem that goes down, and at the end opposite the beam for beamed notes. Never read the pitch from where the stem or beam ends. Compare each note with its neighbours: is it on the same line, a step up or down, or a leap?
4. Several dots on one stem are a chord in one voice: write it as [GBd]. Use separate voices only where stems point in opposite directions with different rhythms.
5. A clef or key signature that has been redrawn or scribbled over at the start of a staff normally repeats the key signature of the other staves; only change key when a new signature is clearly written, usually after a double bar. Ignore the paper's own printing, such as the publisher name on blank manuscript paper.
6. Use the lyrics to count the notes (one syllable per note, except under slurs and melismas), but never to guess pitches. Each syllable belongs to the note it is written under. Rests take no syllable (w: skips them), so a syllable written after a rest goes on the first note after the rest; watch this where a phrase starts with a rest or with pickup notes leading into the next line.
ABC pitch names are absolute and do not change with the clef. Treble clef lines from the bottom are E G B d f, spaces F A c e; middle C (first ledger line below) is C. Bass clef lines from the bottom are G,, B,, D, F, A,, spaces A,, C, E, G,; middle C (first ledger line above) is C. For a treble clef with an 8 below (tenor), use clef=treble-8 and write the notes as they appear on the staff, as for an ordinary treble clef.
Check every bar: the durations in each voice must add up to the meter (allowing pickup bars). Where something is unreadable, write your best reading and add a % comment on the line before it describing the uncertainty.

Reply with only the ABC, inside one fenced code block marked abc.`;

/** Fel med ett meddelande som kan visas för användaren */
export class OmrError extends Error {}

/** En sida: originalet (för notraderna) och bilden Claude ser */
interface Page {
  full: HTMLCanvasElement;
  overview: HTMLCanvasElement;
}

function base64Of(dataUrl: string): { mime: string; data: string } {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new OmrError('Filen kunde inte läsas');
  return { mime: m[1], data: m[2] ? m[3] : btoa(decodeURIComponent(m[3])) };
}

/** Bilder sparas stora (notraderna tas ur dem) och görs om till JPEG */
export async function imageFileToSource(file: File): Promise<SheetSource> {
  const canvas = await loadImageToCanvas(file, FULL_MAX);
  return { kind: 'image', dataUrl: canvas.toDataURL('image/jpeg', 0.92) };
}

function scaled(src: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number, max: number, upscale = 1) {
  const k = Math.min(upscale, max / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * k));
  canvas.height = Math.max(1, Math.round(sh * k));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function toPage(full: HTMLCanvasElement): Page {
  return { full, overview: scaled(full, 0, 0, full.width, full.height, SEND_MAX) };
}

/** Sidorna som bilder; en PDF ritas sida för sida */
async function loadPages(sources: SheetSource[]): Promise<Page[]> {
  const pages: Page[] = [];
  for (const src of sources) {
    const blob = await (await fetch(src.dataUrl)).blob();
    if (src.kind === 'image') {
      pages.push(toPage(await loadImageToCanvas(new File([blob], 'bild', { type: blob.type }), FULL_MAX)));
      continue;
    }
    const pdfjs = await loadPdfJs();
    const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
    try {
      const doc = await task.promise;
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: FULL_MAX / Math.max(base.width, base.height) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        pages.push(toPage(canvas));
      }
    } finally {
      void task.destroy();
    }
  }
  if (!pages.length) throw new OmrError('Hittade inga sidor att läsa');
  return pages;
}

function imageBlock(canvas: HTMLCanvasElement): Anthropic.Beta.BetaImageBlockParam {
  const { data } = base64Of(canvas.toDataURL('image/jpeg', 0.9));
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } };
}

/** Gör bilden skarp som från en skanner (på plats) och ger bläcket: 1 för mörkt, 0 för papper */
function inkOf(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext('2d')!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  enhancePixels(img.data, canvas.width, canvas.height);
  ctx.putImageData(img, 0, 0);
  const ink = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < ink.length; i++) ink[i] = img.data[i * 4] < 128 ? 1 : 0;
  return ink;
}

const top = (st: Staff) => Math.min(...st.parts.map((p) => p.lines[0]));
const bottom = (st: Staff) => Math.max(...st.parts.map((p) => p.lines[4]));

/** Varje notrad på sidan som en egen bild, uppifrån och ner, med plats för text och hjälplinjer */
function staffCrops(page: Page): HTMLCanvasElement[] {
  const small = scaled(page.full, 0, 0, page.full.width, page.full.height, FIND_MAX);
  const k = page.full.width / small.width;
  const staves = findStaves(inkOf(small), small.width, small.height);
  return staves.map((staff, n) => {
    const gap = lineGap(staff.parts[0]);
    // Upp till grannraderna, men inte in i dem
    const y0 = Math.max(0, top(staff) - 6 * gap, n > 0 ? bottom(staves[n - 1]) + gap : 0);
    const y1 = Math.min(small.height, bottom(staff) + 8 * gap, n < staves.length - 1 ? top(staves[n + 1]) - gap : Infinity);
    const x0 = Math.max(0, staff.parts[0].x0 - 2 * gap);
    const x1 = Math.min(small.width, staff.parts[staff.parts.length - 1].x1 + 2 * gap);
    // Ur originalet, förstorat högst två gånger (med plats för marginalerna)
    return withGuides(scaled(page.full, x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k, SEND_MAX - 2 * MARGIN, 2));
  });
}

/**
 * Notraden skarp som från en skanner, med notlinjerna markerade (röda), hjälplinjernas lägen
 * (blå streck) och tonnamnen i marginalerna: G-klav till vänster och F-klav till höger.
 */
function withGuides(crop: HTMLCanvasElement): HTMLCanvasElement {
  const staves = findStaves(inkOf(crop), crop.width, crop.height);
  if (!staves.length) return crop;

  const canvas = document.createElement('canvas');
  canvas.width = crop.width + 2 * MARGIN;
  canvas.height = crop.height;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(crop, MARGIN, 0);
  const stroke = (x0: number, x1: number, y: number) => {
    g.beginPath();
    g.moveTo(MARGIN + x0, y);
    g.lineTo(MARGIN + x1, y);
    g.stroke();
  };
  staves.forEach((staff, n) => {
    for (const part of staff.parts) {
      const gap = lineGap(part);
      g.lineWidth = Math.max(1, gap * 0.07);
      g.strokeStyle = 'rgba(230, 0, 0, 0.6)';
      g.setLineDash([]);
      for (const y of part.lines) stroke(part.x0, part.x1, y);
      g.strokeStyle = 'rgba(0, 90, 255, 0.45)';
      g.setLineDash([gap * 0.5, gap * 0.4]);
      for (const step of [-2, -4, 10, 12]) stroke(part.x0, part.x1, part.lines[4] - (step * gap) / 2);
    }
    // Tonnamnen till vänster och höger, men inte in över grannraderna
    const sides = [
      { part: staff.parts[0], clef: 'treble', x: MARGIN - 6, align: 'right' as const, at: 0 },
      { part: staff.parts[staff.parts.length - 1], clef: 'bass', x: MARGIN + crop.width + 6, align: 'left' as const, at: -1 },
    ];
    for (const { part, clef, x, align, at } of sides) {
      const gap = lineGap(part);
      const above = staves[n - 1]?.parts.at(at)?.lines[4];
      const below = staves[n + 1]?.parts.at(at)?.lines[0];
      const minY = above === undefined ? 0 : (above + part.lines[0]) / 2;
      const maxY = below === undefined ? canvas.height : (below + part.lines[4]) / 2;
      const size = Math.max(9, Math.min(18, gap * 0.48));
      g.font = `bold ${size}px monospace`;
      g.textAlign = align;
      g.textBaseline = 'middle';
      for (let step = -4; step <= 12; step++) {
        // Är raderna för tätt står bara linjernas namn
        if (gap / 2 < size * 0.9 && step % 2) continue;
        const y = part.lines[4] - (step * gap) / 2;
        if (y < minY || y > maxY || y < size / 2 || y > canvas.height - size / 2) continue;
        g.fillStyle = step % 2 ? '#333' : step >= 0 && step <= 8 ? '#d00000' : '#0050e0';
        g.fillText(pitchName(clef, step), x, y);
      }
    }
  });
  return canvas;
}

function abcFromReply(text: string): string {
  const fenced = /```(?:abc)?[ \t]*\n([\s\S]*?)```/i.exec(text);
  const abc = (fenced ? fenced[1] : text).trim();
  if (!/^K:/m.test(abc)) throw new OmrError('Hittade inga noter i bilden');
  return abc;
}

/** Den lästa låten och ungefär vad läsningen kostade (dollar) */
export interface SheetMusicResult {
  content: string;
  cost: number;
}

/**
 * Läser noterna på sidorna och ger en ny låt (ChordPro med noterna i {start_of_abc}).
 * onProgress får lägesbeskrivningar; signal avbryter.
 */
export async function readSheetMusic(
  sources: SheetSource[],
  apiKey: string,
  opts: { title?: string; onProgress?: (message: string) => void; signal?: AbortSignal } = {},
): Promise<SheetMusicResult> {
  if (!apiKey.trim()) throw new OmrError('Lägg in en API-nyckel under Inställningar › Notläsning');
  const client = new Anthropic({ apiKey: apiKey.trim(), dangerouslyAllowBrowser: true });
  opts.onProgress?.('Förbereder bilderna…');
  const pages = await loadPages(sources);
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  let images = 0;
  for (const [i, page] of pages.entries()) {
    content.push({ type: 'text', text: `Page ${i + 1}:` }, imageBlock(page.overview));
    images++;
    const crops = staffCrops(page).slice(0, Math.max(0, MAX_IMAGES - images - (pages.length - i - 1)));
    for (const [n, crop] of crops.entries()) {
      content.push({ type: 'text', text: `Page ${i + 1}, staff ${n + 1} of ${crops.length}:` }, imageBlock(crop));
    }
    images += crops.length;
  }
  const many = pages.length > 1 ? `${pages.length} pages of the same piece. ` : '';
  content.push({ type: 'text', text: `${many}Transcribe this sheet music to ABC.` });

  try {
    opts.onProgress?.('Läser noterna…');
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        // Avböjs anropet av säkerhetsfiltren görs det om med en annan modell
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: SYSTEM,
        messages: [{ role: 'user', content }],
      },
      { signal: opts.signal },
    );
    let written = 0;
    stream.on('text', (t) => {
      written += t.length;
      // Ungefär hur långt den kommit, så att man ser att något händer
      opts.onProgress?.(`Skriver noterna… (${Math.round(written / 100) / 10} tusen tecken)`);
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new OmrError('Claude kunde inte läsa bilden');
    if (msg.stop_reason === 'max_tokens') throw new OmrError('Noterna var för långa för att läsas på en gång. Prova med färre sidor.');
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    const u = msg.usage;
    const cost = ((u.input_tokens + (u.cache_creation_input_tokens ?? 0)) * PRICE_IN + u.output_tokens * PRICE_OUT) / 1e6;
    return { content: abcToChordPro(abcFromReply(text), opts.title), cost };
  } catch (e) {
    if (e instanceof OmrError) throw e;
    if (e instanceof Anthropic.APIUserAbortError) throw new OmrError('Avbrutet');
    if (e instanceof Anthropic.AuthenticationError) throw new OmrError('API-nyckeln fungerar inte. Kontrollera den under Inställningar › Notläsning.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new OmrError('API-nyckeln har inte behörighet. Kontrollera kontot hos Anthropic.');
    if (e instanceof Anthropic.RateLimitError) throw new OmrError('För många förfrågningar just nu. Vänta en stund och försök igen.');
    if (e instanceof Anthropic.BadRequestError) throw new OmrError(`Anthropic tog inte emot bilden: ${e.message}`);
    if (e instanceof Anthropic.APIConnectionError) throw new OmrError('Kunde inte nå Anthropic. Kontrollera internetanslutningen.');
    if (e instanceof Anthropic.APIError) throw new OmrError(`Fel hos Anthropic (${e.status ?? 'okänt'}). Försök igen senare.`);
    throw e;
  }
}
