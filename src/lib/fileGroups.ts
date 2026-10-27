// Flera filer som blir en låt vid import, t.ex. "Låt (1).pdf", "Låt (2).pdf" och "Låt (3).pdf".
// Varje fil kan höra till låten ovanför i importlistan; förvalt när namnen bara skiljer sig
// på sidnumret.

import { titleKey } from './duplicates';

// "(2)", "(sida 2)", "sida 2", "s. 2", "del 2", "page 2", "p2" eller "_2"/"-2" sist i namnet.
// Högst två siffror och inte efter en annan siffra, så att "IMG_1234", "2024-06-02" och
// "Blink-182" inte räknas som sidor.
const PAGE_MARK =
  /(?:\s*\((?:(?:sida|sid|s\.|del|page|p\.?)\s*)?(\d{1,2})\)|\s*[-–,]?\s*\b(?:sida|sid|s\.|del|page|p\.?)\s*(\d{1,2})|(?<!\d)[_-](\d{1,2}))\s*$/i;

function withoutExtension(name: string): string {
  return name.replace(/\.[a-z0-9]{1,5}$/i, '');
}

/** Sidnumret i ett filnamn, t.ex. 2 för "Låt (2).pdf" eller "Låt sida 2.pdf". */
export function filePageNumber(name: string): number | undefined {
  const m = PAGE_MARK.exec(withoutExtension(name).trim());
  const n = m && (m[1] ?? m[2] ?? m[3]);
  return n ? Number(n) : undefined;
}

/** Namnet utan sidnummer och filändelse, som det jämförs. */
function baseKey(name: string): string {
  return titleKey(withoutExtension(name).trim().replace(PAGE_MARK, ''));
}

/**
 * Hör filen till samma låt som filen före? Ja när namnen är lika bortsett från sidnumret och
 * minst ett av dem har ett (två filer med exakt samma namn är snarare dubbletter).
 */
export function samePiece(prev: string, name: string): boolean {
  const k = baseKey(name);
  const [p, q] = [filePageNumber(prev), filePageNumber(name)];
  // Samma sidnummer två gånger är en dubblett, inte nästa sida
  return !!k && k === baseKey(prev) && (p !== undefined || q !== undefined) && p !== q;
}

export interface GroupItem {
  fileName: string;
  /** Sparas som fil (bara filer kan slås ihop) */
  isFile: boolean;
  /** Valt för hand; undefined = förvalet */
  joinPrev?: boolean;
}

/** Om varje post hör till låten ovanför. */
export function joinsPrevious(items: GroupItem[]): boolean[] {
  const joins: boolean[] = [];
  // Sidnumren i låten som posten skulle bli en del av
  let pages = new Set<number | undefined>();
  items.forEach((it, i) => {
    const prev = items[i - 1];
    const page = filePageNumber(it.fileName);
    let join = false;
    if (prev && it.isFile && prev.isFile) {
      // Förval: samma noter, och sidan finns inte redan (samma filer valda två gånger)
      join = it.joinPrev ?? (samePiece(prev.fileName, it.fileName) && !pages.has(page));
    }
    if (!join) pages = new Set();
    pages.add(page);
    joins.push(join);
  });
  return joins;
}

/** Första posten i varje posts låt (posten själv om den inte hör till låten ovanför). */
export function groupHeads(items: GroupItem[]): number[] {
  const joins = joinsPrevious(items);
  const heads: number[] = [];
  joins.forEach((j, i) => heads.push(j ? heads[i - 1] : i));
  return heads;
}

/** Filer i sidordning när alla har ett sidnummer, annars i den ordning de kom. */
export function sortByPage<T extends { name: string }>(files: T[]): T[] {
  // En fil utan nummer bland numrerade är första sidan ("Låt.pdf", "Låt (sida 2).pdf")
  let nums = files.map((f) => filePageNumber(f.name));
  if (nums.filter((n) => n === undefined).length === 1 && files.length > 1) nums = nums.map((n) => n ?? 1);
  if (nums.some((n) => n === undefined)) return files;
  return files.map((f, i) => ({ f, n: nums[i]!, i })).sort((a, b) => a.n - b.n || a.i - b.i).map((x) => x.f);
}

/** Sant om alla titlar är samma noter med olika sidnummer, t.ex. "Låt (1)" och "Låt (2)". */
export function samePieceTitles(titles: string[]): boolean {
  const k = baseKey(titles[0] ?? '');
  const pages = titles.map(filePageNumber);
  return !!k && titles.every((t) => baseKey(t) === k) && pages.some((p) => p !== undefined) && new Set(pages).size === pages.length;
}

/** Titeln utan sidnummer: "Låt (2)" → "Låt". */
export function pieceTitle(title: string): string {
  return title.trim().replace(PAGE_MARK, '').trim() || title.trim();
}

/**
 * Låtar i biblioteket som ser ut att vara sidor av samma noter: filer med samma titel (och
 * artist) bortsett från sidnumret, med olika sidnummer. Varje grupp är i sidordning.
 */
export function pieceGroups<T extends { id: string; title: string; artist: string; isFile: boolean }>(songs: T[]): T[][] {
  const byKey = new Map<string, T[]>();
  for (const s of songs) {
    if (!s.isFile) continue;
    const k = `${baseKey(s.title)}|${titleKey(s.artist)}`;
    if (!baseKey(s.title)) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), s]);
  }
  const groups: T[][] = [];
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const nums = list.map((s) => filePageNumber(s.title));
    // Samma sidnummer två gånger (eller inget alls) är snarare kopior än sidor
    if (nums.every((n) => n === undefined) || new Set(nums).size < nums.length) continue;
    groups.push(
      list
        .map((s, i) => ({ s, n: nums[i] ?? 0 }))
        .sort((a, b) => a.n - b.n)
        .map((x) => x.s),
    );
  }
  return groups;
}

/** Ett förslag att slå ihop känns igen på låtarna i det. */
export function mergeKey(group: { id: string }[]): string {
  return group
    .map((s) => s.id)
    .sort()
    .join('+');
}
