/**
 * The contract every device-family module implements.
 *
 * A driver owns one protocol on one connected device: it subscribes, runs the handshake,
 * turns notifications into DeviceData, and reconciles the desired Targets on every tick.
 * Drivers never integrate distance, estimate power or run timers for the game; the session does that.
 */
import type { Clock } from '../core/clock.ts';
import { Emitter } from '../core/events.ts';
import type { Logger } from '../core/log.ts';
import type { Capabilities, DeviceClass, DeviceData, Targets, WorkoutCommand } from '../core/types.ts';
import type { QuirkFlag } from '../quirks/flags.generated.ts';
import type { Quirks } from '../quirks/quirks.ts';
import type { RegistryEntry } from '../registry/types.ts';
import type { Gatt } from '../transport/gatt.ts';
import type { BleCharacteristic } from '../transport/types.ts';

export interface DriverOptions {
  /** Drive Zwift Hub-style trainers over the Zwift protocol (grade and native gears). Default false. */
  zwiftProtocol: boolean;
  /** Allow vendor control paths that are incomplete or have side effects (see each driver). Default false. */
  vendorControl: boolean;
}

export interface DriverContext {
  gatt: Gatt;
  deviceName: string | undefined;
  entry: RegistryEntry | undefined;
  quirks: Quirks;
  log: Logger;
  clock: Clock;
  options: DriverOptions;
  /** Class suggested by the registry entry, if any. */
  classHint?: DeviceClass;
}

export type NoticeKind = 'started_by_user' | 'stopped_by_user' | 'paused_by_user' | 'control_lost' | 'info' | 'warning';

export interface DriverNotice {
  kind: NoticeKind;
  message: string;
}

export interface DriverEvents {
  data: DeviceData;
  notice: DriverNotice;
}

export interface DeviceDriver {
  /** Registry protocol id, e.g. "ftms". */
  readonly protocolId: string;
  /** What to show the user, e.g. "Bluetooth FTMS + Zwift protocol". */
  readonly protocolName: string;
  readonly deviceClass: DeviceClass;
  readonly events: Emitter<DriverEvents>;
  /** Quirk flags this driver acts on; the session reports the rest as not implemented. */
  readonly handledFlags: readonly QuirkFlag[];
  capabilities(): Capabilities;
  /** Subscribe and run the handshake. Called once per connection. */
  start(): Promise<void>;
  /** Reconcile the desired state. Called every tick with the full target set; send only changes. */
  apply(targets: Targets): Promise<void>;
  command(cmd: WorkoutCommand): Promise<void>;
  /** Unsubscribe. The session closes the connection. */
  stop(): Promise<void>;
  /**
   * Diagnostics: send one raw frame on the driver's control channel, through its own queue.
   * Resolves with the device's answer. Drivers without a control channel leave it out.
   */
  rawControl?(data: Uint8Array): Promise<string>;
  /** Diagnostics: the Set Target Speed frame this driver would send for `kmh`, in the device's units. */
  encodeSpeedTarget?(kmh: number): Uint8Array;
}

/** Flags that describe routing or documentation; no driver needs to act on them. */
export const INFORMATIONAL_FLAGS: readonly QuirkFlag[] = [
  'has_proprietary_protocol',
  'name_changes_with_firmware',
  'ftms_capability_varies_by_firmware',
  'model_selection_required',
  'prefer_proprietary_if_vendor_service',
  'falls_back_to_ftms',
  'distance_from_speed',
  'no_auto_pause',
  'auto_start_on_speed',
];

export abstract class BaseDriver implements DeviceDriver {
  abstract readonly protocolId: string;
  abstract readonly deviceClass: DeviceClass;
  abstract readonly handledFlags: readonly QuirkFlag[];
  readonly events = new Emitter<DriverEvents>();
  protected readonly ctx: DriverContext;
  protected readonly log: Logger;
  #unsubs: (() => Promise<void>)[] = [];

  constructor(ctx: DriverContext) {
    this.ctx = ctx;
    this.log = ctx.log;
  }

  abstract get protocolName(): string;
  abstract capabilities(): Capabilities;
  abstract start(): Promise<void>;

  async apply(_targets: Targets): Promise<void> {}

  async command(_cmd: WorkoutCommand): Promise<void> {}

  async stop(): Promise<void> {
    for (const off of this.#unsubs.splice(0)) {
      try {
        await off();
      } catch {
        // The link may already be gone.
      }
    }
  }

  /** Subscribe and remember how to undo it. Parse errors are logged, never thrown into the transport. */
  protected async listen(char: BleCharacteristic, handler: (data: Uint8Array) => void): Promise<void> {
    const off = await char.subscribe((data) => {
      try {
        handler(data);
      } catch (err) {
        this.log.warn(`could not parse ${char.uuid}: ${String(err)}`);
      }
    });
    this.#unsubs.push(off);
  }

  protected emitData(data: DeviceData): void {
    if (Object.keys(data).length > 0) this.events.emit('data', data);
  }

  protected notice(kind: NoticeKind, message: string): void {
    this.log.info(message);
    this.events.emit('notice', { kind, message });
  }
}

/** Write without response when the characteristic allows it, unless the device needs responses. */
export function prefersWithResponse(char: BleCharacteristic, quirks: Quirks): boolean {
  if (quirks.has('write_with_response_required')) return true;
  if (char.properties.writeWithoutResponse) return false;
  return true;
}

/** Split a frame into writes of at most `size` bytes (BLE's default 20-byte payload). */
export function chunks(data: Uint8Array, size = 20): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) out.push(data.slice(i, i + size));
  return out;
}
