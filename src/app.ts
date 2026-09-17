import type { Db } from './db/db.ts';
import type { Store } from './db/store.ts';
import type { KeyRateTracker } from './engine/keyRate.ts';
import type { BptfWebSocket } from './sources/bptfWs.ts';
import type { PricedbSource } from './sources/pricedb.ts';
import type { ScmSource } from './sources/scm.ts';
import type { Engine } from './engine/index.ts';

export interface AppContext {
  db: Db;
  store: Store;
  keyRate: KeyRateTracker;
  ws: BptfWebSocket;
  pricedb: PricedbSource;
  scm: ScmSource;
  engine: Engine;
}
