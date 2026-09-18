import type { ItemRow } from '../db/store.ts';
import { parseSku } from '../tf2/sku.ts';

export function bptfClassifiedsUrl(item: ItemRow | undefined, sku: string, intent?: 'buy' | 'sell'): string {
  const p = parseSku(sku);
  const params = new URLSearchParams();
  const base = item?.base_name ?? item?.name ?? '';
  if (base) params.set('item', base);
  params.set('quality', String(p.quality));
  params.set('tradable', p.tradable ? '1' : '-1');
  params.set('craftable', p.craftable ? '1' : '-1');
  params.set('australium', p.australium ? '1' : '-1');
  params.set('killstreak_tier', String(p.killstreak ?? 0));
  if (p.effect) params.set('particle', String(p.effect));
  if (intent) params.set('intent', intent);
  return `https://backpack.tf/classifieds?${params.toString()}`;
}

export function bptfProfileUrl(steamid: string): string {
  return `https://backpack.tf/profiles/${steamid}`;
}

export function steamProfileUrl(steamid: string): string {
  return `https://steamcommunity.com/profiles/${steamid}`;
}

export function scmUrl(marketHashName: string): string {
  return `https://steamcommunity.com/market/listings/440/${encodeURIComponent(marketHashName)}`;
}

export function pricedbUrl(sku: string): string {
  return `https://pricedb.io/item/${encodeURIComponent(sku)}`;
}

export function bptfStatsUrl(item: ItemRow | undefined, sku: string): string {
  // https://backpack.tf/stats/<Quality>/<Item>/Tradable/Craftable[/<priceindex>]
  const p = parseSku(sku);
  const qualityNames: Record<number, string> = {
    0: 'Normal', 1: 'Genuine', 3: 'Vintage', 5: 'Unusual', 6: 'Unique', 7: 'Community', 8: 'Valve', 9: 'Self-Made', 11: 'Strange', 13: 'Haunted', 14: "Collector's", 15: 'Decorated Weapon',
  };
  const base = item?.base_name ?? item?.name ?? '';
  let url = `https://backpack.tf/stats/${encodeURIComponent(qualityNames[p.quality] ?? 'Unique')}/${encodeURIComponent(base)}/${p.tradable ? 'Tradable' : 'Non-Tradable'}/${p.craftable ? 'Craftable' : 'Non-Craftable'}`;
  if (p.effect) url += `/${p.effect}`;
  return url;
}

/**
 * Steam trade-offer URL that opens the trade window with the partner's item already added
 * (same `for_item` parameter backpack.tf's lightning button uses). Only the partner's item can be preloaded.
 */
export function tradeOfferForItemUrl(tradeUrl: string | null, assetId: string | null): string | null {
  if (!tradeUrl) return null;
  if (!assetId) return tradeUrl;
  const sep = tradeUrl.includes('?') ? '&' : '?';
  return `${tradeUrl}${sep}for_item=440_2_${assetId}`;
}
