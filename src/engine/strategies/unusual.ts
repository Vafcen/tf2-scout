import type { Settings } from '../../config.ts';
import type { Store } from '../../db/store.ts';
import { now } from '../../db/store.ts';
import type { OrderBook } from '../orderbook.ts';
import type { PriceContext } from '../prices.ts';
import type { Opportunities } from '../opportunities.ts';
import { fmtKeysMetal, fmtUsd } from '../../tf2/currencies.ts';
import { bptfClassifiedsUrl, bptfProfileUrl, bptfStatsUrl, pricedbUrl, steamProfileUrl } from '../links.ts';
import { isUnusualSku } from '../../tf2/sku.ts';
import { median } from '../keyRate.ts';

/**
 * Lane 6: unusual deals. An unusual sell listing well below several references
 * (pricedb, backpack.tf suggested, best buy orders). Requires capital and judgment: a confidence score
 * is shown based on how many references agree and how old they are.
 */
export class UnusualStrategy {
  private store: Store;
  private book: OrderBook;
  private prices: PriceContext;
  private opps: Opportunities;

  constructor(store: Store, book: OrderBook, prices: PriceContext, opps: Opportunities) {
    this.store = store;
    this.book = book;
    this.prices = prices;
    this.opps = opps;
  }

  enabled(s: Settings): boolean {
    if (s.unusual.enabled === 'on') return true;
    if (s.unusual.enabled === 'off') return false;
    return s.capitalKeys >= 20;
  }

  evaluate(sku: string, s: Settings): void {
    if (!isUnusualSku(sku) || !this.enabled(s)) return;
    const book = this.book.build(sku, s.snipe.botPulseMaxAgeMin);
    if (!book.sells.length) {
      this.opps.expireOthers('unusual', sku, [], 'no sell listings');
      return;
    }
    const ts = now();
    const k = this.prices.keyRef();
    const refs = this.prices.refs(sku);
    const references: { name: string; valueRef: number; ageDays: number | null }[] = [];
    if (refs.pricedbSell && refs.pricedbSell > 0) references.push({ name: 'pricedb', valueRef: refs.pricedbSell, ageDays: refs.pricedbTs ? (ts - refs.pricedbTs) / 86400 : null });
    if (refs.bptfSuggested && refs.bptfSuggested > 0) references.push({ name: 'bptf suggested', valueRef: refs.bptfSuggested, ageDays: refs.bptfTs ? (ts - refs.bptfTs) / 86400 : null });
    // bot buy orders (non-conditional): the best one, with a 10 % margin as the implied market price
    const buys = book.buys.filter((b) => b.online && b.row.is_bot && !b.outlier);
    if (buys.length) references.push({ name: `best buy order (${buys[0].row.user_name ?? 'bot'})`, valueRef: buys[0].valueRef * 1.1, ageDays: 0 });
    // Very old references (> 1 year) carry little weight: drop them if there are others.
    const fresh = references.filter((r) => r.ageDays === null || r.ageDays < 365);
    const used = fresh.length >= s.unusual.minRefs ? fresh : references;
    if (used.length < s.unusual.minRefs) {
      this.opps.expireOthers('unusual', sku, [], 'no references');
      return;
    }
    const refValue = median(used.map((r) => r.valueRef));
    const minRef = Math.min(...used.map((r) => r.valueRef));
    const spreadPct = (Math.max(...used.map((r) => r.valueRef)) / Math.min(...used.map((r) => r.valueRef)) - 1) * 100;
    const maxCost = s.capitalKeys > 0 ? s.capitalKeys * k : Infinity;
    const item = this.store.getItem(sku);
    const keep: string[] = [];
    for (const sell of book.sells) {
      const cost = sell.valueRef;
      if (cost <= 0 || cost > maxCost) continue;
      const discount = ((refValue - cost) / refValue) * 100;
      if (discount < s.unusual.minDiscountPct) continue;
      // Conservative exit: the buy order if it's already profitable; otherwise 92 % of the LOWEST reference.
      const exitRef = buys[0] && buys[0].valueRef > cost ? buys[0].valueRef : minRef * 0.92;
      const net = exitRef - cost;
      if (net < cost * 0.05) continue;
      // Only the cheapest unit per SKU; the other sellers as alternatives.
      const alternatives = book.sells
        .filter((o) => o.row.id !== sell.row.id && o.row.steamid !== sell.row.steamid && o.valueRef <= refValue * (1 - s.unusual.minDiscountPct / 100))
        .slice(0, 5)
        .map((o) => ({ listingId: o.row.id, seller: o.row.user_name, isBot: !!o.row.is_bot, priceText: fmtKeysMetal(o.valueRef, k), tradeUrl: o.row.trade_url }));
      let confidence = 0.3 + Math.min(0.25, used.length * 0.08) - Math.min(0.2, spreadPct / 200);
      const oldest = Math.max(...used.map((r) => r.ageDays ?? 0));
      if (oldest > 180) confidence -= 0.1;
      if (buys.length >= 2) confidence += 0.1;
      if (sell.row.is_bot) confidence += 0.05;
      if (!sell.row.premium && !sell.row.is_bot) confidence -= 0.05;
      confidence = Math.max(0.05, Math.min(0.9, confidence));
      keep.push(sell.row.id);
      const name = item?.name ?? sku;
      const flags = sell.row.flags ? (JSON.parse(sell.row.flags) as Record<string, unknown>) : null;
      this.opps.upsert({
        lane: 'unusual', sku, listingId: sell.row.id,
        title: `${name}: ${discount.toFixed(0)} % below reference (${fmtKeysMetal(cost, k)} vs ${fmtKeysMetal(refValue, k)})`,
        buyVenue: 'bptf', buyPriceRef: cost, buyPriceUsd: this.prices.refToUsd(cost),
        sellVenue: 'bptf', sellPriceRef: exitRef, sellPriceUsd: this.prices.refToUsd(exitRef),
        netRef: net, netUsd: this.prices.refToUsd(net), pct: (net / cost) * 100, confidence,
        details: {
          item: { sku, name, imageUrl: item?.image_url ?? null, effect: flags?.effect ?? null },
          buy: {
            venue: 'backpack.tf', listingId: sell.row.id, keys: sell.row.keys, metal: sell.row.metal, priceText: fmtKeysMetal(cost, k),
            seller: { steamid: sell.row.steamid, name: sell.row.user_name, isBot: !!sell.row.is_bot, premium: !!sell.row.premium, online: sell.online, tradeUrl: sell.row.trade_url },
            details: sell.row.details, flags,
          },
          sell: { venue: 'backpack.tf', priceText: fmtKeysMetal(exitRef, k), note: buys[0] && buys[0].valueRef > cost ? `${buys[0].row.user_name ?? 'bot'}'s buy order` : 'own listing at 92 % of the lowest reference', buyer: buys[0] ? { name: buys[0].row.user_name, tradeUrl: buys[0].row.trade_url, isBot: true, count: buys[0].row.count } : undefined },
          alternatives,
          references: used.map((r) => ({ name: r.name, valueText: fmtKeysMetal(r.valueRef, k), ageDays: r.ageDays === null ? null : Math.round(r.ageDays) })),
          referenceRef: refValue, referenceSpreadPct: spreadPct, discountPct: discount,
          book: { buyOrders: book.buys.length, botBuysOnline: buys.length, sells: book.sells.length, bestBuyRef: buys[0]?.valueRef ?? null, bestSellRef: book.bestSell?.valueRef ?? null },
          refs: { pricedbBuyRef: refs.pricedbBuy, pricedbSellRef: refs.pricedbSell, bptfSuggestedRef: refs.bptfSuggested, keyRef: k, keyUsd: this.prices.keyUsd() },
          links: {
            classifieds: bptfClassifiedsUrl(item ?? undefined, sku, 'sell'), classifiedsBuy: bptfClassifiedsUrl(item ?? undefined, sku, 'buy'), stats: bptfStatsUrl(item ?? undefined, sku),
            sellerBptf: bptfProfileUrl(sell.row.steamid), sellerSteam: steamProfileUrl(sell.row.steamid), sellerTradeOffer: sell.row.trade_url, pricedb: pricedbUrl(refs.skuUsed),
          },
          steps: [
            `First check the effect/hat history on pricedb and in the backpack.tf stats (${used.length} references, spread ${spreadPct.toFixed(0)} %).`,
            `Buy "${name}" for ${fmtKeysMetal(cost, k)} (${fmtUsd(this.prices.refToUsd(cost))}).`,
            buys[0] && buys[0].valueRef > cost ? `Immediate exit: ${buys[0].row.user_name ?? 'bot'}'s buy order at ${fmtKeysMetal(buys[0].valueRef, k)}.` : `List it at ≈ ${fmtKeysMetal(exitRef, k)} and wait for a buyer (unusuals take days or weeks).`,
          ],
        },
        ttlMin: 180,
      });
      break;
    }
    this.opps.expireOthers('unusual', sku, keep, 'no longer profitable');
  }
}
