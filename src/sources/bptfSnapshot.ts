import { env } from '../config.ts';
import { logger } from '../log.ts';
import { bus } from '../bus.ts';
import { normalizeListing, now, type BptfListingPayload, type Store } from '../db/store.ts';
import { skuFromBptfItem } from '../tf2/sku.ts';
import { botPulse } from '../engine/botPulse.ts';

const log = logger('bptf-snapshot');

interface SnapshotListing extends Partial<BptfListingPayload> {
  // the snapshot uses snake_case in several fields
  listed_at?: number;
  bumped_at?: number;
  user_agent?: { client?: string; lastPulse?: number; last_pulse?: number };
  trade_offers_preferred?: boolean;
  buy_out_only?: boolean;
  timestamp?: number;
  bump?: number;
}

interface SnapshotResponse {
  listings?: SnapshotListing[];
  appid?: number;
  sku?: string;
  createdAt?: number;
  message?: string;
}

/**
 * Order book snapshot for an item (needs BPTF_TOKEN). Priority queue with a soft rate limit.
 * Priority: SKUs with active opportunities > watchlist > SKUs with the most activity.
 */
export class BptfSnapshotSource {
  private store: Store;
  private queue: { name: string; sku: string; prio: number }[] = [];
  private queued = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private pauseUntil = 0;
  private lastSnapshotBySku = new Map<string, number>();
  done = 0;
  errors = 0;
  lastAt: number | null = null;
  lastError: string | null = null;

  constructor(store: Store) {
    this.store = store;
  }

  get enabled(): boolean {
    return !!env.BPTF_TOKEN;
  }

  start(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.tick(), 2500);
    setInterval(() => this.fillFromActivity(), 60_000);
    setTimeout(() => this.fillFromActivity(), 30_000);
    log.info('snapshot enabled (1 query every 2.5 s)');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  status() {
    return { enabled: this.enabled, queued: this.queue.length, done: this.done, errors: this.errors, lastAt: this.lastAt, lastError: this.lastError };
  }

  /** Enqueues a SKU (prio 0 = highest). Ignored if it was already queried less than `minAgeSec` ago. */
  request(sku: string, prio = 1, minAgeSec = 120): void {
    if (!this.enabled || this.queued.has(sku)) return;
    const last = this.lastSnapshotBySku.get(sku) ?? 0;
    if (now() - last < minAgeSec) return;
    const item = this.store.getItem(sku);
    if (!item?.name) return;
    this.queue.push({ name: item.name, sku, prio });
    this.queued.add(sku);
    this.queue.sort((a, b) => a.prio - b.prio);
    if (this.queue.length > 500) {
      const dropped = this.queue.splice(500);
      for (const d of dropped) this.queued.delete(d.sku);
    }
  }

  private fillFromActivity(): void {
    if (this.queue.length > 50) return;
    const ts = now();
    for (const w of this.store.db.all<{ sku: string }>('SELECT sku FROM watchlist')) this.request(w.sku, 1, 600);
    const active = this.store.db.all<{ sku: string }>(
      `SELECT sku, SUM(sell_updates + sell_deletes) a FROM churn WHERE hour_ts >= ? GROUP BY sku ORDER BY a DESC LIMIT 60`, ts - 86400,
    );
    for (const r of active) this.request(r.sku, 2, 1800);
  }

  private async tick(): Promise<void> {
    if (Date.now() < this.pauseUntil || !this.queue.length) return;
    const job = this.queue.shift()!;
    this.queued.delete(job.sku);
    try {
      const url = `https://backpack.tf/api/classifieds/listings/snapshot?token=${encodeURIComponent(env.BPTF_TOKEN!)}&appid=440&sku=${encodeURIComponent(job.name)}`;
      const res = await fetch(url, { headers: { 'user-agent': 'tf2-scout/0.1 (local dashboard; read-only)' }, signal: AbortSignal.timeout(20_000) });
      if (res.status === 429) {
        this.pauseUntil = Date.now() + 60_000;
        this.queue.unshift(job);
        this.queued.add(job.sku);
        log.warn('snapshot rate limited, pausing for 60 s');
        return;
      }
      if (!res.ok) {
        this.errors++;
        this.lastError = `HTTP ${res.status} (${job.name})`;
        if (res.status === 401 || res.status === 403) {
          this.pauseUntil = Date.now() + 10 * 60_000;
          log.error(`snapshot rejected (${res.status}): check BPTF_TOKEN. Pausing for 10 min.`);
        }
        return;
      }
      const data = (await res.json()) as SnapshotResponse;
      this.apply(job.sku, data);
    } catch (err) {
      this.errors++;
      this.lastError = (err as Error).message;
      log.debug(`snapshot error ${job.name}: ${this.lastError}`);
    }
  }

  private apply(sku: string, data: SnapshotResponse): void {
    const listings = data.listings ?? [];
    const seenAt = now();
    const keepIds: string[] = [];
    let buyChanged = false;
    const sellIds: string[] = [];
    this.store.db.transaction(() => {
      for (const raw of listings) {
        const payload: BptfListingPayload = {
          ...(raw as BptfListingPayload),
          id: raw.id ?? (raw.intent === 'sell' && raw.item?.id ? `440_${raw.item.id}` : `snap_${raw.steamid}_${sku}_${raw.intent}`),
          appid: 440,
          listedAt: raw.listedAt ?? raw.listed_at ?? raw.timestamp,
          bumpedAt: raw.bumpedAt ?? raw.bumped_at ?? raw.bump,
          userAgent: raw.userAgent ?? (raw.user_agent ? { client: raw.user_agent.client, lastPulse: raw.user_agent.lastPulse ?? raw.user_agent.last_pulse } : undefined),
          source: raw.source ?? (raw.userAgent || raw.user_agent ? 'userAgent' : 'steam'),
        };
        const l = normalizeListing(payload, skuFromBptfItem);
        if (!l || l.sku !== sku) continue;
        this.store.upsertListing(l, seenAt);
        if (l.isBot) botPulse.observe(l.steamid, l.lastPulse);
        keepIds.push(l.id);
        if (l.intent === 'sell') sellIds.push(l.id);
        else buyChanged = true;
      }
      const removed = this.store.deactivateMissing(sku, keepIds);
      if (removed) buyChanged = true;
    });
    this.done++;
    this.lastAt = seenAt;
    this.lastSnapshotBySku.set(sku, seenAt);
    bus.emitTyped('listings:changed', new Map([[sku, { sku, sellIds, buyChanged, deletedIds: [] }]]));
  }
}
