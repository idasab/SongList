import { describe, expect, it } from 'vitest';
import { extractImportMeta } from './importMeta';

describe('uppgifter i notornas huvud', () => {
  it('gör tonart, taktart och upphovsperson till direktiv och tar bort utskriftsdatum', () => {
    const src = [
      '{title: Morgonvisa 2017-05-14 09:38}',
      '',
      'Morgonvisa Text & Music: Anna Exempel,',
      'Key: G, Time Signature: 4/4 [0]',
      '[G]Solen går [C]upp',
    ].join('\n');
    const out = extractImportMeta(src);
    expect(out).toBe('{title: Morgonvisa}\n{artist: Anna Exempel}\n{key: G}\n{time: 4/4}\n\n[G]Solen går [C]upp');
  });

  it('text och musik var för sig, och © längst ner', () => {
    const out = extractImportMeta('{title: Visa}\n\n[C]La la\n\nText: Anna\nMusik: Bo\n© 2020 Förlaget');
    expect(out).toContain('{lyricist: Anna}\n{composer: Bo}\n{copyright: © 2020 Förlaget}');
    expect(out).not.toMatch(/^Text:/m);
  });

  it('låter vanlig text vara', () => {
    const src = '{title: Visa}\n\nSolen går upp\n[C]över ån';
    expect(extractImportMeta(src)).toBe(src);
  });
});
