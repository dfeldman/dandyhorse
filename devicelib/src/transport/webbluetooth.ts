/**
 * Web Bluetooth adapter (Chrome, Edge, Opera, Android Chrome; not Safari or Firefox).
 * The only file in devicelib that touches navigator.bluetooth. Types are declared locally
 * so there is no dependency on @types/web-bluetooth.
 */
import { DeviceError } from '../core/errors.ts';
import { normalizeUuid } from '../core/uuid.ts';
import type {
  BleAdapter,
  BleCharacteristic,
  BleConnection,
  BleDevice,
  BleService,
  CharacteristicProperties,
  RequestDeviceOptions,
} from './types.ts';

interface WbCharacteristic extends EventTarget {
  uuid: string;
  properties: CharacteristicProperties;
  value?: DataView | null;
  readValue(): Promise<DataView>;
  writeValue?(data: Uint8Array): Promise<void>;
  writeValueWithResponse?(data: Uint8Array): Promise<void>;
  writeValueWithoutResponse?(data: Uint8Array): Promise<void>;
  startNotifications(): Promise<WbCharacteristic>;
  stopNotifications(): Promise<WbCharacteristic>;
}
interface WbService {
  uuid: string;
  getCharacteristics(): Promise<WbCharacteristic[]>;
}
interface WbServer {
  connected: boolean;
  connect(): Promise<WbServer>;
  disconnect(): void;
  getPrimaryServices(): Promise<WbService[]>;
}
interface WbDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: WbServer;
}
interface WbBluetooth {
  getAvailability?(): Promise<boolean>;
  requestDevice(options: object): Promise<WbDevice>;
  getDevices?(): Promise<WbDevice[]>;
}

function bluetooth(): WbBluetooth | undefined {
  return (globalThis.navigator as unknown as { bluetooth?: WbBluetooth } | undefined)?.bluetooth;
}

/** Chrome allows one GATT operation at a time per device; this queue serialises them. */
class GattQueue {
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(op: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(() => op());
    this.#tail = result.catch(() => undefined);
    return result;
  }
}

function toBytes(view: DataView): Uint8Array {
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}

class WebCharacteristic implements BleCharacteristic {
  readonly uuid: string;
  readonly serviceUuid: string;
  readonly properties: CharacteristicProperties;
  #c: WbCharacteristic;
  #q: GattQueue;
  #listeners = new Set<(d: Uint8Array) => void>();
  #started = false;
  #onEvent = (ev: Event): void => {
    const view = (ev.target as WbCharacteristic).value;
    if (!view) return;
    const data = toBytes(view);
    for (const l of [...this.#listeners]) l(data);
  };

  constructor(c: WbCharacteristic, serviceUuid: string, q: GattQueue) {
    this.#c = c;
    this.#q = q;
    this.uuid = normalizeUuid(c.uuid);
    this.serviceUuid = serviceUuid;
    const p = c.properties;
    this.properties = {
      read: !!p.read,
      write: !!p.write,
      writeWithoutResponse: !!p.writeWithoutResponse,
      notify: !!p.notify,
      indicate: !!p.indicate,
    };
  }

  read(): Promise<Uint8Array> {
    return this.#q.run(async () => toBytes(await this.#c.readValue()));
  }

  write(data: Uint8Array, withResponse: boolean): Promise<void> {
    return this.#q.run(async () => {
      const c = this.#c;
      if (withResponse && c.writeValueWithResponse) return c.writeValueWithResponse(data);
      if (!withResponse && c.writeValueWithoutResponse) return c.writeValueWithoutResponse(data);
      if (c.writeValue) return c.writeValue(data);
      throw new DeviceError('not_supported', `characteristic ${this.uuid} cannot be written`);
    });
  }

  async subscribe(listener: (data: Uint8Array) => void): Promise<() => Promise<void>> {
    this.#listeners.add(listener);
    if (!this.#started) {
      this.#started = true;
      this.#c.addEventListener('characteristicvaluechanged', this.#onEvent);
      try {
        await this.#q.run(() => this.#c.startNotifications());
      } catch (err) {
        this.#started = false;
        this.#listeners.delete(listener);
        this.#c.removeEventListener('characteristicvaluechanged', this.#onEvent);
        throw err;
      }
    }
    return async () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0 && this.#started) {
        this.#started = false;
        this.#c.removeEventListener('characteristicvaluechanged', this.#onEvent);
        try {
          await this.#q.run(() => this.#c.stopNotifications());
        } catch {
          // Already disconnected; nothing to stop.
        }
      }
    };
  }
}

class WebConnection implements BleConnection {
  #server: WbServer;
  #q = new GattQueue();

  constructor(server: WbServer) {
    this.#server = server;
  }

  get connected(): boolean {
    return this.#server.connected;
  }

  async discover(): Promise<BleService[]> {
    const services = await this.#q.run(() => this.#server.getPrimaryServices());
    const out: BleService[] = [];
    for (const s of services) {
      const serviceUuid = normalizeUuid(s.uuid);
      let chars: WbCharacteristic[] = [];
      try {
        chars = await this.#q.run(() => s.getCharacteristics());
      } catch {
        // A service without characteristics throws NotFoundError in Chrome.
      }
      out.push({ uuid: serviceUuid, characteristics: chars.map((c) => new WebCharacteristic(c, serviceUuid, this.#q)) });
    }
    return out;
  }

  async disconnect(): Promise<void> {
    this.#server.disconnect();
  }
}

class WebDevice implements BleDevice {
  readonly id: string;
  readonly name: string | undefined;
  #d: WbDevice;

  constructor(d: WbDevice) {
    this.#d = d;
    this.id = d.id;
    this.name = d.name ?? undefined;
  }

  async connect(): Promise<BleConnection> {
    if (!this.#d.gatt) throw new DeviceError('connect_failed', 'device has no GATT server');
    try {
      const server = await this.#d.gatt.connect();
      return new WebConnection(server);
    } catch (err) {
      throw new DeviceError('connect_failed', `could not connect to ${this.name ?? this.id}: ${String(err)}`, err);
    }
  }

  onDisconnect(listener: () => void): () => void {
    const h = (): void => listener();
    this.#d.addEventListener('gattserverdisconnected', h);
    return () => this.#d.removeEventListener('gattserverdisconnected', h);
  }
}

export class WebBluetoothAdapter implements BleAdapter {
  readonly kind = 'web-bluetooth';

  async isAvailable(): Promise<boolean> {
    const bt = bluetooth();
    if (!bt) return false;
    try {
      return bt.getAvailability ? await bt.getAvailability() : true;
    } catch {
      return false;
    }
  }

  async requestDevice(opts: RequestDeviceOptions): Promise<BleDevice> {
    const bt = bluetooth();
    if (!bt) throw new DeviceError('unavailable', 'Web Bluetooth is not available in this browser');
    const optionalServices = (opts.optionalServices ?? []).map((u) => normalizeUuid(u));
    const options: Record<string, unknown> = { optionalServices };
    if (opts.acceptAllDevices || (!opts.namePrefixes?.length && !opts.services?.length)) {
      options['acceptAllDevices'] = true;
    } else {
      options['filters'] = [
        ...(opts.namePrefixes ?? []).map((namePrefix) => ({ namePrefix })),
        ...(opts.services ?? []).map((s) => ({ services: [normalizeUuid(s)] })),
      ];
    }
    try {
      return new WebDevice(await bt.requestDevice(options));
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'NotFoundError') throw new DeviceError('cancelled', 'no device was chosen', err);
      if (name === 'SecurityError') throw new DeviceError('unavailable', 'requestDevice must be called from a user gesture', err);
      throw new DeviceError('connect_failed', String(err), err);
    }
  }

  async getKnownDevices(): Promise<BleDevice[]> {
    const bt = bluetooth();
    if (!bt?.getDevices) return [];
    return (await bt.getDevices()).map((d) => new WebDevice(d));
  }
}
