import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config.ts';
import { logger } from '../log.ts';

const log = logger('db');
const here = dirname(fileURLToPath(import.meta.url));

export type Row = Record<string, unknown>;

export class Db {
  readonly sqlite: DatabaseSync;
  private cache = new Map<string, StatementSync>();

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec('PRAGMA journal_mode = WAL');
    this.sqlite.exec('PRAGMA synchronous = NORMAL');
    this.sqlite.exec('PRAGMA temp_store = MEMORY');
    this.sqlite.exec('PRAGMA cache_size = -65536');
    this.migrate();
  }

  private migrate(): void {
    const version = (this.sqlite.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    const sql = readFileSync(join(here, 'schema.sql'), 'utf8');
    // schema.sql is split into "-- vN" blocks; the blocks with N > user_version are executed.
    const blocks = sql.split(/^-- v(\d+):.*$/m);
    let latest = version;
    for (let i = 1; i < blocks.length; i += 2) {
      const v = Number(blocks[i]);
      const body = blocks[i + 1];
      if (v <= version) continue;
      this.sqlite.exec(body);
      this.sqlite.exec(`PRAGMA user_version = ${v}`);
      latest = v;
      log.info(`schema upgraded to v${v}`);
    }
    if (latest === version && version === 0) log.warn('schema.sql has no versioned blocks');
  }

  prepare(sql: string): StatementSync {
    let st = this.cache.get(sql);
    if (!st) {
      st = this.sqlite.prepare(sql);
      this.cache.set(sql, st);
    }
    return st;
  }

  run(sql: string, ...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint } {
    return this.prepare(sql).run(...(params as never[]));
  }

  get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
    return this.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: unknown[]): T[] {
    return this.prepare(sql).all(...(params as never[])) as T[];
  }

  transaction<T>(fn: () => T): T {
    this.sqlite.exec('BEGIN');
    try {
      const r = fn();
      this.sqlite.exec('COMMIT');
      return r;
    } catch (err) {
      this.sqlite.exec('ROLLBACK');
      throw err;
    }
  }

  getMeta(key: string): string | undefined {
    return this.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)?.value;
  }

  setMeta(key: string, value: string): void {
    this.run('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  close(): void {
    this.sqlite.close();
  }
}

let instance: Db | undefined;
export function getDb(): Db {
  if (!instance) instance = new Db(join(env.DATA_DIR, 'scout.sqlite'));
  return instance;
}
