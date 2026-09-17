import type { Settings } from '../../config.ts';
import type { Store, ListingRow } from '../../db/store.ts';
import { now } from '../../db/store.ts';
import type { OrderBook } from '../orderbook.ts';
import type { PriceContext } from '../prices.ts';
import type { Opportunities } from '../opportunities.ts';
import { fmtKeysMetal, fmtUsd } from '../../tf2/currencies.ts';
import { bptfClassifiedsUrl, pricedbUrl } from '../links.ts';

/**
 * Lane 4: cash → keys. marketplace.tf listings (they arrive via the backpack.tf feed in USD) whose cash price
 * is lower than what bots pay in keys (valued at the key's cash price). Selling keys→cash requires
 * mannco/marketplace data with no usable public API: it's left as a manual link on each item.
 */
export class CashStrategy {
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
    const keyUsd = this.prices.keyUsd();
    const keyBuyRef = this.prices.keyBuyRef();
    const k = this.prices.keyRef();
    const rows = this.store.db.all<ListingRow>("SELECT * FROM listings WHERE active = 1 AND intent = 'sell' AND usd IS NOT NULL AND usd > 0 AND seen_at >= ?", ts - 2 * 86400);
    this.lastCandidates = rows.length;
    const keep: string[] = [];
    for (const r of rows) {
      const book = this.book.build(r.sku, s.snipe.botPulseMaxAgeMin);
      if (book.botBuys.length < 2) continue;
      const best = book.botBuys[0];
      const keysReceived = best.valueRef / keyBuyRef;
      const cashValue = keysReceived * keyUsd; // what those keys are worth sold for cash
      const advantage = (cashValue / r.usd! - 1) * 100;
      if (advantage < s.cash.minAdvantagePct) continue;
      const item = this.store.getItem(r.sku);
      const name = item?.name ?? r.sku;
      keep.push(r.id);
      this.opps.upsert({
        lane: 'cash', sku: r.sku, listingId: r.id,
        title: `${name}: ${fmtUsd(r.usd!)} on marketplace.tf → ${fmtKeysMetal(best.valueRef, k)} on bptf (+${advantage.toFixed(0)} %)`,
        buyVenue: 'marketplace.tf', buyPriceRef: (r.usd! / keyUsd) * keyBuyRef, buyPriceUsd: r.usd!,
        sellVenue: 'bptf', sellPriceRef: best.valueRef, sellPriceUsd: cashValue,
        netRef: best.valueRef - (r.usd! / keyUsd) * keyBuyRef, netUsd: cashValue - r.usd!, pct: advantage,
        confidence: Math.max(0.1, Math.min(0.8, 0.3 + Math.min(0.25, book.botBuys.length * 0.05))),
        details: {
          item: { sku: r.sku, name, imageUrl: item?.image_url ?? null },
          buy: { venue: 'marketplace.tf', priceText: fmtUsd(r.usd!), seller: { name: r.user_name, steamid: r.steamid }, details: r.details },
          sell: { venue: 'backpack.tf', priceText: fmtKeysMetal(best.valueRef, k), buyer: { name: best.row.user_name, tradeUrl: best.row.trade_url, isBot: true, count: best.row.count } },
          keyUsd, botBuys: book.botBuys.length,
          links: { classifieds: bptfClassifiedsUrl(item ?? undefined, r.sku), pricedb: pricedbUrl(r.sku), marketplace: 'https://marketplace.tf/items/tf2/' + encodeURIComponent(item?.market_name ?? name) },
          steps: [
            `Buy "${name}" on marketplace.tf for ${fmtUsd(r.usd!)} (real money; no trade hold).`,
            `Sell it to ${best.row.user_name ?? 'bot'}'s buy order for ${fmtKeysMetal(best.valueRef, k)}.`,
            `Those keys are worth ≈ ${fmtUsd(cashValue)} in cash (at ${fmtUsd(keyUsd)}/key), versus the ${fmtUsd(r.usd!)} paid.`,
          ],
        },
        ttlMin: 120,
      });
    }
    for (const row of this.opps.active('cash', 500)) if (!keep.includes(row.listing_id)) this.opps.expire(row.id, 'no longer profitable');
    this.lastRunAt = ts;
    this.lastResults = keep.length;
    return keep.length;
  }
}
