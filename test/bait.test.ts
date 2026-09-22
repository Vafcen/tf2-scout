import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baitTextReason, priceTooGoodReason, baitReason } from '../src/engine/bait.ts';

test('bait text in the seller listing', () => {
  assert.ok(baitTextReason('Send me offers wont sell for the lowest'));
  assert.ok(baitTextReason('✅ Always the lowest prices!⚡ Prices negotiable! 👤 Human trader'));
  assert.ok(baitTextReason('offers welcome / instant accept at ask'));
  assert.ok(baitTextReason('𝗦𝗲𝗻𝗱 𝗺𝗲 𝗼𝗳𝗳𝗲𝗿𝘀'), 'decorated unicode too');
  assert.equal(baitTextReason('Selling for 22.44 ref 🐍 STOCK = 6 🐍 Trade at https://cobra.tf/buy/...'), null);
  assert.equal(baitTextReason('⚡ Selling 𝟭 of these for 𝟭 𝙠𝙚𝙮, 𝟱𝟴.𝟴𝟴 𝙧𝙚𝙛!'), null);
  assert.equal(baitTextReason(null), null);
});

test('price far below every buy order is bait, a small discount is not', () => {
  assert.ok(priceTooGoodReason(24, 922), 'unusual worth 922 ref listed at 24 ref');
  assert.ok(priceTooGoodReason(1, 10));
  assert.equal(priceTooGoodReason(60, 63.5), null, 'a normal snipe margin is fine');
  assert.equal(priceTooGoodReason(40, 63.5), null, '37 % below is still plausible from a stale pricer');
  assert.equal(priceTooGoodReason(0, 10), null);
});

test('combined reason prefers the price signal', () => {
  assert.match(baitReason('Send me offers', 24, 922)!, /asking 3 %/);
  assert.match(baitReason('Send me offers', 60, 63.5)!, /send me offers/i);
  assert.equal(baitReason('Selling 1 for 3.44 ref each', 60, 63.5), null);
});
