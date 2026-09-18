import type { Hono } from 'hono';
import type { AppContext } from '../../app.ts';
import { layout } from '../layout.ts';
import { html, raw, pctText } from '../html.ts';
import { statusFor } from '../server.ts';
import { LANE_LABELS } from '../../engine/index.ts';
import type { Lane } from '../../config.ts';
import { now } from '../../db/store.ts';
import { CHECK_OFFSETS } from '../../engine/checks.ts';

interface LaneRow { lane: Lane; created: number; alerted: number; offered: number; executed: number; rejected: number; expired: number; med_life: number | null; verified: number }
interface CaptureRow { key: string; offset_sec: number; n: number; alive: number }

export function computeStats(app: AppContext, days: number) {
  const since = now() - days * 86400;
  const lanes = app.db.all<LaneRow>(
    `SELECT lane,
       COUNT(*) created,
       SUM(alerted_at IS NOT NULL) alerted,
       SUM(status IN ('offered','executed','rejected')) offered,
       SUM(status = 'executed') executed,
       SUM(status = 'rejected') rejected,
       SUM(status = 'expired') expired,
       SUM(COALESCE(json_extract(details, '$.verified'), 0)) verified,
       NULL med_life
     FROM opportunities WHERE created_at >= ? GROUP BY lane ORDER BY created DESC`, since,
  );
  for (const l of lanes) {
    const lives = app.db.all<{ life: number }>(
      `SELECT json_extract(details, '$.lifeSec') life FROM opportunities WHERE lane = ? AND status = 'expired' AND created_at >= ? AND json_extract(details, '$.lifeSec') IS NOT NULL ORDER BY life`, l.lane, since,
    );
    l.med_life = lives.length ? lives[Math.floor(lives.length / 2)].life : null;
  }
  const captureBy = (expr: string): CaptureRow[] => app.db.all<CaptureRow>(
    `SELECT ${expr} key, c.offset_sec, COUNT(*) n, SUM(c.verdict = 'alive') alive
     FROM opp_checks c JOIN opportunities o ON o.id = c.opp_id
     WHERE o.created_at >= ? GROUP BY key, c.offset_sec ORDER BY key, c.offset_sec`, since,
  );
  const byLane = captureBy('o.lane');
  const byFamily = captureBy("COALESCE(json_extract(o.details, '$.sell.buyer.family'), '—')");
  const byBucket = captureBy("CASE WHEN o.buy_price_ref < 10 THEN 'a: < 10 ref' WHEN o.buy_price_ref < 60 THEN 'b: 10–60 ref' WHEN o.buy_price_ref < 300 THEN 'c: 1–5 keys' ELSE 'd: > 5 keys' END");
  const byHour = captureBy("strftime('%H', o.created_at, 'unixepoch')");
  const verdicts = app.db.all<{ verdict: string; offset_sec: number; n: number }>(
    `SELECT c.verdict, c.offset_sec, COUNT(*) n FROM opp_checks c JOIN opportunities o ON o.id = c.opp_id WHERE o.created_at >= ? GROUP BY c.verdict, c.offset_sec`, since,
  );
  const trades = app.db.get<{ n: number; opps: number }>(
    `SELECT COUNT(*) n, COUNT(DISTINCT opportunity_id) opps FROM trades WHERE ts >= ? AND opportunity_id IS NOT NULL`, since,
  );
  return { days, lanes, byLane, byFamily, byBucket, byHour, verdicts, trades, pnl: app.engine.ledger.summary() };
}

function captureTable(title: string, rows: CaptureRow[]): string {
  const keys = [...new Set(rows.map((r) => r.key))];
  if (!keys.length) return '';
  const cell = (key: string, off: number) => {
    const r = rows.find((x) => x.key === key && x.offset_sec === off);
    if (!r || !r.n) return '—';
    return `${Math.round((r.alive / r.n) * 100)} % <span class="muted small">(${r.alive}/${r.n})</span>`;
  };
  return html`<div class="card"><h2>${title}</h2><table><thead><tr><th></th>${CHECK_OFFSETS.map((o) => html`<th class="num">still takeable at +${o >= 60 ? `${o / 60} min` : `${o} s`}</th>`)}</tr></thead>
    <tbody>${keys.map((k) => html`<tr><td>${k}</td>${CHECK_OFFSETS.map((o) => raw(`<td class="num">${cell(k, o)}</td>`))}</tr>`)}</tbody></table></div>`.html;
}

export function statsRoutes(hono: Hono, app: AppContext): void {
  hono.get('/stats', (c) => {
    const days = Math.max(1, Math.min(90, Number(c.req.query('days') ?? 7) || 7));
    const s = computeStats(app, days);
    const k = app.engine.prices.keyRef();
    const body = html`
      <h1>Stats</h1>
      <form class="filters" method="get" action="/stats"><label>Window (days) <input type="number" name="days" value="${days}" min="1" max="90"></label><button type="submit">Apply</button></form>
      <div class="grid">
        <div class="kpi"><div class="label">Opportunities created</div><div class="value">${s.lanes.reduce((a, l) => a + l.created, 0)}</div><div class="small muted">${s.lanes.reduce((a, l) => a + l.alerted, 0)} alerted · ${s.lanes.reduce((a, l) => a + l.verified, 0)} verified by snapshot</div></div>
        <div class="kpi"><div class="label">You acted on</div><div class="value">${s.lanes.reduce((a, l) => a + l.offered, 0)}</div><div class="small muted">${s.lanes.reduce((a, l) => a + l.executed, 0)} executed · ${s.lanes.reduce((a, l) => a + l.rejected, 0)} rejected/gone</div></div>
        <div class="kpi"><div class="label">Trades logged from opportunities</div><div class="value">${s.trades?.n ?? 0}</div><div class="small muted">${s.trades?.opps ?? 0} opportunities · realized P&L (all time) ${s.pnl.realizedRef >= 0 ? '+' : ''}${s.pnl.realizedRef.toFixed(2)} ref</div></div>
        <div class="kpi"><div class="label">Post-alert checks</div><div class="value">${app.engine.checks.done}</div><div class="small muted">${app.engine.checks.scheduled} scheduled · ${app.engine.droppedDuringVerification} dropped during verification</div></div>
      </div>
      <div class="card"><h2>By lane (last ${days} days)</h2>
        <table><thead><tr><th>Lane</th><th class="num">Created</th><th class="num">Alerted</th><th class="num">Verified</th><th class="num">Offered</th><th class="num">Executed</th><th class="num">Rejected</th><th class="num">Expired</th><th class="num">Median life</th><th class="num">Win rate</th></tr></thead>
        <tbody>${s.lanes.map((l) => html`<tr><td><span class="tag ${l.lane}">${LANE_LABELS[l.lane] ?? l.lane}</span></td><td class="num">${l.created}</td><td class="num">${l.alerted}</td><td class="num">${l.verified}</td><td class="num">${l.offered}</td><td class="num">${l.executed}</td><td class="num">${l.rejected}</td><td class="num">${l.expired}</td><td class="num">${l.med_life !== null ? (l.med_life >= 60 ? `${Math.round(l.med_life / 60)} min` : `${l.med_life} s`) : '—'}</td><td class="num">${l.offered ? pctText((l.executed / l.offered) * 100) : '—'}</td></tr>`)}</tbody></table>
        <p class="small muted">Win rate = executed / (offered + executed + rejected). It only means something if you press "Offer sent" and then "Executed" or "Rejected" on every opportunity you act on.</p>
      </div>
      ${raw(captureTable('Capture by lane (was it still takeable when re-checked?)', s.byLane))}
      ${raw(captureTable('Capture by buyer family (the exit)', s.byFamily))}
      ${raw(captureTable('Capture by cost bucket', s.byBucket))}
      ${raw(captureTable('Capture by hour of day (UTC)', s.byHour))}
      <div class="card"><h2>Why opportunities die</h2>
        <table><thead><tr><th>Verdict</th>${CHECK_OFFSETS.map((o) => html`<th class="num">+${o} s</th>`)}</tr></thead>
        <tbody>${['alive', 'sell_gone', 'buyer_gone', 'buyer_repriced', 'unprofitable'].map((v) => html`<tr><td>${v}</td>${CHECK_OFFSETS.map((o) => html`<td class="num">${s.verdicts.find((x) => x.verdict === v && x.offset_sec === o)?.n ?? 0}</td>`)}</tr>`)}</tbody></table>
        <p class="small muted">sell_gone = the seller's listing disappeared (sold or withdrawn) · buyer_gone = the buy order disappeared · buyer_repriced = the buy order dropped below the alerted price · unprofitable = still there but the margin is below your minimum. Checks marked as verified ran right after a fresh classifieds snapshot; without a BPTF_TOKEN they rely on the live feed only.</p>
      </div>
      <p class="small muted">Key rate used for ref conversions: ${k.toFixed(2)} ref.</p>`;
    return c.html(layout({ title: 'Stats', active: '/stats', body, status: statusFor(app) }));
  });
  hono.get('/api/stats', (c) => c.json(computeStats(app, Math.max(1, Math.min(90, Number(c.req.query('days') ?? 7) || 7)))));
  hono.get('/api/checks/:oppId', (c) => c.json(app.db.all('SELECT * FROM opp_checks WHERE opp_id = ? ORDER BY offset_sec', Number(c.req.param('oppId')))));
}
