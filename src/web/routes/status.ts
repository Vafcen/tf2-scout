import type { Hono } from 'hono';
import type { AppContext } from '../../app.ts';
import { layout } from '../layout.ts';
import { html, fmtAgo, fmtDate } from '../html.ts';
import { statusFor } from '../server.ts';
import { env } from '../../config.ts';
import { botPulse } from '../../engine/botPulse.ts';

export function statusRoutes(hono: Hono, app: AppContext): void {
  const snapshot = () => {
    const q = <T,>(sql: string) => app.db.get<T>(sql)!;
    const listings = q<{ n: number; act: number; sells: number; bots: number }>("SELECT COUNT(*) n, SUM(active) act, SUM(active AND intent='sell') sells, SUM(is_bot) bots FROM listings");
    const items = q<{ n: number }>('SELECT COUNT(*) n FROM items');
    const refs = q<{ pdb: number; bptf: number }>("SELECT SUM(src='pricedb') pdb, SUM(src='bptf') bptf FROM ref_prices");
    const scm = q<{ n: number }>('SELECT COUNT(*) n FROM scm_prices');
    const opps = q<{ act: number; total: number }>("SELECT SUM(status IN ('new','alerted')) act, COUNT(*) total FROM opportunities");
    const churn = q<{ skus: number }>('SELECT COUNT(DISTINCT sku) skus FROM churn WHERE hour_ts >= strftime(\'%s\',\'now\') - 86400');
    const dbSize = app.db.get<{ s: number }>('SELECT page_count * page_size s FROM pragma_page_count(), pragma_page_size()')?.s ?? 0;
    return {
      ws: { connected: app.ws.connected, eventsPerMin: app.ws.eventsPerMin(), totalEvents: app.ws.totalEvents, lastEventAt: app.ws.lastEventAt },
      pricedb: { lastSyncAt: app.pricedb.lastSyncAt, count: app.pricedb.lastCount },
      scm: { lastKeyAt: app.scm.lastKeyAt, requests: app.scm.requests, rateLimited: app.scm.rateLimited },
      engine: {
        evaluated: app.engine.evaluated, alertsSent: app.engine.alertsSent, startedAt: app.engine.startedAt,
        bankingLastRunAt: app.engine.banking.lastRunAt, bankingResults: app.engine.banking.lastResults,
        scmKeys: { lastRunAt: app.engine.scmKeys.lastRunAt, results: app.engine.scmKeys.lastResults, candidates: app.engine.scmKeys.lastCandidates, pending: app.engine.scmKeys.pendingVerification },
        cash: { lastRunAt: app.engine.cash.lastRunAt, results: app.engine.cash.lastResults, candidates: app.engine.cash.lastCandidates },
        snapshot: app.engine.snapshotStatus(),
      },
      discord: { enabled: app.engine.discord.enabled, sent: app.engine.discord.sent, failed: app.engine.discord.failed },
      db: { listings, items: items.n, refs, scm: scm.n, opps, activeSkus24h: churn.skus, sizeMb: Math.round(dbSize / 1048576 * 10) / 10, botsSeen: botPulse.size() },
      config: { bptfToken: !!env.BPTF_TOKEN, bptfApiKey: !!env.BPTF_API_KEY, steamId: !!env.STEAM_ID64, discord: !!env.DISCORD_WEBHOOK_URL, stn: !!env.STN_API_KEY, dataDir: env.DATA_DIR, port: env.PORT },
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      uptimeSec: Math.round(process.uptime()),
    };
  };

  hono.get('/status', (c) => {
    const s = snapshot();
    const yes = (b: boolean) => (b ? '✅' : '—');
    const body = html`
      <h1>System status</h1>
      <div class="grid">
        <div class="kpi"><div class="label">backpack.tf feed</div><div class="value">${s.ws.connected ? 'connected' : 'disconnected'}</div><div class="small muted">${s.ws.eventsPerMin} events/min · ${s.ws.totalEvents} total · last ${fmtAgo(s.ws.lastEventAt)}</div></div>
        <div class="kpi"><div class="label">pricedb</div><div class="value">${s.pricedb.count} SKUs</div><div class="small muted">synced ${fmtAgo(s.pricedb.lastSyncAt)}</div></div>
        <div class="kpi"><div class="label">Steam Market</div><div class="value">${s.scm.requests} queries</div><div class="small muted">key ${fmtAgo(s.scm.lastKeyAt)} · ${s.scm.rateLimited} rate limits</div></div>
        <div class="kpi"><div class="label">bptf snapshot</div><div class="value">${s.engine.snapshot.enabled ? s.engine.snapshot.done + ' done' : 'no token'}</div><div class="small muted">${s.engine.snapshot.enabled ? `queue ${s.engine.snapshot.queued} · errors ${s.engine.snapshot.errors} · last ${fmtAgo(s.engine.snapshot.lastAt)}` : 'add BPTF_TOKEN to .env'}</div></div>
        <div class="kpi"><div class="label">Engine</div><div class="value">${s.engine.evaluated} evaluations</div><div class="small muted">started ${fmtDate(s.engine.startedAt)} · banking ${fmtAgo(s.engine.bankingLastRunAt)} (${s.engine.bankingResults} items) · SCM→keys ${fmtAgo(s.engine.scmKeys.lastRunAt)} (${s.engine.scmKeys.results} of ${s.engine.scmKeys.candidates}, ${s.engine.scmKeys.pending} pending verification) · cash ${s.engine.cash.candidates} USD listings</div></div>
        <div class="kpi"><div class="label">Alerts</div><div class="value">${s.engine.alertsSent}</div><div class="small muted">Discord ${s.discord.enabled ? `${s.discord.sent} sent · ${s.discord.failed} failed` : 'not configured'}</div></div>
        <div class="kpi"><div class="label">Database</div><div class="value">${s.db.sizeMb} MB</div><div class="small muted">${s.db.listings.act} active listings (${s.db.listings.sells} sells) · ${s.db.items} items · ${s.db.activeSkus24h} active SKUs 24 h · ${s.db.botsSeen} bots seen</div></div>
        <div class="kpi"><div class="label">Process</div><div class="value">${s.memoryMb} MB RAM</div><div class="small muted">uptime ${Math.floor(s.uptimeSec / 3600)} h ${Math.floor((s.uptimeSec % 3600) / 60)} min</div></div>
      </div>
      <div class="card"><h2>Configuration (.env)</h2>
        <table>
          <tr><th>BPTF_TOKEN</th><td>${yes(s.config.bptfToken)} order book snapshot</td></tr>
          <tr><th>BPTF_API_KEY</th><td>${yes(s.config.bptfApiKey)} suggested prices / backpack value</td></tr>
          <tr><th>STEAM_ID64</th><td>${yes(s.config.steamId)} daily value of your backpack</td></tr>
          <tr><th>DISCORD_WEBHOOK_URL</th><td>${yes(s.config.discord)} alerts on your phone</td></tr>
          <tr><th>STN_API_KEY</th><td>${yes(s.config.stn)} keys board (STN)</td></tr>
          <tr><th>Data</th><td class="mono">${s.config.dataDir}</td></tr>
        </table>
      </div>`;
    return c.html(layout({ title: 'Status', active: '/status', body, status: statusFor(app) }));
  });

  hono.get('/api/status', (c) => c.json(snapshot()));
  hono.get('/health', (c) => c.text('OK'));
}
