import type { Settings } from '../../config.ts';
import type { Store, ListingRow } from '../../db/store.ts';
import type { OrderBook, Book, PricedListing } from '../orderbook.ts';
import type { PriceContext } from '../prices.ts';
import type { Opportunities, OppInput } from '../opportunities.ts';
import { bptfClassifiedsUrl, bptfProfileUrl, pricedbUrl, scmUrl, steamProfileUrl, tradeOfferForItemUrl } from '../links.ts';
import { familyLabel, isAutoAccept } from '../families.ts';
import { fmtKeysMetal, pureBreakdown } from '../../tf2/currencies.ts';
import { normalizeText } from '../../tf2/text.ts';

/**
 * Lane 1: snipe (bptf → bptf).
 *  - instant flip: a sell listing below the best buy order (online bot / online premium human).
 *  - deal: sell listing ≥ dealMinPct below the pricedb sell price with buy-order liquidity.
 */
export class SnipeStrategy {
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

  /** Re-evaluates a whole SKU. Returns the listing ids that are still opportunities. */
  evaluate(sku: string, s: Settings): string[] {
    const book = this.book.build(sku, s.snipe.botPulseMaxAgeMin);
    const keep: string[] = [];
    if (!book.sells.length) {
      this.opps.expireOthers('snipe', sku, [], 'no sell listings');
      this.opps.expireOthers('deal', sku, [], 'no sell listings');
      return keep;
    }
    const item = this.store.getItem(sku);
    const refs = this.prices.refs(sku);
    const k = this.prices.keyRef();
    const maxPrice = s.maxItemPriceKeys > 0 ? s.maxItemPriceKeys * k : Infinity;
    const keepSnipe: string[] = [];
    const keepDeal: string[] = [];
    const sellersDone = new Set<string>(); // one opportunity per seller and SKU (bots list each unit separately)
    let snipeEmitted = false; // only the cheapest sell generates a snipe; the other sellers go in as alternatives
    let dealEmitted = false;
    for (const sell of book.sells) {
      const cost = sell.valueRef;
      if (cost <= 0 || cost > maxPrice) continue;
      if (sellersDone.has(sell.row.steamid)) continue;
      const suspicious = this.suspiciousDetails(sell.row, s);
      const buyer = this.book.bestBuyExcluding(book, sell.row.steamid);
      // --- instant flip ---
      if (buyer) {
        const net = buyer.valueRef - cost;
        const pct = (net / cost) * 100;
        if (net + 1e-6 >= s.snipe.minNetRef && pct + 1e-6 >= s.snipe.minPct) {
          sellersDone.add(sell.row.steamid);
          if (snipeEmitted) continue;
          snipeEmitted = true;
          keepSnipe.push(sell.row.id);
          const alternatives = book.sells
            .filter((o) => o.row.id !== sell.row.id && o.row.steamid !== sell.row.steamid && o.valueRef <= buyer.valueRef - s.snipe.minNetRef)
            .slice(0, 5)
            .map((o) => ({ listingId: o.row.id, seller: o.row.user_name, isBot: !!o.row.is_bot, priceText: fmtKeysMetal(o.valueRef, this.prices.keyRef()), tradeUrl: o.row.trade_url }));
          const input = this.buildSnipe(sku, item, sell, buyer, net, pct, suspicious, book, refs, s);
          (input.details as Record<string, unknown>).alternatives = alternatives;
          this.opps.upsert(input);
          continue;
        }
      }
      // --- deal vs pricedb ---
      const ref = refs.pricedbSell ?? refs.bptfSuggested;
      if (ref && ref > 0) {
        const discount = ((ref - cost) / ref) * 100;
        const liquidBuys = refs.pricedbBuy
          ? book.botBuys.filter((b) => b.valueRef >= refs.pricedbBuy! * 0.95).length
          : book.botBuys.length;
        if (discount >= s.snipe.dealMinPct && liquidBuys >= s.snipe.dealMinBuyOrders) {
          const exitRef = refs.pricedbBuy && refs.pricedbBuy > cost ? refs.pricedbBuy : ref * 0.95;
          const net = exitRef - cost;
          if (net + 1e-6 >= s.snipe.minNetRef) {
            sellersDone.add(sell.row.steamid);
            if (dealEmitted) continue;
            dealEmitted = true;
            keepDeal.push(sell.row.id);
            const alternatives = book.sells
              .filter((o) => o.row.id !== sell.row.id && o.row.steamid !== sell.row.steamid && ((ref - o.valueRef) / ref) * 100 >= s.snipe.dealMinPct)
              .slice(0, 5)
              .map((o) => ({ listingId: o.row.id, seller: o.row.user_name, isBot: !!o.row.is_bot, priceText: fmtKeysMetal(o.valueRef, this.prices.keyRef()), tradeUrl: o.row.trade_url }));
            const input = this.buildDeal(sku, item, sell, discount, net, exitRef, liquidBuys, suspicious, book, refs, s);
            (input.details as Record<string, unknown>).alternatives = alternatives;
            this.opps.upsert(input);
          }
        }
      }
    }
    this.opps.expireOthers('snipe', sku, keepSnipe, 'no longer profitable');
    this.opps.expireOthers('deal', sku, keepDeal, 'no longer profitable');
    return [...keepSnipe, ...keepDeal];
  }

  private suspiciousDetails(row: ListingRow, s: Settings): string | null {
    const d = normalizeText(row.details ?? '').toLowerCase();
    for (const kw of s.snipe.ignoreDetailsKeywords) if (kw && d.includes(kw.toLowerCase())) return kw;
    return null;
  }

  private commonDetails(sku: string, item: ReturnType<Store['getItem']>, sell: PricedListing, book: Book, refs: ReturnType<PriceContext['refs']>) {
    const flags = sell.row.flags ? (JSON.parse(sell.row.flags) as Record<string, unknown>) : null;
    const scm = this.prices.scmLowestCents(sku);
    return {
      item: { sku, name: item?.name ?? sku, imageUrl: item?.image_url ?? null },
      buy: {
        venue: 'backpack.tf',
        listingId: sell.row.id,
        keys: sell.row.keys,
        metal: sell.row.metal,
        priceText: fmtKeysMetal(sell.valueRef, this.prices.keyRef()),
        seller: {
          steamid: sell.row.steamid, name: sell.row.user_name, isBot: !!sell.row.is_bot, uaClient: sell.row.ua_client, family: familyLabel(sell.family),
          premium: !!sell.row.premium, online: sell.online, tradeUrl: sell.row.trade_url, listedAt: sell.row.listed_at, bumpedAt: sell.row.bumped_at,
          tradeOffersPreferred: sell.row.trade_offers_preferred === null ? null : !!sell.row.trade_offers_preferred,
        },
        assetId: sell.row.asset_id,
        units: sell.row.stock_units,
        pure: pureBreakdown(sell.valueRef, this.prices.keyRef()),
        details: sell.row.details,
        flags,
      },
      refs: {
        pricedbBuyRef: refs.pricedbBuy, pricedbSellRef: refs.pricedbSell, bptfSuggestedRef: refs.bptfSuggested,
        scmCents: scm?.cents ?? null, keyRef: this.prices.keyRef(), keyUsd: this.prices.keyUsd(),
      },
      book: { buyOrders: book.buys.length, botBuysOnline: book.botBuys.length, sells: book.sells.length, bestBuyRef: book.bestBuy?.valueRef ?? null, bestSellRef: book.bestSell?.valueRef ?? null },
      links: {
        classifieds: bptfClassifiedsUrl(item ?? undefined, sku, 'sell'),
        classifiedsBuy: bptfClassifiedsUrl(item ?? undefined, sku, 'buy'),
        sellerBptf: bptfProfileUrl(sell.row.steamid),
        sellerSteam: steamProfileUrl(sell.row.steamid),
        sellerTradeOffer: sell.row.trade_url,
        sellerTradeOfferForItem: tradeOfferForItemUrl(sell.row.trade_url, sell.row.asset_id),
        pricedb: pricedbUrl(refs.skuUsed),
        scm: item?.market_name ? scmUrl(item.market_name) : null,
      },
    };
  }

  private buildSnipe(sku: string, item: ReturnType<Store['getItem']>, sell: PricedListing, buyer: PricedListing, net: number, pct: number,
    suspicious: string | null, book: Book, refs: ReturnType<PriceContext['refs']>, s: Settings): OppInput {
    // Confidence is mostly about the EXIT: auto-accept bots take a matching offer in seconds,
    // human-managed listings may sit for hours, humans may ignore it or haggle.
    const autoAccept = isAutoAccept(buyer.family);
    let confidence = autoAccept ? 0.85 : buyer.row.is_bot ? 0.5 : 0.45;
    if (buyer.family === 'other-bot') confidence -= 0.1;
    if (buyer.room !== null && buyer.room >= 1) confidence += 0.05; // stock room confirmed in the listing text
    if (!sell.row.premium && !sell.row.is_bot) confidence -= 0.1;
    if (sell.row.trade_offers_preferred === 0) confidence -= 0.15; // seller wants a friend add / chat first
    if (suspicious) confidence = Math.min(confidence, 0.35);
    if (sell.online) confidence += 0.05;
    if (book.botBuys.length >= 3) confidence += 0.05;
    if (!autoAccept) confidence = Math.min(confidence, 0.5);
    confidence = Math.max(0.05, Math.min(0.99, confidence));
    const k = this.prices.keyRef();
    const payPure = pureBreakdown(sell.valueRef, k);
    const askPure = pureBreakdown(buyer.valueRef, k);
    const name = item?.name ?? sku;
    const netUsd = this.prices.refToUsd(net);
    const details = {
      ...this.commonDetails(sku, item, sell, book, refs),
      sell: {
        venue: 'backpack.tf',
        listingId: buyer.row.id,
        keys: buyer.row.keys,
        metal: buyer.row.metal,
        priceText: fmtKeysMetal(buyer.valueRef, this.prices.keyRef()),
        buyer: {
          steamid: buyer.row.steamid, name: buyer.row.user_name, isBot: !!buyer.row.is_bot, uaClient: buyer.row.ua_client, family: familyLabel(buyer.family), autoAccept,
          premium: !!buyer.row.premium, online: buyer.online, tradeUrl: buyer.row.trade_url, count: buyer.row.count, room: buyer.room, details: buyer.row.details,
        },
        pure: askPure,
      },
      suspicious,
      verified: false,
      steps: [
        `Leg 1 — buy: open the seller's offer link (their "${name}" is preloaded) and add ${payPure.text} from your inventory. Send.`,
        `Leg 2 — sell: once it is yours, open ${buyer.row.user_name ?? 'the buyer'}'s offer link, add "${name}" from your side and take ${askPure.text} from theirs${autoAccept ? ' (bot: accepts within seconds while it has room' + (buyer.room !== null ? `, room ${buyer.room}` : '') + ')' : ' (human-managed: may take hours)'}.`,
        sell.row.trade_offers_preferred === 0 ? 'The seller prefers friend requests / chat over offers: expect delays.' : 'Check the classifieds link first if the alert is older than a couple of minutes.',
      ],
    };
    return {
      lane: 'snipe', sku, listingId: sell.row.id,
      title: `${name}: buy ${fmtKeysMetal(sell.valueRef, this.prices.keyRef())} → sell ${fmtKeysMetal(buyer.valueRef, this.prices.keyRef())}`,
      buyVenue: 'bptf', buyPriceRef: sell.valueRef, buyPriceUsd: this.prices.refToUsd(sell.valueRef),
      sellVenue: 'bptf', sellPriceRef: buyer.valueRef, sellPriceUsd: this.prices.refToUsd(buyer.valueRef),
      netRef: net, netUsd, pct, confidence, details, ttlMin: s.alerts.oppTtlMin,
    };
  }

  private buildDeal(sku: string, item: ReturnType<Store['getItem']>, sell: PricedListing, discount: number, net: number, exitRef: number,
    liquidBuys: number, suspicious: string | null, book: Book, refs: ReturnType<PriceContext['refs']>, s: Settings): OppInput {
    let confidence = 0.4 + Math.min(0.3, liquidBuys * 0.05);
    if (suspicious) confidence = Math.min(confidence, 0.3);
    if (refs.pricedbTs && refs.pricedbTs < Math.floor(Date.now() / 1000) - 14 * 86400) confidence -= 0.15; // stale reference price
    confidence = Math.max(0.05, Math.min(0.95, confidence));
    const name = item?.name ?? sku;
    const details = {
      ...this.commonDetails(sku, item, sell, book, refs),
      sell: { venue: 'backpack.tf', priceText: fmtKeysMetal(exitRef, this.prices.keyRef()), note: 'sell to bot buy orders / your own listing' },
      discountPct: discount,
      liquidBuyOrders: liquidBuys,
      suspicious,
      steps: [
        `Buy "${name}" for ${fmtKeysMetal(sell.valueRef, this.prices.keyRef())} (≈ ${discount.toFixed(0)} % below pricedb).`,
        `Expected exit: ${fmtKeysMetal(exitRef, this.prices.keyRef())} (bot buy orders or your own sell listing).`,
        'Check the price history before buying: if the item is falling, the discount may be real and not a bargain.',
      ],
    };
    return {
      lane: 'deal', sku, listingId: sell.row.id,
      title: `${name}: ${discount.toFixed(0)} % below pricedb (${fmtKeysMetal(sell.valueRef, this.prices.keyRef())})`,
      buyVenue: 'bptf', buyPriceRef: sell.valueRef, buyPriceUsd: this.prices.refToUsd(sell.valueRef),
      sellVenue: 'bptf', sellPriceRef: exitRef, sellPriceUsd: this.prices.refToUsd(exitRef),
      netRef: net, netUsd: this.prices.refToUsd(net), pct: (net / sell.valueRef) * 100, confidence, details, ttlMin: s.alerts.oppTtlMin * 2,
    };
  }
}
