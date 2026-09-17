// Collector test: listens to the websocket for N seconds and shows what ended up in the database.
import { getDb } from '../src/db/db.ts';
import { Store } from '../src/db/store.ts';
import { BptfWebSocket } from '../src/sources/bptfWs.ts';
import { KeyRateTracker } from '../src/engine/keyRate.ts';
import { bus } from '../src/bus.ts';

const seconds = Number(process.argv[2] ?? 60);
const db = getDb();
const store = new Store(db);
const kr = new KeyRateTracker(store);
const ws = new BptfWebSocket(store, kr);
let changedSkus = 0;
bus.onTyped('listings:changed', (m) => { changedSkus += m.size; });
ws.start();
setTimeout(() => {
  ws.stop();
  const q = (sql: string) => db.get(sql);
  console.log('events', ws.totalEvents, 'batches', ws.totalBatches, 'changed skus', changedSkus);
  console.log('listings', q('SELECT COUNT(*) n, SUM(active) act, SUM(is_bot) bots, SUM(intent=\'sell\') sells FROM listings'));
  console.log('items', q('SELECT COUNT(*) n FROM items'));
  console.log('ref_prices bptf', q("SELECT COUNT(*) n FROM ref_prices WHERE src='bptf'"));
  console.log('scm_prices', q('SELECT COUNT(*) n FROM scm_prices'));
  console.log('churn', q('SELECT COUNT(*) n, SUM(updates) u, SUM(deletes) d FROM churn'));
  console.log('key rate', kr.bptfRef, kr.bptfUsd, store.latestKeyRate());
  console.log('sample human sell', db.get("SELECT id, sku, keys, metal, value_ref, user_name, details FROM listings WHERE intent='sell' AND is_bot=0 LIMIT 1"));
  console.log('sample bot sell', db.get("SELECT id, sku, keys, metal, value_ref, ua_client, last_pulse FROM listings WHERE intent='sell' AND is_bot=1 LIMIT 1"));
  db.close();
  process.exit(0);
}, seconds * 1000);
