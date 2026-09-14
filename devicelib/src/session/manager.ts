/**
 * Several devices at once: a machine plus optional sensors (heart-rate strap, power meter).
 * Merges their telemetry and forwards controls to the machine. This is the usual entry point for games.
 */
import { Emitter } from '../core/events.ts';
import { Logger } from '../core/log.ts';
import type { Telemetry } from '../core/types.ts';
import { defaultOptionalServices } from '../registry/services.ts';
import type { BleAdapter, BleDevice } from '../transport/types.ts';
import { DeviceSession, type SessionOptions } from './session.ts';

export interface ManagerOptions extends SessionOptions {
  /** Extra service UUIDs to request (Web Bluetooth hides unlisted services). */
  extraServices?: string[];
}

export interface ManagerEvents {
  telemetry: Telemetry;
  sessions: readonly DeviceSession[];
}

export interface DeviceFilter {
  namePrefixes?: string[];
  services?: string[];
}

export class DeviceManager {
  readonly adapter: BleAdapter;
  readonly events = new Emitter<ManagerEvents>();
  readonly log: Logger;
  #opts: ManagerOptions;
  #sessions: DeviceSession[] = [];

  constructor(adapter: BleAdapter, opts: ManagerOptions = {}) {
    this.adapter = adapter;
    this.log = opts.log ?? new Logger({ source: 'devicelib' });
    this.#opts = { ...opts, log: this.log };
  }

  get sessions(): readonly DeviceSession[] {
    return this.#sessions;
  }

  /** The treadmill, bike, elliptical or rower, if one is connected. */
  get machine(): DeviceSession | undefined {
    return this.#sessions.find((s) => s.isMachine && s.state !== 'disconnected');
  }

  /** Open the platform's device chooser. On the web, call this from a click handler. */
  requestDevice(filter?: DeviceFilter): Promise<BleDevice> {
    return this.adapter.requestDevice({
      acceptAllDevices: !filter,
      ...filter,
      optionalServices: defaultOptionalServices(this.#opts.extraServices),
    });
  }

  async connect(device: BleDevice, opts: SessionOptions = {}): Promise<DeviceSession> {
    const session = await DeviceSession.connect(device, { ...this.#opts, ...opts });
    this.#sessions.push(session);
    session.events.on('telemetry', () => this.#emitMerged());
    session.events.on('state', (s) => {
      if (s === 'disconnected') {
        this.#sessions = this.#sessions.filter((x) => x !== session);
        this.events.emit('sessions', this.#sessions);
      }
    });
    this.events.emit('sessions', this.#sessions);
    return session;
  }

  /** Chooser plus connect, in one call from a click handler. */
  async requestAndConnect(filter?: DeviceFilter, opts?: SessionOptions): Promise<DeviceSession> {
    return this.connect(await this.requestDevice(filter), opts);
  }

  async disconnectAll(): Promise<void> {
    await Promise.all(this.#sessions.map((s) => s.disconnect()));
    this.#sessions = [];
    this.events.emit('sessions', this.#sessions);
  }

  /** The machine's telemetry with heart rate from a strap and power from a power meter when present. */
  merged(): Telemetry | undefined {
    const machine = this.machine;
    const base = machine?.telemetry ?? this.#sessions.find((s) => s.telemetry)?.telemetry;
    if (!base) return undefined;
    const out: Telemetry = { ...base, computed: [...base.computed] };
    for (const s of this.#sessions) {
      if (s === machine || !s.telemetry?.fresh) continue;
      const t = s.telemetry;
      const protocol = s.info.protocolId;
      if (t.heartRateBpm !== undefined && (protocol === 'heart_rate' || out.heartRateBpm === undefined)) out.heartRateBpm = t.heartRateBpm;
      if (protocol === 'cycling_power' && t.powerW !== undefined) {
        out.powerW = t.powerW;
        out.computed = out.computed.filter((k) => k !== 'powerW');
        if (t.cadenceRpm !== undefined) out.cadenceRpm = t.cadenceRpm;
      }
      if (protocol === 'rsc_cps' && t.cadenceRpm !== undefined && out.cadenceRpm === undefined) out.cadenceRpm = t.cadenceRpm;
    }
    return out;
  }

  #emitMerged(): void {
    const t = this.merged();
    if (t) this.events.emit('telemetry', t);
  }

  // Controls go to the machine.
  setTargetSpeed(kmh: number | undefined): void {
    this.machine?.setTargetSpeed(kmh);
  }
  setTargetIncline(pct: number | undefined): void {
    this.machine?.setTargetIncline(pct);
  }
  setGrade(pct: number): void {
    this.machine?.setGrade(pct);
  }
  setTargetPower(w: number): void {
    this.machine?.setTargetPower(w);
  }
  setResistance(level: number): void {
    this.machine?.setResistance(level);
  }
  shiftUp(): number | undefined {
    return this.machine?.shiftUp();
  }
  shiftDown(): number | undefined {
    return this.machine?.shiftDown();
  }
}
