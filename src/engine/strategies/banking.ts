import type { Settings } from '../../config.ts';
import type { Store } from '../../db/store.ts';
import { now } from '../../db/store.ts';
import type { OrderBook } from '../orderbook.ts';
import type { PriceContext } from '../prices.ts';
import type { Opportunities } from '../opportunities.ts';
import { bptfClassifiedsUrl, pricedbUrl } from '../links.ts';
import { fmtKeysMetal, splitRef, toRefined, toScrap } from '../../tf2/currencies.ts';

interface Candidate {
  sku: string;
  updates: number;
  sellUpdates: number;
  sellDeletes: number;
}

/**
 * Lane 2: manual banking (market making). Items with spread and turnover where you can place
 * a buy order just above the best one and a sell listing just below the best one.
 */
export class BankingStrategy {
  private store: Store;
  private book: OrderBook;
  private prices: PriceContext;
  private opps: Opportunities;
  lastRunAt: number | null = null;
  lastCandidates = 0;
  lastResults = 0;

  constructor(store: Store, book: OrderBook, prices: PriceContext, opps: Opportunities) {
    this.store = store;
    this.book = book;
    this.prices = prices;
    this.opps = opps;
  }

  run(s: Settings): number {
    const ts = now();
    const candidates = this.store.db.all<Candidate>(
      `SELECT sku, SUM(updates) updates, SUM(sell_updates) sellUpdates, SUM(sell_deletes) sellDeletes
       FROM churn WHERE hour_ts >= ? GROUP BY sku HAVING SUM(updates) >= ? ORDER BY SUM(updates) DESC LIMIT 3000`,
      ts - 86400, s.banking.minChurn24h,
    );
    this.lastCandidates = candidates.length;
    const k = this.prices.keyRef();
    const maxPrice = s.maxItemPriceKeys > 0 ? s.maxItemPriceKeys * k : Infinity;
    const step = s.banking.stepRef;
    const results: { sku: string; score: number; input: Parameters<Opportunities['upsert']>[0] }[] = [];
    for (const c of candidates) {
      const book = this.book.build(c.sku, s.snipe.botPulseMaxAgeMin);
      if (book.botBuys.length < s.banking.minBotBuyOrders || !book.bestSell || !book.bestBuy) continue;
      const refs = this.prices.refs(c.sku);
      // Achievable sell price: the best sell from an online bot (humans tend to overprice), capped by pricedb.
      const botSell = book.sells.find((l) => l.row.is_bot && l.online);
      const sellAnchor = botSell ? botSell.valueRef : refs.pricedbSell;
      if (!sellAnchor) continue;
      const bestBuy = book.bestBuy.valueRef;
      const bestSell = refs.pricedbSell ? Math.min(sellAnchor, refs.pricedbSell) : sellAnchor;
      if (bestBuy <= 0 || bestSell > maxPrice || bestSell <= bestBuy) continue;
      const spread = bestSell - bestBuy;
      const spreadPct = (spread / bestBuy) * 100;
      if (spread < s.banking.minSpreadRef || spreadPct < s.banking.minSpreadPct) continue;
      // Huge spread = dead market or stale reference: nobody will pay the sell price.
      if (spreadPct > s.banking.maxSpreadPct) continue;
      if (c.sellDeletes < s.banking.minSellDeletes24h) continue;
      // Arithmetic in scrap (integers) to avoid floating-point errors.
      const stepScrap = Math.max(1, toScrap(step));
      const buyScrap = toScrap(bestBuy) + stepScrap;
      const sellScrap = toScrap(bestSell) - stepScrap;
      const netScrap = sellScrap - buyScrap;
      if (netScrap < toScrap(s.banking.minSpreadRef)) continue;
      const myBuy = toRefined(buyScrap);
      const mySell = toRefined(sellScrap);
      const net = toRefined(netScrap);
      const activity = c.sellDeletes * 3 + c.sellUpdates + c.updates / 10;
      const score = spreadPct * Math.log2(1 + activity);
      const item = this.store.getItem(c.sku);
      const name = item?.name ?? c.sku;
      const buyKM = splitRef(myBuy, k);
      const sellKM = splitRef(mySell, k);
      const input: Parameters<Opportunities['upsert']>[0] = {
        lane: 'banking', sku: c.sku, listingId: '',
        title: `${name}: buy at ${fmtKeysMetal(myBuy, k)} / sell at ${fmtKeysMetal(mySell, k)}`,
        buyVenue: 'bptf', buyPriceRef: myBuy, buyPriceUsd: this.prices.refToUsd(myBuy),
        sellVenue: 'bptf', sellPriceRef: mySell, sellPriceUsd: this.prices.refToUsd(mySell),
        netRef: net, netUsd: this.prices.refToUsd(net), pct: (net / myBuy) * 100,
        confidence: Math.max(0.1, Math.min(0.9, 0.3 + Math.log2(1 + activity) / 10 + Math.min(0.2, book.botBuys.length * 0.03))),
        details: {
          item: { sku: c.sku, name, imageUrl: item?.image_url ?? null },
          quote: { buy: buyKM, sell: sellKM, buyRef: myBuy, sellRef: mySell, stepRef: step },
          book: {
            bestBuyRef: bestBuy, bestSellRef: bestSell, spreadRef: spread, spreadPct,
            buyOrders: book.buys.length, botBuysOnline: book.botBuys.length, sells: book.sells.length,
            bestBuyer: book.bestBuy.row.user_name, bestSeller: botSell?.row.user_name ?? 'pricedb', humanBestSellRef: book.bestSell.valueRef,
          },
          churn24h: { updates: c.updates, sellUpdates: c.sellUpdates, sellDeletes: c.sellDeletes },
          refs: { pricedbBuyRef: refs.pricedbBuy, pricedbSellRef: refs.pricedbSell, keyRef: k },
          score,
          links: {
            classifieds: bptfClassifiedsUrl(item ?? undefined, c.sku),
            classifiedsSell: bptfClassifiedsUrl(item ?? undefined, c.sku, 'sell'),
            classifiedsBuy: bptfClassifiedsUrl(item ?? undefined, c.sku, 'buy'),
            pricedb: pricedbUrl(refs.skuUsed),
          },
          steps: [
            `Create a buy order on backpack.tf for "${name}" at ${fmtKeysMetal(myBuy, k)} (just above the current best, ${fmtKeysMetal(bestBuy, k)}).`,
            `Once you buy it, list it at ${fmtKeysMetal(mySell, k)} (just below the best sell, ${fmtKeysMetal(bestSell, k)}).`,
            `Profit per cycle ≈ ${fmtKeysMetal(net, k)}. 24 h turnover: ${c.sellDeletes} sells removed, ${c.sellUpdates} sells listed.`,
          ],
        },
        ttlMin: 60,
      };
      results.push({ sku: c.sku, score, input });
    }
    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, s.banking.maxItems);
    const keep = new Set(top.map((r) => r.sku));
    for (const r of top) this.opps.upsert(r.input);
    for (const row of this.opps.active('banking', 1000)) if (!keep.has(row.sku)) this.opps.expire(row.id, 'outside top N');
    this.lastRunAt = ts;
    this.lastResults = top.length;
    return top.length;
  }
}
