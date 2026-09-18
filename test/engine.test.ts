import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db/db.ts';
import { Store, now, type NormListing } from '../src/db/store.ts';
import { PriceContext } from '../src/engine/prices.ts';
import { OrderBook } from '../src/engine/orderbook.ts';
import { Opportunities } from '../src/engine/opportunities.ts';
import { SnipeStrategy } from '../src/engine/strategies/snipe.ts';
import { BankingStrategy } from '../src/engine/strategies/banking.ts';
import { DEFAULT_SETTINGS } from '../src/config.ts';
import { parseBuyRoom } from '../src/tf2/stock.ts';

function setup() {
  const db = new Db(':memory:');
  const store = new Store(db);
  store.insertKeyRate({ bptfRef: 64, pricedbBuyRef: 63.44, pricedbSellRef: 63.77, bptfUsd: 1.68 });
  store.upsertRefPrice('479;6', 'pricedb', 0, 3.33, 0, 3.66, now());
  const prices = new PriceContext(store);
  const book = new OrderBook(store, prices);
  const opps = new Opportunities(store);
  return { db, store, prices, book, opps };
}

function listing(over: Partial<NormListing> & { id: string; sku: string; intent: 'buy' | 'sell'; steamid: string; metal: number }): NormListing {
  return {
    keys: 0, usd: null, valueRef: over.metal, isBot: true, uaClient: 'tf2autobot', lastPulse: now(), premium: true, banned: false, online: true,
    userName: 'bot ' + over.steamid, tradeUrl: 'https://steamcommunity.com/tradeoffer/new/?partner=1&token=x', listedAt: now(), bumpedAt: now(),
    details: null, source: 'userAgent', count: 1, flags: null,
    assetId: over.intent === 'sell' ? over.id.replace('440_', '') : null, tradeOffersPreferred: true, buyoutOnly: true,
    stockRoom: over.intent === 'buy' ? parseBuyRoom(over.details ?? null) : null, stockUnits: null, festivized: false,
    item: { name: 'Security Shades', marketName: 'Security Shades', defindex: 479, quality: 6, effect: null, ksTier: 0, australium: false, imageUrl: null, baseName: 'Security Shades' },
    refs: {},
    ...over,
  };
}

test('snipe: detects an instant flip and excludes conditional or wildly overpriced buy orders', () => {
  const { store, book, prices, opps } = setup();
  const s = structuredClone(DEFAULT_SETTINGS);
  store.upsertItem('479;6', listing({ id: 'x', sku: '479;6', intent: 'sell', steamid: '0', metal: 1 }).item);
  // sell at 2.33, buy orders: reliable bot 3.33, "conditional" bot 26.77 (text), wildly overpriced bot 40 (no text)
  store.upsertListing(listing({ id: '440_1', sku: '479;6', intent: 'sell', steamid: 'S1', metal: 2.33 }));
  store.upsertListing(listing({ id: '440_B1_a', sku: '479;6', intent: 'buy', steamid: 'B1', metal: 3.33 }));
  store.upsertListing(listing({ id: '440_B2_a', sku: '479;6', intent: 'buy', steamid: 'B2', metal: 26.77, details: '𝗣𝗿𝗶𝗰𝗲 𝗶𝘀 𝗳𝗼𝗿 spelled, less for other' }));
  store.upsertListing(listing({ id: '440_B3_a', sku: '479;6', intent: 'buy', steamid: 'B3', metal: 40 }));
  const strat = new SnipeStrategy(store, book, prices, opps);
  const keep = strat.evaluate('479;6', s);
  assert.deepEqual(keep, ['440_1']);
  const active = opps.active('snipe');
  assert.equal(active.length, 1);
  assert.equal(active[0].sell_price_ref, 3.33, 'the exit must be the reliable buy order, not the conditional or the wildly overpriced one');
  assert.ok(Math.abs((active[0].net_ref ?? 0) - 1) < 1e-9);
  const d = JSON.parse(active[0].details!) as { sell: { buyer: { steamid: string } } };
  assert.equal(d.sell.buyer.steamid, 'B1');
});

test('snipe: expires when the sell disappears and does not fire with insufficient margin', () => {
  const { store, book, prices, opps } = setup();
  const s = structuredClone(DEFAULT_SETTINGS);
  store.upsertListing(listing({ id: '440_1', sku: '479;6', intent: 'sell', steamid: 'S1', metal: 3.22 }));
  store.upsertListing(listing({ id: '440_B1_a', sku: '479;6', intent: 'buy', steamid: 'B1', metal: 3.33 }));
  const strat = new SnipeStrategy(store, book, prices, opps);
  assert.deepEqual(strat.evaluate('479;6', s), [], '0.11 ref of margin does not reach the minimum');
  store.upsertListing(listing({ id: '440_2', sku: '479;6', intent: 'sell', steamid: 'S2', metal: 2.66 }));
  assert.deepEqual(strat.evaluate('479;6', s), ['440_2']);
  store.deactivateListing('440_2');
  assert.deepEqual(strat.evaluate('479;6', s), []);
  assert.equal(opps.active('snipe').length, 0);
  assert.equal(opps.recent(10)[0].status, 'expired');
});

test('snipe: a single opportunity per SKU even with several sellers; the same steamid is not used as buyer', () => {
  const { store, book, prices, opps } = setup();
  const s = structuredClone(DEFAULT_SETTINGS);
  store.upsertListing(listing({ id: '440_1', sku: '479;6', intent: 'sell', steamid: 'S1', metal: 2.33 }));
  store.upsertListing(listing({ id: '440_2', sku: '479;6', intent: 'sell', steamid: 'S2', metal: 2.44 }));
  store.upsertListing(listing({ id: '440_S1_a', sku: '479;6', intent: 'buy', steamid: 'S1', metal: 3.55 })); // the seller itself buys at a higher price
  store.upsertListing(listing({ id: '440_B1_a', sku: '479;6', intent: 'buy', steamid: 'B1', metal: 3.33 }));
  const strat = new SnipeStrategy(store, book, prices, opps);
  const keep = strat.evaluate('479;6', s);
  assert.deepEqual(keep, ['440_1']);
  const d = JSON.parse(opps.active('snipe')[0].details!) as { sell: { buyer: { steamid: string } }; alternatives: unknown[] };
  assert.equal(d.sell.buyer.steamid, 'B1');
  assert.equal(d.alternatives.length, 1);
});

test('banking: proposes prices one step inside the spread', () => {
  const { store, book, prices, opps } = setup();
  const s = structuredClone(DEFAULT_SETTINGS);
  s.banking.minChurn24h = 1;
  s.banking.minSellDeletes24h = 0;
  const hour = now() - (now() % 3600);
  store.addChurn('479;6', hour, { updates: 20, sellUpdates: 5, sellDeletes: 3 });
  store.upsertItem('479;6', listing({ id: 'x', sku: '479;6', intent: 'sell', steamid: '0', metal: 1 }).item);
  store.upsertListing(listing({ id: '440_1', sku: '479;6', intent: 'sell', steamid: 'S1', metal: 3.66 }));
  store.upsertListing(listing({ id: '440_B1_a', sku: '479;6', intent: 'buy', steamid: 'B1', metal: 3.11 }));
  store.upsertListing(listing({ id: '440_B2_a', sku: '479;6', intent: 'buy', steamid: 'B2', metal: 3.0 }));
  const strat = new BankingStrategy(store, book, prices, opps);
  assert.equal(strat.run(s), 1);
  const row = opps.active('banking')[0];
  assert.equal(row.buy_price_ref, 3.22);
  assert.equal(row.sell_price_ref, 3.55);
  assert.ok(Math.abs((row.net_ref ?? 0) - 0.33) < 1e-9);
});

test('scm → keys: only SKUs the Steam Market name can identify', async () => {
  const { scmNameIdentifiesSku } = await import('../src/engine/strategies/scmKeys.ts');
  assert.ok(scmNameIdentifiesSku('5056;6'));
  assert.ok(scmNameIdentifiesSku('208;11;australium;kt-3'));
  assert.ok(scmNameIdentifiesSku('205;11;festive'));
  assert.ok(!scmNameIdentifiesSku('5056;6;uncraftable'), 'non-craftable is not in the market name');
  assert.ok(!scmNameIdentifiesSku('30421;5;u110'), 'unusual effects are lumped together');
  assert.ok(!scmNameIdentifiesSku('30469;6;p16738740'), 'paint is not in the market name');
  assert.ok(!scmNameIdentifiesSku('15000;15;w2;pk20'), 'war paint wear/skin mapping is not handled');
  assert.ok(!scmNameIdentifiesSku('6526;6;kt-3;td-589'), 'kit targets are not handled');
});

test('post-alert checks classify what happened to a snipe', async () => {
  const { PostAlertChecks } = await import('../src/engine/checks.ts');
  const { BptfSnapshotSource } = await import('../src/sources/bptfSnapshot.ts');
  const { SettingsManager } = await import('../src/engine/settings.ts');
  const { store, book, prices, opps } = setup();
  const s = structuredClone(DEFAULT_SETTINGS);
  store.upsertItem('479;6', listing({ id: 'x', sku: '479;6', intent: 'sell', steamid: '0', metal: 1 }).item);
  store.upsertListing(listing({ id: '440_1', sku: '479;6', intent: 'sell', steamid: 'S1', metal: 2.33 }));
  store.upsertListing(listing({ id: '440_B1_a', sku: '479;6', intent: 'buy', steamid: 'B1', metal: 3.33, uaClient: 'Gladiator.tf bot', details: 'Buying 0 / 2' }));
  new SnipeStrategy(store, book, prices, opps).evaluate('479;6', s);
  const opp = opps.active('snipe')[0];
  const d = JSON.parse(opp.details!) as { sell: { buyer: { family: string; room: number } }; links: { sellerTradeOfferForItem: string }; buy: { pure: { text: string } } };
  assert.equal(d.sell.buyer.family, 'gladiator');
  assert.equal(d.sell.buyer.room, 2);
  assert.ok(d.links.sellerTradeOfferForItem.endsWith('&for_item=440_2_1'));
  assert.equal(d.buy.pure.text, '2 ref + 1 rec'); // 2.33 ref = 21 scrap
  const checks = new PostAlertChecks(store, opps, book, new BptfSnapshotSource(store), new SettingsManager(store));
  await checks.runCheck(opp.id, 60);
  // buyer reprices below the alerted exit
  store.upsertListing(listing({ id: '440_B1_a', sku: '479;6', intent: 'buy', steamid: 'B1', metal: 2.44, uaClient: 'Gladiator.tf bot', details: 'Buying 0 / 2' }));
  await checks.runCheck(opp.id, 300);
  // seller's listing disappears
  store.deactivateListing('440_1');
  await checks.runCheck(opp.id, 900);
  const rows = store.db.all<{ offset_sec: number; verdict: string }>('SELECT offset_sec, verdict FROM opp_checks WHERE opp_id = ? ORDER BY offset_sec', opp.id);
  assert.deepEqual(rows.map((r) => r.verdict), ['alive', 'buyer_repriced', 'sell_gone']);
});

test('buy orders that are already full are not used as exits', () => {
  const { store, book, prices, opps } = setup();
  const s = structuredClone(DEFAULT_SETTINGS);
  store.upsertListing(listing({ id: '440_1', sku: '479;6', intent: 'sell', steamid: 'S1', metal: 2.33 }));
  store.upsertListing(listing({ id: '440_B1_a', sku: '479;6', intent: 'buy', steamid: 'B1', metal: 3.55, details: 'I am buying, I have 1 / 1.' }));
  store.upsertListing(listing({ id: '440_B2_a', sku: '479;6', intent: 'buy', steamid: 'B2', metal: 3.11, details: 'Stock: 0/1' }));
  new SnipeStrategy(store, book, prices, opps).evaluate('479;6', s);
  const opp = opps.active('snipe')[0];
  assert.equal(opp.sell_price_ref, 3.11, 'the full buy order (1/1) must be skipped');
});
