import { logger } from '../log.ts';
import { now, type Store } from '../db/store.ts';
import { bus } from '../bus.ts';

const log = logger('pricedb');
const BASE = 'https://pricedb.io/api';

export interface PricedbItem {
  sku: string;
  name: string;
  source?: string;
  time?: number;
  buy: { keys: number; metal: number };
  sell: { keys: number; metal: number };
}

export interface PricedbHistoryPoint {
  buy: { keys: number; metal: number };
  sell: { keys: number; metal: number };
  time: number;
}

export class PricedbSource {
  private timer: NodeJS.Timeout | null = null;
  lastSyncAt: number | null = null;
  lastCount = 0;
  keyBuyRef: number | null = null;
  keySellRef: number | null = null;

  private store: Store;
  private intervalMs: number;

  constructor(store: Store, intervalMs = 30 * 60_000) {
    this.store = store;
    this.intervalMs = intervalMs;
    const last = store.latestKeyRate();
    this.keyBuyRef = last?.pricedb_buy_ref ?? null;
    this.keySellRef = last?.pricedb_sell_ref ?? null;
    const meta = store.db.getMeta('pricedb.lastSyncAt');
    if (meta) this.lastSyncAt = Number(meta);
    const count = store.db.getMeta('pricedb.lastCount');
    if (count) this.lastCount = Number(count);
  }

  start(): void {
    const age = this.lastSyncAt ? now() - this.lastSyncAt : Infinity;
    const delay = age * 1000 >= this.intervalMs ? 0 : this.intervalMs - age * 1000;
    setTimeout(() => void this.sync(), delay);
    this.timer = setInterval(() => void this.sync(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sync(): Promise<void> {
    try {
      const res = await fetch(`${BASE}/autob/items`, { headers: { 'user-agent': 'tf2-scout/0.1 (+local dashboard)' }, signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { success?: boolean; items?: PricedbItem[] } | PricedbItem[];
      const items = Array.isArray(data) ? data : (data.items ?? []);
      if (!items.length) throw new Error('empty response');
      const ts = now();
      let n = 0;
      this.store.db.transaction(() => {
        for (const it of items) {
          if (!it?.sku || !it.buy || !it.sell) continue;
          this.store.upsertRefPrice(it.sku, 'pricedb', it.buy.keys ?? 0, it.buy.metal ?? 0, it.sell.keys ?? 0, it.sell.metal ?? 0, it.time ?? ts);
          if (it.name) this.store.ensureItemName(it.sku, it.name, ts);
          n++;
        }
      });
      const key = items.find((i) => i.sku === '5021;6');
      if (key) {
        this.keyBuyRef = key.buy.metal;
        this.keySellRef = key.sell.metal;
        this.store.insertKeyRate({ pricedbBuyRef: key.buy.metal, pricedbSellRef: key.sell.metal });
      }
      this.lastSyncAt = ts;
      this.lastCount = n;
      this.store.db.setMeta('pricedb.lastSyncAt', String(ts));
      this.store.db.setMeta('pricedb.lastCount', String(n));
      log.info(`synced ${n} prices (key ${this.keyBuyRef}/${this.keySellRef} ref)`);
      bus.emitTyped('keyrate', { bptfRef: null, bptfUsd: null });
    } catch (err) {
      log.error('pricedb sync failed', (err as Error).message);
    }
  }

  async history(sku: string, days = 30): Promise<PricedbHistoryPoint[]> {
    const start = now() - days * 86400;
    const res = await fetch(`${BASE}/item-history/${encodeURIComponent(sku)}?start=${start}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { history?: PricedbHistoryPoint[]; items?: PricedbHistoryPoint[] } | PricedbHistoryPoint[];
    if (Array.isArray(data)) return data;
    return data.history ?? data.items ?? [];
  }
}
