import { describe, expect, it } from 'vitest';
import { askSubtitleArtist, looksLikeArtist, subtitleToArtist } from './subtitleArtist';
import { parseChordPro } from './chordpro';

describe('undertitel som kan vara artisten', () => {
  it('känner igen namn men inte vanliga undertitlar', () => {
    expect(looksLikeArtist('Bröderna Prov')).toBe(true);
    expect(looksLikeArtist('Carola')).toBe(true);
    expect(looksLikeArtist('Simon and Garfunkel')).toBe(true);
    expect(looksLikeArtist('Bob Prov & the Testers')).toBe(true);
    expect(looksLikeArtist('En annan titel')).toBe(false);
    expect(looksLikeArtist('Psalm 23')).toBe(false);
    expect(looksLikeArtist('Vers: Livet är en fest')).toBe(false);
    expect(looksLikeArtist('Ett Väldigt Långt Namn Med Många Ord')).toBe(false);
  });

  it('frågar bara när artist saknas och man inte svarat nej för just den undertiteln', () => {
    const s = { subtitle: 'Bröderna Prov', artist: '' };
    expect(askSubtitleArtist(s)).toBe(true);
    expect(askSubtitleArtist({ ...s, artist: 'Någon' })).toBe(false);
    expect(askSubtitleArtist({ ...s, subtitleNotArtist: 'Bröderna Prov' })).toBe(false);
    // En ny undertitel frågas det om igen
    expect(askSubtitleArtist({ ...s, subtitleNotArtist: 'Något annat' })).toBe(true);
  });

  it('flyttar undertiteln till artist', () => {
    const out = subtitleToArtist('{title: Låt}\n{subtitle: Bröderna Prov}\n[G]Rad\n', 'Bröderna Prov');
    const { meta } = parseChordPro(out);
    expect(meta.artist).toBe('Bröderna Prov');
    expect(meta.subtitle).toBeUndefined();
    expect(out).toContain('[G]Rad');
  });
});
