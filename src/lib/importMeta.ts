// Uppgifter i huvudet på utskrivna noter, t.ex. "Key: G, Time Signature: 4/4" och
// "Text & Music: Namn", blir ChordPro-direktiv i stället för låttext.

const FIELDS: [RegExp, string][] = [
  [/^(key|tonart)$/i, 'key'],
  [/^(time signature|time|taktart|takt)$/i, 'time'],
  [/^(tempo|bpm)$/i, 'tempo'],
  [/^capo$/i, 'capo'],
];

// "Text & Music", "Text och musik", "Words and Music", "Text", "Musik" …
const CREDIT = /^((?:text|words|lyrics|ord|musik|music)(?:\s*(?:&|och|and|\/)\s*(?:text|words|lyrics|musik|music))?)\s*:\s*(.+)$/i;
const CREDIT_IN_LINE = /^(.+?)\s+((?:text|words|lyrics|musik|music)(?:\s*(?:&|och|and|\/)\s*(?:text|words|lyrics|musik|music))?\s*:.+)$/i;

// Datum och klockslag från webbläsarens sidhuvud vid utskrift, t.ex. "2017-05-14 09:38"
const PRINT_DATE = /\s*\b\d{4}-\d{2}-\d{2}\b(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/g;

function clean(value: string): string {
  return value.trim().replace(/[,;]+$/, '').trim();
}

/** Gör om en rad med uppgifter till direktiv, eller undefined om raden inte är sådan. */
function metaLine(line: string): { name: string; value: string }[] | undefined {
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
  const parts = line.split(/,\s*(?=[\p{L} ]+:)/u);
  const out: { name: string; value: string }[] = [];
  for (const part of parts) {
    const m = /^([\p{L} ]+):\s*(\S+)/u.exec(part.trim());
    const name = m && FIELDS.find(([re]) => re.test(m[1].trim()))?.[1];
    if (!m || !name) return undefined;
    out.push({ name, value: clean(m[2]) });
  }
  return out.length ? out : undefined;
}

/**
 * Plockar ut uppgifter från noternas huvud (och rader som "Text & Musik: …" eller "© …" var som
 * helst) och lägger dem som direktiv överst. Webbläsarens utskriftsdatum tas bort, och en rad
 * som bara upprepar titeln tas bort.
 */
export function extractImportMeta(chordPro: string): string {
  const lines = chordPro.split('\n');
  const body = lines.findIndex((l) => /\[[^\]]+\]|^\{start_of/.test(l));
  const headEnd = body < 0 ? lines.length : body;
  const directives: { name: string; value: string }[] = [];
  let title: string | undefined;
  const rest: string[] = [];

  lines.forEach((raw, i) => {
    const inHead = i < headEnd;
    const t = /^\{title:\s*(.*)\}$/.exec(raw.trim());
    if (t) {
      title = t[1].replace(PRINT_DATE, '').trim();
      return;
    }
    let line = inHead ? raw.replace(PRINT_DATE, '').trim() : raw;
    if (inHead && !line) {
      if (raw.trim()) return;
      rest.push(raw);
      return;
    }
    const pieces: string[] = [];
    const inLine = inHead ? CREDIT_IN_LINE.exec(line) : null;
    if (inLine) {
      pieces.push(inLine[1]);
      line = inLine[2];
    }
    const meta = metaLine(line.trim());
    if (meta) {
      directives.push(...meta);
      if (!pieces.length) return;
    } else pieces.push(line);
    for (const p of pieces) {
      const same = title && p.trim().toLowerCase() === title.toLowerCase();
      if (inHead && same) continue;
      if (inHead && !title && !/^\{/.test(p.trim()) && p.trim()) {
        title = p.trim();
        continue;
      }
      rest.push(p);
    }
  });

  const seen = new Set<string>();
  const top = [
    ...(title ? [{ name: 'title', value: title }] : []),
    ...directives.filter((d) => {
      // Första förekomsten gäller; artist från "Text & Musik" bara om ingen artist redan finns
      if (seen.has(d.name)) return false;
      seen.add(d.name);
      return true;
    }),
  ].map((d) => `{${d.name}: ${d.value}}`);
  // Direktiv som redan fanns överst (t.ex. {artist}) ligger kvar efter titeln
  const leading: string[] = [];
  while (rest.length && /^\{(?!start_of|comment)/.test(rest[0].trim())) leading.push(rest.shift()!);
  while (rest.length && !rest[0].trim()) rest.shift();
  const existing = new Set(leading.map((l) => /^\{(\w+)/.exec(l.trim())?.[1]));
  const merged = [...top.slice(0, title ? 1 : 0), ...leading, ...top.slice(title ? 1 : 0).filter((d) => !existing.has(/^\{(\w+)/.exec(d)?.[1]))];
  return `${merged.join('\n')}${merged.length ? '\n\n' : ''}${rest.join('\n')}`;
}
