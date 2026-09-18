import type { Store } from '../db/store.ts';
import { now } from '../db/store.ts';
import type { Lane } from '../config.ts';
import { bus } from '../bus.ts';

export interface OppInput {
  lane: Lane;
  sku: string;
  listingId?: string;
  title: string;
  buyVenue?: string;
  buyPriceRef?: number | null;
  buyPriceUsd?: number | null;
  sellVenue?: string;
  sellPriceRef?: number | null;
  sellPriceUsd?: number | null;
  netRef?: number | null;
  netUsd?: number | null;
  pct?: number | null;
  confidence: number;
  details: Record<string, unknown>;
  ttlMin: number;
}

export interface OppRow {
  id: number;
  lane: Lane;
  sku: string;
  listing_id: string;
  title: string;
  buy_venue: string | null;
  buy_price_ref: number | null;
  buy_price_usd: number | null;
  sell_venue: string | null;
  sell_price_ref: number | null;
  sell_price_usd: number | null;
  net_ref: number | null;
  net_usd: number | null;
  pct: number | null;
  confidence: number;
  details: string | null;
  status: string; // new | alerted | offered | executed | rejected | expired | dismissed
  created_at: number;
  updated_at: number;
  expires_at: number | null;
  alerted_at: number | null;
}

export interface UpsertResult {
  id: number;
  isNew: boolean;
  improved: boolean;
  row: OppRow;
}

/** Statuses that still count as "live" for the dashboard and the strategies. */
export const ACTIVE_STATUSES = ['new', 'alerted', 'offered'];
const ACTIVE_SQL = "status IN ('new','alerted','offered')";

export class Opportunities {
  private store: Store;
  constructor(store: Store) {
    this.store = store;
  }

  upsert(o: OppInput): UpsertResult {
    const ts = now();
    const listingId = o.listingId ?? '';
    const existing = this.store.db.get<OppRow>(
      'SELECT * FROM opportunities WHERE lane = ? AND sku = ? AND listing_id = ?', o.lane, o.sku, listingId,
    );
    const expiresAt = ts + o.ttlMin * 60;
    const details = JSON.stringify(o.details);
    if (!existing || !ACTIVE_STATUSES.includes(existing.status)) {
      // New (or reactivated after expiring): replace the row to keep the unique key.
      if (existing) this.store.db.run('DELETE FROM opportunities WHERE id = ?', existing.id);
      // Anti-spam: if we already alerted something equal or better for this lane+SKU < 30 min ago, it is born as "alerted".
      const recent = this.store.db.get<{ net_ref: number | null }>(
        'SELECT net_ref FROM opportunities WHERE lane = ? AND sku = ? AND alerted_at IS NOT NULL AND alerted_at >= ? ORDER BY alerted_at DESC LIMIT 1',
        o.lane, o.sku, ts - 30 * 60,
      );
      const silent = !!recent && (recent.net_ref ?? 0) >= (o.netRef ?? 0) * 0.98;
      const r = this.store.db.run(
        `INSERT INTO opportunities (lane, sku, listing_id, title, buy_venue, buy_price_ref, buy_price_usd, sell_venue, sell_price_ref, sell_price_usd,
           net_ref, net_usd, pct, confidence, details, status, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        o.lane, o.sku, listingId, o.title, o.buyVenue ?? null, o.buyPriceRef ?? null, o.buyPriceUsd ?? null, o.sellVenue ?? null,
        o.sellPriceRef ?? null, o.sellPriceUsd ?? null, o.netRef ?? null, o.netUsd ?? null, o.pct ?? null, o.confidence, details,
        silent ? 'alerted' : 'new', ts, ts, expiresAt,
      );
      const id = Number(r.lastInsertRowid);
      if (silent) this.store.db.run('UPDATE opportunities SET alerted_at = ? WHERE id = ?', ts, id);
      const row = this.get(id)!;
      bus.emitTyped('opportunity', { id, lane: o.lane, sku: o.sku, status: row.status, isNew: !silent, improved: false });
      return { id, isNew: !silent, improved: false, row };
    }
    const prevNet = existing.net_ref ?? 0;
    const improved = (o.netRef ?? 0) > prevNet * 1.05 + 0.05;
    this.store.db.run(
      `UPDATE opportunities SET title = ?, buy_venue = ?, buy_price_ref = ?, buy_price_usd = ?, sell_venue = ?, sell_price_ref = ?, sell_price_usd = ?,
         net_ref = ?, net_usd = ?, pct = ?, confidence = ?, details = ?, updated_at = ?, expires_at = ? WHERE id = ?`,
      o.title, o.buyVenue ?? null, o.buyPriceRef ?? null, o.buyPriceUsd ?? null, o.sellVenue ?? null, o.sellPriceRef ?? null, o.sellPriceUsd ?? null,
      o.netRef ?? null, o.netUsd ?? null, o.pct ?? null, o.confidence, details, ts, expiresAt, existing.id,
    );
    const row = this.get(existing.id)!;
    bus.emitTyped('opportunity', { id: existing.id, lane: o.lane, sku: o.sku, status: row.status, isNew: false, improved });
    return { id: existing.id, isNew: false, improved, row };
  }

  get(id: number): OppRow | undefined {
    return this.store.db.get<OppRow>('SELECT * FROM opportunities WHERE id = ?', id);
  }

  markAlerted(id: number): void {
    this.store.db.run("UPDATE opportunities SET status = CASE WHEN status = 'new' THEN 'alerted' ELSE status END, alerted_at = ? WHERE id = ?", now(), id);
  }

  expire(id: number, reason: string): void {
    const row = this.get(id);
    if (!row || !ACTIVE_STATUSES.includes(row.status)) return;
    if (row.status === 'offered') return; // you already acted on it: only you can close it (executed / rejected)
    const details = row.details ? (JSON.parse(row.details) as Record<string, unknown>) : {};
    details.expiredReason = reason;
    details.lifeSec = now() - row.created_at;
    this.store.db.run("UPDATE opportunities SET status = 'expired', updated_at = ?, details = ? WHERE id = ?", now(), JSON.stringify(details), id);
    bus.emitTyped('opportunity', { id, lane: row.lane, sku: row.sku, status: 'expired', isNew: false, improved: false });
  }

  /** Expires the active opportunities of a SKU/lane that are not in `keepIds` (listing ids). */
  expireOthers(lane: Lane, sku: string, keepListingIds: string[], reason: string): void {
    const rows = this.store.db.all<OppRow>(
       `SELECT * FROM opportunities WHERE lane = ? AND sku = ? AND ${ACTIVE_SQL}`, lane, sku,
    );
    for (const r of rows) if (!keepListingIds.includes(r.listing_id)) this.expire(r.id, reason);
  }

  expireByListing(listingId: string, reason: string): void {
    const rows = this.store.db.all<OppRow>(`SELECT * FROM opportunities WHERE listing_id = ? AND ${ACTIVE_SQL}`, listingId);
    for (const r of rows) this.expire(r.id, reason);
  }

  expireStale(ts = now()): number {
    const rows = this.store.db.all<OppRow>(`SELECT * FROM opportunities WHERE ${ACTIVE_SQL} AND expires_at IS NOT NULL AND expires_at < ?`, ts);
    for (const r of rows) this.expire(r.id, 'ttl');
    return rows.length;
  }

  /** Merge keys into the details JSON (e.g. verification results). */
  patchDetails(id: number, patch: Record<string, unknown>): void {
    const row = this.get(id);
    if (!row) return;
    const details = row.details ? (JSON.parse(row.details) as Record<string, unknown>) : {};
    Object.assign(details, patch);
    this.store.db.run('UPDATE opportunities SET details = ? WHERE id = ?', JSON.stringify(details), id);
  }

  setStatus(id: number, status: 'executed' | 'dismissed' | 'offered' | 'rejected'): void {
    const row = this.get(id);
    if (!row) return;
    this.store.db.run('UPDATE opportunities SET status = ?, updated_at = ? WHERE id = ?', status, now(), id);
    bus.emitTyped('opportunity', { id, lane: row.lane, sku: row.sku, status, isNew: false, improved: false });
  }

  active(lane?: Lane, limit = 200): OppRow[] {
    return lane
      ? this.store.db.all<OppRow>(`SELECT * FROM opportunities WHERE ${ACTIVE_SQL} AND lane = ? ORDER BY net_ref DESC LIMIT ?`, lane, limit)
      : this.store.db.all<OppRow>(`SELECT * FROM opportunities WHERE ${ACTIVE_SQL} ORDER BY updated_at DESC LIMIT ?`, limit);
  }

  recent(limit = 100): OppRow[] {
    return this.store.db.all<OppRow>('SELECT * FROM opportunities ORDER BY updated_at DESC LIMIT ?', limit);
  }

  prune(olderThanSec: number, ts = now()): number {
    return Number(this.store.db.run("DELETE FROM opportunities WHERE status IN ('expired','dismissed') AND updated_at < ?", ts - olderThanSec).changes);
  }
}
