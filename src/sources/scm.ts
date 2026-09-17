import { logger } from '../log.ts';
import { now, type Store } from '../db/store.ts';

const log = logger('scm');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) tf2-scout/0.1';

export interface PriceOverview {
  lowestCents: number | null;
  medianCents: number | null;
  volume: number | null;
}

function parseUsd(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/,/g, '').match(/([\d.]+)/);
  return m ? Math.round(parseFloat(m[1]) * 100) : null;
}

/**
 * Steam Community Market. Hard rate limit (~20 req/min per IP): queue with 1 request every 4 s
 * and a 30-min cache per item. The key is queried every 10 min.
 */
export class ScmSource {
  private store: Store;
  private queue: { marketName: string; sku: string | null; resolve: (v: PriceOverview | null) => void }[] = [];
  private draining = false;
  private pauseUntil = 0;
  private keyTimer: NodeJS.Timeout | null = null;
  lastKeyAt: number | null = null;
  requests = 0;
  rateLimited = 0;

  constructor(store: Store) {
    this.store = store;
  }

  start(): void {
    void this.refreshKey();
    this.keyTimer = setInterval(() => void this.refreshKey(), 10 * 60_000);
  }

  stop(): void {
    if (this.keyTimer) clearInterval(this.keyTimer);
  }

  async refreshKey(): Promise<void> {
    const r = await this.priceOverview('Mann Co. Supply Crate Key', '5021;6');
    if (r?.lowestCents) {
      this.store.insertKeyRate({ scmUsdLow: r.lowestCents / 100, scmUsdMedian: r.medianCents ? r.medianCents / 100 : null, scmVolume: r.volume });
      this.lastKeyAt = now();
      log.info(`key on SCM: $${(r.lowestCents / 100).toFixed(2)} (median $${r.medianCents ? (r.medianCents / 100).toFixed(2) : '?'}, vol ${r.volume ?? '?'})`);
    }
  }

  /** Current price of an item (queued). Uses the cache if it is recent. */
  priceOverview(marketName: string, sku: string | null, maxAgeSec = 1800): Promise<PriceOverview | null> {
    if (sku) {
      const cached = this.store.db.get<{ lowest_cents: number | null; median_cents: number | null; volume: number | null; ts: number; src: string }>(
        'SELECT lowest_cents, median_cents, volume, ts, src FROM scm_prices WHERE sku = ?', sku,
      );
      if (cached && cached.src === 'scm' && cached.ts >= now() - maxAgeSec) {
        return Promise.resolve({ lowestCents: cached.lowest_cents, medianCents: cached.median_cents, volume: cached.volume });
      }
    }
    return new Promise((resolve) => {
      if (this.queue.length > 200) return resolve(null);
      this.queue.push({ marketName, sku, resolve });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        const wait = this.pauseUntil - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        const job = this.queue.shift()!;
        const result = await this.fetchOverview(job.marketName);
        if (result === 'ratelimited') {
          this.rateLimited++;
          this.pauseUntil = Date.now() + 60_000;
          this.queue.unshift(job);
          continue;
        }
        if (result && job.sku) {
          this.store.upsertScmPrice(job.sku, job.marketName, result.lowestCents, 'scm', now(), { medianCents: result.medianCents, volume: result.volume });
        }
        job.resolve(result);
        this.pauseUntil = Date.now() + 4000;
      }
    } finally {
      this.draining = false;
    }
  }

  private async fetchOverview(marketName: string): Promise<PriceOverview | null | 'ratelimited'> {
    const url = `https://steamcommunity.com/market/priceoverview/?appid=440&currency=1&market_hash_name=${encodeURIComponent(marketName)}`;
    try {
      this.requests++;
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
      if (res.status === 429) return 'ratelimited';
      if (!res.ok) {
        log.debug(`priceoverview ${res.status} for ${marketName}`);
        return null;
      }
      const data = (await res.json()) as { success?: boolean; lowest_price?: string; median_price?: string; volume?: string };
      if (!data?.success) return null;
      return { lowestCents: parseUsd(data.lowest_price), medianCents: parseUsd(data.median_price), volume: data.volume ? parseInt(data.volume.replace(/,/g, ''), 10) : null };
    } catch (err) {
      log.debug(`priceoverview error ${marketName}: ${(err as Error).message}`);
      return null;
    }
  }
}
