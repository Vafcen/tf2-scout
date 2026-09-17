import type { Hono } from 'hono';
import type { AppContext } from '../../app.ts';
import { layout } from '../layout.ts';
import { html, raw, fmtAgo, esc } from '../html.ts';
import { statusFor } from '../server.ts';
import { fmtKeysMetal, fmtUsd } from '../../tf2/currencies.ts';
import { bptfClassifiedsUrl, bptfStatsUrl, pricedbUrl, scmUrl, steamProfileUrl } from '../../engine/links.ts';
import { now } from '../../db/store.ts';

export function itemRoutes(hono: Hono, app: AppContext): void {
  hono.get('/item/:sku', (c) => {
    const sku = c.req.param('sku');
    const s = app.engine.settings.get();
    const item = app.store.getItem(sku);
    const book = app.engine.book.build(sku, s.snipe.botPulseMaxAgeMin);
    const refs = app.engine.prices.refs(sku);
    const scm = app.engine.prices.scmLowestCents(sku);
    const churn = app.store.churn24h(sku);
    const k = app.engine.prices.keyRef();
    const img = item?.image_url ? (item.image_url.startsWith('http') ? item.image_url : `https://backpack.tf${item.image_url}`) : null;
    const inWatch = !!app.db.get('SELECT 1 FROM watchlist WHERE sku = ?', sku);
    const rowsFor = (list: typeof book.buys) => list.slice(0, 40).map((l) => html`<tr>
      <td class="num">${fmtKeysMetal(l.valueRef, k)}<div class="small muted">${l.row.keys} keys, ${l.row.metal} ref × ${l.row.count}</div></td>
      <td>${l.row.is_bot ? '🤖' : '👤'} <a href="${steamProfileUrl(l.row.steamid)}" target="_blank" rel="noopener">${l.row.user_name ?? l.row.steamid}</a>
        ${l.row.is_bot && l.row.ua_client ? raw(`<span class="tag bot">${esc(l.row.ua_client)}</span>`) : ''}
        ${!l.online ? raw('<span class="tag warn">offline</span>') : ''}${l.outlier ? raw('<span class="tag warn" title="' + esc(l.outlier) + '">⚠ conditional</span>') : ''}${l.row.premium ? ' ★' : ''}</td>
      <td class="small muted">${fmtAgo(l.row.seen_at)}</td>
      <td class="small">${l.row.trade_url ? raw(`<a href="${esc(l.row.trade_url)}" target="_blank" rel="noopener">offer ↗</a>`) : ''}</td>
      <td class="small muted">${(l.row.details ?? '').slice(0, 90)}</td>
    </tr>`);
    const body = html`
      <p><a href="/">← Opportunities</a></p>
      <h1>${img ? raw(`<img class="icon" src="${esc(img)}" alt="">`) : ''}${item?.name ?? sku} <span class="small mono muted">${sku}</span></h1>
      <div class="row">
        <a class="btn secondary" href="${bptfClassifiedsUrl(item, sku)}" target="_blank" rel="noopener">Classifieds ↗</a>
        <a class="btn secondary" href="${bptfStatsUrl(item, sku)}" target="_blank" rel="noopener">bptf stats ↗</a>
        <a class="btn secondary" href="${pricedbUrl(refs.skuUsed)}" target="_blank" rel="noopener">pricedb ↗</a>
        ${item?.market_name ? html`<a class="btn secondary" href="${scmUrl(item.market_name)}" target="_blank" rel="noopener">Steam Market ↗</a>` : ''}
        <form method="post" action="/item/${encodeURIComponent(sku)}/watch"><button type="submit" class="${inWatch ? 'danger' : ''}">${inWatch ? 'Remove from watchlist' : 'Add to watchlist'}</button></form>
        ${item?.market_name ? html`<form method="post" action="/item/${encodeURIComponent(sku)}/scm"><button type="submit" class="secondary">Query Steam Market now</button></form>` : ''}
      </div>
      <div class="grid">
        <div class="kpi"><div class="label">pricedb buy / sell</div><div class="value">${refs.pricedbBuy ? fmtKeysMetal(refs.pricedbBuy, k) : '—'} / ${refs.pricedbSell ? fmtKeysMetal(refs.pricedbSell, k) : '—'}</div><div class="small muted">${refs.pricedbTs ? 'upd. ' + fmtAgo(refs.pricedbTs) : ''}</div></div>
        <div class="kpi"><div class="label">backpack.tf suggested</div><div class="value">${refs.bptfSuggested ? fmtKeysMetal(refs.bptfSuggested, k) : '—'}</div><div class="small muted">${refs.bptfTs ? 'upd. ' + fmtAgo(refs.bptfTs) : ''}</div></div>
        <div class="kpi"><div class="label">Best buy / best sell</div><div class="value">${book.bestBuy ? fmtKeysMetal(book.bestBuy.valueRef, k) : '—'} / ${book.bestSell ? fmtKeysMetal(book.bestSell.valueRef, k) : '—'}</div><div class="small muted">${book.buys.length} buy orders (${book.botBuys.length} bots online) · ${book.sells.length} sells</div></div>
        <div class="kpi"><div class="label">Steam Market</div><div class="value">${scm ? fmtUsd(scm.cents / 100) : '—'}</div><div class="small muted">${scm ? `seller net ${fmtUsd(Math.floor(scm.cents / 1.15) / 100)} · ${scm.src} · ${fmtAgo(scm.ts)}` : 'no data'}</div></div>
        <div class="kpi"><div class="label">Activity 24 h</div><div class="value">${churn.updates}</div><div class="small muted">${churn.sellUpdates} sells posted · ${churn.sellDeletes} sells removed · ${churn.deletes} deletes</div></div>
      </div>
      <div class="two">
        <div class="card"><h2>Buy orders (${book.buys.length})</h2><table><thead><tr><th class="num">Price</th><th>Buyer</th><th>Seen</th><th></th><th>Details</th></tr></thead><tbody>${rowsFor(book.buys)}</tbody></table></div>
        <div class="card"><h2>Sell listings (${book.sells.length})</h2><table><thead><tr><th class="num">Price</th><th>Seller</th><th>Seen</th><th></th><th>Details</th></tr></thead><tbody>${rowsFor(book.sells)}</tbody></table></div>
      </div>
      <p class="small muted">The order book is built from the backpack.tf live feed${app.engine.snapshotEnabled ? ' and verified against the snapshot' : ' (without BPTF_TOKEN there is no snapshot verification)'}. "Offline" bots are not counted as buyers.</p>`;
    return c.html(layout({ title: item?.name ?? sku, active: '/', body, status: statusFor(app) }));
  });

  hono.post('/item/:sku/watch', (c) => {
    const sku = c.req.param('sku');
    const exists = app.db.get('SELECT 1 FROM watchlist WHERE sku = ?', sku);
    if (exists) app.db.run('DELETE FROM watchlist WHERE sku = ?', sku);
    else app.db.run('INSERT INTO watchlist (sku, added_at) VALUES (?, ?)', sku, now());
    return c.redirect(`/item/${encodeURIComponent(sku)}`);
  });

  hono.post('/item/:sku/scm', async (c) => {
    const sku = c.req.param('sku');
    const item = app.store.getItem(sku);
    if (item?.market_name) await app.scm.priceOverview(item.market_name, sku, 0);
    return c.redirect(`/item/${encodeURIComponent(sku)}`);
  });

  hono.get('/api/item/:sku', (c) => {
    const sku = c.req.param('sku');
    const s = app.engine.settings.get();
    const book = app.engine.book.build(sku, s.snipe.botPulseMaxAgeMin);
    return c.json({ item: app.store.getItem(sku), refs: app.engine.prices.refs(sku), buys: book.buys.map((b) => ({ ...b.row, valueRef: b.valueRef, online: b.online })), sells: book.sells.map((b) => ({ ...b.row, valueRef: b.valueRef, online: b.online })) });
  });
}
