// Notläsning: foton eller PDF:er av notblad tolkas av Claude till noter i ABC-format.
// Anropet går direkt från appen till Anthropics API med användarens egen API-nyckel
// (sparas bara på enheten). Kräver internet.
//
// Claude ser varje sida i sin helhet och kan sedan zooma in (verktyget zoom) på notraderna:
// utsnitten tas ur originalbilden i högre upplösning, så att notlinjerna går att räkna.
import Anthropic from '@anthropic-ai/sdk';
import { abcToChordPro } from '../lib/abc';
import { loadPdfJs } from './fileImport';
import { loadImageToCanvas } from './ocr';

/** En sida att läsa: en bild eller en PDF (som data-URL) */
export interface SheetSource {
  kind: 'image' | 'pdf';
  dataUrl: string;
}

const MODEL = 'claude-opus-5-5';
/** Det största Claude läser (pixlar på längsta sidan); större bilder skalas ner av API:et */
const SEND_MAX = 2576;
/** Originalet sparas så här stort, så att utsnitten blir skarpare än översikten (inom iOS gräns för canvas) */
const FULL_MAX = 3600;
/** Så många gånger Claude kan be om utsnitt innan noterna måste skrivas */
const MAX_ROUNDS = 8;

const SYSTEM = `You transcribe printed or handwritten sheet music from photos and PDFs into ABC notation (ABC standard 2.1, as rendered by abcjs).

Transcribe exactly what is written; never arrange, simplify or complete the music. Include:
- Header: X:1, T: (title), C: (composer/arranger, if printed), M:, L:, Q: (only if a tempo is marked), K: (key signature; use the key that the signature and the music imply, e.g. K:Em, and add clef=bass when the first staff is in bass clef).
- Every voice and staff. For more than one staff use %%score with braces or brackets as printed, e.g. %%score [(S A) (T B)] for a choir on two staves or %%score {RH | LH} for piano. Declare each voice with V: (id, clef, name or short name as printed) and prefix every music line with its inline voice field, e.g. [V:S]. Two voices sharing one staff (stems up/down) are two separate voices inside the same parentheses in %%score.
- Lyrics with w: lines directly after the voice line they belong to, using - between syllables and _ for melismas; several verses become several w: lines.
- Chord symbols printed above the staff as "G", "Am7", "D/F#" before the note they belong to.
- Accidentals, ties, slurs, triplets, rests, repeats, voltas (|1 :|2), fermatas, dynamics (!p!, !f!), and inline key or meter changes ([K:D], [M:3/4]).
Keep one ABC line per printed system, in the same order, so that line breaks match the original. Multiple images or pages are consecutive pages of the same piece unless they are clearly different pieces; transcribe them as one tune.

Reading the pitches is the hard part, so work like this:
1. Look at the whole page first: layout, systems, clefs, key and time signatures, voices.
2. Use the zoom tool on every system before you write its notes: one zoom per system covering all its staves with a little margin. Ask for the zooms of several systems in the same turn. Zoom further into any passage that is still unclear (crowded chords, ledger lines, small accidentals).
3. Read each note from its position on the staff: count the lines and spaces (and ledger lines) from the clef, then apply the key signature and any accidental earlier in the same bar. Never fill in a melody from the lyrics, the title or a tune you recognise; the printed notes always win.
4. Handwritten music: noteheads vary in size and shape, and staff lines may be uneven, slanted or curved across a photo. Judge each notehead by its centre relative to the nearest lines at that point of the staff (not by a straight line across the page), and compare it with its neighbours: is it on the same line, a step up or down, or a leap? Stems may sit to either side and be uneven; read the pitch from the head, not the stem.
ABC pitch names are absolute and do not change with the clef. Treble clef lines from the bottom are E G B d f, spaces F A c e; middle C (first ledger line below) is C. Bass clef lines from the bottom are G,, B,, D, F, A,, spaces A,, C, E, G,; middle C (first ledger line above) is C. For a treble clef with an 8 below (tenor), use clef=treble-8 and write the notes as they appear on the staff, as for an ordinary treble clef.
Check every bar: the durations in each voice must add up to the meter (allowing pickup bars). Where something is unreadable, write your best reading and add a % comment on the line before it describing the uncertainty.

Reply with only the ABC, inside one fenced code block marked abc.`;

const ZOOM_TOOL: Anthropic.Beta.BetaTool = {
  name: 'zoom',
  description:
    'Returns an enlarged, sharper crop of one page, taken from the original high-resolution image. Coordinates are pixels in the page image as you see it, with the origin at the top left.',
  input_schema: {
    type: 'object',
    properties: {
      page: { type: 'integer', description: 'Page number, starting at 1' },
      left: { type: 'integer' },
      top: { type: 'integer' },
      right: { type: 'integer' },
      bottom: { type: 'integer' },
    },
    required: ['page', 'left', 'top', 'right', 'bottom'],
    additionalProperties: false,
  },
  // Inmatningen strömmas direkt; den kontrolleras innan utsnittet tas
  eager_input_streaming: true,
};

/** Fel med ett meddelande som kan visas för användaren */
export class OmrError extends Error {}

/** En sida: originalet (för utsnitt) och bilden Claude ser */
interface Page {
  full: HTMLCanvasElement;
  /** Översiktens bredd och höjd i pixlar */
  w: number;
  h: number;
  /** Pixlar i originalet per pixel i översikten */
  k: number;
  overview: string;
}

function base64Of(dataUrl: string): { mime: string; data: string } {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new OmrError('Filen kunde inte läsas');
  return { mime: m[1], data: m[2] ? m[3] : btoa(decodeURIComponent(m[3])) };
}

/** Bilder sparas stora (utsnitten tas ur dem) och görs om till JPEG */
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
  const overview = scaled(full, 0, 0, full.width, full.height, SEND_MAX);
  return {
    full,
    w: overview.width,
    h: overview.height,
    k: full.width / overview.width,
    overview: overview.toDataURL('image/jpeg', 0.9),
  };
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

function imageBlock(dataUrl: string): Anthropic.Beta.BetaImageBlockParam {
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Of(dataUrl).data } };
}

/** Utsnittet Claude bad om, eller ett fel om rutan inte går att använda */
function zoom(pages: Page[], block: Anthropic.Beta.BetaToolUseBlock): Anthropic.Beta.BetaToolResultBlockParam {
  const fail = (text: string): Anthropic.Beta.BetaToolResultBlockParam => ({
    type: 'tool_result',
    tool_use_id: block.id,
    is_error: true,
    content: text,
  });
  const input = block.input as Record<string, unknown>;
  const [page, left, top, right, bottom] = ['page', 'left', 'top', 'right', 'bottom'].map((key) => input?.[key]);
  if (![page, left, top, right, bottom].every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return fail('page, left, top, right and bottom must all be numbers.');
  }
  const p = pages[(page as number) - 1];
  if (!p) return fail(`There are ${pages.length} pages; page must be between 1 and ${pages.length}.`);
  const x0 = Math.max(0, Math.min(left as number, right as number));
  const x1 = Math.min(p.w, Math.max(left as number, right as number));
  const y0 = Math.max(0, Math.min(top as number, bottom as number));
  const y1 = Math.min(p.h, Math.max(top as number, bottom as number));
  if (x1 - x0 < 8 || y1 - y0 < 8) return fail(`The box is empty or outside the page (the page is ${p.w}×${p.h} px).`);
  // Ur originalet, förstorat högst två gånger
  const crop = scaled(p.full, x0 * p.k, y0 * p.k, (x1 - x0) * p.k, (y1 - y0) * p.k, SEND_MAX, 2);
  return {
    type: 'tool_result',
    tool_use_id: block.id,
    content: [
      { type: 'text', text: `Page ${page as number}, x ${Math.round(x0)}–${Math.round(x1)}, y ${Math.round(y0)}–${Math.round(y1)}:` },
      imageBlock(crop.toDataURL('image/jpeg', 0.9)),
    ],
  };
}

function abcFromReply(text: string): string {
  const fenced = /```(?:abc)?[ \t]*\n([\s\S]*?)```/i.exec(text);
  const abc = (fenced ? fenced[1] : text).trim();
  if (!/^K:/m.test(abc)) throw new OmrError('Hittade inga noter i bilden');
  return abc;
}

/**
 * Läser noterna på sidorna och ger en ny låt (ChordPro med noterna i {start_of_abc}).
 * onProgress får lägesbeskrivningar; signal avbryter.
 */
export async function readSheetMusic(
  sources: SheetSource[],
  apiKey: string,
  opts: { title?: string; onProgress?: (message: string) => void; signal?: AbortSignal } = {},
): Promise<string> {
  if (!apiKey.trim()) throw new OmrError('Lägg in en API-nyckel under Inställningar › Notläsning');
  const client = new Anthropic({ apiKey: apiKey.trim(), dangerouslyAllowBrowser: true });
  opts.onProgress?.('Förbereder bilderna…');
  const pages = await loadPages(sources);
  const many = pages.length > 1 ? `${pages.length} pages of the same piece. ` : '';
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: 'user',
      content: [
        ...pages.flatMap((p, i): Anthropic.Beta.BetaContentBlockParam[] => [
          { type: 'text', text: `Page ${i + 1} (${p.w}×${p.h} px):` },
          imageBlock(p.overview),
        ]),
        { type: 'text', text: `${many}Transcribe this sheet music to ABC.` },
      ],
    },
  ];
  let zooms = 0;
  try {
    for (let round = 1; ; round++) {
      opts.onProgress?.(zooms ? `Läser noterna… (${zooms} utsnitt granskade)` : 'Läser noterna…');
      const stream = client.beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 64000,
          // Avböjs anropet av säkerhetsfiltren görs det om med en annan modell
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'high' },
          // Bilderna skickas om varje varv; cachen gör det billigare
          cache_control: { type: 'ephemeral' },
          system: SYSTEM,
          tools: [ZOOM_TOOL],
          messages,
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
      const asks = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (msg.stop_reason !== 'tool_use' || !asks.length) {
        const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
        return abcToChordPro(abcFromReply(text), opts.title);
      }
      if (round > MAX_ROUNDS) throw new OmrError('Noterna tog för lång tid att läsa. Prova med färre sidor.');
      zooms += asks.length;
      opts.onProgress?.(`Zoomar in… (${zooms} utsnitt)`);
      // Svaret läggs till oförändrat (med tankarna), sedan utsnitten
      messages.push({ role: 'assistant', content: msg.content });
      const results: Anthropic.Beta.BetaContentBlockParam[] = asks.map((b) => zoom(pages, b));
      if (round === MAX_ROUNDS) results.push({ type: 'text', text: 'No more zooms are available. Write the final ABC now.' });
      messages.push({ role: 'user', content: results });
    }
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
