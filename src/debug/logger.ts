// src/debug: tagged, timestamped console logging with a history buffer.
// In the browser console, call __log() to dump the entire session history
// (useful for copying into bug reports after a failure).

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
/** Minimum level that gets written. 'debug' logs everything. */
export const LOG_LEVEL: LogLevel = 'debug';
const HISTORY_LIMIT = 500;

const history: string[] = [];

const fmt = (v: unknown): string => {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === 'object' && v !== null) {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
};

const write = (level: LogLevel, tag: string, args: unknown[]): void => {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[LOG_LEVEL]) return;
  const t = (performance.now() / 1000).toFixed(3);
  const line = `[${t}s][${tag}] ${args.map(fmt).join(' ')}`;
  history.push(line);
  if (history.length > HISTORY_LIMIT) history.shift();
  const prefix = `[${tag}]`;
  if (level === 'error') console.error(prefix, ...args);
  else if (level === 'warn') console.warn(prefix, ...args);
  else console.log(prefix, ...args);
};

export const logger = {
  debug: (tag: string, ...args: unknown[]) => write('debug', tag, args),
  info: (tag: string, ...args: unknown[]) => write('info', tag, args),
  warn: (tag: string, ...args: unknown[]) => write('warn', tag, args),
  error: (tag: string, ...args: unknown[]) => write('error', tag, args),
  /** Full session history (newest last). */
  history: (): string[] => history.slice(),
};

// console helper: type __log() to dump everything
Object.assign(window as unknown as Record<string, unknown>, {
  __log: (): string[] => logger.history(),
});