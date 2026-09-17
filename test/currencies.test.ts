import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toScrap, toRefined, roundRef, splitRef, fmtKeysMetal, scmSellerNetCents, scmBuyerPaysCents, scmFeeCents,
  refToUsd, usdToRef, valueRef,
} from '../src/tf2/currencies.ts';

test('scrap/ref', () => {
  assert.equal(toScrap(1.33), 12);
  assert.equal(toScrap(0.11), 1);
  assert.equal(toRefined(12), 1.33);
  assert.equal(toRefined(9), 1);
  assert.equal(roundRef(1.35), 1.33);
  assert.equal(roundRef(63.44), 63.44);
});

test('split and format', () => {
  assert.deepEqual(splitRef(130.55, 63.55), { keys: 2, metal: 3.44 }); // 3.45 is not a multiple of scrap → 31 scrap = 3.44
  assert.equal(fmtKeysMetal(63.55 * 2 + 3.44, 63.55), '2 keys, 3.44 ref');
  assert.equal(fmtKeysMetal(5.33, 63.55), '5.33 ref');
  assert.equal(fmtKeysMetal(63.55, 63.55), '1 key');
  assert.equal(valueRef(1, 2.33, 63.55), 65.88);
});

test('Steam Market fees (TF2 = 5% + 10%, minimum 1¢ each)', () => {
  // Steam formula: fee = floor(max(recv*5%,1)) + floor(max(recv*10%,1)); buyer pays recv + fee
  assert.equal(scmFeeCents(198), 9 + 19);
  assert.equal(scmBuyerPaysCents(198), 226);
  assert.equal(scmSellerNetCents(227), 199); // 199 + 9 + 19 = 227
  assert.equal(scmSellerNetCents(3), 1); // minimums
  assert.equal(scmSellerNetCents(100), 88); // 88 + 4 + 8 = 100
});

test('ref/usd conversions', () => {
  const usd = refToUsd(127.1, 63.55, 1.7); // 2 keys → $3.40
  assert.ok(Math.abs(usd - 3.4) < 1e-9);
  assert.ok(Math.abs(usdToRef(3.4, 63.55, 1.7) - 127.1) < 1e-9);
});
