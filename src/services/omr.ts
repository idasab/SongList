// Notläsning: foton eller PDF:er av notblad tolkas av Claude till noter i ABC-format.
// Anropet går direkt från appen till Anthropics API med användarens egen API-nyckel
// (sparas bara på enheten). Kräver internet.
import Anthropic from '@anthropic-ai/sdk';
import { abcToChordPro } from '../lib/abc';
import { loadImageToCanvas } from './ocr';

/** En sida att läsa: en bild eller en PDF (som data-URL) */
export interface SheetSource {
  kind: 'image' | 'pdf';
  dataUrl: string;
}

const MODEL = 'claude-opus-5-5';

const SYSTEM = `You transcribe printed or handwritten sheet music from photos and PDFs into ABC notation (ABC standard 2.1, as rendered by abcjs).

Transcribe exactly what is written; never arrange, simplify or complete the music. Include:
- Header: X:1, T: (title), C: (composer/arranger, if printed), M:, L:, Q: (only if a tempo is marked), K: (key signature; use the key that the signature and the music imply, e.g. K:Em, and add clef=bass when the first staff is in bass clef).
- Every voice and staff. For more than one staff use %%score with braces or brackets as printed, e.g. %%score [(S A) (T B)] for a choir on two staves or %%score {RH | LH} for piano. Declare each voice with V: (id, clef, name or short name as printed) and prefix every music line with its inline voice field, e.g. [V:S]. Two voices sharing one staff (stems up/down) are two separate voices inside the same parentheses in %%score.
- Lyrics with w: lines directly after the voice line they belong to, using - between syllables and _ for melismas; several verses become several w: lines.
- Chord symbols printed above the staff as "G", "Am7", "D/F#" before the note they belong to.
- Accidentals, ties, slurs, triplets, rests, repeats, voltas (|1 :|2), fermatas, dynamics (!p!, !f!), and inline key or meter changes ([K:D], [M:3/4]).
Keep one ABC line per printed system, in the same order, so that line breaks match the original. Multiple images or pages are consecutive pages of the same piece unless they are clearly different pieces; transcribe them as one tune.
Check every bar: the durations in each voice must add up to the meter (allowing pickup bars). Where something is unreadable, write your best reading and add a % comment on the line before it describing the uncertainty.

Reply with only the ABC, inside one fenced code block marked abc.`;

/** Fel med ett meddelande som kan visas för användaren */
export class OmrError extends Error {}

function base64Of(dataUrl: string): { mime: string; data: string } {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new OmrError('Filen kunde inte läsas');
  return { mime: m[1], data: m[2] ? m[3] : btoa(decodeURIComponent(m[3])) };
}

/** Bilder skalas ner (Claude läser inte fler detaljer än så) och görs om till JPEG */
export async function imageFileToSource(file: File): Promise<SheetSource> {
  const canvas = await loadImageToCanvas(file, 2400);
  return { kind: 'image', dataUrl: canvas.toDataURL('image/jpeg', 0.9) };
}

function contentBlock(src: SheetSource): Anthropic.Beta.BetaContentBlockParam {
  const { mime, data } = base64Of(src.dataUrl);
  if (src.kind === 'pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  }
  const media = mime === 'image/png' || mime === 'image/webp' || mime === 'image/gif' ? mime : 'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type: media, data } };
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
  opts.onProgress?.('Läser noterna…');
  const pages = sources.length > 1 ? `${sources.length} sidor av samma stycke. ` : '';
  try {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        // Avböjs anropet av säkerhetsfiltren görs det om med en annan modell
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'high' },
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [...sources.map(contentBlock), { type: 'text', text: `${pages}Transcribe this sheet music to ABC.` }],
          },
        ],
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
    return abcToChordPro(abcFromReply(text), opts.title);
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
