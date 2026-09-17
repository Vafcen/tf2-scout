import type { NormListing, Store } from '../db/store.ts';
import { bus } from '../bus.ts';
import { logger } from '../log.ts';

const log = logger('keyrate');

/**
 * Derives the key price backpack.tf uses from the feed's listings:
 *   value.raw = keys * K + metal  ⇒  K = (value.raw - metal) / keys
 * and the USD per key that bptf uses in its conversions (community.usd / (community.raw / K)).
 */
export class KeyRateTracker {
  private samplesRef: number[] = [];
  private samplesUsd: number[] = [];
  bptfRef: number | null = null;
  bptfUsd: number | null = null;
  private lastPersist = 0;

  private store: Store;

  constructor(store: Store) {
    this.store = store;
    const last = store.latestKeyRate();
    if (last?.bptf_ref) this.bptfRef = last.bptf_ref;
    if (last?.bptf_usd) this.bptfUsd = last.bptf_usd;
  }

  observe(l: NormListing): void {
    if (l.keys >= 1 && l.valueRef && l.valueRef > 0) {
      const k = (l.valueRef - l.metal) / l.keys;
      if (k > 30 && k < 200) this.push(this.samplesRef, k, 200);
    }
    if (l.refs.communityRaw && l.refs.communityUsd && this.bptfRef) {
      const usdPerRef = l.refs.communityUsd / l.refs.communityRaw;
      const keyUsd = usdPerRef * this.bptfRef;
      if (keyUsd > 0.5 && keyUsd < 10) this.push(this.samplesUsd, keyUsd, 200);
    }
    if (this.samplesRef.length >= 20) {
      const ref = median(this.samplesRef);
      const usd = this.samplesUsd.length >= 5 ? median(this.samplesUsd) : this.bptfUsd;
      const changed = this.bptfRef === null || Math.abs(ref - this.bptfRef) > 0.005;
      this.bptfRef = Math.round(ref * 100) / 100;
      if (usd) this.bptfUsd = Math.round(usd * 10000) / 10000;
      const t = Date.now();
      if (changed || t - this.lastPersist > 10 * 60_000) {
        this.lastPersist = t;
        this.store.insertKeyRate({ bptfRef: this.bptfRef, bptfUsd: this.bptfUsd });
        bus.emitTyped('keyrate', { bptfRef: this.bptfRef, bptfUsd: this.bptfUsd });
        if (changed) log.info(`key according to backpack.tf: ${this.bptfRef} ref ≈ $${this.bptfUsd ?? '?'}`);
      }
    }
  }

  private push(arr: number[], v: number, max: number): void {
    arr.push(v);
    if (arr.length > max) arr.splice(0, arr.length - max);
  }
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
