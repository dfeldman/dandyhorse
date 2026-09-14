import { reactive } from 'vue'
import type { Commanded, DeviceRanges, DeviceRole, DeviceStatus, DeviceType, Metrics, ReportedDevice } from '../types'
import { emptyMetrics } from '../types'

export type DeviceKind = DeviceType | 'hrm'

export interface DeviceFeatures extends Record<string, unknown> {
  speedRange?: DeviceRanges['speed']
  inclineRange?: DeviceRanges['incline']
  powerRange?: DeviceRanges['power']
  grade?: boolean
  power?: boolean
  speed?: boolean
  incline?: boolean
}

/** Every driver (simulator, FTMS, HRM) implements this. Instances are stored with markRaw; the
 *  observable fields live in `state`/`actual` which are Vue reactive objects. */
export interface FitnessDevice {
  readonly role: DeviceRole
  readonly type: DeviceKind
  readonly name: string
  readonly address: string
  readonly protocol: string
  readonly status: DeviceStatus
  readonly features: DeviceFeatures
  /** Last error message (for the UI), or null. */
  readonly error: string | null
  /** Live measured values in SI. Reactive. */
  readonly actual: Metrics
  connect(): Promise<void>
  disconnect(): Promise<void>
  /** Write targets to the device. Called every tick; implementations dedupe. */
  setTargets(commanded: Commanded): Promise<void>
  /** Emergency stop. */
  stop(): Promise<void>
  /** True after the user stopped the machine with its own stop button / safety key. The bridge never
   *  restarts a machine in this state; only the user can clear it (machine start button or bridge Resume). */
  readonly userStopped: boolean
  resumeAfterUserStop(): void
  /** Device-reported ranges for the feasibility step. */
  ranges(): DeviceRanges
  toReport(): ReportedDevice
}

export interface DeviceState {
  type: DeviceKind
  name: string
  address: string
  protocol: string
  status: DeviceStatus
  features: DeviceFeatures
  error: string | null
  userStopped: boolean
}

/** Common plumbing so drivers only implement the I/O. */
export abstract class BaseDevice implements FitnessDevice {
  readonly state: DeviceState
  readonly actual: Metrics = reactive(emptyMetrics())
  constructor(readonly role: DeviceRole, type: DeviceKind, init: Partial<DeviceState> = {}) {
    this.state = reactive({
      type, name: init.name ?? type, address: init.address ?? '', protocol: init.protocol ?? 'ftms',
      status: init.status ?? 'disconnected', features: init.features ?? {}, error: null, userStopped: false,
    })
  }
  get type() { return this.state.type }
  get name() { return this.state.name }
  get address() { return this.state.address }
  get protocol() { return this.state.protocol }
  get status() { return this.state.status }
  get features() { return this.state.features }
  get error() { return this.state.error }
  get userStopped() { return this.state.userStopped }
  resumeAfterUserStop(): void { this.state.userStopped = false }

  abstract connect(): Promise<void>
  abstract disconnect(): Promise<void>
  abstract setTargets(commanded: Commanded): Promise<void>
  abstract stop(): Promise<void>

  ranges(): DeviceRanges {
    return { speed: this.state.features.speedRange ?? null, incline: this.state.features.inclineRange ?? null, power: this.state.features.powerRange ?? null }
  }

  clearActual(): void {
    for (const k of Object.keys(this.actual) as (keyof Metrics)[]) this.actual[k] = null
  }

  toReport(): ReportedDevice {
    return {
      role: this.role, type: this.state.type, name: this.state.name, address: this.state.address, protocol: this.state.protocol,
      status: this.state.status, features: JSON.parse(JSON.stringify(this.state.features)),
      ...(this.state.userStopped ? { userStopped: true } : {}),
    }
  }
}
