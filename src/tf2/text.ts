/**
 * Normalizes text "decorated" with Mathematical Alphanumeric Symbols (𝗕𝗨𝗬𝗜𝗡𝗚, 𝟭𝟮, 𝘀𝗲𝗹𝗹…) to ASCII
 * so keywords can be searched for in listing details.
 */
const LETTER_BLOCKS = [0x1d400, 0x1d434, 0x1d468, 0x1d49c, 0x1d4d0, 0x1d504, 0x1d538, 0x1d56c, 0x1d5a0, 0x1d5d4, 0x1d608, 0x1d63c, 0x1d670];
const DIGIT_BLOCKS = [0x1d7ce, 0x1d7d8, 0x1d7e2, 0x1d7ec, 0x1d7f6];

export function normalizeText(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x1d400 || cp > 0x1d7ff) {
      out += ch;
      continue;
    }
    let mapped: string | null = null;
    for (const base of LETTER_BLOCKS) {
      const off = cp - base;
      if (off >= 0 && off < 52) {
        mapped = String.fromCharCode(off < 26 ? 65 + off : 97 + off - 26);
        break;
      }
    }
    if (mapped === null) {
      for (const base of DIGIT_BLOCKS) {
        const off = cp - base;
        if (off >= 0 && off < 10) {
          mapped = String(off);
          break;
        }
      }
    }
    out += mapped ?? ch;
  }
  return out.replace(/[⠀​‌‍]/g, ' ');
}
