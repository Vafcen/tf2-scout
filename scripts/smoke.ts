// Quick check of every data source. Usage: node scripts/smoke.ts
import { env } from '../src/config.ts';

const ok = (name: string, detail: string) => console.log(`✅ ${name}: ${detail}`);
const bad = (name: string, detail: string) => console.log(`❌ ${name}: ${detail}`);

async function pricedb(): Promise<void> {
  try {
    const res = await fetch('https://pricedb.io/api/autob/items/5021;6', { signal: AbortSignal.timeout(15_000) });
    const j = (await res.json()) as { buy?: { metal: number }; sell?: { metal: number } };
    if (j.buy && j.sell) ok('pricedb', `key ${j.buy.metal}/${j.sell.metal} ref`);
    else bad('pricedb', JSON.stringify(j).slice(0, 100));
  } catch (e) {
    bad('pricedb', (e as Error).message);
  }
}

async function scm(): Promise<void> {
  try {
    const res = await fetch('https://steamcommunity.com/market/priceoverview/?appid=440&currency=1&market_hash_name=Mann%20Co.%20Supply%20Crate%20Key', {
      headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json()) as { success?: boolean; lowest_price?: string; volume?: string };
    if (j.success) ok('Steam Market', `key ${j.lowest_price} (vol ${j.volume})`);
    else bad('Steam Market', `HTTP ${res.status}`);
  } catch (e) {
    bad('Steam Market', (e as Error).message);
  }
}

async function ws(): Promise<void> {
  await new Promise<void>((resolve) => {
    let n = 0;
    const sock = new WebSocket(env.BPTF_WS_URL);
    const t = setTimeout(() => {
      sock.close();
      if (n > 0) ok('backpack.tf websocket', `${n} events in 8 s`);
      else bad('backpack.tf websocket', 'no events in 8 s (another instance connected? the server limits connections per IP)');
      resolve();
    }, 8000);
    sock.onmessage = (m) => {
      try {
        const d = JSON.parse(String(m.data));
        n += Array.isArray(d) ? d.length : 1;
      } catch { /* ignore */ }
    };
    sock.onerror = () => {
      clearTimeout(t);
      bad('backpack.tf websocket', 'connection refused (expected if TF2 Scout is already running: backpack.tf allows one connection per IP)');
      resolve();
    };
  });
}

async function snapshot(): Promise<void> {
  if (!env.BPTF_TOKEN) return console.log('⏭  snapshot: no BPTF_TOKEN');
  try {
    const res = await fetch(`https://backpack.tf/api/classifieds/listings/snapshot?token=${env.BPTF_TOKEN}&appid=440&sku=${encodeURIComponent('Mann Co. Supply Crate Key')}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return bad('snapshot', `HTTP ${res.status} (invalid or blocked token)`);
    const j = (await res.json()) as { listings?: unknown[] };
    ok('snapshot', `${j.listings?.length ?? 0} key listings`);
  } catch (e) {
    bad('snapshot', (e as Error).message);
  }
}

async function api(): Promise<void> {
  if (!env.BPTF_API_KEY) return console.log('⏭  IGetUsers: no BPTF_API_KEY');
  const id = env.STEAM_ID64 ?? '76561198013127982';
  try {
    const res = await fetch(`https://backpack.tf/api/IGetUsers/v3?key=${env.BPTF_API_KEY}&steamids=${id}`, { signal: AbortSignal.timeout(20_000) });
    const j = (await res.json()) as { response?: { players?: Record<string, { name?: string; backpack_value?: Record<string, number> }> } };
    const p = j.response?.players?.[id];
    if (p) ok('IGetUsers', `${p.name ?? id}: ${p.backpack_value?.['440'] ?? '?'} ref`);
    else bad('IGetUsers', `HTTP ${res.status} ${JSON.stringify(j).slice(0, 120)}`);
  } catch (e) {
    bad('IGetUsers', (e as Error).message);
  }
}

async function discord(): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) return console.log('⏭  Discord: no DISCORD_WEBHOOK_URL');
  try {
    const res = await fetch(env.DISCORD_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'TF2 Scout', content: '✅ TF2 Scout connected to this channel.' }), signal: AbortSignal.timeout(15_000) });
    if (res.ok || res.status === 204) ok('Discord', 'test message sent');
    else bad('Discord', `HTTP ${res.status}`);
  } catch (e) {
    bad('Discord', (e as Error).message);
  }
}

await pricedb();
await scm();
await snapshot();
await api();
await discord();
await ws();
