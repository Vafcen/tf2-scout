import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE } from 'hono/streaming';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config.ts';
import { logger } from '../log.ts';
import { bus } from '../bus.ts';
import type { AppContext } from '../app.ts';
import { LANE_LABELS } from '../engine/index.ts';
import { fmtKeysMetal, fmtUsd } from '../tf2/currencies.ts';
import { opportunityRoutes } from './routes/opportunities.ts';
import { itemRoutes } from './routes/items.ts';
import { keysRoutes } from './routes/keys.ts';
import { settingsRoutes } from './routes/settings.ts';
import { statusRoutes } from './routes/status.ts';
import { portfolioRoutes } from './routes/portfolio.ts';
import { bankingRoutes } from './routes/banking.ts';
import { statsRoutes } from './routes/stats.ts';
import { topStatus } from './layout.ts';
import type { Lane } from '../config.ts';

const log = logger('web');
const here = dirname(fileURLToPath(import.meta.url));

export function statusFor(app: AppContext) {
  const kr = app.store.latestKeyRate();
  const key = kr?.pricedb_sell_ref ?? kr?.bptf_ref;
  const a = app.engine.settings.get().alerts;
  const nowTs = Math.floor(Date.now() / 1000);
  const desktopAlerts: 'on' | 'muted' | 'off' = !a.desktopEnabled ? 'off' : a.desktopMutedUntil > nowTs ? 'muted' : 'on';
  return {
    wsConnected: app.ws.connected,
    eventsPerMin: app.ws.eventsPerMin(),
    keyText: key ? `key ${key.toFixed(2)} ref` + (kr?.bptf_usd ? ` ≈ $${kr.bptf_usd.toFixed(2)}` : '') : 'key ?',
    desktopAlerts,
    mutedUntilText: desktopAlerts === 'muted' ? new Date(a.desktopMutedUntil * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : undefined,
  };
}

export function startWeb(app: AppContext) {
  const hono = new Hono();
  hono.use('/static/*', serveStatic({ root: join(here, 'public'), rewriteRequestPath: (p) => p.replace(/^\/static/, '') }));

  hono.get('/partials/topstatus', (c) => c.html(topStatus(statusFor(app))));

  // Bell: enable / mute for N hours / disable desktop notifications.
  hono.post('/alerts/desktop', async (c) => {
    const b = await c.req.parseBody();
    const action = String(b.action ?? '');
    const hours = Math.max(0.25, Math.min(72, Number(b.hours) || 1));
    const nowTs = Math.floor(Date.now() / 1000);
    if (action === 'on') app.engine.settings.update({ alerts: { desktopEnabled: true, desktopMutedUntil: 0 } });
    else if (action === 'off') app.engine.settings.update({ alerts: { desktopEnabled: false, desktopMutedUntil: 0 } });
    else if (action === 'mute') app.engine.settings.update({ alerts: { desktopEnabled: true, desktopMutedUntil: nowTs + Math.round(hours * 3600) } });
    const back = c.req.header('referer') ?? '/';
    return c.redirect(back.startsWith('http://localhost') || back.startsWith('/') ? back : '/');
  });

  hono.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      let alive = true;
      const onOpp = (ev: { id: number; lane: string; sku: string; status: string; isNew: boolean; improved: boolean }) => {
        const row = app.engine.opps.get(ev.id);
        const k = app.engine.prices.keyRef();
        void stream.writeSSE({
          event: 'opportunity',
          data: JSON.stringify({
            ...ev,
            title: row?.title,
            laneLabel: LANE_LABELS[ev.lane as Lane],
            netText: row ? `+${fmtKeysMetal(row.net_ref ?? 0, k)} · ${fmtUsd(row.net_usd ?? 0)}` : '',
          }),
        });
      };
      bus.onTyped('opportunity', onOpp);
      stream.onAbort(() => {
        alive = false;
        bus.off('opportunity', onOpp);
      });
      while (alive) {
        await stream.writeSSE({ event: 'ping', data: String(Date.now()) });
        await stream.sleep(20_000);
      }
    }),
  );

  opportunityRoutes(hono, app);
  itemRoutes(hono, app);
  keysRoutes(hono, app);
  settingsRoutes(hono, app);
  statusRoutes(hono, app);
  portfolioRoutes(hono, app);
  bankingRoutes(hono, app);
  statsRoutes(hono, app);

  hono.notFound((c) => c.text('Not found', 404));
  hono.onError((err, c) => {
    log.error(`error in ${c.req.path}`, err);
    return c.text('Internal error: ' + err.message, 500);
  });

  const server = serve({ fetch: hono.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
    log.info(`dashboard listening on http://localhost:${info.port}`);
  });
  return server;
}
