/** A discovered GATT table with lookups, and tracing of every read, write and notification. */
import type { Logger } from '../core/log.ts';
import { normalizeUuid, uuidLabel } from '../core/uuid.ts';
import type { BleCharacteristic, BleService, CharacteristicProperties } from './types.ts';

export interface GattSnapshot {
  services: { uuid: string; characteristics: { uuid: string; properties: CharacteristicProperties }[] }[];
}

class TracedCharacteristic implements BleCharacteristic {
  readonly uuid: string;
  readonly serviceUuid: string;
  readonly properties: CharacteristicProperties;
  #inner: BleCharacteristic;
  #log: Logger;

  constructor(inner: BleCharacteristic, log: Logger) {
    this.#inner = inner;
    this.#log = log;
    this.uuid = normalizeUuid(inner.uuid);
    this.serviceUuid = normalizeUuid(inner.serviceUuid);
    this.properties = inner.properties;
  }

  async read(): Promise<Uint8Array> {
    const data = await this.#inner.read();
    this.#log.trace('read', this.uuid, data);
    return data;
  }

  async write(data: Uint8Array, withResponse: boolean): Promise<void> {
    this.#log.trace('tx', this.uuid, data, withResponse);
    await this.#inner.write(data, withResponse);
  }

  subscribe(listener: (data: Uint8Array) => void): Promise<() => Promise<void>> {
    return this.#inner.subscribe((data) => {
      this.#log.trace('rx', this.uuid, data);
      listener(data);
    });
  }
}

export class Gatt {
  readonly services: readonly BleService[];
  #uuids = new Set<string>();

  constructor(services: readonly BleService[], log?: Logger) {
    this.services = services.map((s) => {
      const uuid = normalizeUuid(s.uuid);
      this.#uuids.add(uuid);
      const characteristics = s.characteristics.map((c) => {
        const traced = log ? new TracedCharacteristic(c, log) : c;
        this.#uuids.add(normalizeUuid(c.uuid));
        return traced;
      });
      return { uuid, characteristics };
    });
  }

  /** True if a service or characteristic with this UUID exists. */
  has(uuid: string | number): boolean {
    return this.#uuids.has(normalizeUuid(uuid));
  }

  /** Every service and characteristic UUID, for registry gatt_has rules. */
  uuids(): ReadonlySet<string> {
    return this.#uuids;
  }

  service(uuid: string | number): BleService | undefined {
    const u = normalizeUuid(uuid);
    return this.services.find((s) => s.uuid === u);
  }

  /** First characteristic with this UUID, optionally only inside one service. */
  char(uuid: string | number, serviceUuid?: string | number): BleCharacteristic | undefined {
    const u = normalizeUuid(uuid);
    const su = serviceUuid === undefined ? undefined : normalizeUuid(serviceUuid);
    for (const s of this.services) {
      if (su && s.uuid !== su) continue;
      const c = s.characteristics.find((x) => x.uuid === u);
      if (c) return c;
    }
    return undefined;
  }

  chars(): BleCharacteristic[] {
    return this.services.flatMap((s) => [...s.characteristics]);
  }

  snapshot(): GattSnapshot {
    return {
      services: this.services.map((s) => ({
        uuid: s.uuid,
        characteristics: s.characteristics.map((c) => ({ uuid: c.uuid, properties: { ...c.properties } })),
      })),
    };
  }

  /** A multi-line human description, for logs and the inspector. */
  describe(): string {
    return this.services
      .map((s) => {
        const chars = s.characteristics.map((c) => {
          const p = c.properties;
          const props = [p.read && 'read', p.write && 'write', p.writeWithoutResponse && 'writeNoResp', p.notify && 'notify', p.indicate && 'indicate']
            .filter(Boolean)
            .join(',');
          return `  ${uuidLabel(c.uuid)} ${c.uuid} [${props}]`;
        });
        return [`${uuidLabel(s.uuid)} ${s.uuid}`, ...chars].join('\n');
      })
      .join('\n');
  }
}
