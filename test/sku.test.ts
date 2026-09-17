import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { skuFromBptfItem, parseSku, isUnusualSku, skuWithoutPaint } from '../src/tf2/sku.ts';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/bptf_items.json', import.meta.url), 'utf8')) as {
  expect: string;
  item: Parameters<typeof skuFromBptfItem>[0];
}[];

for (const f of fixtures) {
  test(`sku ${f.expect}`, () => {
    assert.equal(skuFromBptfItem(f.item), f.expect);
  });
}

test('parseSku and helpers', () => {
  const p = parseSku('30421;5;u110');
  assert.equal(p.effect, 110);
  assert.equal(p.quality, 5);
  assert.ok(isUnusualSku('30421;5;u110'));
  assert.ok(!isUnusualSku('5021;6'));
  assert.equal(skuWithoutPaint('30469;6;p16738740'), '30469;6');
  assert.equal(skuWithoutPaint('15000;15;w2;pk20'), '15000;15;w2;pk20');
});
