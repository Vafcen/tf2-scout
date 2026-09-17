import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db/db.ts';
import { Store } from '../src/db/store.ts';
import { Ledger } from '../src/ledger/trades.ts';

test('ledger: FIFO P&L per SKU', () => {
  const store = new Store(new Db(':memory:'));
  const l = new Ledger(store);
  const base = { name: 'Hat', venue: 'backpack.tf', price_usd: null, fees_usd: 0, opportunity_id: null, note: null };
  l.add({ ...base, ts: 1, sku: 'a', side: 'buy', qty: 2, price_ref: 10 });
  l.add({ ...base, ts: 2, sku: 'a', side: 'buy', qty: 1, price_ref: 12 });
  l.add({ ...base, ts: 3, sku: 'a', side: 'sell', qty: 2, price_ref: 15 }); // 2 × (15 − 10) = 10
  l.add({ ...base, ts: 4, sku: 'b', side: 'sell', qty: 1, price_ref: 5 }); // no purchase: +5 gross
  const p = l.summary();
  assert.equal(p.realizedRef, 15);
  assert.equal(p.buys, 3);
  assert.equal(p.sells, 3);
  assert.deepEqual(p.openPositions, [{ sku: 'a', name: 'Hat', qty: 1, costRef: 12 }]);
});
