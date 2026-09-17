import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from '../config.ts';
import type { Store } from '../db/store.ts';
import { logger } from '../log.ts';

const log = logger('settings');

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return (patch === undefined ? base : (patch as T));
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return patch as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = deepMerge((base as Record<string, unknown>)[k], v);
  }
  return out as T;
}

export class SettingsManager {
  private store: Store;
  private cached: Settings;
  constructor(store: Store) {
    this.store = store;
    this.cached = this.load();
  }

  private load(): Settings {
    const saved = this.store.getSetting<unknown>('settings');
    const merged = deepMerge(DEFAULT_SETTINGS, saved ?? {});
    const parsed = SettingsSchema.safeParse(merged);
    if (!parsed.success) {
      log.warn('saved settings are invalid, falling back to defaults', parsed.error.issues);
      return structuredClone(DEFAULT_SETTINGS);
    }
    return parsed.data;
  }

  get(): Settings {
    return this.cached;
  }

  update(patch: unknown): Settings {
    const merged = deepMerge(this.cached, patch);
    const parsed = SettingsSchema.safeParse(merged);
    if (!parsed.success) throw new Error('invalid settings: ' + parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    this.cached = parsed.data;
    this.store.setSetting('settings', this.cached);
    return this.cached;
  }

  reset(): Settings {
    this.cached = structuredClone(DEFAULT_SETTINGS);
    this.store.setSetting('settings', this.cached);
    return this.cached;
  }
}
