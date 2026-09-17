import type { Hono } from 'hono';
import type { AppContext } from '../../app.ts';
import { layout } from '../layout.ts';
import { html, raw, fmtDate } from '../html.ts';
import { statusFor } from '../server.ts';
import { fmtKeysMetal, fmtUsd, splitRef } from '../../tf2/currencies.ts';
import { Ledger } from '../../ledger/trades.ts';
import { now } from '../../db/store.ts';

export function portfolioRoutes(hono: Hono, app: AppContext): void {
  const ledger = new Ledger(app.store);

  hono.get('/portfolio', (c) => {
    const k = app.engine.prices.keyRef();
    const trades = ledger.list(300);
    const pnl = ledger.summary();
    const snaps = ledger.snapshots(60);
    const body = html`
      <h1>Portfolio</h1>
      <div class="grid">
        <div class="kpi"><div class="label">Realized profit (FIFO)</div><div class="value ${pnl.realizedRef >= 0 ? 'pos' : 'neg'}">${fmtKeysMetal(pnl.realizedRef, k)}</div><div class="small muted">${fmtUsd(pnl.realizedUsd)} based on logged prices</div></div>
        <div class="kpi"><div class="label">Trades</div><div class="value">${pnl.buys} buys · ${pnl.sells} sells</div></div>
        <div class="kpi"><div class="label">Open positions</div><div class="value">${pnl.openPositions.length}</div><div class="small muted">cost ${fmtKeysMetal(pnl.openPositions.reduce((a, p) => a + p.costRef, 0), k)}</div></div>
        <div class="kpi"><div class="label">Backpack value</div><div class="value">${snaps[0]?.value_ref ? fmtKeysMetal(snaps[0].value_ref, k) : '—'}</div><div class="small muted">${snaps[0] ? `${fmtDate(snaps[0].ts)} · ${snaps[0].src}` : 'requires BPTF_API_KEY and STEAM_ID64'}</div></div>
      </div>
      <div class="row"><a class="btn" href="/portfolio/new">Log a trade</a></div>
      ${pnl.openPositions.length ? html`<div class="card"><h2>Open positions</h2><table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Cost</th></tr></thead><tbody>${pnl.openPositions.map((p) => html`<tr><td><a href="/item/${encodeURIComponent(p.sku)}">${p.name ?? p.sku}</a></td><td class="num">${p.qty}</td><td class="num">${fmtKeysMetal(p.costRef, k)}</td></tr>`)}</tbody></table></div>` : ''}
      <div class="card"><h2>Trades</h2>
        ${trades.length ? html`<table><thead><tr><th>Date</th><th>Side</th><th>Item</th><th>Venue</th><th class="num">Qty</th><th class="num">Price</th><th class="num">USD</th><th>Note</th><th></th></tr></thead><tbody>
          ${trades.map((t) => html`<tr><td>${fmtDate(t.ts)}</td><td>${t.side === 'buy' ? '🟢 buy' : '🔴 sell'}</td><td><a href="/item/${encodeURIComponent(t.sku)}">${t.name ?? t.sku}</a></td><td>${t.venue ?? ''}</td><td class="num">${t.qty}</td><td class="num">${t.price_ref !== null ? fmtKeysMetal(t.price_ref, k) : '—'}</td><td class="num">${t.price_usd !== null ? fmtUsd(t.price_usd) : '—'}${t.fees_usd ? html`<div class="small muted">fees ${fmtUsd(t.fees_usd)}</div>` : ''}</td><td class="small">${t.note ?? ''}</td><td><form method="post" action="/portfolio/${t.id}/delete"><button class="secondary" type="submit">✕</button></form></td></tr>`)}
        </tbody></table>` : raw('<p class="muted">No trades logged yet. When you execute an opportunity, click "Mark as executed" and fill in the actual price.</p>')}
      </div>
      ${snaps.length ? html`<div class="card"><h2>Backpack value</h2><table><thead><tr><th>Date</th><th class="num">Value</th><th class="num">USD</th><th class="num">Slots</th></tr></thead><tbody>${snaps.map((s) => html`<tr><td>${fmtDate(s.ts)}</td><td class="num">${s.value_ref ? fmtKeysMetal(s.value_ref, k) : '—'}</td><td class="num">${s.value_usd ? fmtUsd(s.value_usd) : '—'}</td><td class="num">${s.slots ?? '—'}</td></tr>`)}</tbody></table></div>` : ''}`;
    return c.html(layout({ title: 'Portfolio', active: '/portfolio', body, status: statusFor(app) }));
  });

  hono.get('/portfolio/new', (c) => {
    const k = app.engine.prices.keyRef();
    const oppId = Number(c.req.query('opp') ?? 0) || null;
    const opp = oppId ? app.engine.opps.get(oppId) : undefined;
    const d = opp?.details ? (JSON.parse(opp.details) as Record<string, any>) : {};
    const sku = c.req.query('sku') ?? opp?.sku ?? '';
    const item = sku ? app.store.getItem(sku) : undefined;
    const buy = opp?.buy_price_ref ? splitRef(opp.buy_price_ref, k) : { keys: 0, metal: 0 };
    const sell = opp?.sell_price_ref ? splitRef(opp.sell_price_ref, k) : { keys: 0, metal: 0 };
    const form = (side: 'buy' | 'sell', def: { keys: number; metal: number }, venue: string) => html`
      <div class="card"><h2>${side === 'buy' ? 'Buy' : 'Sell'}</h2>
      <form method="post" action="/portfolio/new" class="filters">
        <input type="hidden" name="side" value="${side}"><input type="hidden" name="opp" value="${oppId ?? ''}">
        <label>SKU <input type="text" name="sku" value="${sku}" required style="width:220px"></label>
        <label>Name <input type="text" name="name" value="${item?.name ?? d.item?.name ?? ''}" style="width:260px"></label>
        <label>Venue <select name="venue"><option ${venue === 'backpack.tf' ? 'selected' : ''}>backpack.tf</option><option ${venue === 'Steam Market' ? 'selected' : ''}>Steam Market</option><option>mannco.store</option><option>marketplace.tf</option><option>scrap.tf</option><option>other</option></select></label>
        <label>Quantity <input type="number" name="qty" value="1" min="1"></label>
        <label>Keys <input type="number" name="keys" value="${def.keys}" min="0" step="1"></label>
        <label>Metal (ref) <input type="number" name="metal" value="${def.metal}" min="0" step="0.11"></label>
        <label>USD (if paid in cash/wallet) <input type="number" name="usd" value="" step="0.01"></label>
        <label>Fees USD <input type="number" name="fees" value="0" step="0.01"></label>
        <label>Note <input type="text" name="note" value="" style="width:220px"></label>
        <button type="submit">Save ${side === 'buy' ? 'buy' : 'sell'}</button>
      </form></div>`;
    const body = html`
      <p><a href="/portfolio">← Portfolio</a></p>
      <h1>Log a trade${opp ? html` <span class="small muted">(opportunity #${opp.id}: ${opp.title})</span>` : ''}</h1>
      <p class="small muted">Log the buy once you have the item and the sell once you close it; profit is computed with FIFO. Prices in keys + ref (equivalent) or in USD for cash/wallet.</p>
      ${form('buy', buy, d.buy?.venue ?? 'backpack.tf')}
      ${form('sell', sell, d.sell?.venue ?? 'backpack.tf')}`;
    return c.html(layout({ title: 'Log a trade', active: '/portfolio', body, status: statusFor(app) }));
  });

  hono.post('/portfolio/new', async (c) => {
    const b = await c.req.parseBody();
    const k = app.engine.prices.keyRef();
    const g = (key: string) => (typeof b[key] === 'string' ? (b[key] as string) : '');
    const keys = Number(g('keys')) || 0;
    const metal = Number(g('metal')) || 0;
    const usd = g('usd') === '' ? null : Number(g('usd')) || 0;
    const priceRef = keys || metal ? keys * k + metal : usd !== null ? (usd / app.engine.prices.keyUsd()) * k : null;
    const priceUsd = usd !== null ? usd : priceRef !== null ? app.engine.prices.refToUsd(priceRef) : null;
    if (!g('sku')) return c.text('SKU is required', 400);
    ledger.add({
      ts: now(), sku: g('sku'), name: g('name') || null, side: g('side') === 'sell' ? 'sell' : 'buy', venue: g('venue') || null,
      qty: Math.max(1, Number(g('qty')) || 1), price_ref: priceRef, price_usd: priceUsd, fees_usd: Number(g('fees')) || 0,
      opportunity_id: Number(g('opp')) || null, note: g('note') || null,
    });
    return c.redirect('/portfolio');
  });

  hono.post('/portfolio/:id/delete', (c) => {
    ledger.remove(Number(c.req.param('id')));
    return c.redirect('/portfolio');
  });

  hono.get('/api/portfolio', (c) => c.json({ trades: ledger.list(500), pnl: ledger.summary(), snapshots: ledger.snapshots(365) }));
}
