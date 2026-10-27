// Uppgifter i huvudet på utskrivna noter, t.ex. "Key: G, Time Signature: 4/4" och
// "Text & Music: Namn", blir ChordPro-direktiv i stället för låttext.

type Meta = { name: string; value: string };

// Fältets värde ur texten efter kolon; undefined om det inte ser ut som ett sådant värde
const FIELDS: [RegExp, string, (v: string) => string | undefined][] = [
  [
    /^(key|tonart)$/i,
    'key',
    (v) => {
      // "E minor" och "A moll" = Em och Am; "G major" och "D dur" = G och D
      const m = /^([A-H][#b]?)(m(?![a-z]))?\s*(minor|moll|major|dur)?\b/i.exec(v);
      if (!m) return undefined;
      const root = m[1].charAt(0).toUpperCase() + m[1].slice(1);
      return root + (m[2] || /minor|moll/i.test(m[3] ?? '') ? 'm' : '');
    },
  ],
  [/^(time signature|time|taktart|takt)$/i, 'time', (v) => /^\d{1,2}\/\d{1,2}\b/.exec(v)?.[0]],
  [/^(tempo|bpm)$/i, 'tempo', (v) => /^\d{2,3}\b/.exec(v)?.[0]],
  [/^capo$/i, 'capo', (v) => /^\d{1,2}\b/.exec(v)?.[0]],
];

// "Text & Music", "Text och musik", "Words and Music", "Text", "Musik" … (med stor bokstav)
const CREDIT_WORDS = '(?:Text|Words|Lyrics|Ord|Musik|Music)(?:\\s*(?:&|och|and|\\/)\\s*(?:[Tt]ext|[Ww]ords|[Ll]yrics|[Mm]usik|[Mm]usic))?';
const CREDIT = new RegExp(`^(${CREDIT_WORDS})\\s*:\\s*(.+)$`);
// Titel och upphovsperson på samma rad: "Visa Text & Music: Anna" (inte "Text & Music: Anna")
const CREDIT_IN_LINE = new RegExp(`^(.+?)(?<!&|och|and|\\/)\\s+(${CREDIT_WORDS}\\s*:.+)$`);

// Datum och klockslag från webbläsarens sidhuvud vid utskrift, t.ex. "2017-05-14 09:38"
const PRINT_DATE = /\s*\b\d{4}-\d{2}-\d{2}\b(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/g;

// Huvudet: raderna före första ackordet, men högst så här många rader med text
const MAX_HEAD_LINES = 6;

function clean(value: string): string {
  return value.trim().replace(/[,;]+$/, '').trim();
}

/** Upphovspersoner och ©: gäller var som helst i låten (på en egen rad). */
function creditLine(line: string): Meta[] | undefined {
  const credit = CREDIT.exec(line);
  if (credit) {
    const who = credit[1].toLowerCase();
    const value = clean(credit[2]);
    if (!value) return [];
    const both = /&|och|and|\//.test(who);
    const name = both ? 'artist' : /text|words|lyrics|ord/.test(who) ? 'lyricist' : 'composer';
    return [{ name, value }];
  }
  if (/^©/.test(line)) {
    const value = clean(line.replace(/^©\s*/, ''));
    return value ? [{ name: 'copyright', value: line.trim() }] : [];
  }
  return undefined;
}

/** Tonart, taktart, tempo och capo, t.ex. "Key: G, Time Signature: 4/4". Bara i huvudet. */
function fieldLine(line: string): Meta[] | undefined {
  const parts = line.split(/,\s*(?=[\p{L} ]+:)/u);
  const out: Meta[] = [];
  for (const part of parts) {
    const m = /^([\p{L} ]+):\s*(.+)$/u.exec(part.trim());
    const field = m && FIELDS.find(([re]) => re.test(m[1].trim()));
    const value = field && field[2](m[2].trim());
    if (!field || !value) return undefined;
    out.push({ name: field[1], value });
  }
  return out.length ? out : undefined;
}

/**
 * Plockar ut uppgifter från noternas huvud (och rader som "Text & Musik: …" eller "© …" var som
 * helst) och lägger dem som direktiv överst. Webbläsarens utskriftsdatum tas bort, och en rad i
 * huvudet som bara upprepar titeln tas bort.
 */
export function extractImportMeta(chordPro: string): string {
  const lines = chordPro.split('\n');
  const firstChord = lines.findIndex((l) => /\[[A-H][^\]]*\]|^\s*\{start_of/.test(l));
  // Huvudet: före första ackordet eller delen, och högst MAX_HEAD_LINES rader med text
  let headEnd = firstChord < 0 ? lines.length : firstChord;
  let filled = 0;
  for (let i = 0; i < headEnd; i++) {
    if (lines[i].trim() && !/^\s*\{/.test(lines[i]) && ++filled > MAX_HEAD_LINES) {
      headEnd = i;
      break;
    }
  }
  // Utan ackord är det mesta låttext: bara de första raderna kan vara huvud
  if (firstChord < 0) headEnd = Math.min(headEnd, 4);

  const directives: Meta[] = [];
  let title: string | undefined;
  const rest: string[] = [];

  /** En rad i huvudet: uppgifter blir direktiv, resten blir kvar. */
  const headPiece = (text: string) => {
    const meta = creditLine(text) ?? fieldLine(text);
    if (meta) {
      directives.push(...meta);
      return;
    }
    // En rad som upprepar titeln (bara om låten har ackord; annars kan det vara en textrad)
    if (title && firstChord >= 0 && text.toLowerCase() === title.toLowerCase()) return;
    // Utan titel: första raden i huvudet, om låten har ackord (annars kan det vara sångtext)
    if (!title && firstChord >= 0) {
      title = text;
      return;
    }
    rest.push(text);
  };

  lines.forEach((raw, i) => {
    const inHead = i < headEnd;
    const trimmed = raw.trim();
    // Webbläsarens sidhuvud på varje sida: titel och datum, eller bara datum
    if (PRINT_DATE.test(trimmed)) {
      PRINT_DATE.lastIndex = 0;
      const left = trimmed.replace(PRINT_DATE, '').trim();
      if (!left || (title && left.toLowerCase() === title.toLowerCase())) return;
    }
    PRINT_DATE.lastIndex = 0;

    const dir = /^\{(\w+):\s*(.*)\}$/.exec(trimmed);
    if (dir && (dir[1] === 'title' || dir[1] === 'artist')) {
      // Titeln (och artisten från titelraden) kan innehålla datum eller en upphovsperson
      let value = dir[2].replace(PRINT_DATE, '').trim();
      const inLine = CREDIT_IN_LINE.exec(value);
      if (inLine) {
        value = inLine[1].trim();
        directives.push(...(creditLine(inLine[2]) ?? []));
      }
      const meta = creditLine(value) ?? fieldLine(value);
      if (dir[1] === 'title') title = value;
      else if (meta) directives.push(...meta);
      else directives.push({ name: 'artist', value });
      return;
    }

    if (inHead && trimmed && !trimmed.startsWith('{')) {
      const text = trimmed.replace(PRINT_DATE, '').trim();
      if (!text) return;
      const inLine = CREDIT_IN_LINE.exec(text);
      if (inLine) {
        headPiece(inLine[1].trim());
        headPiece(inLine[2]);
      } else headPiece(text);
      return;
    }
    const credit = trimmed && !trimmed.startsWith('{') ? creditLine(trimmed) : undefined;
    if (credit) {
      directives.push(...credit);
      return;
    }
    rest.push(raw);
  });

  // Första förekomsten gäller; artist från titelraden går före "Text & Musik"
  const seen = new Set<string>();
  const top = [...(title ? [{ name: 'title', value: title }] : []), ...directives]
    .filter((d) => {
      if (seen.has(d.name)) return false;
      seen.add(d.name);
      return true;
    })
    .map((d) => `{${d.name}: ${d.value}}`);
  // Direktiv som redan fanns överst (t.ex. {key}) ligger kvar, om de inte redan finns
  const leading: string[] = [];
  while (rest.length && /^\s*\{(?!start_of|comment)/.test(rest[0])) leading.push(rest.shift()!.trim());
  while (rest.length && !rest[0].trim()) rest.shift();
  const names = new Set(top.map((d) => /^\{(\w+)/.exec(d)?.[1]));
  const merged = [...top, ...leading.filter((l) => !names.has(/^\{(\w+)/.exec(l)?.[1]))];
  return `${merged.join('\n')}${merged.length ? '\n\n' : ''}${rest.join('\n')}`;
}
