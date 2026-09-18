import type { Hono } from 'hono';
import type { AppContext } from '../../app.ts';
import { layout } from '../layout.ts';
import { html, raw, fmtAgo, pctText, esc } from '../html.ts';
import { statusFor } from '../server.ts';
import { LANE_LABELS } from '../../engine/index.ts';
import type { Lane } from '../../config.ts';
import { fmtKeysMetal, fmtUsd } from '../../tf2/currencies.ts';
import type { OppRow } from '../../engine/opportunities.ts';

const LANES: Lane[] = ['snipe', 'deal', 'keys', 'unusual', 'cash', 'scm_keys', 'banking'];

interface Filters {
  lane: string;
  minNet: number;
  minConf: number;
  maxPriceKeys: number;
  includeSuspicious: boolean;
}

function parseFilters(q: Record<string, string | undefined>): Filters {
  return {
    lane: q.lane ?? '',
    minNet: Number(q.minNet ?? 0) || 0,
    minConf: Number(q.minConf ?? 0) || 0,
    maxPriceKeys: Number(q.maxPriceKeys ?? 0) || 0,
    includeSuspicious: q.suspicious === '1',
  };
}

export function oppTable(app: AppContext, f: Filters, rows: OppRow[]): string {
  const k = app.engine.prices.keyRef();
  const filtered = rows.filter((r) => {
    if (f.lane && r.lane !== f.lane) return false;
    if ((r.net_ref ?? 0) < f.minNet) return false;
    if (r.confidence < f.minConf / 100) return false;
    if (f.maxPriceKeys > 0 && (r.buy_price_ref ?? 0) > f.maxPriceKeys * k) return false;
    if (!f.includeSuspicious && r.details && r.details.includes('"suspicious":"')) return false;
    return true;
  });
  if (!filtered.length) {
    return html`<div class="card muted">No active opportunities match these filters. The feed keeps listening; new ones show up on their own.</div>`.html;
  }
  const trs = filtered.map((r) => {
    const d = r.details ? (JSON.parse(r.details) as Record<string, any>) : {};
    const img = d.item?.imageUrl ? (String(d.item.imageUrl).startsWith('http') ? d.item.imageUrl : `https://backpack.tf${d.item.imageUrl}`) : null;
    const seller = d.buy?.seller;
    const buyer = d.sell?.buyer;
    return html`<tr>
      <td><span class="tag ${r.lane}">${LANE_LABELS[r.lane]}</span></td>
      <td class="item">${img ? raw(`<img class="icon" src="${esc(img)}" alt="">`) : ''}<a href="/opp/${r.id}">${d.item?.name ?? r.sku}</a>
        ${d.suspicious ? raw('<span class="tag warn" title="Listing mentions ' + esc(d.suspicious) + '">⚠</span>') : ''}
        ${d.verified ? raw('<span class="tag bot" title="verified by classifieds snapshot">✓</span>') : ''}
        ${r.status === 'offered' ? raw('<span class="tag keys" title="you sent an offer">offered</span>') : ''}
        ${d.buy?.flags?.spells ? raw('<span class="tag bot" title="spells">✨ ' + esc((d.buy.flags.spells as string[]).join(', ')) + '</span>') : ''}
        ${d.buy?.flags?.paint ? raw('<span class="tag bot" title="painted">🎨 ' + esc(d.buy.flags.paint) + '</span>') : ''}
      </td>
      <td class="num">${r.buy_venue === 'scm' || r.buy_venue === 'marketplace.tf' ? (r.buy_price_usd !== null ? fmtUsd(r.buy_price_usd) : '—') : (r.buy_price_ref !== null ? fmtKeysMetal(r.buy_price_ref, k) : '—')}<div class="small muted">${seller ? (seller.isBot ? '🤖 ' : '👤 ') + (seller.name ?? '') : (r.buy_venue === 'scm' ? 'Steam Market' : (r.buy_venue ?? ''))}</div></td>
      <td class="num">${r.sell_price_ref !== null ? fmtKeysMetal(r.sell_price_ref, k) : '—'}<div class="small muted">${buyer ? (buyer.isBot ? '🤖 ' : '👤 ') + (buyer.name ?? '') + (buyer.family ? ` · ${buyer.family}` : '') + (buyer.room !== null && buyer.room !== undefined ? ` · room ${buyer.room}` : '') : (d.sell?.note ?? r.sell_venue ?? '')}</div></td>
      <td class="num"><span class="pos">+${fmtKeysMetal(r.net_ref ?? 0, k)}</span><div class="small muted">${fmtUsd(r.net_usd ?? 0)} · ${pctText(r.pct)}</div></td>
      <td class="num"><span class="conf" title="${Math.round(r.confidence * 100)} %"><i style="width:${Math.round(r.confidence * 100)}%"></i></span></td>
      <td class="num small muted" title="created ${fmtAgo(r.created_at)} · updated ${fmtAgo(r.updated_at)}">${fmtAgo(r.updated_at)}</td>
      <td class="small">
        ${d.links?.sellerTradeOfferForItem ? raw(`<a href="${esc(d.links.sellerTradeOfferForItem)}" target="_blank" rel="noopener" title="opens the trade window with the seller's item preloaded">Offer ↗</a> `) : d.links?.sellerTradeOffer ? raw(`<a href="${esc(d.links.sellerTradeOffer)}" target="_blank" rel="noopener">Offer ↗</a> `) : ''}
        ${d.links?.classifieds ? raw(`<a href="${esc(d.links.classifieds)}" target="_blank" rel="noopener">bptf ↗</a>`) : ''}
      </td>
    </tr>`.html;
  });
  return `<table><thead><tr><th>Lane</th><th>Item</th><th class="num">Buy</th><th class="num">Sell</th><th class="num">Net</th><th class="num">Conf.</th><th class="num">Age</th><th>Links</th></tr></thead><tbody>${trs.join('')}</tbody></table>`;
}

export function opportunityRoutes(hono: Hono, app: AppContext): void {
  hono.get('/', (c) => {
    const f = parseFilters(c.req.query());
    const rows = app.engine.opps.active(undefined, 300);
    const qs = new URLSearchParams(c.req.query()).toString();
    const body = html`
      <h1>Active opportunities</h1>
      <form class="filters" method="get" action="/">
        <label>Lane <select name="lane"><option value="">All</option>${LANES.map((l) => raw(`<option value="${l}" ${f.lane === l ? 'selected' : ''}>${LANE_LABELS[l]}</option>`))}</select></label>
        <label>Min. net (ref) <input type="number" step="0.11" name="minNet" value="${f.minNet}"></label>
        <label>Min. confidence (%) <input type="number" name="minConf" value="${f.minConf}" min="0" max="100"></label>
        <label>Max. price (keys) <input type="number" step="0.5" name="maxPriceKeys" value="${f.maxPriceKeys}"></label>
        <label>Suspicious <select name="suspicious"><option value="0" ${!f.includeSuspicious ? 'selected' : ''}>hide</option><option value="1" ${f.includeSuspicious ? 'selected' : ''}>show</option></select></label>
        <button type="submit">Filter</button>
      </form>
      <div id="opps" hx-get="/partials/opportunities?${raw(esc(qs))}" hx-trigger="every 5s, refresh from:body" hx-swap="innerHTML">
        ${raw(oppTable(app, f, rows))}
      </div>
      <p class="small muted">Opportunities expire on their own when the listing disappears or after ${app.engine.settings.get().alerts.oppTtlMin} min without confirmation. Banking opportunities are listed on their own tab.</p>
    `;
    return c.html(layout({ title: 'Opportunities', active: '/', body, status: statusFor(app) }));
  });

  hono.get('/partials/opportunities', (c) => {
    const f = parseFilters(c.req.query());
    return c.html(oppTable(app, f, app.engine.opps.active(undefined, 300)));
  });

  hono.get('/opp/:id', (c) => {
    const id = Number(c.req.param('id'));
    const r = app.engine.opps.get(id);
    if (!r) return c.text('Not found', 404);
    const d = r.details ? (JSON.parse(r.details) as Record<string, any>) : {};
    const k = app.engine.prices.keyRef();
    const img = d.item?.imageUrl ? (String(d.item.imageUrl).startsWith('http') ? d.item.imageUrl : `https://backpack.tf${d.item.imageUrl}`) : null;
    const links = Object.entries((d.links ?? {}) as Record<string, string | null>).filter(([, v]) => !!v);
    const linkLabels: Record<string, string> = {
      classifieds: 'Classifieds (sell)', classifiedsBuy: 'Classifieds (buy)', classifiedsSell: 'Classifieds (sell)', sellerBptf: 'Seller on backpack.tf', sellerSteam: 'Seller on Steam',
      sellerTradeOffer: 'Send offer to seller', sellerTradeOfferForItem: 'Send offer to seller (item preloaded)', pricedb: 'History on pricedb', scm: 'Steam Market', stats: 'Stats on backpack.tf', marketplace: 'marketplace.tf',
    };
    const checks = app.db.all<{ offset_sec: number; verdict: string; verified: number; net_then: number | null }>('SELECT offset_sec, verdict, verified, net_then FROM opp_checks WHERE opp_id = ? ORDER BY offset_sec', r.id);
    const fam = (x: any) => (x?.family ? ` · ${x.family}` : '');
    const body = html`
      <p><a href="/">← Opportunities</a></p>
      <h1><span class="tag ${r.lane}">${LANE_LABELS[r.lane]}</span> ${img ? raw(`<img class="icon" src="${esc(img)}" alt="">`) : ''} ${d.item?.name ?? r.sku}</h1>
      <div class="grid">
        <div class="kpi"><div class="label">Buy</div><div class="value">${r.buy_price_ref !== null ? fmtKeysMetal(r.buy_price_ref, k) : '—'}</div><div class="small muted">${d.buy?.seller ? (d.buy.seller.isBot ? '🤖 ' : '👤 ') + (d.buy.seller.name ?? '') + fam(d.buy.seller) : ''}${d.buy?.pure?.text ? html`<div>add <b>${d.buy.pure.text}</b></div>` : ''}</div></div>
        <div class="kpi"><div class="label">Sell</div><div class="value">${r.sell_price_ref !== null ? fmtKeysMetal(r.sell_price_ref, k) : '—'}</div><div class="small muted">${d.sell?.buyer ? (d.sell.buyer.isBot ? '🤖 ' : '👤 ') + (d.sell.buyer.name ?? '') + fam(d.sell.buyer) + (d.sell.buyer.room !== null && d.sell.buyer.room !== undefined ? ` · room ${d.sell.buyer.room}` : '') : (d.sell?.note ?? '')}${d.sell?.pure?.text ? html`<div>take <b>${d.sell.pure.text}</b></div>` : ''}</div></div>
        <div class="kpi"><div class="label">Net</div><div class="value pos">+${fmtKeysMetal(r.net_ref ?? 0, k)}</div><div class="small muted">${fmtUsd(r.net_usd ?? 0)} · ${pctText(r.pct)}</div></div>
        <div class="kpi"><div class="label">Confidence · status</div><div class="value">${Math.round(r.confidence * 100)} % · ${r.status}</div><div class="small muted">created ${fmtAgo(r.created_at)} · upd. ${fmtAgo(r.updated_at)} · ${d.verified ? '✓ verified by snapshot' : 'unverified (live feed)'}</div></div>
      </div>
      ${d.suspicious ? raw(`<div class="card"><span class="tag warn">⚠ Warning</span> The listing mentions "${esc(d.suspicious)}": this is usually a middleman (quicksell) or a backpack seller; double-check before sending anything.</div>`) : ''}
      <div class="two">
        <div class="card">
          <h2>Steps</h2>
          <ol class="steps">${(d.steps ?? []).map((s: string) => html`<li>${s}</li>`)}</ol>
          ${Array.isArray(d.alternatives) && d.alternatives.length ? html`<h2>Other sellers at the same price</h2>
          <ul class="small">${(d.alternatives as { seller?: string; isBot?: boolean; priceText?: string; tradeUrl?: string | null }[]).map((a) => html`<li>${a.isBot ? '🤖' : '👤'} ${a.seller ?? '?'} · ${a.priceText ?? ''} ${a.tradeUrl ? raw(`<a href="${esc(a.tradeUrl)}" target="_blank" rel="noopener">offer ↗</a>`) : ''}</li>`)}</ul>` : ''}
          ${Array.isArray(d.references) && d.references.length ? html`<h2>References</h2>
          <ul class="small">${(d.references as { name: string; valueText: string; ageDays: number | null }[]).map((r) => html`<li>${r.name}: ${r.valueText}${r.ageDays !== null ? ` (${r.ageDays} d ago)` : ''}</li>`)}</ul>` : ''}
          <h2>Links</h2>
          <ul>${links.map(([key, url]) => html`<li><a href="${url!}" target="_blank" rel="noopener">${linkLabels[key] ?? key} ↗</a></li>`)}
            ${d.sell?.buyer?.tradeUrl ? html`<li><a href="${d.sell.buyer.tradeUrl}" target="_blank" rel="noopener">Send offer to buyer ↗</a></li>` : ''}
          </ul>
          <h2>Execute</h2>
          <div class="row">
            ${d.links?.sellerTradeOfferForItem ? html`<a class="btn" href="${d.links.sellerTradeOfferForItem}" target="_blank" rel="noopener">1 · Offer to seller (item preloaded) ↗</a>` : d.links?.sellerTradeOffer ? html`<a class="btn" href="${d.links.sellerTradeOffer}" target="_blank" rel="noopener">1 · Offer to seller ↗</a>` : ''}
            ${d.sell?.buyer?.tradeUrl ? html`<a class="btn" href="${d.sell.buyer.tradeUrl}" target="_blank" rel="noopener">2 · Offer to buyer ↗</a>` : ''}
          </div>
          <h2>Track it</h2>
          <div class="row">
            ${r.status !== 'offered' ? html`<form method="post" action="/opp/${r.id}/offered"><button type="submit" class="secondary">Offer sent</button></form>` : ''}
            <form method="post" action="/opp/${r.id}/executed"><button type="submit">Mark as executed</button></form>
            <form method="post" action="/opp/${r.id}/rejected"><button type="submit" class="secondary">Rejected / gone</button></form>
            <form method="post" action="/opp/${r.id}/dismiss"><button type="submit" class="secondary">Dismiss</button></form>
            <a class="btn secondary" href="/item/${encodeURIComponent(r.sku)}">View item and order book</a>
          </div>
          <p class="small muted">Press "Offer sent" when you send the first offer, then "Executed" (and log the real prices) or "Rejected / gone". That is what feeds the win rate on the Stats page.</p>
          ${checks.length ? html`<h2>Re-checks after the alert</h2><ul class="small">${checks.map((ch) => html`<li>+${ch.offset_sec >= 60 ? `${ch.offset_sec / 60} min` : `${ch.offset_sec} s`}: <b>${ch.verdict}</b>${ch.net_then !== null ? ` (net then ${fmtKeysMetal(ch.net_then, k)})` : ''}${ch.verified ? ' · snapshot' : ''}</li>`)}</ul>` : ''}
        </div>
        <div class="card">
          <h2>Context</h2>
          <table>
            <tr><th>SKU</th><td class="mono">${r.sku}</td></tr>
            ${d.refs ? html`<tr><th>pricedb buy / sell</th><td>${d.refs.pricedbBuyRef ? fmtKeysMetal(d.refs.pricedbBuyRef, k) : '—'} / ${d.refs.pricedbSellRef ? fmtKeysMetal(d.refs.pricedbSellRef, k) : '—'}</td></tr>
            <tr><th>bptf suggested</th><td>${d.refs.bptfSuggestedRef ? fmtKeysMetal(d.refs.bptfSuggestedRef, k) : '—'}</td></tr>
            <tr><th>Steam Market</th><td>${d.refs.scmCents ? fmtUsd(d.refs.scmCents / 100) + ' (buyer) · ' + fmtUsd(Math.floor(d.refs.scmCents / 1.15) / 100) + ' seller net' : '—'}</td></tr>` : ''}
            ${d.book ? html`<tr><th>Order book</th><td>${d.book.buyOrders} buy orders (${d.book.botBuysOnline} bots online) · ${d.book.sells} sells · best buy ${d.book.bestBuyRef ? fmtKeysMetal(d.book.bestBuyRef, k) : '—'} · best sell ${d.book.bestSellRef ? fmtKeysMetal(d.book.bestSellRef, k) : '—'}</td></tr>` : ''}
            ${d.buy?.details ? html`<tr><th>Seller text</th><td class="small">${d.buy.details}</td></tr>` : ''}
            ${d.sell?.buyer?.details ? html`<tr><th>Buyer text</th><td class="small">${d.sell.buyer.details}</td></tr>` : ''}
            ${d.buy?.flags ? html`<tr><th>Attributes</th><td class="small mono">${JSON.stringify(d.buy.flags)}</td></tr>` : ''}
            ${d.discountPct !== undefined ? html`<tr><th>Discount vs pricedb</th><td>${Number(d.discountPct).toFixed(1)} % · ${d.liquidBuyOrders} liquid buy orders</td></tr>` : ''}
            ${d.expiredReason ? html`<tr><th>Expired</th><td>${d.expiredReason}</td></tr>` : ''}
          </table>
          <details><summary>Full JSON</summary><pre class="mono">${JSON.stringify(d, null, 2)}</pre></details>
        </div>
      </div>`;
    return c.html(layout({ title: r.title, active: '/', body, status: statusFor(app) }));
  });

  hono.post('/opp/:id/executed', (c) => {
    const id = Number(c.req.param('id'));
    app.engine.opps.setStatus(id, 'executed');
    return c.redirect(`/portfolio/new?opp=${id}`);
  });

  hono.post('/opp/:id/offered', (c) => {
    const id = Number(c.req.param('id'));
    app.engine.opps.setStatus(id, 'offered');
    return c.redirect(`/opp/${id}`);
  });

  hono.post('/opp/:id/rejected', (c) => {
    const id = Number(c.req.param('id'));
    app.engine.opps.setStatus(id, 'rejected');
    return c.redirect('/');
  });

  hono.post('/opp/:id/dismiss', (c) => {
    const id = Number(c.req.param('id'));
    app.engine.opps.setStatus(id, 'dismissed');
    return c.redirect('/');
  });

  hono.get('/api/opportunities', (c) => c.json(app.engine.opps.active(undefined, 500)));
}
