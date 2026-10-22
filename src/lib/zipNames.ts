// Rätt filnamn i zip-filer. Många program (t.ex. Arkivverktyget på Mac) skriver filnamn i UTF-8
// utan att markera det, och Utforskaren i äldre Windows skriver dem i teckentabell 437.
// Uppackningen läser då namnen tecken för tecken, så att "å" blir "Ã¥" eller "†".

const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

function decodeCp437(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
  return s;
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/** Tolkar ett filnamn utan UTF-8-markering: UTF-8 om det går, annars teckentabell 437. */
export function decodeZipName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (utf8Flag) return new TextDecoder().decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return decodeCp437(bytes);
  }
}

/**
 * Läser zip-filens innehållsförteckning och ger en översättning från namnen som fflate
 * använder (UTF-8 om filen är markerad så, annars latin-1) till rätt namn.
 */
export function zipNameMap(data: Uint8Array): Map<string, string> {
  const map = new Map<string, string>();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // Slutposten (End of central directory) ligger sist, före en eventuell kommentar
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return map;
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  for (let n = 0; n < count && p + 46 <= data.length; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const flag = view.getUint16(p + 8, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const bytes = data.subarray(p + 46, p + 46 + nameLen);
    const utf8Flag = (flag & 0x800) !== 0;
    const key = utf8Flag ? new TextDecoder().decode(bytes) : latin1(bytes);
    map.set(key, decodeZipName(bytes, utf8Flag).normalize('NFC'));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return map;
}
