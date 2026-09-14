/**
 * FTMS control point client. One write in flight; the next goes after the "80 op result"
 * indication or a timeout. Cheap boards break if you write back to back.
 *
 * The timeout starts when the write is acknowledged, not when it is queued: the write waits behind
 * other GATT operations and takes a radio round trip, which can use up a short budget on its own
 * (QZ waits 300 ms from the write call). A Horizon 7.0AT answered within the bridge's old 3 s wait
 * but never within devicelib's old 300 ms, counted from before the write.
 */
import { hex } from '../../core/bytes.ts';
import type { Clock } from '../../core/clock.ts';
import type { Logger } from '../../core/log.ts';
import type { BleCharacteristic } from '../../transport/types.ts';
import { parseResponse, type FtmsResult } from './codec.ts';

export const DEFAULT_CONTROL_TIMEOUT_MS = 1500;

export interface ControlPointOptions {
  clock: Clock;
  log: Logger;
  withResponse: boolean;
  /** How long to wait for the indication after the write is acknowledged. Default 1500 ms. */
  timeoutMs?: number;
  /** Called for every response, including late or unsolicited ones. */
  onResponse?: (op: number, result: FtmsResult) => void;
}

export class ControlPoint {
  #char: BleCharacteristic;
  #opts: ControlPointOptions;
  #queue: Promise<unknown> = Promise.resolve();
  #pending: { op: number; resolve: (r: FtmsResult) => void } | undefined;
  #off: (() => Promise<void>) | undefined;

  constructor(char: BleCharacteristic, opts: ControlPointOptions) {
    this.#char = char;
    this.#opts = opts;
  }

  async start(): Promise<void> {
    this.#off = await this.#char.subscribe((d) => this.#onIndication(d));
  }

  async stop(): Promise<void> {
    const off = this.#off;
    this.#off = undefined;
    this.#pending?.resolve('error');
    this.#pending = undefined;
    if (off) await off().catch(() => undefined);
  }

  #onIndication(d: Uint8Array): void {
    const res = parseResponse(d);
    if (!res) {
      this.#opts.log.debug(`unexpected control point data ${hex(d)}`);
      return;
    }
    this.#opts.onResponse?.(res.op, res.result);
    const p = this.#pending;
    if (p && p.op === res.op) {
      this.#pending = undefined;
      p.resolve(res.result);
    } else {
      this.#opts.log.debug(`late response for op ${res.op.toString(16)}: ${res.result}`);
    }
  }

  /** Queue a command and resolve with the device's answer. Never throws. */
  send(data: Uint8Array): Promise<FtmsResult> {
    const run = async (): Promise<FtmsResult> => {
      const { clock, log } = this.#opts;
      const op = data[0]!;
      let pending!: { op: number; resolve: (r: FtmsResult) => void };
      const answer = new Promise<FtmsResult>((resolve) => {
        pending = { op, resolve };
        this.#pending = pending;
      });
      try {
        await this.#char.write(data, this.#opts.withResponse);
      } catch (err) {
        if (this.#pending === pending) this.#pending = undefined;
        log.warn(`control point write ${hex(data)} failed: ${String(err)}`);
        return 'error';
      }
      // Count from the acknowledged write (see the header comment).
      const timer = clock.setTimeout(() => {
        if (this.#pending === pending) {
          this.#pending = undefined;
          pending.resolve('timeout');
        }
      }, this.#opts.timeoutMs ?? DEFAULT_CONTROL_TIMEOUT_MS);
      const result = await answer;
      clock.clearTimeout(timer);
      if (result !== 'success') log.debug(`control point ${hex(data)} -> ${result}`);
      return result;
    };
    const p = this.#queue.then(run);
    this.#queue = p.catch(() => undefined);
    return p;
  }
}
