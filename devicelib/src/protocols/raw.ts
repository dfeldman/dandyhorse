/**
 * Fallback for protocols devicelib does not implement yet. Subscribes to everything that notifies,
 * so the trace captures the device's traffic, and reports no telemetry or controls.
 * Captures from this driver are how a new device family gets added.
 */
import type { Capabilities, DeviceClass } from '../core/types.ts';
import { noCapabilities } from '../core/types.ts';
import { protocolDisplayName } from '../registry/protocolNames.ts';
import { BaseDriver, type DriverContext } from './driver.ts';

export class RawCaptureDriver extends BaseDriver {
  readonly protocolId: string;
  readonly deviceClass: DeviceClass;
  readonly handledFlags = [];

  constructor(ctx: DriverContext, protocolId = 'raw') {
    super(ctx);
    this.protocolId = protocolId;
    this.deviceClass = ctx.classHint ?? 'unknown';
  }

  get protocolName(): string {
    return this.protocolId === 'raw' ? protocolDisplayName('raw') : `${protocolDisplayName(this.protocolId)} (not supported yet)`;
  }

  capabilities(): Capabilities {
    return noCapabilities();
  }

  async start(): Promise<void> {
    for (const c of this.ctx.gatt.chars()) {
      if (!c.properties.notify && !c.properties.indicate) continue;
      try {
        await this.listen(c, () => {});
      } catch (err) {
        this.log.debug(`could not subscribe to ${c.uuid}: ${String(err)}`);
      }
    }
    this.log.info(`capturing raw traffic for protocol "${this.protocolId}"`);
  }
}
