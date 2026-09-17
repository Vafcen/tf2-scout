import type { Settings } from '../../config.ts';
import type { Store } from '../../db/store.ts';
import type { OrderBook } from '../orderbook.ts';
import type { PriceContext } from '../prices.ts';
import type { Opportunities } from '../opportunities.ts';
import { fmtKeysMetal } from '../../tf2/currencies.ts';
import { bptfClassifiedsUrl } from '../links.ts';

export const KEY_SKU = '5021;6';

export interface KeyBoard {
  ts: number;
  pricedbBuyRef: number | null;
  pricedbSellRef: number | null;
  bptfRef: number | null;
  bptfUsd: number | null;
  bestBuyRef: number | null; // best buy order (online bots) on bptf
  bestBuyBy: string | null;
  bestSellRef: number | null; // best sell listing on bptf
  bestSellBy: string | null;
  buyOrders: number;
  sellListings: number;
  scmUsdLow: number | null;
  scmUsdMedian: number | null;
  scmVolume: number | null;
  scmSellerNetUsd: number | null; // what you receive selling one key on SCM at the lowest price
  stnBuyRef: number | null;
  stnSellRef: number | null;
}

/** Lane 5: cross-market key board + instant key flip within bptf. */
export class KeysStrategy {
  private store: Store;
  private book: OrderBook;
  private prices: PriceContext;
  private opps: Opportunities;
  last: KeyBoard | null = null;

  constructor(store: Store, book: OrderBook, prices: PriceContext, opps: Opportunities) {
    this.store = store;
    this.book = book;
    this.prices = prices;
    this.opps = opps;
  }

  run(s: Settings): KeyBoard {
    const book = this.book.build(KEY_SKU, s.snipe.botPulseMaxAgeMin);
    const kr = this.store.latestKeyRate();
    const bestBuy = book.botBuys[0] ?? book.bestBuy;
    const bestSell = book.bestSell;
    const bestBuyRef = bestBuy ? bestBuy.row.keys * (kr?.pricedb_buy_ref ?? 0) + bestBuy.row.metal : null;
    const bestSellRef = bestSell ? bestSell.row.keys * (kr?.pricedb_sell_ref ?? 0) + bestSell.row.metal : null;
    const scmLow = kr?.scm_usd_low ?? null;
    const board: KeyBoard = {
      ts: Math.floor(Date.now() / 1000),
      pricedbBuyRef: kr?.pricedb_buy_ref ?? null,
      pricedbSellRef: kr?.pricedb_sell_ref ?? null,
      bptfRef: kr?.bptf_ref ?? null,
      bptfUsd: kr?.bptf_usd ?? null,
      bestBuyRef, bestBuyBy: bestBuy?.row.user_name ?? null,
      bestSellRef, bestSellBy: bestSell?.row.user_name ?? null,
      buyOrders: book.botBuys.length,
      sellListings: book.sells.length,
      scmUsdLow: scmLow,
      scmUsdMedian: kr?.scm_usd_median ?? null,
      scmVolume: kr?.scm_volume ?? null,
      scmSellerNetUsd: scmLow ? Math.floor((scmLow * 100) / 1.15) / 100 : null,
      stnBuyRef: kr?.stn_buy_ref ?? null,
      stnSellRef: kr?.stn_sell_ref ?? null,
    };
    if (bestBuyRef !== null || bestSellRef !== null) this.store.insertKeyRate({ bptfBestBuyRef: bestBuyRef, bptfBestSellRef: bestSellRef });
    this.last = board;

    // Instant key flip: someone is selling keys for less metal than the bots pay.
    if (bestBuy && bestSell && bestBuyRef !== null && bestSellRef !== null && bestBuy.row.steamid !== bestSell.row.steamid) {
      const net = bestBuyRef - bestSellRef;
      if (net >= 0.11 && bestSell.row.metal > 0 && bestSell.row.keys === 0) {
        const item = this.store.getItem(KEY_SKU);
        this.opps.upsert({
          lane: 'keys', sku: KEY_SKU, listingId: bestSell.row.id,
          title: `Key: buy at ${bestSellRef.toFixed(2)} ref → sell at ${bestBuyRef.toFixed(2)} ref (+${net.toFixed(2)} ref/key)`,
          buyVenue: 'bptf', buyPriceRef: bestSellRef, buyPriceUsd: this.prices.refToUsd(bestSellRef),
          sellVenue: 'bptf', sellPriceRef: bestBuyRef, sellPriceUsd: this.prices.refToUsd(bestBuyRef),
          netRef: net, netUsd: this.prices.refToUsd(net), pct: (net / bestSellRef) * 100,
          confidence: bestBuy.row.is_bot ? 0.8 : 0.5,
          details: {
            item: { sku: KEY_SKU, name: 'Mann Co. Supply Crate Key', imageUrl: item?.image_url ?? null },
            buy: { listingId: bestSell.row.id, priceText: `${bestSellRef.toFixed(2)} ref`, seller: { name: bestSell.row.user_name, steamid: bestSell.row.steamid, tradeUrl: bestSell.row.trade_url, isBot: !!bestSell.row.is_bot }, count: bestSell.row.count },
            sell: { listingId: bestBuy.row.id, priceText: `${bestBuyRef.toFixed(2)} ref`, buyer: { name: bestBuy.row.user_name, steamid: bestBuy.row.steamid, tradeUrl: bestBuy.row.trade_url, isBot: !!bestBuy.row.is_bot }, count: bestBuy.row.count },
            board,
            links: { classifieds: bptfClassifiedsUrl(item ?? undefined, KEY_SKU) },
            steps: [
              `Buy keys from ${bestSell.row.user_name ?? 'the seller'} for ${fmtKeysMetal(bestSellRef, 1e9)} each (stock ${bestSell.row.count}).`,
              `Sell them to ${bestBuy.row.user_name ?? 'the buyer'} for ${bestBuyRef.toFixed(2)} ref each (accepts up to ${bestBuy.row.count}).`,
            ],
          },
          ttlMin: 20,
        });
        this.opps.expireOthers('keys', KEY_SKU, [bestSell.row.id], 'no longer profitable');
      } else {
        this.opps.expireOthers('keys', KEY_SKU, [], 'no longer profitable');
      }
    }
    return board;
  }
}
