// PDF:ens inbyggda typsnitt klarar bara teckentabell Windows-1252 (latin-1 plus t.ex. “ ” – —).
// Ett enda tecken utanför den, t.ex. en emoji, gör hela raden oläsbar. Byt ut eller ta bort sådana
// tecken innan texten ritas.

const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

const REPLACEMENTS: Record<string, string> = {
  '♯': '#',
  '♭': 'b',
  '♮': '',
  '−': '-',
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '―': '-',
  '′': "'",
  '″': '"',
  '‹': '<',
  '›': '>',
  '\u00A0': ' ',
  '\u2009': ' ',
  '\u202F': ' ',
};

function allowed(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || CP1252_EXTRA.has(ch) || ch === '\n';
}

export function pdfSafe(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    if (allowed(ch)) out += ch;
    else if (ch in REPLACEMENTS) out += REPLACEMENTS[ch];
    else {
      // Bokstäver med ovanliga accenter: grundbokstaven (ő → o). Annat (t.ex. emoji) tas bort.
      const base = ch.normalize('NFD').charAt(0);
      if (base !== ch && allowed(base)) out += base;
    }
  }
  return out;
}
