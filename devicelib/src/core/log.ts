/**
 * Logging with two channels:
 *  - log records: leveled human-readable messages;
 *  - trace records: every byte written to or received from a device, as hex.
 * Traces are serializable, so a capture from real hardware can become a test fixture.
 */
import { hex } from './bytes.ts';
import { realClock, type Clock } from './clock.ts';
import { uuidLabel } from './uuid.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogRecord {
  t: number;
  level: LogLevel;
  source: string;
  message: string;
  data?: unknown;
}

export type TraceDirection = 'tx' | 'rx' | 'read';

export interface TraceRecord {
  t: number;
  source: string;
  dir: TraceDirection;
  /** Characteristic UUID, 128-bit lowercase. */
  char: string;
  /** Short label such as "FTMS Control Point" or "fff4", for humans. */
  label: string;
  hex: string;
  /** For tx: whether the write asked for a response. */
  withResponse?: boolean;
}

export interface LogSink {
  log?(record: LogRecord): void;
  trace?(record: TraceRecord): void;
}

export interface LoggerOptions {
  source?: string;
  level?: LogLevel;
  sinks?: LogSink[];
  clock?: Clock;
}

interface Shared {
  sinks: Set<LogSink>;
  level: number;
  clock: Clock;
}

export class Logger {
  readonly source: string;
  #shared: Shared;

  constructor(opts: LoggerOptions = {}, shared?: Shared) {
    this.source = opts.source ?? 'devicelib';
    this.#shared = shared ?? {
      sinks: new Set(opts.sinks ?? []),
      level: LEVELS[opts.level ?? 'info'],
      clock: opts.clock ?? realClock,
    };
  }

  /** A logger with a narrower source name that shares sinks and level with this one. */
  child(source: string): Logger {
    return new Logger({ source: `${this.source}/${source}` }, this.#shared);
  }

  addSink(sink: LogSink): () => void {
    this.#shared.sinks.add(sink);
    return () => this.#shared.sinks.delete(sink);
  }

  setLevel(level: LogLevel): void {
    this.#shared.level = LEVELS[level];
  }

  isEnabled(level: LogLevel): boolean {
    return LEVELS[level] >= this.#shared.level;
  }

  debug(message: string, data?: unknown): void {
    this.#emit('debug', message, data);
  }
  info(message: string, data?: unknown): void {
    this.#emit('info', message, data);
  }
  warn(message: string, data?: unknown): void {
    this.#emit('warn', message, data);
  }
  error(message: string, data?: unknown): void {
    this.#emit('error', message, data);
  }

  /** Record raw traffic. Always delivered to trace sinks, independent of the log level. */
  trace(dir: TraceDirection, char: string, data: Uint8Array, withResponse?: boolean): void {
    const record: TraceRecord = {
      t: this.#shared.clock.now(),
      source: this.source,
      dir,
      char,
      label: uuidLabel(char),
      hex: hex(data),
    };
    if (withResponse !== undefined) record.withResponse = withResponse;
    for (const s of this.#shared.sinks) s.trace?.(record);
  }

  #emit(level: LogLevel, message: string, data?: unknown): void {
    if (LEVELS[level] < this.#shared.level) return;
    const record: LogRecord = { t: this.#shared.clock.now(), level, source: this.source, message };
    if (data !== undefined) record.data = data;
    for (const s of this.#shared.sinks) s.log?.(record);
  }
}

/** A sink that prints to the console. Pass traces: true to also print raw traffic. */
export function consoleSink(opts: { traces?: boolean } = {}): LogSink {
  return {
    log(r) {
      const line = `[${r.source}] ${r.message}`;
      const fn = r.level === 'error' ? console.error : r.level === 'warn' ? console.warn : r.level === 'debug' ? console.debug : console.info;
      if (r.data === undefined) fn(line);
      else fn(line, r.data);
    },
    trace: opts.traces
      ? (r) => console.debug(`[${r.source}] ${r.dir} ${r.label}: ${r.hex}`)
      : undefined,
  };
}

/** Keeps the most recent log and trace records in memory, e.g. for a "download capture" button. */
export class TraceRecorder implements LogSink {
  readonly traces: TraceRecord[] = [];
  readonly logs: LogRecord[] = [];
  readonly max: number;

  constructor(max = 20000) {
    this.max = max;
  }

  log(r: LogRecord): void {
    this.logs.push(r);
    if (this.logs.length > this.max) this.logs.shift();
  }

  trace(r: TraceRecord): void {
    this.traces.push(r);
    if (this.traces.length > this.max) this.traces.shift();
  }

  clear(): void {
    this.traces.length = 0;
    this.logs.length = 0;
  }

  toJSON(): { traces: TraceRecord[]; logs: LogRecord[] } {
    return { traces: [...this.traces], logs: [...this.logs] };
  }
}

/** A logger that discards everything. */
export const silentLogger = new Logger({ source: 'silent' });
