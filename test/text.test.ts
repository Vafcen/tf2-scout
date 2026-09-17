import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText } from '../src/tf2/text.ts';
import { conditionalReason } from '../src/engine/orderbook.ts';

test('normalizes decorated letters and digits', () => {
  assert.equal(normalizeText('𝗕𝗨𝗬𝗜𝗡𝗚 𝗟𝗜𝗦𝗧𝗘𝗗 𝗣𝗔𝗥𝗧𝗦 𝟮𝗸𝗲𝘆 𝟱𝟲𝗿𝗲𝗳'), 'BUYING LISTED PARTS 2key 56ref');
  assert.equal(normalizeText('𝘀𝗲𝗹𝗹_𝗦𝘁𝗮𝗿𝘀𝘁𝗼𝗿𝗺'), 'sell_Starstorm');
  assert.equal(normalizeText('normal text 123'), 'normal text 123');
});

test('detects conditional buy orders', () => {
  assert.ok(conditionalReason('𝗕𝗨𝗬𝗜𝗡𝗚 𝗟𝗜𝗦𝗧𝗘𝗗 𝗣𝗔𝗥𝗧𝗦(✅𝟮𝗸𝗲𝘆 𝟱𝟲𝗿𝗲𝗳), 𝗟𝗘𝗦𝗦 𝗙𝗢𝗥 𝗢𝗧𝗛𝗘𝗥 𝗖𝗢𝗠𝗕𝗢𝗦.'));
  assert.ok(conditionalReason('Price is for fh/ts, less for other.'));
  assert.equal(conditionalReason('I am buying your Non-Craftable Liquidator\'s Lid for 19 ref, I have 0 / 1.'), null);
  assert.equal(conditionalReason(null), null);
});
