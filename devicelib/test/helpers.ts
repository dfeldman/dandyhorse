import type { BleCharacteristic, BleConnection, BleDevice } from '../src/transport/types.ts';
import type { Clock } from '../src/core/clock.ts';

/** Let queued microtasks and zero-delay timers run. */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}

export async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** A clock whose now() is set by the test; timers still run on real time. */
export class ManualClock implements Clock {
  t = 1_000_000;
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    return setTimeout(fn, ms);
  }
  clearTimeout(h: unknown): void {
    clearTimeout(h as ReturnType<typeof setTimeout>);
  }
  setInterval(fn: () => void, ms: number): unknown {
    return setInterval(fn, ms);
  }
  clearInterval(h: unknown): void {
    clearInterval(h as ReturnType<typeof setInterval>);
  }
}

/** The same device, except every write takes `ms` to be acknowledged, like a busy radio link. */
export function slowWrites(device: BleDevice, ms: number): BleDevice {
  const wrap = (c: BleCharacteristic): BleCharacteristic => ({
    uuid: c.uuid,
    serviceUuid: c.serviceUuid,
    properties: c.properties,
    read: () => c.read(),
    subscribe: (listener) => c.subscribe(listener),
    write: async (data, withResponse) => {
      await new Promise((r) => setTimeout(r, ms));
      await c.write(data, withResponse);
    },
  });
  return {
    id: device.id,
    name: device.name,
    advertisedServices: device.advertisedServices,
    onDisconnect: (listener) => device.onDisconnect(listener),
    async connect(): Promise<BleConnection> {
      const conn = await device.connect();
      return {
        get connected() {
          return conn.connected;
        },
        disconnect: () => conn.disconnect(),
        discover: async () => (await conn.discover()).map((s) => ({ uuid: s.uuid, characteristics: s.characteristics.map(wrap) })),
      };
    },
  };
}
