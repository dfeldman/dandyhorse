/**
 * In-memory BLE peripheral and adapter. Used by the tests and by the device simulators,
 * so a game can run against a "virtual treadmill" with no hardware.
 */
import { DeviceError } from '../core/errors.ts';
import { normalizeUuid } from '../core/uuid.ts';
import type { GattSnapshot } from './gatt.ts';
import type {
  BleAdapter,
  BleCharacteristic,
  BleConnection,
  BleDevice,
  BleService,
  CharacteristicProperties,
  RequestDeviceOptions,
} from './types.ts';

export interface MockCharacteristicSpec {
  uuid: string | number;
  properties?: Partial<CharacteristicProperties>;
  value?: Uint8Array;
}

export interface MockServiceSpec {
  uuid: string | number;
  characteristics: MockCharacteristicSpec[];
}

export interface MockPeripheralSpec {
  id?: string;
  name?: string;
  advertisedServices?: (string | number)[];
  services: MockServiceSpec[];
}

export interface MockWrite {
  char: string;
  data: Uint8Array;
  withResponse: boolean;
}

export type WriteHandler = (data: Uint8Array, peripheral: MockPeripheral) => void;

interface CharState {
  uuid: string;
  serviceUuid: string;
  properties: CharacteristicProperties;
  value: Uint8Array;
  listeners: Set<(d: Uint8Array) => void>;
}

let nextId = 1;

export class MockPeripheral implements BleDevice {
  readonly id: string;
  readonly name: string | undefined;
  readonly advertisedServices?: readonly string[];
  /** Every write the host made, in order. */
  readonly writes: MockWrite[] = [];
  /** Fail the next N connect attempts (for reconnect tests). */
  failConnects = 0;
  #services: { uuid: string; chars: CharState[] }[];
  #handlers = new Map<string, WriteHandler[]>();
  #disconnectListeners = new Set<() => void>();
  #connected = false;

  constructor(spec: MockPeripheralSpec) {
    this.id = spec.id ?? `mock-${nextId++}`;
    this.name = spec.name;
    if (spec.advertisedServices) this.advertisedServices = spec.advertisedServices.map((u) => normalizeUuid(u));
    this.#services = spec.services.map((s) => {
      const serviceUuid = normalizeUuid(s.uuid);
      return {
        uuid: serviceUuid,
        chars: s.characteristics.map((c) => ({
          uuid: normalizeUuid(c.uuid),
          serviceUuid,
          properties: {
            read: false,
            write: false,
            writeWithoutResponse: false,
            notify: false,
            indicate: false,
            ...c.properties,
          },
          value: c.value ?? new Uint8Array(0),
          listeners: new Set(),
        })),
      };
    });
  }

  /** Build a peripheral with the same GATT table as a captured real device. */
  static fromSnapshot(snapshot: GattSnapshot, name?: string): MockPeripheral {
    return new MockPeripheral({
      name,
      services: snapshot.services.map((s) => ({
        uuid: s.uuid,
        characteristics: s.characteristics.map((c) => ({ uuid: c.uuid, properties: c.properties })),
      })),
    });
  }

  get connected(): boolean {
    return this.#connected;
  }

  #char(uuid: string | number): CharState {
    const u = normalizeUuid(uuid);
    for (const s of this.#services) {
      const c = s.chars.find((x) => x.uuid === u);
      if (c) return c;
    }
    throw new Error(`mock peripheral has no characteristic ${u}`);
  }

  /** React to host writes on one characteristic. */
  onWrite(uuid: string | number, handler: WriteHandler): void {
    const u = normalizeUuid(uuid);
    const list = this.#handlers.get(u) ?? [];
    list.push(handler);
    this.#handlers.set(u, list);
  }

  /** Send a notification or indication to the host, if it has subscribed. Delivered asynchronously. */
  notify(uuid: string | number, data: Uint8Array): void {
    const c = this.#char(uuid);
    c.value = data;
    const copy = data.slice();
    queueMicrotask(() => {
      if (!this.#connected) return;
      for (const l of [...c.listeners]) l(copy);
    });
  }

  isSubscribed(uuid: string | number): boolean {
    return this.#char(uuid).listeners.size > 0;
  }

  setValue(uuid: string | number, data: Uint8Array): void {
    this.#char(uuid).value = data;
  }

  /** Writes to one characteristic, as hex strings, for assertions. */
  writesTo(uuid: string | number): string[] {
    const u = normalizeUuid(uuid);
    return this.writes.filter((w) => w.char === u).map((w) => Array.from(w.data, (b) => b.toString(16).padStart(2, '0')).join(' '));
  }

  /** Drop the link as if the device walked out of range. */
  simulateDisconnect(): void {
    if (!this.#connected) return;
    this.#connected = false;
    for (const s of this.#services) for (const c of s.chars) c.listeners.clear();
    for (const l of [...this.#disconnectListeners]) l();
  }

  onDisconnect(listener: () => void): () => void {
    this.#disconnectListeners.add(listener);
    return () => this.#disconnectListeners.delete(listener);
  }

  async connect(): Promise<BleConnection> {
    if (this.failConnects > 0) {
      this.failConnects--;
      throw new DeviceError('connect_failed', 'mock connect failure');
    }
    this.#connected = true;
    return new MockConnection(this);
  }

  /** @internal */
  _services(): BleService[] {
    return this.#services.map((s) => ({
      uuid: s.uuid,
      characteristics: s.chars.map((c) => new MockCharacteristic(this, c)),
    }));
  }

  /** @internal */
  _write(c: CharState, data: Uint8Array, withResponse: boolean): void {
    if (!this.#connected) throw new DeviceError('disconnected', 'not connected');
    this.writes.push({ char: c.uuid, data: data.slice(), withResponse });
    for (const h of this.#handlers.get(c.uuid) ?? []) queueMicrotask(() => h(data.slice(), this));
  }

  /** @internal */
  _disconnectByHost(): void {
    if (!this.#connected) return;
    this.#connected = false;
    for (const s of this.#services) for (const c of s.chars) c.listeners.clear();
  }
}

class MockCharacteristic implements BleCharacteristic {
  readonly uuid: string;
  readonly serviceUuid: string;
  readonly properties: CharacteristicProperties;
  #p: MockPeripheral;
  #c: CharState;

  constructor(p: MockPeripheral, c: CharState) {
    this.#p = p;
    this.#c = c;
    this.uuid = c.uuid;
    this.serviceUuid = c.serviceUuid;
    this.properties = c.properties;
  }

  async read(): Promise<Uint8Array> {
    if (!this.#c.properties.read) throw new DeviceError('not_supported', `${this.uuid} is not readable`);
    return this.#c.value.slice();
  }

  async write(data: Uint8Array, withResponse: boolean): Promise<void> {
    const p = this.#c.properties;
    if (!p.write && !p.writeWithoutResponse) throw new DeviceError('not_supported', `${this.uuid} is not writable`);
    this.#p._write(this.#c, data, withResponse);
  }

  async subscribe(listener: (data: Uint8Array) => void): Promise<() => Promise<void>> {
    const p = this.#c.properties;
    if (!p.notify && !p.indicate) throw new DeviceError('not_supported', `${this.uuid} cannot notify`);
    this.#c.listeners.add(listener);
    return async () => {
      this.#c.listeners.delete(listener);
    };
  }
}

class MockConnection implements BleConnection {
  #p: MockPeripheral;

  constructor(p: MockPeripheral) {
    this.#p = p;
  }

  get connected(): boolean {
    return this.#p.connected;
  }

  async discover(): Promise<BleService[]> {
    return this.#p._services();
  }

  async disconnect(): Promise<void> {
    this.#p._disconnectByHost();
  }
}

export class MockAdapter implements BleAdapter {
  readonly kind = 'mock';
  readonly devices: MockPeripheral[];
  /** The options of the most recent requestDevice call, for assertions. */
  lastRequest?: RequestDeviceOptions;

  constructor(devices: MockPeripheral[] = []) {
    this.devices = devices;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async requestDevice(opts: RequestDeviceOptions): Promise<BleDevice> {
    this.lastRequest = opts;
    const found = this.devices.find((d) => {
      if (opts.acceptAllDevices) return true;
      const byName = (opts.namePrefixes ?? []).some((p) => d.name?.startsWith(p));
      const bySvc = (opts.services ?? []).some((s) => d.advertisedServices?.includes(normalizeUuid(s)));
      return byName || bySvc || (!opts.namePrefixes?.length && !opts.services?.length);
    });
    if (!found) throw new DeviceError('cancelled', 'no mock device matched');
    return found;
  }

  async getKnownDevices(): Promise<BleDevice[]> {
    return [...this.devices];
  }
}
