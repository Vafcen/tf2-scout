import { env } from '../config.ts';
import { logger } from '../log.ts';
import { bus, type SkuChange } from '../bus.ts';
import { normalizeListing, now, type BptfListingPayload, type NormListing, type Store } from '../db/store.ts';
import { skuFromBptfItem } from '../tf2/sku.ts';
import { KeyRateTracker } from '../engine/keyRate.ts';
import { botPulse } from '../engine/botPulse.ts';

const log = logger('bptf-ws');

interface WsEvent {
  id?: string;
  event: string;
  payload: BptfListingPayload;
}

interface ChurnCounters {
  updates: number;
  deletes: number;
  sellUpdates: number;
  sellDeletes: number;
  humanSellUpdates: number;
}

export class BptfWebSocket {
  private ws: WebSocket | null = null;
  private stopped = false;
  private backoffMs = 1000;
  private churn = new Map<string, ChurnCounters>();
  private churnHour = 0;
  private eventTimestamps: number[] = [];
  lastEventAt: number | null = null;
  connected = false;
  totalEvents = 0;
  totalBatches = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  private statusTimer: NodeJS.Timeout | null = null;

  private store: Store;
  private keyRate: KeyRateTracker;

  constructor(store: Store, keyRate: KeyRateTracker) {
    this.store = store;
    this.keyRate = keyRate;
  }

  start(): void {
    this.stopped = false;
    this.connect();
    this.flushTimer = setInterval(() => this.flushChurn(), 60_000);
    this.statusTimer = setInterval(() => this.emitStatus(), 15_000);
  }

  stop(): void {
    this.stopped = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.flushChurn();
    this.ws?.close();
  }

  eventsPerMin(): number {
    const cutoff = Date.now() - 60_000;
    this.eventTimestamps = this.eventTimestamps.filter((t) => t >= cutoff);
    return this.eventTimestamps.length;
  }

  private emitStatus(): void {
    bus.emitTyped('ws:status', { connected: this.connected, eventsPerMin: this.eventsPerMin(), lastEventAt: this.lastEventAt });
  }

  private connect(): void {
    if (this.stopped) return;
    log.info(`connecting to ${env.BPTF_WS_URL}`);
    let ws: WebSocket;
    try {
      ws = new WebSocket(env.BPTF_WS_URL);
    } catch (err) {
      log.error('could not create the WebSocket', err);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.backoffMs = 1000;
      log.info('connected');
      this.emitStatus();
    };
    ws.onmessage = (m) => this.onMessage(typeof m.data === 'string' ? m.data : String(m.data));
    ws.onerror = (e) => log.warn('websocket error', (e as { message?: string }).message ?? e.type);
    ws.onclose = (e) => {
      this.connected = false;
      log.warn(`disconnected (code ${e.code}${e.reason ? ', ' + e.reason : ''})`);
      this.emitStatus();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
    setTimeout(() => this.connect(), delay);
  }

  private onMessage(raw: string): void {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      log.debug('non-JSON message');
      return;
    }
    const events = (Array.isArray(data) ? data : [data]) as WsEvent[];
    this.totalBatches++;
    const t = Date.now();
    this.lastEventAt = Math.floor(t / 1000);
    const changes = new Map<string, SkuChange>();
    const seenAt = now();
    const hour = seenAt - (seenAt % 3600);
    if (hour !== this.churnHour) {
      this.flushChurn();
      this.churnHour = hour;
    }
    this.store.db.transaction(() => {
      for (const ev of events) {
        if (!ev || typeof ev !== 'object') continue;
        this.totalEvents++;
        this.eventTimestamps.push(t);
        if (ev.event === 'overstocked') {
          log.warn('server reports overstocked: events are arriving faster than we process them');
          continue;
        }
        if (ev.event !== 'listing-update' && ev.event !== 'listing-delete') continue;
        const l = normalizeListing(ev.payload, skuFromBptfItem);
        if (!l) continue;
        const change = changes.get(l.sku) ?? { sku: l.sku, sellIds: [], buyChanged: false, deletedIds: [] };
        changes.set(l.sku, change);
        const c = this.churn.get(l.sku) ?? { updates: 0, deletes: 0, sellUpdates: 0, sellDeletes: 0, humanSellUpdates: 0 };
        this.churn.set(l.sku, c);
        if (ev.event === 'listing-delete') {
          this.store.deactivateListing(l.id);
          change.deletedIds.push(l.id);
          if (l.intent === 'buy') change.buyChanged = true;
          c.deletes++;
          if (l.intent === 'sell') c.sellDeletes++;
          continue;
        }
        this.store.upsertListing(l, seenAt);
        this.store.upsertItem(l.sku, l.item, seenAt);
        if (l.isBot) botPulse.observe(l.steamid, l.lastPulse);
        this.recordRefs(l, seenAt);
        this.keyRate.observe(l);
        c.updates++;
        if (l.intent === 'sell') {
          c.sellUpdates++;
          if (!l.isBot) c.humanSellUpdates++;
          change.sellIds.push(l.id);
        } else {
          change.buyChanged = true;
        }
      }
    });
    if (this.eventTimestamps.length > 20_000) this.eventsPerMin();
    if (changes.size) bus.emitTyped('listings:changed', changes);
  }

  private recordRefs(l: NormListing, ts: number): void {
    // backpack.tf suggested (community) price and Steam Market price that travel inside the payload.
    if (l.refs.communityRaw) {
      const k = this.keyRate.bptfRef;
      if (k && k > 0) {
        const keys = Math.floor(l.refs.communityRaw / k);
        const metal = Math.round((l.refs.communityRaw - keys * k) * 100) / 100;
        // bptf does not distinguish buy/sell: we store the same value in both as the "suggested" reference.
        this.store.upsertRefPrice(l.sku, 'bptf', keys, metal, keys, metal, l.refs.communityUpdatedAt ?? ts);
      }
    }
    if (l.refs.steamCents && l.item.marketName) {
      this.store.upsertScmPrice(l.sku, l.item.marketName, l.refs.steamCents, 'bptf', ts);
    }
  }

  private flushChurn(): void {
    if (!this.churn.size) return;
    const hour = this.churnHour || now() - (now() % 3600);
    const entries = [...this.churn.entries()];
    this.churn.clear();
    try {
      this.store.db.transaction(() => {
        for (const [sku, c] of entries) this.store.addChurn(sku, hour, c);
      });
    } catch (err) {
      log.error('error saving churn', err);
    }
  }
}
