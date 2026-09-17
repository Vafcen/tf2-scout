import type { Hono } from 'hono';
import type { AppContext } from '../../app.ts';
import { layout } from '../layout.ts';
import { html, raw, fmtAgo } from '../html.ts';
import { statusFor } from '../server.ts';
import { fmtUsd } from '../../tf2/currencies.ts';
import { oppTable } from './opportunities.ts';

export function keysRoutes(hono: Hono, app: AppContext): void {
  hono.get('/keys', (c) => {
    const b = app.engine.keys.last ?? app.engine.keys.run(app.engine.settings.get());
    const usdPerRef = b.bptfUsd && b.bptfRef ? b.bptfUsd / b.bptfRef : null;
    const scmNetPerRef = b.scmSellerNetUsd && b.pricedbSellRef ? b.scmSellerNetUsd / b.pricedbSellRef : null;
    const history = app.db.all<{ ts: number; pricedb_sell_ref: number | null; bptf_ref: number | null; scm_usd_low: number | null; bptf_usd: number | null }>(
      'SELECT ts, pricedb_sell_ref, bptf_ref, scm_usd_low, bptf_usd FROM key_rates ORDER BY ts DESC LIMIT 48',
    );
    const body = html`
      <h1>Key dashboard</h1>
      <div class="grid">
        <div class="kpi"><div class="label">pricedb (bots) buy / sell</div><div class="value">${b.pricedbBuyRef ?? '—'} / ${b.pricedbSellRef ?? '—'} ref</div></div>
        <div class="kpi"><div class="label">backpack.tf (derived from feed)</div><div class="value">${b.bptfRef ?? '—'} ref</div><div class="small muted">≈ ${b.bptfUsd ? fmtUsd(b.bptfUsd) : '—'} per key in cash (bptf reference)</div></div>
        <div class="kpi"><div class="label">Best buy order on bptf (bots online)</div><div class="value">${b.bestBuyRef ? b.bestBuyRef.toFixed(2) + ' ref' : '—'}</div><div class="small muted">${b.bestBuyBy ?? ''} · ${b.buyOrders} buy orders</div></div>
        <div class="kpi"><div class="label">Best sell listing on bptf</div><div class="value">${b.bestSellRef ? b.bestSellRef.toFixed(2) + ' ref' : '—'}</div><div class="small muted">${b.bestSellBy ?? ''} · ${b.sellListings} sells</div></div>
        <div class="kpi"><div class="label">Steam Market (wallet)</div><div class="value">${b.scmUsdLow ? fmtUsd(b.scmUsdLow) : '—'}</div><div class="small muted">median ${b.scmUsdMedian ? fmtUsd(b.scmUsdMedian) : '—'} · vol. ${b.scmVolume ?? '—'}/day · selling nets you ${b.scmSellerNetUsd ? fmtUsd(b.scmSellerNetUsd) : '—'}</div></div>
        <div class="kpi"><div class="label">Ref value</div><div class="value">${usdPerRef ? '$' + usdPerRef.toFixed(4) : '—'}</div><div class="small muted">cash (bptf) · in SCM wallet ${scmNetPerRef ? '$' + scmNetPerRef.toFixed(4) : '—'}</div></div>
      </div>
      <div class="card">
        <h2>How to read this</h2>
        <ul class="small">
          <li><b>Key flip on bptf</b>: if the best sell listing is below the best buy order, there is an immediate profit (it shows up below as a "Keys" opportunity).</li>
          <li><b>Wallet → keys</b>: buying keys on the Steam Market costs ${b.scmUsdLow ? fmtUsd(b.scmUsdLow) : '—'} of wallet; the "SCM → keys" tab (phase 5) looks for items that yield more keys per dollar.</li>
          <li><b>Cash</b>: backpack.tf values the key at ${b.bptfUsd ? fmtUsd(b.bptfUsd) : '—'} (marketplace.tf price); selling keys on SCM yields ${b.scmSellerNetUsd ? fmtUsd(b.scmSellerNetUsd) : '—'} but as Steam wallet balance, not real money.</li>
        </ul>
      </div>
      <h2>Key opportunities</h2>
      ${raw(oppTable(app, { lane: 'keys', minNet: 0, minConf: 0, maxPriceKeys: 0, includeSuspicious: true }, app.engine.opps.active('keys', 50)))}
      <h2>Recent history</h2>
      <table><thead><tr><th>When</th><th class="num">pricedb sell</th><th class="num">bptf</th><th class="num">SCM</th><th class="num">cash/key</th></tr></thead>
      <tbody>${history.map((h) => html`<tr><td>${fmtAgo(h.ts)}</td><td class="num">${h.pricedb_sell_ref ?? '—'}</td><td class="num">${h.bptf_ref ?? '—'}</td><td class="num">${h.scm_usd_low ? fmtUsd(h.scm_usd_low) : '—'}</td><td class="num">${h.bptf_usd ? fmtUsd(h.bptf_usd) : '—'}</td></tr>`)}</tbody></table>`;
    return c.html(layout({ title: 'Keys', active: '/keys', body, status: statusFor(app) }));
  });
  hono.get('/api/keys', (c) => c.json(app.engine.keys.last));
}
