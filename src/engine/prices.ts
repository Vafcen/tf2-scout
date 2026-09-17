import type { Store, RefPriceRow } from '../db/store.ts';
import { skuWithoutPaint } from '../tf2/sku.ts';

/** Price context: current key rate and per-SKU references. */
export class PriceContext {
  private store: Store;
  constructor(store: Store) {
    this.store = store;
  }

  /** Key in ref to value keys you RECEIVE (what bots pay for a key). */
  keyBuyRef(): number {
    const k = this.store.latestKeyRate();
    return k?.pricedb_buy_ref ?? k?.bptf_ref ?? 63;
  }

  /** Key in ref to value keys you PAY (what it costs to buy a key). */
  keySellRef(): number {
    const k = this.store.latestKeyRate();
    return k?.pricedb_sell_ref ?? k?.bptf_ref ?? 63.5;
  }

  /** "Mid" key rate for informational conversions. */
  keyRef(): number {
    return (this.keyBuyRef() + this.keySellRef()) / 2;
  }

  /** USD per key (cash). Prefer the value backpack.tf uses (marketplace); otherwise SCM net. */
  keyUsd(): number {
    const k = this.store.latestKeyRate();
    if (k?.bptf_usd) return k.bptf_usd;
    if (k?.scm_usd_low) return k.scm_usd_low / 1.15;
    return 1.7;
  }

  valuePay(keys: number, metal: number): number {
    return keys * this.keySellRef() + metal;
  }

  valueReceive(keys: number, metal: number): number {
    return keys * this.keyBuyRef() + metal;
  }

  refToUsd(valueRef: number): number {
    return (valueRef / this.keyRef()) * this.keyUsd();
  }

  /** Price references for a SKU: pricedb (buy/sell) and backpack.tf suggested, in ref. */
  refs(sku: string): { pricedbBuy: number | null; pricedbSell: number | null; pricedbTs: number | null; bptfSuggested: number | null; bptfTs: number | null; skuUsed: string } {
    let rows = this.store.getRefPrices(sku);
    let skuUsed = sku;
    if (!rows.some((r) => r.src === 'pricedb')) {
      const alt = skuWithoutPaint(sku);
      if (alt !== sku) {
        const altRows = this.store.getRefPrices(alt);
        if (altRows.length) {
          rows = [...rows.filter((r) => r.src !== 'pricedb'), ...altRows.filter((r) => r.src === 'pricedb')];
          skuUsed = alt;
        }
      }
    }
    const pdb = rows.find((r) => r.src === 'pricedb');
    const bptf = rows.find((r) => r.src === 'bptf');
    const k = this.keyRef();
    const val = (r: RefPriceRow | undefined, side: 'buy' | 'sell'): number | null => {
      if (!r) return null;
      const keys = side === 'buy' ? r.buy_keys : r.sell_keys;
      const metal = side === 'buy' ? r.buy_metal : r.sell_metal;
      if (keys === null && metal === null) return null;
      return (keys ?? 0) * k + (metal ?? 0);
    };
    return {
      pricedbBuy: val(pdb, 'buy'),
      pricedbSell: val(pdb, 'sell'),
      pricedbTs: pdb?.ts ?? null,
      bptfSuggested: val(bptf, 'sell'),
      bptfTs: bptf?.ts ?? null,
      skuUsed,
    };
  }

  scmLowestCents(sku: string): { cents: number; ts: number; marketName: string | null; src: string | null } | null {
    const r = this.store.db.get<{ lowest_cents: number | null; ts: number; market_name: string | null; src: string | null }>(
      'SELECT lowest_cents, ts, market_name, src FROM scm_prices WHERE sku = ?', sku,
    );
    if (!r || r.lowest_cents === null) return null;
    return { cents: r.lowest_cents, ts: r.ts, marketName: r.market_name, src: r.src };
  }
}
