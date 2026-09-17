import type { Store } from '../db/store.ts';
import { now } from '../db/store.ts';

export interface TradeRow {
  id: number;
  ts: number;
  sku: string;
  name: string | null;
  side: 'buy' | 'sell';
  venue: string | null;
  qty: number;
  price_ref: number | null;
  price_usd: number | null;
  fees_usd: number;
  opportunity_id: number | null;
  note: string | null;
}

export interface PnlSummary {
  realizedRef: number;
  realizedUsd: number;
  buys: number;
  sells: number;
  openPositions: { sku: string; name: string | null; qty: number; costRef: number }[];
}

export class Ledger {
  private store: Store;
  constructor(store: Store) {
    this.store = store;
  }

  add(t: Omit<TradeRow, 'id'>): number {
    const r = this.store.db.run(
      `INSERT INTO trades (ts, sku, name, side, venue, qty, price_ref, price_usd, fees_usd, opportunity_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      t.ts, t.sku, t.name, t.side, t.venue, t.qty, t.price_ref, t.price_usd, t.fees_usd, t.opportunity_id, t.note,
    );
    return Number(r.lastInsertRowid);
  }

  remove(id: number): void {
    this.store.db.run('DELETE FROM trades WHERE id = ?', id);
  }

  list(limit = 200): TradeRow[] {
    return this.store.db.all<TradeRow>('SELECT * FROM trades ORDER BY ts DESC, id DESC LIMIT ?', limit);
  }

  /** Realized P&L using FIFO per SKU (in ref and USD, based on the logged prices). */
  summary(): PnlSummary {
    const rows = this.store.db.all<TradeRow>('SELECT * FROM trades ORDER BY ts ASC, id ASC');
    const lots = new Map<string, { qty: number; costRef: number; costUsd: number }[]>();
    const names = new Map<string, string | null>();
    let realizedRef = 0;
    let realizedUsd = 0;
    let buys = 0;
    let sells = 0;
    for (const t of rows) {
      names.set(t.sku, t.name);
      const q = lots.get(t.sku) ?? [];
      lots.set(t.sku, q);
      const unitRef = t.price_ref ?? 0;
      const unitUsd = (t.price_usd ?? 0) + (t.fees_usd ?? 0) / Math.max(1, t.qty) * (t.side === 'buy' ? 1 : -1);
      if (t.side === 'buy') {
        buys += t.qty;
        q.push({ qty: t.qty, costRef: unitRef, costUsd: unitUsd });
      } else {
        sells += t.qty;
        let remaining = t.qty;
        while (remaining > 0) {
          const lot = q[0];
          if (!lot) {
            // sell with no logged buy: counted as gross profit
            realizedRef += remaining * unitRef;
            realizedUsd += remaining * unitUsd;
            break;
          }
          const take = Math.min(lot.qty, remaining);
          realizedRef += take * (unitRef - lot.costRef);
          realizedUsd += take * (unitUsd - lot.costUsd);
          lot.qty -= take;
          remaining -= take;
          if (lot.qty === 0) q.shift();
        }
      }
    }
    const openPositions: PnlSummary['openPositions'] = [];
    for (const [sku, q] of lots) {
      const qty = q.reduce((a, l) => a + l.qty, 0);
      if (qty > 0) openPositions.push({ sku, name: names.get(sku) ?? null, qty, costRef: q.reduce((a, l) => a + l.qty * l.costRef, 0) });
    }
    return { realizedRef, realizedUsd, buys, sells, openPositions };
  }

  snapshots(limit = 90): { ts: number; value_ref: number | null; value_usd: number | null; slots: number | null; src: string | null }[] {
    return this.store.db.all('SELECT * FROM portfolio_snapshots ORDER BY ts DESC LIMIT ?', limit);
  }

  addSnapshot(valueRef: number | null, valueUsd: number | null, slots: number | null, src: string, ts = now()): void {
    this.store.db.run('INSERT OR REPLACE INTO portfolio_snapshots (ts, value_ref, value_usd, slots, src) VALUES (?, ?, ?, ?, ?)', ts, valueRef, valueUsd, slots, src);
  }
}
