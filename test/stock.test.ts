import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBuyRoom, parseSellUnits } from '../src/tf2/stock.ts';
import { familyOf, isAutoAccept } from '../src/engine/families.ts';

test('buy order room from details', () => {
  assert.equal(parseBuyRoom('I am buying your Non-Craftable Liquidator\'s Lid for 19 ref, I have 0 / 1.'), 1);
  assert.equal(parseBuyRoom('💰 Buying your Ye Olde Rustic Colour for 1.33 ref! Stock: 0/3 | Add me'), 3);
  assert.equal(parseBuyRoom('Buying for 𝟭.𝟯𝟯 𝗿𝗲𝗳 ｜ Stock: 𝟬/𝟭 📦 ｜ Send a trade offer'), 1);
  assert.equal(parseBuyRoom('Buying for 3 keys . Current stock: 1 out of 1'), 0);
  assert.equal(parseBuyRoom('⚡️𝟮𝟲.𝟳𝟳 𝗿𝗲𝗳. 24/7 Instantly buying thousands of unusuals/items with ~10000 keys'), null, '24/7 is not stock');
  assert.equal(parseBuyRoom('[⚡24/7 FAST TRADE⚡] I am buying 3 for 𝟔𝟏.𝟐𝟐 𝐫𝐞𝐟 each.'), 3);
  assert.equal(parseBuyRoom("I'm buying this item for 1.66 ref! Current stock 1 and max stock 3⚡"), 2);
  assert.equal(parseBuyRoom(null), null);
});

test('sell units from details', () => {
  assert.equal(parseSellUnits('Selling for 22.44 ref 🐍 STOCK = 6 🐍 Trade at https://cobra.tf/buy/A%20Mann\'s%20Mint'), 6);
  assert.equal(parseSellUnits('🚨 𝗦𝗘𝗟𝗟𝗜𝗡𝗚 𝟭 at 𝟯.𝟰𝟰 𝗿𝗲𝗳 each. ⚡ Send offer'), 1);
  assert.equal(parseSellUnits('⚡ Selling 𝟭 of these for 𝟭 𝙠𝙚𝙮, 𝟱𝟴.𝟴𝟴 𝙧𝙚𝙛! 📈'), 1);
  assert.equal(parseSellUnits('24/7 Instantly selling ~200000 keys worth of unusuals/items'), null);
});

test('bot families', () => {
  assert.equal(familyOf(true, 'Gladiator.tf - Rent your own bot from 6 keys per month', 'x'), 'gladiator');
  assert.equal(familyOf(true, 'TF2AutobotPriceDB - Fastest bot in the planet', 'x'), 'tf2autobot');
  assert.equal(familyOf(true, 'cobra.tf', 'CobraTF TOOLS'), 'cobra');
  assert.equal(familyOf(true, 'User Agent', '6ScrapyardBot⚡️24/7'), 'scrapyard');
  assert.equal(familyOf(true, 'backpack.tf automatic', 'GON#1'), 'human-managed');
  assert.equal(familyOf(true, null, 'someone'), 'human-managed');
  assert.equal(familyOf(false, null, 'someone'), 'human');
  assert.ok(isAutoAccept('gladiator'));
  assert.ok(!isAutoAccept('human-managed'));
  assert.ok(!isAutoAccept('human'));
});
