import type { Hono } from 'hono';
import type { AppContext } from '../../app.ts';
import { layout } from '../layout.ts';
import { html, raw, fmtAgo, esc } from '../html.ts';
import { statusFor } from '../server.ts';
import { fmtKeysMetal, fmtUsd } from '../../tf2/currencies.ts';

export function bankingRoutes(hono: Hono, app: AppContext): void {
  hono.get('/banking', (c) => {
    const k = app.engine.prices.keyRef();
    const s = app.engine.settings.get();
    const rows = app.engine.opps.active('banking', 500).sort((a, b) => {
      const da = a.details ? (JSON.parse(a.details) as { score?: number }).score ?? 0 : 0;
      const db = b.details ? (JSON.parse(b.details) as { score?: number }).score ?? 0 : 0;
      return db - da;
    });
    const body = html`
      <h1>Manual banking</h1>
      <p class="small muted">Items with spread and turnover where you can place a buy order just above the best one and a sell listing just below the best one. Recalculated every 10 minutes from the last 24 h of activity (last run: ${fmtAgo(app.engine.banking.lastRunAt)}; ${app.engine.banking.lastCandidates} candidates). Settings: spread ≥ ${s.banking.minSpreadRef} ref and ≥ ${s.banking.minSpreadPct} %, activity ≥ ${s.banking.minChurn24h}, price ≤ ${s.maxItemPriceKeys || '∞'} keys.</p>
      <div class="row"><form method="post" action="/banking/run"><button type="submit" class="secondary">Recalculate now</button></form></div>
      ${rows.length ? html`<table><thead><tr><th>#</th><th>Item</th><th class="num">Place buy order at</th><th class="num">Sell at</th><th class="num">Net/cycle</th><th class="num">Spread</th><th class="num">Activity 24 h</th><th class="num">Book</th><th>Links</th></tr></thead><tbody>
        ${rows.map((r, i) => {
          const d = r.details ? (JSON.parse(r.details) as Record<string, any>) : {};
          const img = d.item?.imageUrl ? (String(d.item.imageUrl).startsWith('http') ? d.item.imageUrl : `https://backpack.tf${d.item.imageUrl}`) : null;
          return html`<tr>
            <td class="muted">${i + 1}</td>
            <td>${img ? raw(`<img class="icon" src="${esc(img)}" alt="">`) : ''}<a href="/item/${encodeURIComponent(r.sku)}">${d.item?.name ?? r.sku}</a></td>
            <td class="num"><b>${fmtKeysMetal(r.buy_price_ref ?? 0, k)}</b><div class="small muted">current best ${fmtKeysMetal(d.book?.bestBuyRef ?? 0, k)} (${d.book?.bestBuyer ?? ''})</div></td>
            <td class="num"><b>${fmtKeysMetal(r.sell_price_ref ?? 0, k)}</b><div class="small muted">current best ${fmtKeysMetal(d.book?.bestSellRef ?? 0, k)} (${d.book?.bestSeller ?? ''})</div></td>
            <td class="num pos">+${fmtKeysMetal(r.net_ref ?? 0, k)}<div class="small muted">${fmtUsd(r.net_usd ?? 0)} · ${(r.pct ?? 0).toFixed(1)} %</div></td>
            <td class="num">${(d.book?.spreadPct ?? 0).toFixed(1)} %</td>
            <td class="num">${d.churn24h?.sellDeletes ?? 0} sold*<div class="small muted">${d.churn24h?.sellUpdates ?? 0} new sells · ${d.churn24h?.updates ?? 0} ev.</div></td>
            <td class="num">${d.book?.botBuysOnline ?? 0} bots / ${d.book?.buyOrders ?? 0} buys<div class="small muted">${d.book?.sells ?? 0} sells</div></td>
            <td class="small">${d.links?.classifieds ? raw(`<a href="${esc(d.links.classifieds)}" target="_blank" rel="noopener">classifieds ↗</a>`) : ''} ${d.links?.pricedb ? raw(`<a href="${esc(d.links.pricedb)}" target="_blank" rel="noopener">pricedb ↗</a>`) : ''}</td>
          </tr>`;
        })}
      </tbody></table><p class="small muted">* "sold" = sell listings removed in the last 24 h (a proxy for sales; includes removals without a sale).</p>` : raw('<div class="card muted">No proposals yet: the engine needs at least a few minutes of feed to measure activity. Check back in a while or click "Recalculate now".</div>')}`;
    return c.html(layout({ title: 'Banking', active: '/banking', body, status: statusFor(app) }));
  });

  hono.post('/banking/run', (c) => {
    app.engine.runBanking();
    return c.redirect('/banking');
  });
}
