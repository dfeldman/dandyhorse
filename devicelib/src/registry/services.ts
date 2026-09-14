/** The service UUIDs to request up front. Web Bluetooth hides any service not listed at requestDevice time. */
import { normalizeUuid, UUID } from '../core/uuid.ts';
import { REGISTRY_UUIDS } from './entries.generated.ts';

const STANDARD = [
  UUID.FTMS,
  UUID.CYCLING_POWER,
  UUID.CSC,
  UUID.RSC,
  UUID.HEART_RATE,
  UUID.BATTERY,
  UUID.DEVICE_INFORMATION,
  UUID.VENDOR_FFF0,
  normalizeUuid(0xffe0),
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART
  UUID.ZWIFT_SERVICE,
];

/** 16-bit characteristic aliases (0x2Axx, 0x2Bxx) are not services; leave them out. */
function isCharacteristicAlias(uuid: string): boolean {
  return /^00002[ab][0-9a-f]{2}-0000-1000-8000-00805f9b34fb$/.test(uuid);
}

export function defaultOptionalServices(extra: string[] = []): string[] {
  const all = new Set<string>();
  for (const u of [...STANDARD, ...REGISTRY_UUIDS, ...extra.map((x) => normalizeUuid(x))]) {
    if (!isCharacteristicAlias(u)) all.add(u);
  }
  return [...all];
}
