# 🎯 TF2 Scout

TF2 Scout is a **read-only Team Fortress 2 trading-opportunity finder**. It listens to the public backpack.tf listing feed in real time, keeps a local order book in SQLite, cross-checks prices against pricedb.io and the Steam Community Market, and tells you where there is margin. It runs **no bots** and **never writes to Steam**: it does not log in to your account, does not send trade offers and does not create or bump listings. You execute every trade yourself, by hand, from your own account. Opportunities are grouped into seven lanes: **snipe**, **deal**, **banking**, **keys**, **SCM → keys**, **cash** and **unusual**, plus a **portfolio** page where you log what you actually did and see your FIFO profit and loss.

Dashboard: **http://localhost:4400** (localhost only by default).

## Why no bots

Section 4.C ("Automation") of the Steam Subscriber Agreement forbids using scripts, bots, macros or other non-human-controlled systems to interact with Steam and its marketplaces. TF2 Scout stays on the right side of that line by only *reading* data that is already public (the backpack.tf feed and APIs, pricedb.io, the Steam Market price overview) and presenting it to you; the buying and selling is still done by a human clicking through Steam and backpack.tf. That also means it can never trade on your behalf while you are away.

## Features

| Lane | What it looks for | How you execute it manually |
|---|---|---|
| **Snipe** | A sell listing on backpack.tf priced below the best *reliable* buy order for the same item (an online bot, or an online premium user). `net = best buy order − sell price`; needs `net ≥ 0.33 ref` and `≥ 3 %`. Only the cheapest unit per item is shown; other sellers appear as alternatives. | Open the opportunity, confirm both listings are still live on backpack.tf, send a trade offer to the seller through their trade URL, then send the item to the buy order. Bots accept in seconds if they still have room. |
| **Deal** | A sell listing at least 10 % below the pricedb sell price, backed by at least 3 online bot buy orders within 5 % of the pricedb buy price. Expected exit is the pricedb buy price (or 95 % of the sell price if that is higher than the cost). | Buy the item, then either sell it to the bot buy orders or list it yourself on backpack.tf. Check the item's price history first: a falling item is not a bargain. |
| **Banking** | Items with a real spread and turnover in the last 24 h. For each, it quotes a buy-order price (best buy + 0.11 ref) and a sell price (best sell − 0.11 ref) and ranks by `spread % × log2(1 + activity)`. Recomputed every 10 min, up to 50 items. | Create the buy order and, once you own the item, the sell listing on backpack.tf at the quoted prices. Accept offers that arrive at those prices. Mind backpack.tf's per-account listing limit. |
| **Keys** | A cross-market key board (pricedb, backpack.tf, best key buy order and sell listing on backpack.tf, Steam Market low/median/volume) and an instant key flip when someone sells keys for at least 0.11 ref less than the best online bot pays. | Buy the cheap keys from the seller, sell them to the buy order. |
| **SCM → keys** | Items that, bought on the Steam Community Market with wallet funds and sold to a bot buy order for keys, yield at least 15 % more keys per dollar than buying keys on the Market directly. Prices seen in the feed are re-verified on the Market before being published. | Buy on the Steam Market, wait out the 7-day trade hold, then sell to the best buy order that day. |
| **Cash** | marketplace.tf sell listings (they arrive in USD through the backpack.tf feed) whose cash price is at least 8 % below what bot buy orders pay in keys, valued at backpack.tf's cash price per key. | Buy on marketplace.tf with real money (no trade hold), sell the item to the bot buy order for keys. |
| **Unusual** | Unusual sell listings at least 15 % below the median of several references (pricedb sell, backpack.tf suggested price, best bot buy order × 1.1), with a confidence score that reflects how many references agree and how old they are. Enabled automatically when your capital is ≥ 20 keys. | Only with capital and judgment: read the effect/hat history first, buy, then exit to the buy order or list at about 92 % of the lowest reference and wait. |
| **Portfolio** | Not a lane: your own trade log. Realized profit is computed with FIFO per item, in ref and USD, and your backpack value is recorded daily if you provide a backpack.tf API key and SteamID. | Click "Mark as executed" on an opportunity and enter the real buy/sell prices, or log any trade by hand. |

## Data sources

| Source | Endpoint | Auth | Rate limits and notes |
|---|---|---|---|
| backpack.tf live feed | `wss://ws.backpack.tf/events` (`listing-update` / `listing-delete` events) | None | backpack.tf allows **one WebSocket connection per IP**. Run a single instance, and expect `pnpm smoke`'s WebSocket check to fail while the app is running. The payload also carries backpack.tf's suggested price, an embedded Steam Market price and marketplace.tf USD listings; the app derives the key's ref and USD rate from it. Reconnects with exponential backoff (1 s → 60 s). |
| backpack.tf classifieds snapshot | `https://backpack.tf/api/classifieds/listings/snapshot` | `BPTF_TOKEN` (user token) | Full order book for one item per request. Queued at **1 request every 2.5 s**; a `429` pauses the queue for 60 s, a `401`/`403` for 10 min. Priority: items with active opportunities, then your watchlist, then the most active items of the last 24 h. Without a token, the order book is built from the live feed only. |
| backpack.tf WebAPI | `https://backpack.tf/api/IGetUsers/v3` | `BPTF_API_KEY` + `STEAM_ID64` | Called at most once every ~23 h to record your backpack value for the Portfolio page. This is the only WebAPI endpoint the code uses. |
| pricedb.io | `https://pricedb.io/api/autob/items` | None | The full price list is synced every 30 min (key = SKU `5021;6`). |
| Steam Community Market | `https://steamcommunity.com/market/priceoverview/` | None | Steam enforces roughly **20 requests per minute per IP**. The app queues one request every 4 s, caches each item for 30 min, refreshes the key price every 10 min and pauses for 60 s on `429`. |
| Discord (output) | Your webhook URL | `DISCORD_WEBHOOK_URL` | Alerts are sent as embeds at about one message per 1.2 s, honoring Discord's `retry_after` on `429`. |

`STN_API_KEY` is accepted in `.env` and reported on the Status page, but this version makes no requests to STN.trading; leave it empty.

## Requirements

- **Node.js 24 or newer** (`"engines": { "node": ">=24" }`). The project runs TypeScript directly through Node's native type stripping, uses the built-in `node:sqlite` module, `process.loadEnvFile`, and the global `fetch`/`WebSocket`. There is no build step and no native module to compile.
- **pnpm** (a `pnpm-lock.yaml` is committed). npm works too: replace `pnpm <script>` with `npm run <script>` (`npm start` and `npm test` also work).
- **Operating system**
  - Linux: everything works. `scripts/install-service.sh` installs a systemd *user* service. Desktop notifications use `notify-send` (libnotify); if it is missing they are disabled automatically with a warning in the log.
  - macOS and Windows: the app and dashboard run the same way (`pnpm start`), but the systemd scripts do not apply and there are no desktop notifications (`notify-send` does not exist there). Use Discord alerts instead, or run it in Docker.
- **A Steam account you can actually trade with**, if you intend to act on what you see: not [limited](https://help.steampowered.com/en/faqs/view/71D3-35C2-AD96-AA3A), with TF2 Premium (a free account can only trade under restrictions), and with Steam Guard Mobile Authenticator enabled for more than 7 days so your offers are not held. None of this is needed just to run the dashboard.

## Setup, step by step

### 1. Clone and install

```bash
git clone https://github.com/Vafcen/tf2-scout.git
cd tf2-scout
pnpm install
```

### 2. Create your `.env`

```bash
cp .env.example .env
```

Every variable is optional; the app starts with an empty `.env` and runs on the public feed alone. The more you fill in, the more lanes light up. Values are validated at startup (`zod`): an invalid value prints the offending keys and exits.

| Variable | Where to get it | What it unlocks |
|---|---|---|
| `BPTF_TOKEN` | Sign in to backpack.tf with Steam, open <https://backpack.tf/connections>, click **Show Token** under "User Token". | The classifieds snapshot: the order book of each interesting item is re-fetched within seconds so you know a listing is still alive before you act. Strongly recommended. |
| `BPTF_API_KEY` | <https://backpack.tf/developer/apikey/view> → create a key. Site URL `http://localhost:4400`, comments "personal use, local dashboard". | Daily backpack value on the Portfolio page (together with `STEAM_ID64`). |
| `STEAM_ID64` | Paste your profile URL into <https://steamid.io> and copy the **steamID64** (17 digits). It is also the number in your backpack.tf profile URL, `backpack.tf/profiles/7656119...`. | Same as above. |
| `DISCORD_WEBHOOK_URL` | In Discord: channel settings → **Integrations** → **Webhooks** → **New Webhook** → **Copy Webhook URL**. Install the Discord app on your phone and enable notifications for that channel. | Push alerts for snipes, key flips and unusual deals (configurable per lane). |
| `STN_API_KEY` | <https://stntrading.eu/dev/apikey> | Nothing yet (see Data sources). Leave empty. |
| `PORT` | default `4400` | Dashboard port. |
| `HOST` | default `127.0.0.1` | Bind address. Keep `127.0.0.1` unless you know how you will protect the dashboard (see Running 24/7). |
| `DATA_DIR` | default `./data` | Where `scout.sqlite` lives. |
| `DESKTOP_NOTIFY` | default `true` | Allow `notify-send` desktop notifications (Linux). Note that notifications also have to be switched on in the dashboard; see the bell below. |
| `BPTF_WS_URL`, `LOG_LEVEL` | defaults `wss://ws.backpack.tf/events`, `info` | Advanced; not listed in `.env.example`. `LOG_LEVEL` accepts `debug`, `info`, `warn`, `error`. |

More detail on each credential is in [`docs/credentials.md`](docs/credentials.md). `.env` is git-ignored.

### 3. Start it

```bash
pnpm start
```

Open <http://localhost:4400>. The log tells you what is missing (`no BPTF_TOKEN: there will be no order book snapshot`, `no DISCORD_WEBHOOK_URL: alerts only go to the dashboard and the desktop`). The first opportunities appear within minutes; the key board runs 20 s after start, banking after 90 s, SCM → keys after 2 min, cash after 2.5 min, and all of them keep running on their own schedules.

### 4. Verify your sources

Stop the app first (the WebSocket check needs the single per-IP connection), then:

```bash
pnpm smoke
```

It checks pricedb, the Steam Market, the snapshot (if `BPTF_TOKEN` is set), `IGetUsers` (if `BPTF_API_KEY` is set), the Discord webhook (it posts a "connected" test message) and the backpack.tf WebSocket, and prints one line per source.

### 5. Run the tests

```bash
pnpm test
```

### 6. Tune it

Open **Settings** in the dashboard and set your capital in keys and the maximum price per item. The defaults are conservative and are listed in the Settings reference below. Changes apply immediately without a restart.

## Running 24/7

### systemd user service (Linux)

```bash
scripts/install-service.sh
```

The script writes `~/.config/systemd/user/tf2-scout.service` (working directory = the project folder, `ExecStart = node src/index.ts`, `Restart=always`, 5 s restart delay), reloads systemd, enables and starts the unit, and calls `loginctl enable-linger` so the service keeps running when you are not logged in. It reads the same `.env`.

```bash
journalctl --user -u tf2-scout -f      # follow the logs
systemctl --user restart tf2-scout     # after editing .env
scripts/uninstall-service.sh           # remove the service
```

### Docker

The image is `node:24-alpine`, installs production dependencies with pnpm, copies `src/` only, and stores the database in a `/data` volume.

Make a container-specific env file that holds only your credentials. The Dockerfile already sets `HOST=0.0.0.0`, `PORT=4400`, `DATA_DIR=/data` and `DESKTOP_NOTIFY=false`; if your `.env` also contains `HOST=127.0.0.1` or `DATA_DIR=./data`, passing it straight through would make the container unreachable and write the database outside the volume.

```bash
grep -E '^(BPTF_TOKEN|BPTF_API_KEY|STEAM_ID64|DISCORD_WEBHOOK_URL)=' .env > .env.docker
echo .env.docker >> .gitignore   # it holds secrets

docker build -t tf2-scout .

docker run -d --name tf2-scout \
  --restart unless-stopped \
  -p 127.0.0.1:4400:4400 \
  -v tf2-scout-data:/data \
  --env-file .env.docker \
  tf2-scout
```

Inside a container the process must listen on `0.0.0.0`; the `-p 127.0.0.1:4400:4400` mapping keeps the dashboard reachable only from the host itself. Do not run the container and a native instance at the same time (one WebSocket per IP).

### On a VPS

TF2 Scout is a single Node process plus one SQLite file, so it moves easily: copy the folder without `node_modules` and `data/`, run `pnpm install`, recreate `.env`, and use the same systemd script or the Dockerfile. Set `DESKTOP_NOTIFY=false` and rely on Discord for alerts.

**The dashboard has no authentication of its own.** Anyone who can reach the port can read your opportunities, change settings and edit your trade log. Keep `HOST=127.0.0.1` and reach it through an SSH tunnel:

```bash
ssh -N -L 4400:127.0.0.1:4400 user@your-vps
# then open http://localhost:4400 on your machine
```

or put the host on a private network such as Tailscale and bind to that interface, or place it behind a reverse proxy (Caddy, nginx) that adds a password. Never expose port 4400 to the public internet as is.

## Using the dashboard

### Pages

- **Opportunities** (`/`): all active opportunities except banking, with filters for lane, minimum net profit (ref), minimum confidence, maximum price (keys) and whether to show listings flagged as suspicious. The table refreshes every 5 s, and a Server-Sent Events stream pops a toast for new snipe, keys, unusual and cash opportunities. Click an item to open its detail page: buy/sell/net/confidence, step-by-step instructions, alternative sellers, references, links, the seller's listing text, and the full JSON.
- **Banking** (`/banking`): the current banking proposals sorted by score, with the price to place your buy order at, the price to sell at, the net per cycle, spread, 24 h activity (sells removed, sells posted, events) and the state of the book. "Recalculate now" reruns the strategy immediately.
- **Keys** (`/keys`): the key board (pricedb buy/sell, backpack.tf rate derived from the feed and its USD value, best buy order and sell listing on backpack.tf, Steam Market low/median/volume and what you would net selling a key there after Steam's 15 % fee), key-flip opportunities and the recent rate history.
- **Portfolio** (`/portfolio`): realized profit (FIFO), number of buys and sells, open positions with their cost, daily backpack value, and the trade log.
- **Settings** (`/settings`): every threshold described below, alert lanes, desktop-notification master switch, "Restore defaults".
- **Status** (`/status`): feed connection and events per minute, pricedb sync age, Steam Market request and rate-limit counters, snapshot queue, engine counters, alerts sent, database size, memory, uptime and which `.env` variables are set.
- **Item** (`/item/<sku>`): the full order book for one item (buy orders and sell listings, bot/human, online/offline, conditional buy orders flagged), reference prices, 24 h activity, links to classifieds, backpack.tf stats, pricedb and the Steam Market, an **Add to watchlist** button (watchlisted items get snapshot priority) and **Query Steam Market now**.

JSON is available at `/api/opportunities`, `/api/item/<sku>`, `/api/keys`, `/api/settings` (GET and PUT), `/api/portfolio`, `/api/status`, `/health` returns `OK`, and `/events` is the SSE stream.

### Desktop alerts and the bell

The bell at the top right controls Linux desktop notifications (`notify-send`). It offers **Enable**, **Mute 1 h**, **Mute 4 h**, **Mute 12 h** and **Disable**. Desktop notifications are **off by default**; enable them from the bell or from Settings. Which lanes notify is chosen in Settings (default: snipe and unusual). Snipes are sent with `critical` urgency so they stay on screen. `DESKTOP_NOTIFY=false` in `.env` disables them regardless of the bell.

### Discord alerts

With `DISCORD_WEBHOOK_URL` set, each qualifying opportunity is posted once as an embed with net profit, confidence, buy and sell sides, a warning if the listing text looks like a middleman, and links (trade offer to seller, trade offer to buyer, classifieds, pricedb). Default lanes: snipe, unusual and keys. Rules that apply to both Discord and desktop alerts:

- only opportunities with confidence ≥ `alerts.minConfidence` (0.3) are alerted; lower ones are dashboard only;
- banking is never alerted per item; check the Banking tab instead;
- an alert for the same lane and item is not repeated within 30 min unless the net profit improves by more than 5 % (plus 0.05 ref).

### Acting on a snipe safely

1. Open the opportunity from the toast, the Discord message or the table.
2. Read the warning tags. A warning tag on the item means the seller's text mentions a keyword from your suspicious list (`quicksell.store`, `backpacks`, `sfuminator` by default), typically a middleman or a backpack seller. Buy orders whose text asks for spells, paints, parts, levels and the like are flagged "conditional" and are never used as an exit.
3. Click **Classifieds** and confirm that both the sell listing and the buy order are still there; the feed is fast but bots are faster, and the snapshot (if you have a token) only re-checks every couple of seconds per item.
4. Use **Send offer to seller** (their trade URL) to buy, then **Send offer to buyer** to sell to the buy order. Bots accept within seconds if they still have stock room.
5. Click **Mark as executed**. Dismiss the ones you skip so they stop cluttering the list.

### Logging trades and reading the FIFO P&L

"Mark as executed" takes you to **Log a trade** with the item, venue and prices pre-filled; adjust them to what you really paid and received. Log the buy when you receive the item and the sell when you close the position. Prices can be entered as keys + metal (converted to ref at the current key rate) or in USD for cash and wallet purchases; fees in USD are added to the cost of a buy and subtracted from the proceeds of a sell. Venues offered: backpack.tf, Steam Market, mannco.store, marketplace.tf, scrap.tf, other.

The Portfolio page matches each sell against the earliest unsold buys of the same SKU (first in, first out) and reports the realized profit in ref and USD. A sell with no logged buy counts as pure profit, so log both sides. Open positions are the buys not yet matched by a sell. Each trade row has a delete button.

## Settings reference

All values live in the SQLite `settings` table and are edited from the dashboard; the defaults are `DEFAULT_SETTINGS` in [`src/config.ts`](src/config.ts).

| Setting | Default | Meaning |
|---|---|---|
| `capitalKeys` | 20 | Your bankroll in keys. Caps the price of unusuals and, in `auto` mode, enables the unusual lane at ≥ 20 keys. |
| `maxItemPriceKeys` | 5 | Maximum price per item for snipe, deal and banking (0 = no limit). |
| `unit` | `keys` | Preferred display unit (`keys` or `usd`). Stored, but the current pages always show keys/ref with a USD hint. |
| `snipe.minNetRef` | 0.33 ref | Minimum absolute profit of an instant flip (also applies to deals). |
| `snipe.minPct` | 3 % | Minimum profit percentage of an instant flip. |
| `snipe.dealMinPct` | 10 % | Minimum discount versus the pricedb sell price for a deal. |
| `snipe.dealMinBuyOrders` | 3 | Online bot buy orders within 5 % of the pricedb buy price required for a deal. |
| `snipe.botPulseMaxAgeMin` | 15 min | A bot counts as online if its last pulse is more recent than this. |
| `snipe.ignoreDetailsKeywords` | `quicksell.store, backpacks, sfuminator` | Listings whose text contains these words are tagged suspicious and get low confidence. |
| `banking.minSpreadRef` | 0.33 ref | Minimum spread (and minimum net per cycle after the step). |
| `banking.minSpreadPct` | 5 % | Minimum spread as a percentage of the best buy. |
| `banking.maxSpreadPct` | 60 % | Larger spreads mean a dead market or a stale reference and are skipped. |
| `banking.minChurn24h` | 10 | Minimum feed events for the item in the last 24 h. |
| `banking.minSellDeletes24h` | 1 | Minimum sell listings removed in 24 h (a proxy for real sales). |
| `banking.minBotBuyOrders` | 2 | Minimum online bots on the buy side. |
| `banking.maxItems` | 50 | How many proposals to keep. |
| `banking.stepRef` | 0.11 ref | How far above the best buy / below the best sell to quote. |
| `keys.alertSpreadPct` | 8 % | Stored, not used by any strategy yet. |
| `scm.minPriceUsd` | $0.30 | Ignore Steam Market items cheaper than this in SCM → keys. |
| `scm.minListings` | 3 | Stored, not used by any strategy yet. |
| `scm.minAdvantagePct` | 15 % | Minimum improvement in keys per dollar versus buying keys on the Market. |
| `cash.minAdvantagePct` | 8 % | Minimum cash advantage of a marketplace.tf listing versus the key value of the bot buy order. |
| `cash.minSales30d`, `cash.manncoFeePct`, `cash.mptfFeePct` | 3, 5 %, 10 % | Stored, not used by any strategy yet. |
| `unusual.enabled` | `auto` | `auto` (on when `capitalKeys ≥ 20`), `on`, `off`. |
| `unusual.minDiscountPct` | 15 % | Minimum discount versus the median of the references. |
| `unusual.minRefs` | 2 | Minimum number of references (pricedb, backpack.tf suggested, best bot buy order). |
| `alerts.discordLanes` | snipe, unusual, keys | Lanes pushed to Discord. |
| `alerts.desktopLanes` | snipe, unusual | Lanes pushed to the desktop. |
| `alerts.oppTtlMin` | 30 min | Lifetime of an unconfirmed snipe (deals get double; keys 20 min, banking 60, SCM → keys 90, cash 120, unusual 180). |
| `alerts.minConfidence` | 0.3 | Minimum confidence to alert. |
| `alerts.desktopEnabled` | false | Master switch for desktop notifications (the bell). |
| `alerts.desktopMutedUntil` | 0 | Unix timestamp until which desktop notifications are muted (set by the bell). |

## How it works

```text
backpack.tf WebSocket ──┐
backpack.tf snapshot ───┤   listings, items, churn, ref prices, key rates
pricedb.io ─────────────┼──▶ SQLite (data/scout.sqlite, WAL) ──▶ order book per SKU
Steam Market ───────────┘                                            │
                                                                     ▼
                                     strategies: snipe/deal (per event), unusual (per event),
                                     banking (10 min), keys (5 min), SCM → keys (10 min), cash (10 min)
                                                                     │
                                                                     ▼
                                     opportunities table (new → alerted → executed/dismissed/expired)
                                                                     │
                                          ┌──────────────────────────┼──────────────────────────┐
                                          ▼                          ▼                          ▼
                                 Hono + HTMX dashboard         Discord webhook           notify-send desktop
                                 (SSE toasts, 5 s refresh)
```

1. **Collector.** `src/sources/bptfWs.ts` keeps one WebSocket open to backpack.tf and writes every listing update or deletion into SQLite inside a transaction, along with the item metadata, hourly churn counters per SKU, the suggested price and Steam Market price embedded in the payload, and samples used to derive the key's ref and USD rate. `bptfSnapshot.ts` refreshes whole order books for the items that matter most when you have a token. `pricedb.ts` and `scm.ts` fill the reference price tables.
2. **Order book.** `src/engine/orderbook.ts` turns the active listings of a SKU into sorted buy and sell sides valued in ref (keys × key rate + metal), marks bots online or offline from their pulse, drops banned users, and flags buy orders that are conditional or far above reference so they are never used as an exit.
3. **Strategies.** Changes from the feed are batched (300 ms) and the snipe/deal and unusual strategies re-evaluate only the SKUs that changed. The other lanes run on timers. Each strategy writes to a single `opportunities` table through `src/engine/opportunities.ts`, which handles de-duplication (one row per lane + SKU + listing), improvement detection, the 30-minute anti-spam rule, expiry when a listing disappears, and cleanup.
4. **Delivery.** The engine listens for new or improved opportunities and fans them out to Discord and the desktop according to your settings; the Hono web server renders the pages with HTMX and pushes the same events over SSE. Every five minutes a maintenance pass expires stale opportunities and prunes old rows.

The exact formulas, thresholds and confidence rules of every lane are documented in [`docs/strategies.md`](docs/strategies.md).

### Project layout

```text
tf2-scout/
├── src/
│   ├── index.ts            # wires everything and starts it; graceful shutdown
│   ├── config.ts           # .env validation, Settings type and DEFAULT_SETTINGS
│   ├── sources/            # bptfWs, bptfSnapshot, bptfApi, pricedb, scm
│   ├── db/                 # node:sqlite wrapper, versioned schema.sql, Store
│   ├── engine/
│   │   ├── index.ts        # Engine: timers, batching, alert fan-out
│   │   ├── orderbook.ts    # per-SKU book, online/conditional detection
│   │   ├── prices.ts       # reference prices, key rate, ref <-> USD
│   │   ├── opportunities.ts# upsert / expire / status of opportunities
│   │   ├── keyRate.ts      # key ref/USD rate derived from the feed
│   │   └── strategies/     # snipe (+deal), banking, keys, scmKeys, cash, unusual
│   ├── alerts/             # discord.ts (webhook queue), desktop.ts (notify-send)
│   ├── ledger/trades.ts    # trade log and FIFO P&L
│   ├── tf2/                # SKU parsing, currency math, text normalization
│   └── web/                # Hono server, layout, routes/, public/ (CSS + SSE client)
├── scripts/                # smoke.ts, collect-test.ts, install/uninstall-service.sh
├── test/                   # node --test suites and fixtures
├── docs/                   # credentials.md, strategies.md
├── data/                   # scout.sqlite (created at runtime, git-ignored)
├── Dockerfile
└── .env.example
```

## Limitations and honest expectations

- **Bots out-snipe humans.** Trading bots react to the same feed in well under a second; by the time you have clicked through, the cheapest listing is often gone. Expect to catch a fraction of the snipes you see. The value of the tool is market-wide coverage and fast, filtered notification, not a guaranteed edge.
- **The feed only carries changes.** After a fresh start the order book is empty and converges over minutes to hours as listings update. The snapshot (with `BPTF_TOKEN`) fixes that for the items that matter; without it, an item's book may be incomplete or include listings that were already removed.
- **Steam Market purchases are trade-locked for 7 days.** The SCM → keys lane is a slow route by design, and the key price can move against you while you wait.
- **mannco.store and marketplace.tf have no usable public API.** The cash lane only sees marketplace.tf listings that happen to arrive through the backpack.tf feed; there is no direct marketplace polling, and selling keys for cash is left to you.
- **pricedb can be stale for illiquid items.** Reference prices for rarely traded items and unusuals may be weeks or months old; the deal and unusual lanes lower confidence for old references, but a stale reference can still make a falling item look like a bargain. Always check the history link before buying.
- **Bot buy orders have conditions and stock limits.** Conditional orders are filtered heuristically from their text and may still slip through; a bot that is full or offline will not accept.
- **The Steam Market and snapshot are rate limited**, so verification is queued and can lag by minutes when there are many candidates.
- **No profit is guaranteed.** This is a screening tool. You are responsible for every trade you make and for complying with Steam's and backpack.tf's terms.

## Development

```bash
pnpm dev        # start with auto-restart on file changes (node --watch)
pnpm test       # unit tests (node --test test/)
pnpm typecheck  # tsc --noEmit
pnpm smoke      # check every external source and the Discord webhook
node scripts/collect-test.ts 60   # listen to the feed for 60 s and print what landed in the database
```

The database schema is versioned in `src/db/schema.sql`: append a new `-- vN:` block for any change and it is applied on the next start. TypeScript is written in the erasable subset (`erasableSyntaxOnly`, `verbatimModuleSyntax`) so Node can run it without a compiler; `tsc` is only used for type checking.

Contributions are welcome: open an issue or a pull request. Keep changes read-only with respect to Steam and backpack.tf (no automated trading, listing or bumping), keep `pnpm test` and `pnpm typecheck` green, and document any new threshold in `docs/strategies.md`.

Licensed under the [MIT License](LICENSE).
