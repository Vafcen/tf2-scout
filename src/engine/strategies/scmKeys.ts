import type { Settings } from '../../config.ts';
import type { Store } from '../../db/store.ts';
import { now } from '../../db/store.ts';
import type { OrderBook } from '../orderbook.ts';
import type { PriceContext } from '../prices.ts';
import type { Opportunities } from '../opportunities.ts';
import type { ScmSource } from '../../sources/scm.ts';
import { fmtKeysMetal, fmtUsd } from '../../tf2/currencies.ts';
import { bptfClassifiedsUrl, pricedbUrl, scmUrl } from '../links.ts';
import { isUnusualSku } from '../../tf2/sku.ts';

interface Candidate {
  sku: string;
  market_name: string | null;
  lowest_cents: number;
  volume: number | null;
  src: string;
  ts: number;
}

/**
 * Lane 3: SCM → keys. Items that, bought on the Steam Market with wallet balance and sold to bot buy orders
 * for keys, yield more keys per dollar than buying keys directly on the Market.
 * Note: anything bought on the Market is trade-locked for 7 days.
 */
export class ScmKeysStrategy {
  private store: Store;
  private book: OrderBook;
  private prices: PriceContext;
  private opps: Opportunities;
  private scm: ScmSource;
  lastRunAt: number | null = null;
  lastCandidates = 0;
  lastResults = 0;
  pendingVerification = 0;

  constructor(store: Store, book: OrderBook, prices: PriceContext, opps: Opportunities, scm: ScmSource) {
    this.store = store;
    this.book = book;
    this.prices = prices;
    this.opps = opps;
    this.scm = scm;
  }

  run(s: Settings): number {
    const ts = now();
    const kr = this.store.latestKeyRate();
    const keyUsdScm = kr?.scm_usd_low ?? null;
    if (!keyUsdScm) return 0;
    const baselineKeysPerUsd = 1 / keyUsdScm;
    const keyBuyRef = this.prices.keyBuyRef();
    const minCents = Math.round(s.scm.minPriceUsd * 100);
    const candidates = this.store.db.all<Candidate>(
      `SELECT sku, market_name, lowest_cents, volume, src, ts FROM scm_prices WHERE lowest_cents >= ? AND ts >= ? AND market_name IS NOT NULL`,
      minCents, ts - 2 * 86400,
    );
    this.lastCandidates = candidates.length;
    const scored: { c: Candidate; keysPerUsd: number; advantage: number; bestBuyRef: number; botBuys: number; verified: boolean; buyerName: string | null; buyerTradeUrl: string | null; buyerCount: number }[] = [];
    for (const c of candidates) {
      // The Steam Market groups unusuals by hat (all effects together) and doesn't distinguish paints/spells:
      // it only makes sense for SKUs whose market name identifies the exact item.
      if (isUnusualSku(c.sku) || /;p\d+/.test(c.sku)) continue;
      const book = this.book.build(c.sku, s.snipe.botPulseMaxAgeMin);
      if (book.botBuys.length < 2) continue;
      const best = book.botBuys[0];
      const keysReceived = best.valueRef / keyBuyRef;
      const usd = c.lowest_cents / 100;
      const keysPerUsd = keysReceived / usd;
      const advantage = (keysPerUsd / baselineKeysPerUsd - 1) * 100;
      if (advantage < s.scm.minAdvantagePct) continue;
      const verified = c.src === 'scm' && c.ts >= ts - 3 * 3600;
      scored.push({ c, keysPerUsd, advantage, bestBuyRef: best.valueRef, botBuys: book.botBuys.length, verified, buyerName: best.row.user_name, buyerTradeUrl: best.row.trade_url, buyerCount: best.row.count });
    }
    scored.sort((a, b) => b.advantage * Math.log2(1 + b.botBuys) - a.advantage * Math.log2(1 + a.botBuys));
    // Verify against the Market the top 30 that still rely on the price embedded in backpack.tf.
    let pending = 0;
    for (const r of scored.slice(0, 30)) {
      if (!r.verified) {
        pending++;
        void this.scm.priceOverview(r.c.market_name!, r.c.sku, 3 * 3600);
      }
    }
    this.pendingVerification = pending;
    const keep: string[] = [];
    const k = this.prices.keyRef();
    for (const r of scored.slice(0, 40)) {
      if (!r.verified) continue;
      const item = this.store.getItem(r.c.sku);
      const name = item?.name ?? r.c.sku;
      const usd = r.c.lowest_cents / 100;
      const costRefEquivalent = usd * baselineKeysPerUsd * keyBuyRef; // keys you would have bought with that money
      const net = r.bestBuyRef - costRefEquivalent;
      const refs = this.prices.refs(r.c.sku);
      keep.push(r.c.sku);
      this.opps.upsert({
        lane: 'scm_keys', sku: r.c.sku, listingId: '',
        title: `${name}: ${fmtUsd(usd)} on Steam Market → ${fmtKeysMetal(r.bestBuyRef, k)} on bptf (+${r.advantage.toFixed(0)} % keys/$)`,
        buyVenue: 'scm', buyPriceRef: costRefEquivalent, buyPriceUsd: usd,
        sellVenue: 'bptf', sellPriceRef: r.bestBuyRef, sellPriceUsd: (r.bestBuyRef / keyBuyRef) * keyUsdScm,
        netRef: net, netUsd: (net / keyBuyRef) * keyUsdScm, pct: r.advantage,
        confidence: Math.max(0.1, Math.min(0.85, 0.35 + Math.min(0.25, r.botBuys * 0.05) + (r.c.volume && r.c.volume > 5 ? 0.1 : 0))),
        details: {
          item: { sku: r.c.sku, name, imageUrl: item?.image_url ?? null },
          buy: { venue: 'Steam Market', priceText: fmtUsd(usd), volume: r.c.volume, marketName: r.c.market_name, verifiedAt: r.c.ts },
          sell: { venue: 'backpack.tf', priceText: fmtKeysMetal(r.bestBuyRef, k), buyer: { name: r.buyerName, tradeUrl: r.buyerTradeUrl, isBot: true, count: r.buyerCount } },
          keysPerUsd: r.keysPerUsd, baselineKeysPerUsd, keyUsdScm, botBuys: r.botBuys,
          refs: { pricedbBuyRef: refs.pricedbBuy, pricedbSellRef: refs.pricedbSell, keyRef: k },
          links: { scm: scmUrl(r.c.market_name!), classifiedsBuy: bptfClassifiedsUrl(item ?? undefined, r.c.sku, 'buy'), classifieds: bptfClassifiedsUrl(item ?? undefined, r.c.sku), pricedb: pricedbUrl(refs.skuUsed) },
          steps: [
            `Buy "${name}" on the Steam Market for ${fmtUsd(usd)} (wallet balance).`,
            'Wait 7 days: Market purchases cannot be traded until then (they can still be resold on the Market).',
            `Sell it to ${r.buyerName ?? 'bot'}'s buy order for ${fmtKeysMetal(r.bestBuyRef, k)} (or the best one available that day).`,
            `Comparison: with ${fmtUsd(usd)} you would buy ${(usd * baselineKeysPerUsd).toFixed(2)} keys directly; this route yields ≈ ${(r.bestBuyRef / keyBuyRef).toFixed(2)}.`,
          ],
        },
        ttlMin: 90,
      });
    }
    for (const row of this.opps.active('scm_keys', 500)) if (!keep.includes(row.sku)) this.opps.expire(row.id, 'outside top N');
    this.lastRunAt = ts;
    this.lastResults = keep.length;
    return keep.length;
  }
}
