/** Time source. Injected everywhere so tests can run without real timers. */

export type TimerHandle = unknown;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(fn: () => void, ms: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof globalThis.setInterval>),
};

export function sleep(clock: Clock, ms: number): Promise<void> {
  return new Promise((resolve) => {
    clock.setTimeout(resolve, ms);
  });
}

/** Resolves with the promise's value, or rejects with a TimeoutError after ms. */
export function withTimeout<T>(promise: Promise<T>, ms: number, clock: Clock, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const h = clock.setTimeout(() => reject(new TimeoutError(`${what} timed out after ${ms} ms`)), ms);
    promise.then(
      (v) => {
        clock.clearTimeout(h);
        resolve(v);
      },
      (e: unknown) => {
        clock.clearTimeout(h);
        reject(e);
      },
    );
  });
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}
