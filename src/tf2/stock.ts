import { normalizeText } from './text.ts';

/**
 * Parses stock information out of a listing's free-text `details`.
 * Bots write it in many ways: "I have 0 / 1", "Stock: 2/5", "0 out of 3", "Selling 3", "STOCK = 6", "Stock: [2]".
 * "24/7" (and "7/24") are advertising, never stock.
 */
const NOT_STOCK = /\b(24\s*\/\s*7|7\s*\/\s*24)\b/g;

export function parseBuyRoom(details: string | null): number | null {
  if (!details) return null;
  const text = normalizeText(details).replace(NOT_STOCK, ' ');
  // "x / y" → have / max
  const slash = text.match(/(?<![\d.])(\d{1,3})\s*\/\s*(\d{1,3})(?!\d|\.\d)/);
  if (slash) {
    const have = Number(slash[1]);
    const max = Number(slash[2]);
    if (max > 0 && have <= max) return max - have;
  }
  // "Current stock 1 and max stock 3"
  const stockMax = text.match(/stock\s*[:=]?\s*(\d{1,3})\s*(?:and|,|\/)?\s*max(?:imum)?\s*(?:stock)?\s*[:=]?\s*(\d{1,3})/i);
  if (stockMax) {
    const have = Number(stockMax[1]);
    const max = Number(stockMax[2]);
    if (max > 0 && have <= max) return max - have;
  }
  const outOf = text.match(/(\d{1,3})\s+out\s+of\s+(\d{1,3})/i);
  if (outOf) {
    const have = Number(outOf[1]);
    const max = Number(outOf[2]);
    if (max > 0 && have <= max) return max - have;
  }
  const buying = text.match(/buying\s+(\d{1,3})\b/i);
  if (buying) return Number(buying[1]);
  return null;
}

export function parseSellUnits(details: string | null): number | null {
  if (!details) return null;
  const text = normalizeText(details).replace(NOT_STOCK, ' ');
  const patterns = [
    /selling\s+(\d{1,3})\b/i,
    /stock\s*[:=\[]*\s*(\d{1,3})\b/i,
    /i\s+have\s+(\d{1,3})\b/i,
    /(\d{1,3})\s+in\s+stock/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const n = Number(m[1]);
      if (n >= 0 && n < 1000) return n;
    }
  }
  return null;
}
