import type { Store } from '../db/store.ts';
import { now } from '../db/store.ts';
import { bus, type SkuChange } from '../bus.ts';
import { logger } from '../log.ts';
import { PriceContext } from './prices.ts';
import { OrderBook } from './orderbook.ts';
import { Opportunities, type OppRow } from './opportunities.ts';
import { SettingsManager } from './settings.ts';
import { SnipeStrategy } from './strategies/snipe.ts';
import { BankingStrategy } from './strategies/banking.ts';
import { KeysStrategy } from './strategies/keys.ts';
import { ScmKeysStrategy } from './strategies/scmKeys.ts';
import { CashStrategy } from './strategies/cash.ts';
import { UnusualStrategy } from './strategies/unusual.ts';
import { BptfApi } from '../sources/bptfApi.ts';
import { Ledger } from '../ledger/trades.ts';
import type { ScmSource } from '../sources/scm.ts';
import { env } from '../config.ts';
import { DiscordAlerts, type DiscordEmbed } from '../alerts/discord.ts';
import { desktopNotify } from '../alerts/desktop.ts';
import { fmtKeysMetal, fmtUsd } from '../tf2/currencies.ts';
import type { Lane } from '../config.ts';
import { BptfSnapshotSource } from '../sources/bptfSnapshot.ts';

const log = logger('engine');

const LANE_COLORS: Record<Lane, number> = {
  snipe: 0x2ecc71, deal: 0x3498db, banking: 0x95a5a6, keys: 0xf1c40f, scm_keys: 0x9b59b6, cash: 0xe67e22, unusual: 0x8e44ad,
};
export const LANE_LABELS: Record<Lane, string> = {
  snipe: 'Snipe', deal: 'Deal', banking: 'Banking', keys: 'Keys', scm_keys: 'SCM → keys', cash: 'Cash', unusual: 'Unusual',
};

export class Engine {
  readonly store: Store;
  readonly prices: PriceContext;
  readonly book: OrderBook;
  readonly opps: Opportunities;
  readonly settings: SettingsManager;
  readonly snipe: SnipeStrategy;
  readonly banking: BankingStrategy;
  readonly keys: KeysStrategy;
  readonly scmKeys: ScmKeysStrategy;
  readonly cash: CashStrategy;
  readonly unusual: UnusualStrategy;
  readonly bptfApi = new BptfApi();
  readonly ledger: Ledger;
  readonly discord = new DiscordAlerts();
  readonly snapshot: BptfSnapshotSource;
  private pending = new Map<string, SkuChange>();
  private flushTimer: NodeJS.Timeout | null = null;
  private timers: NodeJS.Timeout[] = [];
  evaluated = 0;
  alertsSent = 0;
  startedAt = now();

  constructor(store: Store, scm: ScmSource) {
    this.store = store;
    this.prices = new PriceContext(store);
    this.book = new OrderBook(store, this.prices);
    this.opps = new Opportunities(store);
    this.settings = new SettingsManager(store);
    this.snipe = new SnipeStrategy(store, this.book, this.prices, this.opps);
    this.banking = new BankingStrategy(store, this.book, this.prices, this.opps);
    this.keys = new KeysStrategy(store, this.book, this.prices, this.opps);
    this.scmKeys = new ScmKeysStrategy(store, this.book, this.prices, this.opps, scm);
    this.cash = new CashStrategy(store, this.book, this.prices, this.opps);
    this.unusual = new UnusualStrategy(store, this.book, this.prices, this.opps);
    this.ledger = new Ledger(store);
    this.snapshot = new BptfSnapshotSource(store);
  }

  get snapshotEnabled(): boolean {
    return this.snapshot.enabled;
  }

  snapshotStatus() {
    return this.snapshot.status();
  }

  start(): void {
    bus.onTyped('listings:changed', (changes) => this.onChanges(changes));
    bus.onTyped('opportunity', (ev) => this.onOpportunity(ev));
    this.timers.push(setInterval(() => this.runBanking(), 10 * 60_000));
    this.timers.push(setInterval(() => this.runKeys(), 5 * 60_000));
    this.timers.push(setInterval(() => this.maintenance(), 5 * 60_000));
    this.timers.push(setInterval(() => this.runScmKeys(), 10 * 60_000));
    this.timers.push(setInterval(() => this.runCash(), 10 * 60_000));
    this.timers.push(setInterval(() => void this.runPortfolioSnapshot(), 60 * 60_000));
    setTimeout(() => this.runKeys(), 20_000);
    setTimeout(() => this.runBanking(), 90_000);
    setTimeout(() => this.runScmKeys(), 120_000);
    setTimeout(() => this.runCash(), 150_000);
    setTimeout(() => void this.runPortfolioSnapshot(), 30_000);
    this.snapshot.start();
    // Re-evaluate what was still active from the previous run (the market or the rules may have changed).
    setTimeout(() => this.reevaluateActive(), 5_000);
    log.info('engine started');
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.snapshot.stop();
  }

  private onChanges(changes: Map<string, SkuChange>): void {
    for (const [sku, c] of changes) {
      const p = this.pending.get(sku);
      if (p) {
        p.sellIds.push(...c.sellIds);
        p.deletedIds.push(...c.deletedIds);
        p.buyChanged ||= c.buyChanged;
      } else {
        this.pending.set(sku, { ...c, sellIds: [...c.sellIds], deletedIds: [...c.deletedIds] });
      }
    }
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 300);
  }

  private flush(): void {
    this.flushTimer = null;
    const batch = this.pending;
    this.pending = new Map();
    const s = this.settings.get();
    const t0 = Date.now();
    let n = 0;
    for (const [sku, c] of batch) {
      try {
        for (const id of c.deletedIds) this.opps.expireByListing(id, 'listing removed');
        this.snipe.evaluate(sku, s);
        this.unusual.evaluate(sku, s);
        n++;
      } catch (err) {
        log.error(`error evaluating ${sku}`, err);
      }
    }
    this.evaluated += n;
    const dt = Date.now() - t0;
    if (dt > 2000) log.warn(`slow evaluation: ${n} SKUs in ${dt} ms`);
  }

  reevaluateActive(): void {
    const s = this.settings.get();
    const skus = new Set(this.opps.active(undefined, 1000).filter((o) => o.lane !== 'banking' && o.lane !== 'scm_keys' && o.lane !== 'cash').map((o) => o.sku));
    for (const sku of skus) {
      try {
        this.snipe.evaluate(sku, s);
        this.unusual.evaluate(sku, s);
      } catch (err) {
        log.error(`error re-evaluating ${sku}`, err);
      }
    }
    if (skus.size) log.info(`re-evaluated ${skus.size} SKUs with previous opportunities`);
  }

  runBanking(): void {
    try {
      const n = this.banking.run(this.settings.get());
      log.info(`banking: ${n} items proposed (out of ${this.banking.lastCandidates} candidates)`);
    } catch (err) {
      log.error('banking error', err);
    }
  }

  runScmKeys(): void {
    try {
      const n = this.scmKeys.run(this.settings.get());
      log.info(`SCM → keys: ${n} opportunities (${this.scmKeys.lastCandidates} candidates, ${this.scmKeys.pendingVerification} pending verification on the Market)`);
    } catch (err) {
      log.error('SCM → keys error', err);
    }
  }

  runCash(): void {
    try {
      const n = this.cash.run(this.settings.get());
      if (this.cash.lastCandidates) log.info(`cash → keys: ${n} opportunities out of ${this.cash.lastCandidates} USD listings`);
    } catch (err) {
      log.error('cash error', err);
    }
  }

  /** The user's backpack value (backpack.tf IGetUsers), once a day. */
  async runPortfolioSnapshot(): Promise<void> {
    if (!env.STEAM_ID64 || !this.bptfApi.enabled) return;
    const last = this.ledger.snapshots(1)[0];
    if (last && last.ts > now() - 23 * 3600) return;
    const user = await this.bptfApi.getUser(env.STEAM_ID64);
    const valueRef = user?.backpack_value?.['440'];
    if (valueRef === undefined) return;
    this.ledger.addSnapshot(valueRef, this.prices.refToUsd(valueRef), null, 'backpack.tf');
    log.info(`backpack value: ${valueRef.toFixed(2)} ref (${user?.name ?? env.STEAM_ID64})`);
  }

  runKeys(): void {
    try {
      const b = this.keys.run(this.settings.get());
      log.info(`keys: pricedb ${b.pricedbBuyRef}/${b.pricedbSellRef} ref · bptf best buy ${b.bestBuyRef?.toFixed(2) ?? '-'} / best sell ${b.bestSellRef?.toFixed(2) ?? '-'} · SCM $${b.scmUsdLow ?? '-'}`);
    } catch (err) {
      log.error('keys error', err);
    }
  }

  maintenance(): void {
    try {
      const ts = now();
      const expired = this.opps.expireStale(ts);
      const pruned = this.opps.prune(3 * 86400, ts);
      const churn = this.store.pruneChurn(ts - 8 * 86400);
      const deleted = this.store.deleteInactiveListings(3 * 86400, ts);
      log.debug(`maintenance: ${expired} opps expired, ${pruned} pruned, churn ${churn}, listings deleted ${deleted}`);
    } catch (err) {
      log.error('maintenance error', err);
    }
  }

  private onOpportunity(ev: { id: number; lane: string; sku: string; status: string; isNew: boolean; improved: boolean }): void {
    if (ev.isNew && ev.lane !== 'banking') this.snapshot.request(ev.sku, 0, 60);
    if (!(ev.isNew || ev.improved)) return;
    const s = this.settings.get();
    const row = this.opps.get(ev.id);
    if (!row) return;
    const lane = row.lane;
    const toDiscord = s.alerts.discordLanes.includes(lane) && this.discord.enabled;
    const toDesktop = s.alerts.desktopLanes.includes(lane) && this.desktopAlertsActive();
    if (!toDiscord && !toDesktop) return;
    if (lane === 'banking') return; // banking is checked in the dashboard, not alerted per item
    if (row.confidence < s.alerts.minConfidence) return; // low confidence: dashboard only
    const k = this.prices.keyRef();
    const netText = `${fmtKeysMetal(row.net_ref ?? 0, k)} (${fmtUsd(row.net_usd ?? 0)}, ${(row.pct ?? 0).toFixed(1)} %)`;
    if (toDesktop) desktopNotify(`${LANE_LABELS[lane]} · +${netText}`, row.title, lane === 'snipe' ? 'critical' : 'normal');
    if (toDiscord) {
      this.discord.send({ embeds: [this.embedFor(row, netText)] });
      this.alertsSent++;
    }
    this.opps.markAlerted(row.id);
  }

  /** Desktop notifications: master switch + temporary mute. */
  desktopAlertsActive(): boolean {
    const a = this.settings.get().alerts;
    return a.desktopEnabled && a.desktopMutedUntil <= now();
  }

  private embedFor(row: OppRow, netText: string): DiscordEmbed {
    const d = row.details ? (JSON.parse(row.details) as Record<string, any>) : {};
    const fields: DiscordEmbed['fields'] = [
      { name: 'Net profit', value: netText, inline: true },
      { name: 'Confidence', value: `${Math.round(row.confidence * 100)} %`, inline: true },
    ];
    if (d.buy?.priceText) fields.push({ name: 'Buy', value: `${d.buy.priceText} from ${d.buy.seller?.name ?? '?'}${d.buy.seller?.isBot ? ' (bot)' : ''}`, inline: false });
    if (d.sell?.priceText) fields.push({ name: 'Sell', value: `${d.sell.priceText}${d.sell.buyer?.name ? ' to ' + d.sell.buyer.name + (d.sell.buyer.isBot ? ' (bot)' : '') : ''}`, inline: false });
    const links: string[] = [];
    if (d.links?.sellerTradeOffer) links.push(`[Trade offer to seller](${d.links.sellerTradeOffer})`);
    if (d.sell?.buyer?.tradeUrl) links.push(`[Trade offer to buyer](${d.sell.buyer.tradeUrl})`);
    if (d.links?.classifieds) links.push(`[Classifieds](${d.links.classifieds})`);
    if (d.links?.pricedb) links.push(`[pricedb](${d.links.pricedb})`);
    if (links.length) fields.push({ name: 'Links', value: links.join(' · '), inline: false });
    if (d.suspicious) fields.push({ name: '⚠️ Warning', value: `The listing mentions "${d.suspicious}"`, inline: false });
    return {
      title: `${LANE_LABELS[row.lane]} · ${row.title}`.slice(0, 250),
      url: d.links?.classifieds,
      color: LANE_COLORS[row.lane],
      fields,
      thumbnail: d.item?.imageUrl ? { url: String(d.item.imageUrl).startsWith('http') ? d.item.imageUrl : `https://backpack.tf${d.item.imageUrl}` } : undefined,
      footer: { text: `TF2 Scout · ${row.sku}` },
      timestamp: new Date().toISOString(),
    };
  }
}
