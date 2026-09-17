import type { ListingRow, Store } from '../db/store.ts';
import { now } from '../db/store.ts';
import type { PriceContext } from './prices.ts';
import { botPulse } from './botPulse.ts';
import { normalizeText } from '../tf2/text.ts';

export interface PricedListing {
  row: ListingRow;
  /** value in ref (depending on the side: what you pay if buying / what you receive if selling) */
  valueRef: number;
  online: boolean;
  /** buy order far above reference or with conditions in the text: not a reliable exit */
  outlier: string | null;
}

/** Typical texts of conditional buy orders (spells, paints, sheens...). */
const CONDITIONAL_PATTERNS = [
  /price is for/i, /less for other/i, /listed parts/i, /with parts/i, /spell/i, /paint/i, /fh\/ts/i, /sheen/i, /killstreaker/i,
  /only (if|with|for)/i, /must (have|be)/i, /\blvl\b/i, /\blevel\b/i, /craft ?#/i, /\bfestivized\b/i, /halloween/i, /combo/i,
];

export function conditionalReason(details: string | null): string | null {
  if (!details) return null;
  const text = normalizeText(details);
  for (const re of CONDITIONAL_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0].slice(0, 30);
  }
  return null;
}

export interface Book {
  sku: string;
  buys: PricedListing[]; // sorted from highest to lowest value
  sells: PricedListing[]; // sorted from lowest to highest value
  botBuys: PricedListing[]; // online bots only
  bestBuy: PricedListing | null; // best acceptable buy order (online bot or online premium human)
  bestSell: PricedListing | null;
}

export class OrderBook {
  private store: Store;
  private prices: PriceContext;
  constructor(store: Store, prices: PriceContext) {
    this.store = store;
    this.prices = prices;
  }

  isOnline(row: ListingRow, botPulseMaxAgeMin: number, ts = now()): boolean {
    if (row.is_bot) {
      const pulse = Math.max(row.last_pulse ?? 0, botPulse.get(row.steamid) ?? 0);
      if (pulse) return pulse >= ts - botPulseMaxAgeMin * 60;
      return row.seen_at >= ts - 6 * 3600;
    }
    return !!row.online || row.seen_at >= ts - 2 * 3600;
  }

  build(sku: string, botPulseMaxAgeMin: number): Book {
    const ts = now();
    const rows = this.store.activeListings(sku);
    const refs = this.prices.refs(sku);
    const ref = refs.pricedbSell ?? refs.bptfSuggested;
    const buys: PricedListing[] = [];
    const sells: PricedListing[] = [];
    for (const row of rows) {
      if (row.banned) continue;
      if (row.usd !== null && row.usd !== undefined && !row.keys && !row.metal) continue; // marketplace.tf: handled separately
      const online = this.isOnline(row, botPulseMaxAgeMin, ts);
      if (row.intent === 'buy') {
        const valueRef = this.prices.valueReceive(row.keys, row.metal);
        let outlier = conditionalReason(row.details);
        // Far above reference (×1.6, and at least 1 ref more): usually bait for specific attributes.
        if (!outlier && ref && ref > 0 && valueRef > Math.max(ref * 1.6, ref + 1)) outlier = 'far above reference';
        buys.push({ row, valueRef, online, outlier });
      } else {
        sells.push({ row, valueRef: this.prices.valuePay(row.keys, row.metal), online, outlier: null });
      }
    }
    buys.sort((a, b) => b.valueRef - a.valueRef);
    sells.sort((a, b) => a.valueRef - b.valueRef);
    const botBuys = buys.filter((b) => b.row.is_bot && b.online && !b.outlier);
    const acceptableBuys = buys.filter((b) => b.online && !b.outlier && (b.row.is_bot || b.row.premium));
    return { sku, buys, sells, botBuys, bestBuy: acceptableBuys[0] ?? null, bestSell: sells[0] ?? null };
  }

  /** Best reliable buy order excluding a steamid (so you don't "sell" to the same person who is selling to you). */
  bestBuyExcluding(book: Book, steamid: string): PricedListing | null {
    return book.buys.find((b) => b.online && !b.outlier && (b.row.is_bot || b.row.premium) && b.row.steamid !== steamid) ?? null;
  }
}
