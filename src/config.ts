import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// Load .env if it exists (Node ≥ 20.12 ships process.loadEnvFile)
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch (err) {
    console.warn('[config] could not read .env:', (err as Error).message);
  }
}

const emptyToUndef = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const EnvSchema = z.object({
  BPTF_TOKEN: z.preprocess(emptyToUndef, z.string().min(10).optional()),
  BPTF_API_KEY: z.preprocess(emptyToUndef, z.string().min(10).optional()),
  STEAM_ID64: z.preprocess(emptyToUndef, z.string().regex(/^\d{17}$/).optional()),
  DISCORD_WEBHOOK_URL: z.preprocess(emptyToUndef, z.string().url().optional()),
  STN_API_KEY: z.preprocess(emptyToUndef, z.string().min(5).optional()),
  PORT: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).max(65535).default(4400)),
  HOST: z.preprocess(emptyToUndef, z.string().default('127.0.0.1')),
  DATA_DIR: z.preprocess(emptyToUndef, z.string().default('./data')),
  DESKTOP_NOTIFY: z.preprocess(emptyToUndef, z.enum(['true', 'false']).default('true')),
  BPTF_WS_URL: z.preprocess(emptyToUndef, z.string().default('wss://ws.backpack.tf/events')),
  LOG_LEVEL: z.preprocess(emptyToUndef, z.enum(['debug', 'info', 'warn', 'error']).default('info')),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('[config] invalid environment variables:', parsed.error.issues);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  DATA_DIR: resolve(process.cwd(), parsed.data.DATA_DIR),
  DESKTOP_NOTIFY: parsed.data.DESKTOP_NOTIFY === 'true',
};

export type Lane = 'snipe' | 'deal' | 'banking' | 'keys' | 'scm_keys' | 'cash' | 'unusual';

/** Settings editable from the dashboard (stored in the settings table). */
export interface Settings {
  capitalKeys: number;
  maxItemPriceKeys: number;
  unit: 'keys' | 'usd';
  snipe: {
    minNetRef: number; // minimum absolute profit (ref) for an instant flip
    minPct: number; // minimum profit % for an instant flip
    dealMinPct: number; // minimum discount vs pricedb.sell for a "deal"
    dealMinBuyOrders: number; // bot buy orders within 5% of pricedb.buy
    botPulseMaxAgeMin: number; // a bot is considered online if lastPulse < N min
    ignoreDetailsKeywords: string[]; // listings whose details contain these words get tagged (e.g. quicksell.store)
  };
  banking: {
    minSpreadRef: number;
    minSpreadPct: number;
    maxSpreadPct: number; // larger spreads indicate a dead market or a stale reference price
    minChurn24h: number;
    minSellDeletes24h: number; // sell listings removed in 24 h (proxy for real sales)
    minBotBuyOrders: number;
    maxItems: number;
    stepRef: number; // 0.11 ref by default
  };
  keys: { alertSpreadPct: number };
  scm: { minPriceUsd: number; minListings: number; minAdvantagePct: number };
  cash: { minAdvantagePct: number; minSales30d: number; manncoFeePct: number; mptfFeePct: number };
  unusual: { enabled: 'auto' | 'on' | 'off'; minDiscountPct: number; minRefs: number };
  alerts: {
    discordLanes: Lane[];
    desktopLanes: Lane[];
    oppTtlMin: number;
    minConfidence: number;
    desktopEnabled: boolean; // master switch for desktop notifications
    desktopMutedUntil: number; // unix s; 0 = no temporary mute
  };
}

export const DEFAULT_SETTINGS: Settings = {
  capitalKeys: 20,
  maxItemPriceKeys: 5,
  unit: 'keys',
  snipe: {
    minNetRef: 0.33,
    minPct: 3,
    dealMinPct: 10,
    dealMinBuyOrders: 3,
    botPulseMaxAgeMin: 15,
    ignoreDetailsKeywords: ['quicksell.store', 'backpacks', 'sfuminator'],
  },
  banking: { minSpreadRef: 0.33, minSpreadPct: 5, maxSpreadPct: 60, minChurn24h: 10, minSellDeletes24h: 1, minBotBuyOrders: 2, maxItems: 50, stepRef: 0.11 },
  keys: { alertSpreadPct: 8 },
  scm: { minPriceUsd: 0.3, minListings: 3, minAdvantagePct: 15 },
  cash: { minAdvantagePct: 8, minSales30d: 3, manncoFeePct: 5, mptfFeePct: 10 },
  unusual: { enabled: 'auto', minDiscountPct: 15, minRefs: 2 },
  alerts: { discordLanes: ['snipe', 'unusual', 'keys'], desktopLanes: ['snipe', 'unusual'], oppTtlMin: 30, minConfidence: 0.3, desktopEnabled: false, desktopMutedUntil: 0 },
};

export const SettingsSchema: z.ZodType<Settings> = z.object({
  capitalKeys: z.number().min(0),
  maxItemPriceKeys: z.number().min(0),
  unit: z.enum(['keys', 'usd']),
  snipe: z.object({
    minNetRef: z.number().min(0),
    minPct: z.number().min(0),
    dealMinPct: z.number().min(0),
    dealMinBuyOrders: z.number().int().min(0),
    botPulseMaxAgeMin: z.number().min(1),
    ignoreDetailsKeywords: z.array(z.string()),
  }),
  banking: z.object({
    minSpreadRef: z.number().min(0),
    minSpreadPct: z.number().min(0),
    maxSpreadPct: z.number().min(0),
    minChurn24h: z.number().min(0),
    minSellDeletes24h: z.number().int().min(0),
    minBotBuyOrders: z.number().int().min(0),
    maxItems: z.number().int().min(1).max(500),
    stepRef: z.number().min(0),
  }),
  keys: z.object({ alertSpreadPct: z.number().min(0) }),
  scm: z.object({ minPriceUsd: z.number().min(0), minListings: z.number().int().min(0), minAdvantagePct: z.number().min(0) }),
  cash: z.object({
    minAdvantagePct: z.number().min(0),
    minSales30d: z.number().int().min(0),
    manncoFeePct: z.number().min(0).max(100),
    mptfFeePct: z.number().min(0).max(100),
  }),
  unusual: z.object({ enabled: z.enum(['auto', 'on', 'off']), minDiscountPct: z.number().min(0), minRefs: z.number().int().min(1) }),
  alerts: z.object({
    discordLanes: z.array(z.enum(['snipe', 'deal', 'banking', 'keys', 'scm_keys', 'cash', 'unusual'])),
    desktopLanes: z.array(z.enum(['snipe', 'deal', 'banking', 'keys', 'scm_keys', 'cash', 'unusual'])),
    oppTtlMin: z.number().min(1),
    minConfidence: z.number().min(0).max(1),
    desktopEnabled: z.boolean(),
    desktopMutedUntil: z.number().min(0),
  }),
});
