import { env } from './config.ts';
import { logger } from './log.ts';
import { getDb } from './db/db.ts';
import { Store } from './db/store.ts';
import { KeyRateTracker } from './engine/keyRate.ts';
import { BptfWebSocket } from './sources/bptfWs.ts';
import { PricedbSource } from './sources/pricedb.ts';
import { ScmSource } from './sources/scm.ts';
import { Engine } from './engine/index.ts';
import { startWeb } from './web/server.ts';

const log = logger('main');

const db = getDb();
const store = new Store(db);
const keyRate = new KeyRateTracker(store);
const ws = new BptfWebSocket(store, keyRate);
const pricedb = new PricedbSource(store);
const scm = new ScmSource(store);
const engine = new Engine(store, scm);

export const app = { db, store, keyRate, ws, pricedb, scm, engine };

pricedb.start();
scm.start();
engine.start();
ws.start();
const server = startWeb(app);

log.info(`TF2 Scout ready · dashboard at http://localhost:${env.PORT}`);
if (!env.BPTF_TOKEN) log.warn('no BPTF_TOKEN: there will be no order book snapshot (live feed only)');
if (!env.DISCORD_WEBHOOK_URL) log.warn('no DISCORD_WEBHOOK_URL: alerts only go to the dashboard and the desktop');

function shutdown(signal: string): void {
  log.info(`received ${signal}, shutting down...`);
  ws.stop();
  pricedb.stop();
  scm.stop();
  engine.stop();
  server.close();
  setTimeout(() => {
    db.close();
    process.exit(0);
  }, 500);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => log.error('uncaught exception', err));
process.on('unhandledRejection', (err) => log.error('unhandled promise rejection', err));
