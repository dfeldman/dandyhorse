/** Minimal typed event emitter. Listener errors are caught so one bad handler cannot break a device loop. */

export type Listener<T> = (value: T) => void;

export class Emitter<M extends object> {
  #listeners = new Map<keyof M, Set<Listener<never>>>();
  #onError: (err: unknown, event: keyof M) => void;

  constructor(onError?: (err: unknown, event: keyof M) => void) {
    this.#onError = onError ?? ((err, event) => console.error(`listener for "${String(event)}" threw`, err));
  }

  on<K extends keyof M>(event: K, fn: Listener<M[K]>): () => void {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(fn as Listener<never>);
    return () => this.off(event, fn);
  }

  once<K extends keyof M>(event: K, fn: Listener<M[K]>): () => void {
    const off = this.on(event, (v) => {
      off();
      fn(v);
    });
    return off;
  }

  off<K extends keyof M>(event: K, fn: Listener<M[K]>): void {
    this.#listeners.get(event)?.delete(fn as Listener<never>);
  }

  emit<K extends keyof M>(event: K, value: M[K]): void {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as Listener<M[K]>)(value);
      } catch (err) {
        this.#onError(err, event);
      }
    }
  }

  listenerCount(event: keyof M): number {
    return this.#listeners.get(event)?.size ?? 0;
  }

  removeAll(): void {
    this.#listeners.clear();
  }
}
