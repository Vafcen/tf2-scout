import type { Hono } from 'hono';
import type { AppContext } from '../../app.ts';
import { layout } from '../layout.ts';
import { html, raw } from '../html.ts';
import { statusFor } from '../server.ts';
import { LANE_LABELS } from '../../engine/index.ts';
import type { Lane } from '../../config.ts';

const LANES: Lane[] = ['snipe', 'deal', 'keys', 'unusual', 'cash', 'scm_keys', 'banking'];

function num(form: Record<string, string>, key: string, fallback: number): number {
  const v = form[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function settingsRoutes(hono: Hono, app: AppContext): void {
  hono.get('/settings', (c) => {
    const s = app.engine.settings.get();
    const saved = c.req.query('saved');
    const error = c.req.query('error');
    const field = (label: string, name: string, value: number, step = '1') => html`<label>${label} <input type="number" name="${name}" value="${value}" step="${step}"></label>`;
    const laneChecks = (name: string, selected: Lane[]) => LANES.map((l) => html`<label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="${name}" value="${l}" ${selected.includes(l) ? 'checked' : ''}> ${LANE_LABELS[l]}</label>`);
    const body = html`
      <h1>Settings</h1>
      ${saved ? raw('<div class="card" style="border-color:var(--green)">Settings saved.</div>') : ''}
      ${error ? html`<div class="card" style="border-color:var(--red)">${error}</div>` : ''}
      <form method="post" action="/settings">
        <div class="card"><h2>General</h2><div class="row">
          ${field('Capital (keys)', 'capitalKeys', s.capitalKeys, '0.5')}
          ${field('Max price per item (keys, 0 = no limit)', 'maxItemPriceKeys', s.maxItemPriceKeys, '0.5')}
          <label>Preferred unit <select name="unit"><option value="keys" ${s.unit === 'keys' ? 'selected' : ''}>keys/ref</option><option value="usd" ${s.unit === 'usd' ? 'selected' : ''}>USD</option></select></label>
        </div></div>
        <div class="card"><h2>Snipes and deals</h2><div class="row">
          ${field('Min net instant flip (ref)', 'snipe.minNetRef', s.snipe.minNetRef, '0.11')}
          ${field('Min % instant flip', 'snipe.minPct', s.snipe.minPct, '0.5')}
          ${field('Min deal discount (%)', 'snipe.dealMinPct', s.snipe.dealMinPct, '1')}
          ${field('Min liquid buy orders (deal)', 'snipe.dealMinBuyOrders', s.snipe.dealMinBuyOrders)}
          ${field('Bot online if pulse < (min)', 'snipe.botPulseMaxAgeMin', s.snipe.botPulseMaxAgeMin)}
          <label>Suspicious keywords (comma-separated) <input type="text" name="snipe.ignoreDetailsKeywords" value="${s.snipe.ignoreDetailsKeywords.join(', ')}" style="width:320px"></label>
        </div></div>
        <div class="card"><h2>Banking</h2><div class="row">
          ${field('Min spread (ref)', 'banking.minSpreadRef', s.banking.minSpreadRef, '0.11')}
          ${field('Min spread (%)', 'banking.minSpreadPct', s.banking.minSpreadPct, '0.5')}
          ${field('Max spread (%)', 'banking.maxSpreadPct', s.banking.maxSpreadPct, '1')}
          ${field('Min activity 24 h', 'banking.minChurn24h', s.banking.minChurn24h)}
          ${field('Min sells removed 24 h', 'banking.minSellDeletes24h', s.banking.minSellDeletes24h)}
          ${field('Min online bots on buy side', 'banking.minBotBuyOrders', s.banking.minBotBuyOrders)}
          ${field('Max proposed items', 'banking.maxItems', s.banking.maxItems)}
          ${field('Step (ref)', 'banking.stepRef', s.banking.stepRef, '0.11')}
        </div></div>
        <div class="card"><h2>Cash, SCM and unusuals</h2><div class="row">
          ${field('Keys: alert if cross-market spread > %', 'keys.alertSpreadPct', s.keys.alertSpreadPct, '0.5')}
          ${field('SCM: min price ($)', 'scm.minPriceUsd', s.scm.minPriceUsd, '0.05')}
          ${field('SCM: min listings', 'scm.minListings', s.scm.minListings)}
          ${field('SCM: min advantage (%)', 'scm.minAdvantagePct', s.scm.minAdvantagePct, '0.5')}
          ${field('Cash: min advantage (%)', 'cash.minAdvantagePct', s.cash.minAdvantagePct, '0.5')}
          ${field('Cash: min 30 d sales', 'cash.minSales30d', s.cash.minSales30d)}
          ${field('mannco fee (%)', 'cash.manncoFeePct', s.cash.manncoFeePct, '0.5')}
          ${field('marketplace.tf fee (%)', 'cash.mptfFeePct', s.cash.mptfFeePct, '0.5')}
          <label>Unusuals <select name="unusual.enabled"><option value="auto" ${s.unusual.enabled === 'auto' ? 'selected' : ''}>auto (capital ≥ 20 keys)</option><option value="on" ${s.unusual.enabled === 'on' ? 'selected' : ''}>on</option><option value="off" ${s.unusual.enabled === 'off' ? 'selected' : ''}>off</option></select></label>
          ${field('Unusual: min discount (%)', 'unusual.minDiscountPct', s.unusual.minDiscountPct, '1')}
          ${field('Unusual: min references', 'unusual.minRefs', s.unusual.minRefs)}
        </div></div>
        <div class="card"><h2>Alerts</h2>
          <div class="row"><span class="muted small">Discord (${app.engine.discord.enabled ? 'configured' : 'no webhook in .env'}):</span> ${laneChecks('alerts.discordLanes', s.alerts.discordLanes)}</div>
          <div class="row"><label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="alerts.desktopEnabled" value="1" ${s.alerts.desktopEnabled ? 'checked' : ''}> <b>Desktop notifications enabled</b></label> <span class="muted small">(you can also mute them for a few hours from the bell 🔔 at the top)</span></div>
          <div class="row"><span class="muted small">Desktop, lanes:</span> ${laneChecks('alerts.desktopLanes', s.alerts.desktopLanes)}</div>
          <div class="row">${field('Unconfirmed opportunity lifetime (min)', 'alerts.oppTtlMin', s.alerts.oppTtlMin)} ${field('Min confidence to alert (0-1)', 'alerts.minConfidence', s.alerts.minConfidence, '0.05')}</div>
        </div>
        <div class="row"><button type="submit">Save</button> <button type="submit" name="reset" value="1" class="secondary" formnovalidate>Restore defaults</button></div>
      </form>`;
    return c.html(layout({ title: 'Settings', active: '/settings', body, status: statusFor(app) }));
  });

  hono.post('/settings', async (c) => {
    const body = await c.req.parseBody({ all: true });
    const form: Record<string, string> = {};
    const multi: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(body)) {
      if (Array.isArray(v)) multi[k] = v.map(String);
      else if (typeof v === 'string') { form[k] = v; multi[k] = [v]; }
    }
    if (form.reset) {
      app.engine.settings.reset();
      return c.redirect('/settings?saved=1');
    }
    const s = app.engine.settings.get();
    const patch = {
      capitalKeys: num(form, 'capitalKeys', s.capitalKeys),
      maxItemPriceKeys: num(form, 'maxItemPriceKeys', s.maxItemPriceKeys),
      unit: form.unit === 'usd' ? 'usd' : 'keys',
      snipe: {
        minNetRef: num(form, 'snipe.minNetRef', s.snipe.minNetRef), minPct: num(form, 'snipe.minPct', s.snipe.minPct),
        dealMinPct: num(form, 'snipe.dealMinPct', s.snipe.dealMinPct), dealMinBuyOrders: num(form, 'snipe.dealMinBuyOrders', s.snipe.dealMinBuyOrders),
        botPulseMaxAgeMin: num(form, 'snipe.botPulseMaxAgeMin', s.snipe.botPulseMaxAgeMin),
        ignoreDetailsKeywords: (form['snipe.ignoreDetailsKeywords'] ?? '').split(',').map((x) => x.trim()).filter(Boolean),
      },
      banking: {
        minSpreadRef: num(form, 'banking.minSpreadRef', s.banking.minSpreadRef), minSpreadPct: num(form, 'banking.minSpreadPct', s.banking.minSpreadPct),
        maxSpreadPct: num(form, 'banking.maxSpreadPct', s.banking.maxSpreadPct),
        minChurn24h: num(form, 'banking.minChurn24h', s.banking.minChurn24h), minSellDeletes24h: num(form, 'banking.minSellDeletes24h', s.banking.minSellDeletes24h),
        minBotBuyOrders: num(form, 'banking.minBotBuyOrders', s.banking.minBotBuyOrders),
        maxItems: num(form, 'banking.maxItems', s.banking.maxItems), stepRef: num(form, 'banking.stepRef', s.banking.stepRef),
      },
      keys: { alertSpreadPct: num(form, 'keys.alertSpreadPct', s.keys.alertSpreadPct) },
      scm: { minPriceUsd: num(form, 'scm.minPriceUsd', s.scm.minPriceUsd), minListings: num(form, 'scm.minListings', s.scm.minListings), minAdvantagePct: num(form, 'scm.minAdvantagePct', s.scm.minAdvantagePct) },
      cash: { minAdvantagePct: num(form, 'cash.minAdvantagePct', s.cash.minAdvantagePct), minSales30d: num(form, 'cash.minSales30d', s.cash.minSales30d), manncoFeePct: num(form, 'cash.manncoFeePct', s.cash.manncoFeePct), mptfFeePct: num(form, 'cash.mptfFeePct', s.cash.mptfFeePct) },
      unusual: { enabled: (['auto', 'on', 'off'].includes(form['unusual.enabled'] ?? '') ? form['unusual.enabled'] : s.unusual.enabled), minDiscountPct: num(form, 'unusual.minDiscountPct', s.unusual.minDiscountPct), minRefs: num(form, 'unusual.minRefs', s.unusual.minRefs) },
      alerts: {
        discordLanes: multi['alerts.discordLanes'] ?? [], desktopLanes: multi['alerts.desktopLanes'] ?? [],
        oppTtlMin: num(form, 'alerts.oppTtlMin', s.alerts.oppTtlMin), minConfidence: num(form, 'alerts.minConfidence', s.alerts.minConfidence),
        desktopEnabled: form['alerts.desktopEnabled'] === '1', desktopMutedUntil: form['alerts.desktopEnabled'] === '1' ? s.alerts.desktopMutedUntil : 0,
      },
    };
    try {
      app.engine.settings.update(patch);
      return c.redirect('/settings?saved=1');
    } catch (err) {
      return c.redirect('/settings?error=' + encodeURIComponent((err as Error).message));
    }
  });

  hono.get('/api/settings', (c) => c.json(app.engine.settings.get()));
  hono.put('/api/settings', async (c) => {
    try {
      return c.json(app.engine.settings.update(await c.req.json()));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });
}
