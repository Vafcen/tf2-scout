import SKUModule from '@tf2autobot/tf2-sku';

// The package is CommonJS: in ESM it arrives as the default export with the static methods.
const SKU = SKUModule as unknown as {
  fromObject(item: Record<string, unknown>): string;
  fromString(sku: string): ParsedSku;
};

export interface ParsedSku {
  defindex: number;
  quality: number;
  craftable: boolean;
  tradable: boolean;
  killstreak: number;
  australium: boolean;
  effect: number | null;
  festive: boolean;
  paintkit: number | null;
  wear: number | null;
  quality2: number | null;
  craftnumber: number | null;
  crateseries: number | null;
  target: number | null;
  output: number | null;
  outputQuality: number | null;
  paint: number | null;
}

/** Paint cans: the payload's paint attribute does not apply to the SKU. */
const PAINT_CAN_DEFINDEXES = new Set([
  5023, 5027, 5028, 5029, 5030, 5031, 5032, 5033, 5034, 5035, 5036, 5037, 5038, 5039, 5040, 5046, 5051, 5052, 5053,
  5054, 5055, 5056, 5060, 5061, 5062, 5063, 5064, 5065, 5076, 5077,
]);

/** Subset of the `item` object backpack.tf sends over the websocket / snapshot (v2 format). */
export interface BptfItem {
  defindex: number;
  id?: string;
  name?: string;
  marketName?: string;
  baseName?: string;
  imageUrl?: string;
  summary?: string;
  quality?: { id: number; name?: string } | number;
  craftable?: boolean;
  tradable?: boolean;
  killstreakTier?: number;
  australium?: boolean;
  festivized?: boolean;
  particle?: { id: number; name?: string };
  texture?: { id: number; name?: string };
  wearTier?: { id: number; name?: string };
  elevatedQuality?: { id: number; name?: string };
  craftNumber?: number;
  crateSeries?: number;
  paint?: { id?: number; name?: string; color?: string };
  spells?: { name: string; type?: string }[];
  sheen?: { id: number; name: string };
  killstreaker?: { id: number; name: string };
  recipe?: {
    targetItem?: { defindex?: number; _source?: { defindex?: number }; itemName?: string };
    outputItem?: {
      defindex?: number;
      summary?: string;
      quality?: { id: number };
      recipe?: { targetItem?: { defindex?: number; _source?: { defindex?: number } } };
    };
  };
  priceindex?: string;
  price?: {
    steam?: { currency?: string; value?: number; raw?: number; short?: string; long?: string };
    community?: { value?: number; valueHigh?: number; currency?: string; raw?: number; usd?: number; updatedAt?: number };
    suggested?: { raw?: number; usd?: number; short?: string };
  };
}

function targetDefindex(recipe: NonNullable<BptfItem['recipe']>): number | undefined {
  const t = recipe.targetItem;
  if (t?.defindex) return t.defindex;
  if (t?._source?.defindex) return t._source.defindex;
  const nested = recipe.outputItem?.recipe?.targetItem;
  if (nested?.defindex) return nested.defindex;
  if (nested?._source?.defindex) return nested._source.defindex;
  return undefined;
}

/** Builds the SKU (tf2autobot / pricedb format) from the item in the backpack.tf payload. */
export function skuFromBptfItem(item: BptfItem): string {
  const quality = typeof item.quality === 'number' ? item.quality : (item.quality?.id ?? 6);
  // backpack.tf omits `craftable`/`tradable` when they are false (it only sends `true`).
  const obj: Record<string, unknown> = {
    defindex: item.defindex,
    quality,
    craftable: item.craftable ?? false,
  };
  if (item.tradable === false) obj.tradable = false;
  if (item.killstreakTier) obj.killstreak = item.killstreakTier;
  if (item.australium) obj.australium = true;
  if (item.particle?.id) obj.effect = item.particle.id;
  if (item.festivized) obj.festive = true;
  if (item.texture?.id !== undefined && item.texture?.id !== null) obj.paintkit = item.texture.id;
  if (item.wearTier?.id) obj.wear = item.wearTier.id;
  if (item.elevatedQuality?.id) obj.quality2 = item.elevatedQuality.id;
  if (item.craftNumber && item.craftNumber >= 1 && item.craftNumber <= 100) obj.craftnumber = item.craftNumber;
  if (item.crateSeries) obj.crateseries = item.crateSeries;
  if (item.recipe) {
    const target = targetDefindex(item.recipe);
    if (target) obj.target = target;
    const out = item.recipe.outputItem;
    if (out?.defindex) {
      obj.output = out.defindex;
      const summary = out.summary ?? '';
      if (summary.includes('Killstreak Kit')) obj.killstreak = summary.includes('Specialized Killstreak Kit') ? 2 : 3;
      if (out.quality?.id) obj.outputQuality = out.quality.id;
    }
  }
  if (item.paint && !PAINT_CAN_DEFINDEXES.has(item.defindex) && item.paint.color) {
    obj.paint = parseInt(item.paint.color.replace('#', ''), 16);
  }
  return SKU.fromObject(obj);
}

export function parseSku(sku: string): ParsedSku {
  return SKU.fromString(sku);
}

/** SKU without the paint attribute (pricedb does not distinguish paints for most items). */
export function skuWithoutPaint(sku: string): string {
  return sku
    .split(';')
    .filter((p) => !p.startsWith('p') || p.startsWith('pk') || p === 'p')
    .join(';');
}

export function isUnusualSku(sku: string): boolean {
  const parts = sku.split(';');
  return parts[1] === '5' || parts.some((p) => /^u\d+$/.test(p));
}

export function qualityName(q: number): string {
  const map: Record<number, string> = {
    0: 'Normal', 1: 'Genuine', 3: 'Vintage', 5: 'Unusual', 6: 'Unique', 7: 'Community', 8: 'Valve', 9: 'Self-Made',
    11: 'Strange', 13: 'Haunted', 14: "Collector's", 15: 'Decorated',
  };
  return map[q] ?? `q${q}`;
}
