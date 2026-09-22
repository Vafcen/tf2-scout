import { normalizeText } from '../tf2/text.ts';

/**
 * Bait detection for SELL listings.
 *
 * Some sellers (mostly humans, but also a few bots) list an item far below its real value to rank first in the
 * classifieds and then refuse the trade, negotiate, or ask you to add them. Measured on a week of real data, these
 * are ~1 % of detected snipes but dominate the high-profit tail, so they must never reach an alert.
 */

/** The listing text says the asking price is not the real price. */
const BAIT_PATTERNS: RegExp[] = [
  /send me offers?/i,
  /(wont|won't|not)\s+sell\s+for/i,
  /negotiabl/i,
  /offers?\s+(welcome|only|accepted)/i,
  /taking\s+offers?/i,
  /accepting\s+offers?/i,
  /make\s+(me\s+)?an?\s+offer/i,
  /\bor\s+best\s+offer\b/i,
  /\bo\.?b\.?o\.?\b/i,
  /lowest\s+price/i,
  /price\s+is\s+not\s+final/i,
  /add\s+me\s+to\s+(negotiate|discuss)/i,
];

export function baitTextReason(details: string | null): string | null {
  if (!details) return null;
  const text = normalizeText(details);
  for (const re of BAIT_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0].slice(0, 40);
  }
  return null;
}

/**
 * A price far below every reliable buy order is not a bargain, it is bait or a mispriced listing nobody will honour.
 * Real stale-pricer snipes are a few percent below the exit, not a fraction of it.
 */
export const TOO_GOOD_RATIO = 0.5;

export function priceTooGoodReason(cost: number, exitRef: number): string | null {
  if (cost <= 0 || exitRef <= 0) return null;
  const ratio = cost / exitRef;
  if (ratio >= TOO_GOOD_RATIO) return null;
  return `asking ${Math.round(ratio * 100)} % of what buy orders pay`;
}

/** Combined check for a sell listing used as the buy leg of an opportunity. */
export function baitReason(details: string | null, cost: number, exitRef: number): string | null {
  return priceTooGoodReason(cost, exitRef) ?? baitTextReason(details);
}

/** Confidence ceiling for an opportunity whose sell leg looks like bait (below the 0.3 alert threshold). */
export const BAIT_CONFIDENCE_CAP = 0.15;
