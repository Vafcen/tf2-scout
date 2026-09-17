# How TF2 Scout decides (rules and formulas)

Everything is valued in **ref**: `value = keys × K + metal`. For keys you **pay**, K = the key's sell price in pricedb
(what it costs to buy one); for keys you **receive**, K = the buy price (what the bots pay). USD conversions use the
key cash price published by backpack.tf (≈ marketplace.tf).

## Order book
- Fed by the backpack.tf websocket (every listing created/updated/deleted) and, with `BPTF_TOKEN`, by the snapshot.
- A bot counts as **online** if its last pulse is recent (`botPulseMaxAgeMin`, 15 min).
- A buy order is flagged **conditional** (⚠, not usable as an exit) if its text asks for parts, spells, paints, sheens,
  levels… or if it is > 60 % above the reference (usually a "bait" for specific attributes).
- Banned users are ignored.

## Snipe (instant flip)
`net = bestBuyOrder − sellPrice`. Opportunity if `net ≥ minNetRef (0.33 ref)` and `net/price ≥ minPct (3 %)`.
Only the cheapest unit per SKU; the remaining sellers are shown as alternatives. High confidence if the buyer is an
online bot; low if the seller mentions intermediaries (quicksell.store, backpacks…).

## Deal
`discount = (pricedb.sell − price) / pricedb.sell ≥ dealMinPct (10 %)` with ≥ `dealMinBuyOrders` (3) bot buy orders
within 5 % of `pricedb.buy`. Expected exit = `pricedb.buy` if it exceeds the cost, otherwise `pricedb.sell × 0.95`.

## Manual banking
Candidates: SKUs with ≥ `minChurn24h` events in 24 h. `spread = bestSell − bestBuy`; requires ≥ 0.33 ref and ≥ 5 %,
≥ 2 online bots buying and price ≤ `maxItemPriceKeys`. Proposal: `buy = bestBuy + 0.11`, `sell = bestSell − 0.11`.
Ranked by `spread% × log2(1 + activity)` where `activity = 3·removedSells + newSells + events/10`.

## Keys
Board with pricedb, backpack.tf (derived from the feed), best key buy/sell on bptf, Steam Market and cash. Opportunity if
the best key sell listing is ≥ 0.11 ref below the best buy order (online bots).

## SCM → keys
`keysPerUSD = (bestBuyOrder / K_receive) / scmPrice`; baseline = `1 / scmKeyPrice`. Opportunity if the improvement is
≥ `minAdvantagePct` (15 %) with ≥ 2 bots buying. Prices embedded in the feed are verified on the Market before the
opportunity is published. Remember: anything bought on the Market is trade-locked for **7 days**.

## Cash → keys
marketplace.tf listings (USD) from the feed: opportunity if `keysReceived × keyUSD ≥ priceUSD × (1 + minAdvantagePct)`.

## Unusual
References: pricedb (sell), backpack.tf suggested price and the best bot buy order × 1.1 (references older than 1 year
are discarded if others exist). `discount = (median − price) / median ≥ minDiscountPct (15 %)` with ≥ `minRefs` (2)
references. Conservative exit: the buy order if it is already profitable, otherwise 92 % of the lowest reference.
Confidence drops with the dispersion between references and their age, and rises with real buy orders.

## Alerts and expiration
Discord/desktop only for the lanes enabled in Settings and with confidence ≥ `minConfidence` (0.3). An alert for the
same SKU/lane is not repeated within 30 min unless it improves. Opportunities expire when the listing disappears or
after `oppTtlMin`.
