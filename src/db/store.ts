import type { Db } from './db.ts';
import type { BptfItem } from '../tf2/sku.ts';

export type Intent = 'buy' | 'sell';

export interface NormListing {
  id: string;
  sku: string;
  intent: Intent;
  steamid: string;
  keys: number;
  metal: number;
  usd: number | null;
  valueRef: number | null;
  isBot: boolean;
  uaClient: string | null;
  lastPulse: number | null;
  premium: boolean;
  banned: boolean;
  online: boolean;
  userName: string | null;
  tradeUrl: string | null;
  listedAt: number | null;
  bumpedAt: number | null;
  details: string | null;
  source: string | null;
  count: number;
  flags: Record<string, unknown> | null;
  item: {
    name: string;
    marketName: string | null;
    defindex: number;
    quality: number;
    effect: number | null;
    ksTier: number;
    australium: boolean;
    imageUrl: string | null;
    baseName: string | null;
  };
  refs: {
    communityRaw?: number; // ref (bptf key rate)
    communityUsd?: number;
    communityUpdatedAt?: number;
    steamCents?: number; // SCM price (USD cents)
    steamRaw?: number; // ref equivalent according to bptf
  };
}

export interface ListingRow {
  id: string;
  sku: string;
  intent: Intent;
  steamid: string;
  keys: number;
  metal: number;
  usd: number | null;
  value_ref: number | null;
  is_bot: number;
  ua_client: string | null;
  last_pulse: number | null;
  premium: number;
  banned: number;
  online: number;
  user_name: string | null;
  trade_url: string | null;
  listed_at: number | null;
  bumped_at: number | null;
  details: string | null;
  source: string | null;
  count: number;
  active: number;
  seen_at: number;
  flags: string | null;
}

export interface ItemRow {
  sku: string;
  name: string;
  market_name: string | null;
  defindex: number | null;
  quality: number | null;
  effect: number | null;
  ks_tier: number;
  australium: number;
  image_url: string | null;
  base_name: string | null;
}

export interface RefPriceRow {
  sku: string;
  src: string;
  buy_keys: number | null;
  buy_metal: number | null;
  sell_keys: number | null;
  sell_metal: number | null;
  ts: number;
}

export const now = (): number => Math.floor(Date.now() / 1000);

export class Store {
  readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  upsertListing(l: NormListing, seenAt = now()): void {
    this.db.run(
      `INSERT INTO listings (id, sku, intent, steamid, keys, metal, usd, value_ref, is_bot, ua_client, last_pulse, premium, banned, online,
         user_name, trade_url, listed_at, bumped_at, details, source, count, active, seen_at, flags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         sku = excluded.sku, intent = excluded.intent, steamid = excluded.steamid, keys = excluded.keys, metal = excluded.metal,
         usd = excluded.usd, value_ref = excluded.value_ref, is_bot = excluded.is_bot, ua_client = excluded.ua_client,
         last_pulse = excluded.last_pulse, premium = excluded.premium, banned = excluded.banned, online = excluded.online,
         user_name = excluded.user_name, trade_url = excluded.trade_url, listed_at = excluded.listed_at, bumped_at = excluded.bumped_at,
         details = excluded.details, source = excluded.source, count = excluded.count, active = 1, seen_at = excluded.seen_at,
         flags = excluded.flags`,
      l.id, l.sku, l.intent, l.steamid, l.keys, l.metal, l.usd, l.valueRef, l.isBot ? 1 : 0, l.uaClient, l.lastPulse,
      l.premium ? 1 : 0, l.banned ? 1 : 0, l.online ? 1 : 0, l.userName, l.tradeUrl, l.listedAt, l.bumpedAt, l.details,
      l.source, l.count, seenAt, l.flags ? JSON.stringify(l.flags) : null,
    );
    if (l.intent === 'buy') this.deactivateOtherBuyOrders(l.sku, l.steamid, l.id);
  }

  /** A user can only have one buy order per item: when we see a new one, we retire their other ones for the same SKU. */
  deactivateOtherBuyOrders(sku: string, steamid: string, keepId: string): void {
    this.db.run("UPDATE listings SET active = 0 WHERE sku = ? AND intent = 'buy' AND steamid = ? AND active = 1 AND id <> ?", sku, steamid, keepId);
  }

  deactivateListing(id: string): void {
    this.db.run('UPDATE listings SET active = 0 WHERE id = ?', id);
  }

  /** Marks a SKU's listings that are not in `keepIds` as inactive (after a snapshot). */
  deactivateMissing(sku: string, keepIds: string[]): number {
    const placeholders = keepIds.map(() => '?').join(',');
    const sql = keepIds.length
      ? `UPDATE listings SET active = 0 WHERE sku = ? AND active = 1 AND id NOT IN (${placeholders})`
      : 'UPDATE listings SET active = 0 WHERE sku = ? AND active = 1';
    return Number(this.db.run(sql, sku, ...keepIds).changes);
  }

  upsertItem(sku: string, it: NormListing['item'], ts = now()): void {
    this.db.run(
      `INSERT INTO items (sku, name, market_name, defindex, quality, effect, ks_tier, australium, image_url, base_name, first_seen, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sku) DO UPDATE SET name = excluded.name, market_name = COALESCE(excluded.market_name, items.market_name),
         defindex = excluded.defindex, quality = excluded.quality, effect = excluded.effect, ks_tier = excluded.ks_tier,
         australium = excluded.australium, image_url = COALESCE(excluded.image_url, items.image_url),
         base_name = COALESCE(excluded.base_name, items.base_name), updated_at = excluded.updated_at`,
      sku, it.name, it.marketName, it.defindex, it.quality, it.effect, it.ksTier, it.australium ? 1 : 0, it.imageUrl, it.baseName, ts, ts,
    );
  }

  /** Inserts the name if it doesn't exist yet (from pricedb, without attributes). */
  ensureItemName(sku: string, name: string, ts = now()): void {
    this.db.run(
      `INSERT INTO items (sku, name, first_seen, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(sku) DO NOTHING`,
      sku, name, ts, ts,
    );
  }

  getItem(sku: string): ItemRow | undefined {
    return this.db.get<ItemRow>('SELECT * FROM items WHERE sku = ?', sku);
  }

  upsertRefPrice(sku: string, src: string, buyKeys: number, buyMetal: number, sellKeys: number, sellMetal: number, ts: number): void {
    this.db.run(
      `INSERT INTO ref_prices (sku, src, buy_keys, buy_metal, sell_keys, sell_metal, ts) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sku, src) DO UPDATE SET buy_keys = excluded.buy_keys, buy_metal = excluded.buy_metal,
         sell_keys = excluded.sell_keys, sell_metal = excluded.sell_metal, ts = excluded.ts`,
      sku, src, buyKeys, buyMetal, sellKeys, sellMetal, ts,
    );
  }

  getRefPrices(sku: string): RefPriceRow[] {
    return this.db.all<RefPriceRow>('SELECT * FROM ref_prices WHERE sku = ?', sku);
  }

  upsertScmPrice(sku: string, marketName: string | null, lowestCents: number | null, src: string, ts: number, extra?: {
    medianCents?: number | null; volume?: number | null; listings?: number | null; highestBuyCents?: number | null; itemNameId?: string | null;
  }): void {
    this.db.run(
      `INSERT INTO scm_prices (sku, market_name, lowest_cents, median_cents, volume, listings, highest_buy_cents, item_nameid, src, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sku) DO UPDATE SET
         market_name = COALESCE(excluded.market_name, scm_prices.market_name),
         lowest_cents = excluded.lowest_cents,
         median_cents = COALESCE(excluded.median_cents, scm_prices.median_cents),
         volume = COALESCE(excluded.volume, scm_prices.volume),
         listings = COALESCE(excluded.listings, scm_prices.listings),
         highest_buy_cents = COALESCE(excluded.highest_buy_cents, scm_prices.highest_buy_cents),
         item_nameid = COALESCE(excluded.item_nameid, scm_prices.item_nameid),
         src = excluded.src, ts = excluded.ts`,
      sku, marketName, lowestCents, extra?.medianCents ?? null, extra?.volume ?? null, extra?.listings ?? null,
      extra?.highestBuyCents ?? null, extra?.itemNameId ?? null, src, ts,
    );
  }

  addChurn(sku: string, hourTs: number, c: { updates?: number; deletes?: number; sellUpdates?: number; sellDeletes?: number; humanSellUpdates?: number }): void {
    this.db.run(
      `INSERT INTO churn (sku, hour_ts, updates, deletes, sell_updates, sell_deletes, human_sell_updates) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sku, hour_ts) DO UPDATE SET updates = updates + excluded.updates, deletes = deletes + excluded.deletes,
         sell_updates = sell_updates + excluded.sell_updates, sell_deletes = sell_deletes + excluded.sell_deletes,
         human_sell_updates = human_sell_updates + excluded.human_sell_updates`,
      sku, hourTs, c.updates ?? 0, c.deletes ?? 0, c.sellUpdates ?? 0, c.sellDeletes ?? 0, c.humanSellUpdates ?? 0,
    );
  }

  churn24h(sku: string, ts = now()): { updates: number; deletes: number; sellUpdates: number; sellDeletes: number } {
    const r = this.db.get<{ u: number; d: number; su: number; sd: number }>(
      `SELECT COALESCE(SUM(updates),0) u, COALESCE(SUM(deletes),0) d, COALESCE(SUM(sell_updates),0) su, COALESCE(SUM(sell_deletes),0) sd
       FROM churn WHERE sku = ? AND hour_ts >= ?`,
      sku, ts - 86400,
    );
    return { updates: r?.u ?? 0, deletes: r?.d ?? 0, sellUpdates: r?.su ?? 0, sellDeletes: r?.sd ?? 0 };
  }

  pruneChurn(olderThanTs: number): number {
    return Number(this.db.run('DELETE FROM churn WHERE hour_ts < ?', olderThanTs).changes);
  }

  /** Listings not seen in N seconds are considered inactive (bots re-list often). */
  expireStaleListings(maxAgeSec: number, ts = now()): number {
    return Number(this.db.run('UPDATE listings SET active = 0 WHERE active = 1 AND seen_at < ?', ts - maxAgeSec).changes);
  }

  deleteInactiveListings(olderThanSec: number, ts = now()): number {
    return Number(this.db.run('DELETE FROM listings WHERE active = 0 AND seen_at < ?', ts - olderThanSec).changes);
  }

  activeListings(sku: string, intent?: Intent): ListingRow[] {
    return intent
      ? this.db.all<ListingRow>('SELECT * FROM listings WHERE sku = ? AND intent = ? AND active = 1', sku, intent)
      : this.db.all<ListingRow>('SELECT * FROM listings WHERE sku = ? AND active = 1', sku);
  }

  insertKeyRate(r: {
    bptfRef?: number | null; pricedbBuyRef?: number | null; pricedbSellRef?: number | null; bptfUsd?: number | null;
    scmUsdLow?: number | null; scmUsdMedian?: number | null; scmVolume?: number | null; stnBuyRef?: number | null; stnSellRef?: number | null;
    bptfBestBuyRef?: number | null; bptfBestSellRef?: number | null;
  }, ts = now()): void {
    const prev = this.latestKeyRate();
    this.db.run(
      `INSERT OR REPLACE INTO key_rates (ts, bptf_ref, pricedb_buy_ref, pricedb_sell_ref, bptf_usd, scm_usd_low, scm_usd_median, scm_volume,
         stn_buy_ref, stn_sell_ref, bptf_best_buy_ref, bptf_best_sell_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ts,
      r.bptfRef ?? prev?.bptf_ref ?? null, r.pricedbBuyRef ?? prev?.pricedb_buy_ref ?? null, r.pricedbSellRef ?? prev?.pricedb_sell_ref ?? null,
      r.bptfUsd ?? prev?.bptf_usd ?? null, r.scmUsdLow ?? prev?.scm_usd_low ?? null, r.scmUsdMedian ?? prev?.scm_usd_median ?? null,
      r.scmVolume ?? prev?.scm_volume ?? null, r.stnBuyRef ?? prev?.stn_buy_ref ?? null, r.stnSellRef ?? prev?.stn_sell_ref ?? null,
      r.bptfBestBuyRef ?? prev?.bptf_best_buy_ref ?? null, r.bptfBestSellRef ?? prev?.bptf_best_sell_ref ?? null,
    );
  }

  latestKeyRate(): KeyRateRow | undefined {
    return this.db.get<KeyRateRow>('SELECT * FROM key_rates ORDER BY ts DESC LIMIT 1');
  }

  getSetting<T>(key: string): T | undefined {
    const r = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
    return r ? (JSON.parse(r.value) as T) : undefined;
  }

  setSetting(key: string, value: unknown): void {
    this.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  }
}

export interface KeyRateRow {
  ts: number;
  bptf_ref: number | null;
  pricedb_buy_ref: number | null;
  pricedb_sell_ref: number | null;
  bptf_usd: number | null;
  scm_usd_low: number | null;
  scm_usd_median: number | null;
  scm_volume: number | null;
  stn_buy_ref: number | null;
  stn_sell_ref: number | null;
  bptf_best_buy_ref: number | null;
  bptf_best_sell_ref: number | null;
}

/** Normalizes a backpack.tf listing payload (websocket or snapshot). Returns null if it's not TF2 or can't be interpreted. */
export function normalizeListing(p: BptfListingPayload, skuOf: (item: BptfItem) => string): NormListing | null {
  if (!p || p.appid !== 440 || !p.item || typeof p.item.defindex !== 'number') return null;
  const intent = p.intent === 'buy' || p.intent === 'sell' ? p.intent : null;
  if (!intent) return null;
  const cur = p.currencies ?? {};
  const keys = Number(cur.keys ?? 0) || 0;
  const metal = Number(cur.metal ?? 0) || 0;
  const usd = cur.usd !== undefined ? Number(cur.usd) : null;
  if (!keys && !metal && usd === null) return null;
  let sku: string;
  try {
    sku = skuOf(p.item);
  } catch {
    return null;
  }
  const quality = typeof p.item.quality === 'number' ? p.item.quality : (p.item.quality?.id ?? 6);
  const isBot = p.source === 'userAgent' || !!p.userAgent;
  const flags: Record<string, unknown> = {};
  if (p.item.spells?.length) flags.spells = p.item.spells.map((s) => s.name);
  if (p.item.paint?.name) flags.paint = p.item.paint.name;
  if (p.item.sheen?.name) flags.sheen = p.item.sheen.name;
  if (p.item.killstreaker?.name) flags.killstreaker = p.item.killstreaker.name;
  if (p.item.craftNumber) flags.craftNumber = p.item.craftNumber;
  if (p.item.quality && typeof p.item.quality !== 'number' && p.item.quality.name) flags.qualityName = p.item.quality.name;
  if (p.item.particle?.name) flags.effect = p.item.particle.name;
  const refs: NormListing['refs'] = {};
  const pr = p.item.price;
  if (pr?.community?.raw) {
    refs.communityRaw = pr.community.raw;
    if (pr.community.usd) refs.communityUsd = pr.community.usd;
    if (pr.community.updatedAt) refs.communityUpdatedAt = pr.community.updatedAt;
  }
  if (pr?.steam?.value && pr.steam.currency === 'usd') {
    refs.steamCents = Math.round(pr.steam.value);
    if (pr.steam.raw) refs.steamRaw = pr.steam.raw;
  }
  return {
    id: String(p.id),
    sku,
    intent,
    steamid: String(p.steamid ?? p.user?.id ?? ''),
    keys,
    metal,
    usd,
    valueRef: typeof p.value?.raw === 'number' ? p.value.raw : null,
    isBot,
    uaClient: p.userAgent?.client ?? null,
    lastPulse: p.userAgent?.lastPulse ?? null,
    premium: !!p.user?.premium,
    banned: !!p.user?.banned || (Array.isArray(p.user?.bans) && p.user.bans.length > 0),
    online: !!p.user?.online,
    userName: p.user?.name ?? null,
    tradeUrl: p.user?.tradeOfferUrl ?? null,
    listedAt: p.listedAt ?? null,
    bumpedAt: p.bumpedAt ?? null,
    details: p.details ? String(p.details).slice(0, 240) : null,
    source: p.source ?? null,
    count: Number(p.count ?? 1) || 1,
    flags: Object.keys(flags).length ? flags : null,
    item: {
      name: p.item.name ?? p.item.marketName ?? `#${p.item.defindex}`,
      marketName: p.item.marketName ?? null,
      defindex: p.item.defindex,
      quality,
      effect: p.item.particle?.id ?? null,
      ksTier: p.item.killstreakTier ?? 0,
      australium: !!p.item.australium,
      imageUrl: p.item.imageUrl ?? null,
      baseName: p.item.baseName ?? null,
    },
    refs,
  };
}

export interface BptfListingPayload {
  id: string;
  steamid?: string;
  appid: number;
  currencies?: { keys?: number; metal?: number; usd?: number };
  value?: { raw?: number; short?: string; long?: string };
  tradeOffersPreferred?: boolean;
  buyoutOnly?: boolean;
  details?: string;
  listedAt?: number;
  bumpedAt?: number;
  intent?: string;
  count?: number;
  status?: string;
  source?: string;
  item?: BptfItem;
  userAgent?: { client?: string; lastPulse?: number };
  user?: { id?: string; name?: string; premium?: boolean; online?: boolean; banned?: boolean; tradeOfferUrl?: string; bans?: unknown[] };
}
