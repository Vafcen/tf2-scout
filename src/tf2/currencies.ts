/**
 * TF2 currency arithmetic.
 * - 1 ref = 9 scrap; 1 rec = 3 scrap. We work in scrap (integer) to avoid floating point.
 * - "value in ref" = keys * keyRateRef + metal.
 */

export function toScrap(metal: number): number {
  return Math.round(metal * 9);
}

export function toRefined(scrap: number): number {
  // Two decimals, truncated, as backpack.tf displays it: 12 scrap → 1.33, 32 scrap → 3.55, 8 scrap → 0.88.
  return Math.floor((scrap / 9) * 100 + 1e-6) / 100;
}

/** Rounds a value in ref to the nearest scrap multiple (e.g. 1.35 → 1.33). */
export function roundRef(metal: number): number {
  return toRefined(toScrap(metal));
}

export function valueRef(keys: number, metal: number, keyRateRef: number): number {
  return keys * keyRateRef + metal;
}

/** Splits a value in ref into keys + metal (metal < keyRate). */
export function splitRef(valueInRef: number, keyRateRef: number): { keys: number; metal: number } {
  if (keyRateRef <= 0) return { keys: 0, metal: roundRef(valueInRef) };
  const keys = Math.floor(valueInRef / keyRateRef);
  const metal = roundRef(valueInRef - keys * keyRateRef);
  return { keys, metal };
}

export function fmtKeysMetal(valueInRef: number, keyRateRef: number): string {
  const sign = valueInRef < 0 ? '-' : '';
  const { keys, metal } = splitRef(Math.abs(valueInRef), keyRateRef);
  const parts: string[] = [];
  if (keys) parts.push(`${keys} ${keys === 1 ? 'key' : 'keys'}`);
  if (metal || !keys) parts.push(`${metal.toFixed(2)} ref`);
  return sign + parts.join(', ');
}

export function fmtRef(valueInRef: number): string {
  return `${valueInRef.toFixed(2)} ref`;
}

export function fmtUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

export function refToUsd(valueInRef: number, keyRateRef: number, keyUsd: number): number {
  if (keyRateRef <= 0 || keyUsd <= 0) return 0;
  return (valueInRef / keyRateRef) * keyUsd;
}

export function usdToRef(usd: number, keyRateRef: number, keyUsd: number): number {
  if (keyUsd <= 0) return 0;
  return (usd / keyUsd) * keyRateRef;
}

/**
 * Steam Community Market fees for TF2: 5% Steam + 10% TF2, minimum $0.01 each,
 * computed on what the seller receives. Steam computes: buyer_pays = seller_gets + fee(seller_gets).
 * Returns what the seller receives if the buyer pays `buyerPaysCents`.
 */
export function scmSellerNetCents(buyerPaysCents: number): number {
  if (buyerPaysCents <= 0) return 0;
  // Direct search: the net n satisfies n + fee(n) === buyerPays (or the largest n that does not exceed it).
  let n = Math.floor(buyerPaysCents / 1.15);
  while (n + scmFeeCents(n) < buyerPaysCents) n++;
  while (n > 0 && n + scmFeeCents(n) > buyerPaysCents) n--;
  return n;
}

export function scmFeeCents(sellerGetsCents: number): number {
  const steam = Math.max(1, Math.floor(sellerGetsCents * 0.05));
  const game = Math.max(1, Math.floor(sellerGetsCents * 0.1));
  return steam + game;
}

/** How much the buyer must pay on SCM for the seller to receive `sellerGetsCents`. */
export function scmBuyerPaysCents(sellerGetsCents: number): number {
  return sellerGetsCents + scmFeeCents(sellerGetsCents);
}

export function netAfterFeePct(amount: number, feePct: number): number {
  return amount * (1 - feePct / 100);
}

export function pct(net: number, base: number): number {
  return base > 0 ? (net / base) * 100 : 0;
}
