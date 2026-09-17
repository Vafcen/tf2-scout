import { EventEmitter } from 'node:events';

export interface SkuChange {
  sku: string;
  /** ids of sell listings created/updated in this batch (snipe candidates) */
  sellIds: string[];
  /** buy orders changed */
  buyChanged: boolean;
  /** deleted ids */
  deletedIds: string[];
}

export interface BusEvents {
  'listings:changed': [changes: Map<string, SkuChange>];
  'opportunity': [opp: { id: number; lane: string; sku: string; status: string; isNew: boolean; improved: boolean }];
  'keyrate': [rate: { bptfRef: number | null; bptfUsd: number | null }];
  'ws:status': [status: { connected: boolean; eventsPerMin: number; lastEventAt: number | null }];
}

class TypedBus extends EventEmitter {
  emitTyped<K extends keyof BusEvents>(event: K, ...args: BusEvents[K]): boolean {
    return this.emit(event, ...args);
  }
  onTyped<K extends keyof BusEvents>(event: K, listener: (...args: BusEvents[K]) => void): this {
    return this.on(event, listener as (...args: unknown[]) => void);
  }
}

export const bus = new TypedBus();
bus.setMaxListeners(50);
