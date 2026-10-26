// Dubbletter vid import: låtar som redan finns i biblioteket eller förekommer flera gånger i
// samma import. Titlar jämförs utan skiftläge, skiljetecken och en avslutande siffra i parentes
// ("Låt (2)"), eftersom kopior och sidor av samma PDF ofta heter så.

import type { Song } from './model';

/** Titeln som den jämförs: "Allt som Herren gjort - D (2)" → "allt som herren gjort d". */
export function titleKey(title: string): string {
  return title
    .normalize('NFC')
    .toLocaleLowerCase('sv')
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Siffran i parentes sist i titeln, t.ex. 2 för "Låt (2)". */
export function pageNumber(title: string): number | undefined {
  const m = /\((\d+)\)\s*$/.exec(title.trim());
  return m ? Number(m[1]) : undefined;
}

export interface DuplicateCandidate {
  title: string;
  artist: string;
  content: string;
  /** Originalfilens innehåll (data-URL) för låtar som sparas som fil */
  fileData?: string;
}

export interface Duplicate {
  /** Låten i biblioteket, eller undefined om dubbletten finns tidigare i samma import */
  song?: Song;
  /** Titeln på den andra låten */
  title: string;
  /** Samma innehåll (eller samma fil), inte bara samma titel */
  identical: boolean;
  /** Olika siffror i parentes: kan vara olika sidor av samma noter */
  otherPage: boolean;
}

function sameArtist(a: string, b: string): boolean {
  // Saknas artist på någon av dem räcker titeln
  return !a.trim() || !b.trim() || titleKey(a) === titleKey(b);
}

function sameContent(a: DuplicateCandidate, b: DuplicateCandidate): boolean {
  if (a.fileData || b.fileData) return !!a.fileData && a.fileData === b.fileData;
  return a.content.trim() === b.content.trim();
}

function compare(c: DuplicateCandidate, other: DuplicateCandidate): Omit<Duplicate, 'song' | 'title'> | null {
  if (titleKey(c.title) !== titleKey(other.title) || !sameArtist(c.artist, other.artist)) return null;
  const identical = sameContent(c, other);
  const [p, q] = [pageNumber(c.title), pageNumber(other.title)];
  return { identical, otherPage: !identical && p !== q && (p !== undefined || q !== undefined) };
}

/**
 * Dubbletter för varje låt i en import: i första hand en låt i biblioteket, annars en
 * tidigare låt i samma import.
 */
export function findDuplicates(candidates: DuplicateCandidate[], library: Song[]): (Duplicate | undefined)[] {
  const byTitle = new Map<string, Song[]>();
  for (const s of library) {
    if (s.deletedAt) continue;
    const k = titleKey(s.title);
    byTitle.set(k, [...(byTitle.get(k) ?? []), s]);
  }
  return candidates.map((c, i) => {
    let best: Duplicate | undefined;
    for (const s of byTitle.get(titleKey(c.title)) ?? []) {
      const r = compare(c, { title: s.title, artist: s.artist, content: s.content, fileData: s.attachment?.dataUrl || undefined });
      if (r && (!best || (r.identical && !best.identical))) best = { song: s, title: s.title, ...r };
    }
    if (best) return best;
    for (let j = 0; j < i; j++) {
      const r = compare(c, candidates[j]);
      if (r) return { title: candidates[j].title, ...r };
    }
    return undefined;
  });
}
