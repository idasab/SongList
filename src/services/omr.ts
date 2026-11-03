// Notläsning: foton eller PDF:er av notblad tolkas av Claude till noter i ABC-format.
// Anropet går direkt från appen till Anthropics API med användarens egen API-nyckel
// (sparas bara på enheten). Kräver internet.
//
// Claude ser varje sida i sin helhet och kan sedan zooma in (verktyget zoom) på notraderna:
// utsnitten tas ur originalbilden i högre upplösning, så att notlinjerna går att räkna.
// Med verktyget render ritas Claudes egna noter upp, så att de kan jämföras med originalet.
import Anthropic from '@anthropic-ai/sdk';
import { abcToChordPro, loadAbcjs, renderAbcImages } from '../lib/abc';
import { enhancePixels } from '../lib/enhance';
import { CLEFS, findStaves, lineGap, pitchName } from '../lib/staffLines';
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
/** Så många gånger Claude kan använda verktygen innan noterna måste skrivas */
const MAX_ROUNDS = 12;
/** Marginalerna (pixlar) för tonnamnen på var sida om ett utsnitt */
const MARGIN = 52;

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
2. Use the zoom tool on every system before you write its notes: one zoom per system covering all its staves with a little margin, always with clefs. Ask for the zooms of several systems in the same turn. When the noteheads are small (handwriting, dense music), zoom each half of the system separately so that they are larger. Zoom further into any passage that is still unclear (crowded chords, ledger lines, small accidentals).
3. Read each note from its position on the staff, using the guides in the zoomed crops: decide first whether the centre of the notehead lies on a red line or in the white space between two red lines (or on, above or below a dashed ledger-line position), then take the pitch name from the margin at that height, following the staff if it slants. The most common mistake is reading a note in a space as the line just below or above it: a notehead that only touches a line with its edge is in the space. Below a treble staff, a note on the first ledger line is C and a note hanging just below that ledger line is B,. Then apply the key signature and any accidental earlier in the same bar. Never fill in a melody from the lyrics, the title or a tune you recognise; the printed notes always win.
4. Handwritten music: noteheads vary in size and shape and are often just a small dot or a tiny circle at the end of the stem; staff lines may be uneven, slanted or curved across a photo. The pitch is where that dot sits: at the bottom of a stem that goes up, at the top of a stem that goes down, and at the end opposite the beam for beamed notes. Never read the pitch from where the stem or beam ends. Judge each dot by its centre relative to the nearest lines at that point of the staff (not by a straight line across the page), and compare it with its neighbours: is it on the same line, a step up or down, or a leap?
5. Several dots on one stem are a chord in one voice: write it as [GBd]. Use separate voices only where stems point in opposite directions with different rhythms.
6. A clef or key signature that has been redrawn or scribbled over at the start of a staff normally repeats the key signature of the other staves; only change key when a new signature is clearly written, usually after a double bar. Ignore the paper's own printing, such as the publisher name on blank manuscript paper.
7. Use the lyrics to count the notes (one syllable per note, except under slurs and melismas), but never to guess pitches. Each syllable belongs to the note it is written under. Rests take no syllable (w: skips them), so a syllable written after a rest goes on the first note after the rest; watch this where a phrase starts with a rest or with pickup notes leading into the next line.
8. Check your work before you answer: call the render tool with your complete ABC, then compare each rendered system note by note with the zoomed original (zoom again where needed) and correct every difference in pitch, rhythm, accidentals, chords and in which note each syllable sits under. Render again after larger corrections.
ABC pitch names are absolute and do not change with the clef. Treble clef lines from the bottom are E G B d f, spaces F A c e; middle C (first ledger line below) is C. Bass clef lines from the bottom are G,, B,, D, F, A,, spaces A,, C, E, G,; middle C (first ledger line above) is C. For a treble clef with an 8 below (tenor), use clef=treble-8 and write the notes as they appear on the staff, as for an ordinary treble clef.
Check every bar: the durations in each voice must add up to the meter (allowing pickup bars). Where something is unreadable, write your best reading and add a % comment on the line before it describing the uncertainty.

Reply with only the ABC, inside one fenced code block marked abc.`;

const ZOOM_TOOL: Anthropic.Beta.BetaTool = {
  name: 'zoom',
  description:
    'Returns an enlarged, sharpened crop of one page, taken from the original high-resolution image. Coordinates are pixels in the page image as you see it, with the origin at the top left. The staff lines found in the crop are traced in red, ledger-line positions are dashed in blue, and when you give the clefs the margins name the pitch of every line and space.',
  input_schema: {
    type: 'object',
    properties: {
      page: { type: 'integer', description: 'Page number, starting at 1' },
      left: { type: 'integer' },
      top: { type: 'integer' },
      right: { type: 'integer' },
      bottom: { type: 'integer' },
      clefs: {
        type: 'array',
        items: { type: 'string', enum: CLEFS },
        description: 'The clef of each staff in the crop, top to bottom (the last one repeats for any further staves).',
      },
    },
    required: ['page', 'left', 'top', 'right', 'bottom'],
    additionalProperties: false,
  },
  // Inmatningen strömmas direkt; den kontrolleras innan utsnittet tas
  eager_input_streaming: true,
};

const RENDER_TOOL: Anthropic.Beta.BetaTool = {
  name: 'render',
  description:
    'Renders ABC notation the way the app will show it and returns one image per system, plus any parser warnings. Use it to compare your transcription with the original.',
  input_schema: {
    type: 'object',
    properties: { abc: { type: 'string', description: 'The complete ABC tune' } },
    required: ['abc'],
    additionalProperties: false,
  },
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
  const { mime, data } = base64Of(dataUrl);
  return { type: 'image', source: { type: 'base64', media_type: mime === 'image/png' ? 'image/png' : 'image/jpeg', data } };
}

/** abcjs varningar är HTML */
function plainText(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? html;
}

/** Claudes noter uppritade, en bild per notrad, och varningarna från tolkningen */
async function render(block: Anthropic.Beta.BetaToolUseBlock): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const abc = (block.input as Record<string, unknown> | null)?.abc;
  if (typeof abc !== 'string' || !/^K:/m.test(abc)) {
    return { type: 'tool_result', tool_use_id: block.id, is_error: true, content: 'abc must be a complete ABC tune with a K: line.' };
  }
  const lib = await loadAbcjs();
  const warnings = lib.renderAbc('*', abc)[0]?.warnings ?? [];
  const images = await renderAbcImages(abc, { transpose: 0, swedish: false, perSystem: true });
  return {
    type: 'tool_result',
    tool_use_id: block.id,
    content: [
      {
        type: 'text',
        text: warnings.length
          ? `Parser warnings:\n${warnings.map((w) => `- ${plainText(w)}`).join('\n')}`
          : 'No parser warnings.',
      },
      ...images.flatMap((im, i): (Anthropic.Beta.BetaTextBlockParam | Anthropic.Beta.BetaImageBlockParam)[] => [
        { type: 'text', text: `Rendered system ${i + 1}:` },
        imageBlock(im.data),
      ]),
    ],
  };
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
  const clefs = input.clefs;
  if (clefs !== undefined && !(Array.isArray(clefs) && clefs.length && clefs.every((c) => CLEFS.includes(c as string)))) {
    return fail(`clefs must be a list of clefs, top to bottom: ${CLEFS.join(', ')}.`);
  }
  // Ur originalet, förstorat högst två gånger (med plats för marginalerna)
  const crop = scaled(p.full, x0 * p.k, y0 * p.k, (x1 - x0) * p.k, (y1 - y0) * p.k, SEND_MAX - 2 * MARGIN, 2);
  const { canvas, note } = withGuides(crop, clefs as string[] | undefined);
  return {
    type: 'tool_result',
    tool_use_id: block.id,
    content: [
      { type: 'text', text: `Page ${page as number}, x ${Math.round(x0)}–${Math.round(x1)}, y ${Math.round(y0)}–${Math.round(y1)}. ${note}` },
      imageBlock(canvas.toDataURL('image/jpeg', 0.9)),
    ],
  };
}

/**
 * Utsnittet skarpt som från en skanner, med notlinjerna markerade (röda), hjälplinjernas lägen
 * (blå streck) och tonnamnen i marginalerna: då syns det om en not ligger på en linje eller mellan två.
 */
function withGuides(crop: HTMLCanvasElement, clefs: string[] | undefined): { canvas: HTMLCanvasElement; note: string } {
  const ctx = crop.getContext('2d')!;
  const img = ctx.getImageData(0, 0, crop.width, crop.height);
  enhancePixels(img.data, crop.width, crop.height);
  ctx.putImageData(img, 0, 0);
  const ink = new Uint8Array(crop.width * crop.height);
  for (let i = 0; i < ink.length; i++) ink[i] = img.data[i * 4] < 128 ? 1 : 0;
  const staves = findStaves(ink, crop.width, crop.height);
  if (!staves.length) return { canvas: crop, note: 'No staff lines were detected in this crop, so it has no guides.' };

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
    const clef = clefs?.[Math.min(n, clefs.length - 1)];
    if (!clef) return;
    // Tonnamnen till vänster och höger, men inte in över grannraderna
    const sides = [
      { part: staff.parts[0], x: MARGIN - 6, align: 'right' as const, at: 0 },
      { part: staff.parts[staff.parts.length - 1], x: MARGIN + crop.width + 6, align: 'left' as const, at: -1 },
    ];
    for (const { part, x, align, at } of sides) {
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
  const note = [
    `Staff guides: the ${staves.length === 1 ? 'staff' : `${staves.length} staves`} found in this crop ${staves.length === 1 ? 'has its' : 'have their'} five lines traced in red, and the ledger-line positions (two above and two below) dashed in blue.`,
    clefs
      ? `The margins name the ABC pitch of every line and space (${clefs.join(', ')}, top to bottom).`
      : 'Pass clefs to get the pitch names in the margins.',
    "A notehead whose centre is on a red line has that line's pitch; one whose centre is in the white between two red lines has the space's pitch, even if its edges touch the lines. Where a red line does not lie on a printed staff line, ignore the guides for that staff.",
  ].join(' ');
  return { canvas, note };
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
          tools: [ZOOM_TOOL, RENDER_TOOL],
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
      const checking = asks.some((b) => b.name === 'render');
      zooms += asks.filter((b) => b.name === 'zoom').length;
      opts.onProgress?.(checking ? 'Jämför noterna med originalet…' : `Zoomar in… (${zooms} utsnitt)`);
      // Svaret läggs till oförändrat (med tankarna), sedan resultaten
      messages.push({ role: 'assistant', content: msg.content });
      const results: Anthropic.Beta.BetaContentBlockParam[] = await Promise.all(
        asks.map((b) =>
          b.name === 'render'
            ? render(b)
            : b.name === 'zoom'
              ? zoom(pages, b)
              : { type: 'tool_result' as const, tool_use_id: b.id, is_error: true, content: `Unknown tool ${b.name}` },
        ),
      );
      if (round === MAX_ROUNDS) results.push({ type: 'text', text: 'The tools are no longer available. Write the final ABC now.' });
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
