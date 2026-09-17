import { env } from '../config.ts';
import { logger } from '../log.ts';

const log = logger('bptf-api');

export interface BptfUser {
  name?: string;
  backpack_value?: Record<string, number>;
  backpack_update?: Record<string, number>;
  premium?: boolean;
  bans?: Record<string, unknown>;
  trust?: { positive?: number; negative?: number };
}

/** backpack.tf WebAPI endpoints that need BPTF_API_KEY. */
export class BptfApi {
  get enabled(): boolean {
    return !!env.BPTF_API_KEY;
  }

  async getUser(steamid: string): Promise<BptfUser | null> {
    if (!this.enabled) return null;
    const url = `https://backpack.tf/api/IGetUsers/v3?key=${encodeURIComponent(env.BPTF_API_KEY!)}&steamids=${steamid}`;
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'tf2-scout/0.1 (local dashboard; read-only)' }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) {
        log.warn(`IGetUsers responded ${res.status}`);
        return null;
      }
      const data = (await res.json()) as { response?: { success?: number; players?: Record<string, BptfUser>; message?: string } };
      const player = data.response?.players?.[steamid];
      if (!player) {
        log.warn(`IGetUsers returned no data for ${steamid}: ${data.response?.message ?? 'empty response'}`);
        return null;
      }
      return player;
    } catch (err) {
      log.warn('IGetUsers error', (err as Error).message);
      return null;
    }
  }
}
