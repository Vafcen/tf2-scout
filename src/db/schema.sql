-- v1: TF2 Scout base schema
CREATE TABLE IF NOT EXISTS items (
  sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  market_name TEXT,
  defindex INTEGER,
  quality INTEGER,
  effect INTEGER,
  ks_tier INTEGER DEFAULT 0,
  australium INTEGER DEFAULT 0,
  image_url TEXT,
  first_seen INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  intent TEXT NOT NULL,             -- buy | sell
  steamid TEXT NOT NULL,
  keys REAL NOT NULL DEFAULT 0,
  metal REAL NOT NULL DEFAULT 0,
  usd REAL,                         -- marketplace.tf listings
  value_ref REAL,                   -- backpack.tf value.raw (ref at its key rate)
  is_bot INTEGER NOT NULL DEFAULT 0,
  ua_client TEXT,
  last_pulse INTEGER,
  premium INTEGER DEFAULT 0,
  banned INTEGER DEFAULT 0,
  online INTEGER DEFAULT 0,
  user_name TEXT,
  trade_url TEXT,
  listed_at INTEGER,
  bumped_at INTEGER,
  details TEXT,
  source TEXT,
  count INTEGER DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  seen_at INTEGER NOT NULL,         -- last time we saw it (ws or snapshot)
  flags TEXT                        -- json: spells, paint, etc.
);
CREATE INDEX IF NOT EXISTS listings_sku_intent ON listings(sku, intent, active);
CREATE INDEX IF NOT EXISTS listings_seen ON listings(seen_at);
CREATE INDEX IF NOT EXISTS listings_steamid ON listings(steamid);

CREATE TABLE IF NOT EXISTS events (
  ts INTEGER NOT NULL,
  sku TEXT NOT NULL,
  intent TEXT NOT NULL,
  type TEXT NOT NULL,               -- update | delete
  is_bot INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS events_sku_ts ON events(sku, ts);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);

CREATE TABLE IF NOT EXISTS ref_prices (
  sku TEXT NOT NULL,
  src TEXT NOT NULL,                -- pricedb | bptf
  buy_keys REAL, buy_metal REAL,
  sell_keys REAL, sell_metal REAL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (sku, src)
);

CREATE TABLE IF NOT EXISTS scm_prices (
  sku TEXT PRIMARY KEY,
  market_name TEXT,
  lowest_cents INTEGER,             -- lowest sell price on SCM (what the buyer pays)
  median_cents INTEGER,
  volume INTEGER,
  listings INTEGER,
  highest_buy_cents INTEGER,
  item_nameid TEXT,
  src TEXT,                         -- bptf (embedded in the feed) | scm (priceoverview)
  ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS key_rates (
  ts INTEGER PRIMARY KEY,
  bptf_ref REAL,                    -- key in ref according to backpack.tf (derived from the feed)
  pricedb_buy_ref REAL,
  pricedb_sell_ref REAL,
  bptf_usd REAL,                    -- USD per key that backpack.tf uses in its conversions
  scm_usd_low REAL,
  scm_usd_median REAL,
  scm_volume INTEGER,
  stn_buy_ref REAL,
  stn_sell_ref REAL,
  bptf_best_buy_ref REAL,           -- best key buy order (bots) on bptf
  bptf_best_sell_ref REAL           -- best key sell listing on bptf
);

CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lane TEXT NOT NULL,
  sku TEXT NOT NULL,
  listing_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  buy_venue TEXT, buy_price_ref REAL, buy_price_usd REAL,
  sell_venue TEXT, sell_price_ref REAL, sell_price_usd REAL,
  net_ref REAL, net_usd REAL, pct REAL,
  confidence REAL NOT NULL DEFAULT 0.5,
  details TEXT,                     -- json with links, context, steps
  status TEXT NOT NULL DEFAULT 'new',  -- new | alerted | expired | executed | dismissed
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,
  alerted_at INTEGER,
  UNIQUE (lane, sku, listing_id)
);
CREATE INDEX IF NOT EXISTS opp_status ON opportunities(status, updated_at);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  sku TEXT NOT NULL,
  name TEXT,
  side TEXT NOT NULL,               -- buy | sell
  venue TEXT,
  qty INTEGER NOT NULL DEFAULT 1,
  price_ref REAL,                   -- unit price in ref (equivalent)
  price_usd REAL,
  fees_usd REAL DEFAULT 0,
  opportunity_id INTEGER,
  note TEXT
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  ts INTEGER PRIMARY KEY,
  value_ref REAL,
  value_usd REAL,
  slots INTEGER,
  src TEXT
);

CREATE TABLE IF NOT EXISTS watchlist (
  sku TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- v2: churn aggregated by hour (replaces events, which is too voluminous)
CREATE TABLE IF NOT EXISTS churn (
  sku TEXT NOT NULL,
  hour_ts INTEGER NOT NULL,          -- start of the hour (unix s)
  updates INTEGER NOT NULL DEFAULT 0,
  deletes INTEGER NOT NULL DEFAULT 0,
  sell_updates INTEGER NOT NULL DEFAULT 0,
  sell_deletes INTEGER NOT NULL DEFAULT 0,
  human_sell_updates INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (sku, hour_ts)
);
CREATE INDEX IF NOT EXISTS churn_hour ON churn(hour_ts);
DROP TABLE IF EXISTS events;

-- v3: item base name (for backpack.tf classifieds links)
ALTER TABLE items ADD COLUMN base_name TEXT;

-- v4: execution metadata (asset ids, stock room, attributes) and post-alert checks
ALTER TABLE listings ADD COLUMN asset_id TEXT;
ALTER TABLE listings ADD COLUMN trade_offers_preferred INTEGER;
ALTER TABLE listings ADD COLUMN buyout_only INTEGER;
ALTER TABLE listings ADD COLUMN stock_room INTEGER;      -- buy orders: units the buyer still wants (NULL = unknown)
ALTER TABLE listings ADD COLUMN stock_units INTEGER;     -- sell listings: units the seller has (NULL = unknown)
ALTER TABLE listings ADD COLUMN festivized INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS opp_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opp_id INTEGER NOT NULL,
  offset_sec INTEGER NOT NULL,          -- 60 / 300 / 900 seconds after the alert
  checked_at INTEGER NOT NULL,
  sell_alive INTEGER NOT NULL,
  buy_alive INTEGER NOT NULL,
  best_buy_ref REAL,
  net_then REAL,
  verdict TEXT NOT NULL,                -- alive | sell_gone | buyer_gone | buyer_repriced | unprofitable
  verified INTEGER NOT NULL DEFAULT 0   -- 1 when the check ran right after a fresh snapshot
);
CREATE INDEX IF NOT EXISTS opp_checks_opp ON opp_checks(opp_id, offset_sec);
CREATE INDEX IF NOT EXISTS opp_lane_created ON opportunities(lane, created_at);
