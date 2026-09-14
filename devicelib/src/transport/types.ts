/**
 * The only platform boundary in devicelib. Everything above this interface is platform-neutral.
 *
 * Implementations: WebBluetoothAdapter (browsers), MockAdapter (tests, simulators).
 * Future ones (Capacitor, React Native, Node noble, native bridges) implement the same four types.
 */

export interface CharacteristicProperties {
  read: boolean;
  write: boolean;
  writeWithoutResponse: boolean;
  notify: boolean;
  indicate: boolean;
}

export interface BleCharacteristic {
  /** 128-bit lowercase UUID. */
  readonly uuid: string;
  readonly serviceUuid: string;
  readonly properties: CharacteristicProperties;
  read(): Promise<Uint8Array>;
  write(data: Uint8Array, withResponse: boolean): Promise<void>;
  /** Enables notifications or indications. Resolves to a function that removes this listener. */
  subscribe(listener: (data: Uint8Array) => void): Promise<() => Promise<void>>;
}

export interface BleService {
  readonly uuid: string;
  readonly characteristics: readonly BleCharacteristic[];
}

export interface BleConnection {
  readonly connected: boolean;
  /** All services the platform lets us see, with their characteristics. */
  discover(): Promise<BleService[]>;
  disconnect(): Promise<void>;
}

export interface BleDevice {
  /** Stable per platform: a MAC address, or a per-app random id on iOS and the web. */
  readonly id: string;
  readonly name: string | undefined;
  /** Service UUIDs from the advertisement, if the platform exposes them before connecting. Web Bluetooth does not. */
  readonly advertisedServices?: readonly string[];
  connect(): Promise<BleConnection>;
  onDisconnect(listener: () => void): () => void;
}

export interface RequestDeviceOptions {
  /** Show every nearby device. Otherwise namePrefixes and services act as filters (any may match). */
  acceptAllDevices?: boolean;
  namePrefixes?: string[];
  services?: string[];
  /** Services the app may use after connecting. Web Bluetooth hides any service not listed here. */
  optionalServices?: string[];
}

export interface BleAdapter {
  /** "web-bluetooth", "mock", ... */
  readonly kind: string;
  isAvailable(): Promise<boolean>;
  /** Pick a device. On the web this opens the browser's chooser and must run inside a user gesture. */
  requestDevice(opts: RequestDeviceOptions): Promise<BleDevice>;
  /** Devices the user already granted, for reconnecting without the chooser. Optional. */
  getKnownDevices?(): Promise<BleDevice[]>;
}
