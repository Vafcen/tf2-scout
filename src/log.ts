import { env } from './config.ts';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;
const threshold = LEVELS[env.LOG_LEVEL];

function ts(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 8); // local time
}

export function log(level: Level, scope: string, msg: string, extra?: unknown): void {
  if (LEVELS[level] < threshold) return;
  const line = `${ts()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (extra !== undefined) fn(line, extra);
  else fn(line);
}

export const logger = (scope: string) => ({
  debug: (m: string, e?: unknown) => log('debug', scope, m, e),
  info: (m: string, e?: unknown) => log('info', scope, m, e),
  warn: (m: string, e?: unknown) => log('warn', scope, m, e),
  error: (m: string, e?: unknown) => log('error', scope, m, e),
});
