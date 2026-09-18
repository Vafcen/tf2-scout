import type { Store } from '../db/store.ts';
import { now } from '../db/store.ts';
import type { Opportunities, OppRow } from './opportunities.ts';
import type { OrderBook } from './orderbook.ts';
import type { BptfSnapshotSource } from '../sources/bptfSnapshot.ts';
import type { SettingsManager } from './settings.ts';
import { bus } from '../bus.ts';
import { logger } from '../log.ts';

const log = logger('checks');
export const CHECK_OFFSETS = [60, 300, 900];

export interface CheckRow {
  id: number;
  opp_id: number;
  offset_sec: number;
  checked_at: number;
  sell_alive: number;
  buy_alive: number;
  best_buy_ref: number | null;
  net_then: number | null;
  verdict: string;
  verified: number;
}

/**
 * Post-alert checks: 60 s, 5 min and 15 min after an opportunity is alerted we look again at both legs
 * (after a fresh classifieds snapshot when a token is configured) and record whether it was still takeable.
 * This is what turns "alerts" into a measured capture rate per lane, buyer family and price bucket.
 */
export class PostAlertChecks {
  private store: Store;
  private opps: Opportunities;
  private book: OrderBook;
  private snapshot: BptfSnapshotSource;
  private settings: SettingsManager;
  private timers = new Map<string, NodeJS.Timeout>();
  private waiting = new Map<string, { resolve: () => void; timer: NodeJS.Timeout }>();
  scheduled = 0;
  done = 0;

  constructor(store: Store, opps: Opportunities, book: OrderBook, snapshot: BptfSnapshotSource, settings: SettingsManager) {
    this.store = store;
    this.opps = opps;
    this.book = book;
    this.snapshot = snapshot;
    this.settings = settings;
    bus.onTyped('snapshot:applied', ({ sku }) => {
      const w = this.waiting.get(sku);
      if (w) {
        clearTimeout(w.timer);
        this.waiting.delete(sku);
        w.resolve();
      }
    });
  }

  /** Schedule the three checks for an opportunity that was just alerted (or created, when no alerts are configured). */
  schedule(opp: OppRow): void {
    if (!['snipe', 'deal', 'unusual', 'keys'].includes(opp.lane)) return;
    for (const offset of CHECK_OFFSETS) {
      const key = `${opp.id}:${offset}`;
      if (this.timers.has(key)) continue;
      const t = setTimeout(() => {
        this.timers.delete(key);
        void this.runCheck(opp.id, offset);
      }, offset * 1000);
      this.timers.set(key, t);
      this.scheduled++;
    }
  }

  /** Ask for a fresh snapshot of the SKU and wait for it (max `maxWaitMs`). Returns true if one was applied. */
  async freshSnapshot(sku: string, maxWaitMs = 15_000): Promise<boolean> {
    if (!this.snapshot.enabled) return false;
    if (this.snapshot.ageOf(sku) <= 20) return true;
    const requested = this.snapshot.request(sku, 0, 20);
    if (!requested && this.snapshot.ageOf(sku) > 20 && !this.waiting.has(sku)) return false;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(sku);
        resolve(false);
      }, maxWaitMs);
      this.waiting.set(sku, { resolve: () => resolve(true), timer });
    });
  }

  async runCheck(oppId: number, offset: number): Promise<void> {
    const opp = this.opps.get(oppId);
    if (!opp) return;
    const verified = await this.freshSnapshot(opp.sku);
    const s = this.settings.get();
    const book = this.book.build(opp.sku, s.snipe.botPulseMaxAgeMin);
    const d = opp.details ? (JSON.parse(opp.details) as Record<string, any>) : {};
    const sellId = opp.listing_id;
    const buyId: string | undefined = d.sell?.listingId;
    const sell = sellId ? book.sells.find((l) => l.row.id === sellId) : undefined;
    const buyer = buyId ? book.buys.find((l) => l.row.id === buyId) : undefined;
    const sellAlive = !!sell;
    const buyAlive = buyId ? !!buyer : true;
    const bestExit = sellId && sell ? this.book.bestBuyExcluding(book, sell.row.steamid) : book.bestBuy;
    const bestBuyRef = bestExit?.valueRef ?? null;
    const netThen = sell && bestBuyRef !== null ? bestBuyRef - sell.valueRef : null;
    let verdict: string;
    if (!sellAlive) verdict = 'sell_gone';
    else if (buyId && !buyAlive) verdict = 'buyer_gone';
    else if (buyId && buyer && opp.sell_price_ref !== null && buyer.valueRef < opp.sell_price_ref - 0.05) verdict = 'buyer_repriced';
    else if (netThen !== null && netThen + 1e-6 < s.snipe.minNetRef && opp.lane === 'snipe') verdict = 'unprofitable';
    else verdict = 'alive';
    this.store.db.run(
      `INSERT INTO opp_checks (opp_id, offset_sec, checked_at, sell_alive, buy_alive, best_buy_ref, net_then, verdict, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      oppId, offset, now(), sellAlive ? 1 : 0, buyAlive ? 1 : 0, bestBuyRef, netThen, verdict, verified ? 1 : 0,
    );
    this.done++;
    log.debug(`check #${oppId} +${offset}s → ${verdict}${verified ? ' (snapshot)' : ''}`);
  }

  stop(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const w of this.waiting.values()) clearTimeout(w.timer);
    this.waiting.clear();
  }
}
