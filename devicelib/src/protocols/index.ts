/**
 * Protocol id -> driver. This is the extension point for new device families:
 * implement DeviceDriver (usually by extending BaseDriver) and call registerDriver().
 */
import type { Gatt } from '../transport/gatt.ts';
import { UUID } from '../core/uuid.ts';
import type { DeviceDriver, DriverContext } from './driver.ts';
import { FtmsDriver } from './ftms/driver.ts';
import { HorizonDriver } from './horizon.ts';
import { RawCaptureDriver } from './raw.ts';
import { CscDriver, CyclingPowerDriver, HeartRateDriver, RscDriver } from './sensors.ts';

export type DriverCreator = (ctx: DriverContext) => DeviceDriver;

const CREATORS = new Map<string, DriverCreator>([
  ['ftms', (ctx) => new FtmsDriver(ctx)],
  ['horizon', (ctx) => new HorizonDriver(ctx)],
  ['cycling_power', (ctx) => new CyclingPowerDriver(ctx)],
  ['csc', (ctx) => new CscDriver(ctx)],
  ['rsc_cps', (ctx) => new RscDriver(ctx)],
  ['heart_rate', (ctx) => new HeartRateDriver(ctx)],
]);

/** Add or replace the driver for a registry protocol id. */
export function registerDriver(protocolId: string, create: DriverCreator): void {
  CREATORS.set(protocolId, create);
}

export function hasDriver(protocolId: string): boolean {
  return CREATORS.has(protocolId);
}

/** A driver for the protocol, or a raw-capture driver when it is not implemented. */
export function createDriver(protocolId: string, ctx: DriverContext): DeviceDriver {
  const create = CREATORS.get(protocolId);
  return create ? create(ctx) : new RawCaptureDriver(ctx, protocolId);
}

export function hasFtmsData(gatt: Gatt): boolean {
  return [UUID.TREADMILL_DATA, UUID.INDOOR_BIKE_DATA, UUID.ROWER_DATA, UUID.CROSS_TRAINER_DATA].some((u) => gatt.has(u));
}

/** The best standard protocol a device offers, for devices the registry does not know. */
export function detectStandardProtocol(gatt: Gatt): string {
  if (gatt.has(UUID.FTMS) && hasFtmsData(gatt)) return 'ftms';
  if (gatt.has(UUID.CYCLING_POWER_MEASUREMENT)) return 'cycling_power';
  if (gatt.has(UUID.CSC_MEASUREMENT)) return 'csc';
  if (gatt.has(UUID.RSC_MEASUREMENT)) return 'rsc_cps';
  if (gatt.has(UUID.HEART_RATE_MEASUREMENT)) return 'heart_rate';
  return 'raw';
}
