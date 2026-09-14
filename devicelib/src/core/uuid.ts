/** UUID normalisation and the well-known UUIDs the drivers use. */

const BASE_SUFFIX = '-0000-1000-8000-00805f9b34fb';

/** Normalise "0x1826", "1826", 0x1826 or a 128-bit string to lowercase 128-bit form. */
export function normalizeUuid(uuid: string | number): string {
  if (typeof uuid === 'number') return `0000${uuid.toString(16).padStart(4, '0')}${BASE_SUFFIX}`;
  let s = uuid.trim().toLowerCase();
  if (s.startsWith('0x')) s = s.slice(2);
  if (/^[0-9a-f]{4}$/.test(s)) return `0000${s}${BASE_SUFFIX}`;
  if (/^[0-9a-f]{8}$/.test(s)) return `${s}${BASE_SUFFIX}`;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)) return s;
  throw new Error(`not a UUID: ${uuid}`);
}

/** The 16-bit alias of a Bluetooth-base UUID ("2ad9"), or undefined for vendor UUIDs. */
export function shortUuid(uuid: string): string | undefined {
  const s = normalizeUuid(uuid);
  return s.startsWith('0000') && s.endsWith(BASE_SUFFIX) ? s.slice(4, 8) : undefined;
}

const u = normalizeUuid;

export const UUID = {
  // Fitness Machine Service
  FTMS: u(0x1826),
  FTMS_FEATURE: u(0x2acc),
  TREADMILL_DATA: u(0x2acd),
  CROSS_TRAINER_DATA: u(0x2ace),
  STEP_CLIMBER_DATA: u(0x2acf),
  STAIR_CLIMBER_DATA: u(0x2ad0),
  ROWER_DATA: u(0x2ad1),
  INDOOR_BIKE_DATA: u(0x2ad2),
  TRAINING_STATUS: u(0x2ad3),
  SUPPORTED_SPEED_RANGE: u(0x2ad4),
  SUPPORTED_INCLINE_RANGE: u(0x2ad5),
  SUPPORTED_RESISTANCE_RANGE: u(0x2ad6),
  SUPPORTED_HEART_RATE_RANGE: u(0x2ad7),
  SUPPORTED_POWER_RANGE: u(0x2ad8),
  FTMS_CONTROL_POINT: u(0x2ad9),
  FTMS_STATUS: u(0x2ada),
  // Sensors
  CYCLING_POWER: u(0x1818),
  CYCLING_POWER_MEASUREMENT: u(0x2a63),
  CYCLING_POWER_FEATURE: u(0x2a65),
  CYCLING_POWER_CONTROL_POINT: u(0x2a66),
  CSC: u(0x1816),
  CSC_MEASUREMENT: u(0x2a5b),
  RSC: u(0x1814),
  RSC_MEASUREMENT: u(0x2a53),
  HEART_RATE: u(0x180d),
  HEART_RATE_MEASUREMENT: u(0x2a37),
  BATTERY: u(0x180f),
  BATTERY_LEVEL: u(0x2a19),
  DEVICE_INFORMATION: u(0x180a),
  MANUFACTURER_NAME: u(0x2a29),
  MODEL_NUMBER: u(0x2a24),
  FIRMWARE_REVISION: u(0x2a26),
  HARDWARE_REVISION: u(0x2a27),
  SOFTWARE_REVISION: u(0x2a28),
  // Vendor
  VENDOR_FFF0: u(0xfff0),
  VENDOR_FFF3: u(0xfff3),
  VENDOR_FFF4: u(0xfff4),
  ZWIFT_SERVICE: '00000001-19ca-4651-86e5-fa29dcdd09d1',
  ZWIFT_ASYNC: '00000002-19ca-4651-86e5-fa29dcdd09d1',
  ZWIFT_SYNC_RX: '00000003-19ca-4651-86e5-fa29dcdd09d1',
  ZWIFT_SYNC_TX: '00000004-19ca-4651-86e5-fa29dcdd09d1',
} as const;

const LABELS: Record<string, string> = {
  [UUID.FTMS]: 'FTMS',
  [UUID.FTMS_FEATURE]: 'FTMS Feature',
  [UUID.TREADMILL_DATA]: 'Treadmill Data',
  [UUID.CROSS_TRAINER_DATA]: 'Cross Trainer Data',
  [UUID.ROWER_DATA]: 'Rower Data',
  [UUID.INDOOR_BIKE_DATA]: 'Indoor Bike Data',
  [UUID.TRAINING_STATUS]: 'Training Status',
  [UUID.SUPPORTED_SPEED_RANGE]: 'Speed Range',
  [UUID.SUPPORTED_INCLINE_RANGE]: 'Incline Range',
  [UUID.SUPPORTED_RESISTANCE_RANGE]: 'Resistance Range',
  [UUID.SUPPORTED_POWER_RANGE]: 'Power Range',
  [UUID.FTMS_CONTROL_POINT]: 'FTMS Control Point',
  [UUID.FTMS_STATUS]: 'FTMS Status',
  [UUID.CYCLING_POWER_MEASUREMENT]: 'Cycling Power',
  [UUID.CSC_MEASUREMENT]: 'CSC',
  [UUID.RSC_MEASUREMENT]: 'RSC',
  [UUID.HEART_RATE_MEASUREMENT]: 'Heart Rate',
  [UUID.BATTERY_LEVEL]: 'Battery',
  [UUID.ZWIFT_ASYNC]: 'Zwift Async',
  [UUID.ZWIFT_SYNC_RX]: 'Zwift Sync RX',
  [UUID.ZWIFT_SYNC_TX]: 'Zwift Sync TX',
};

/** A short human label for logs: a known name, the 16-bit alias, or the first 8 hex digits. */
export function uuidLabel(uuid: string): string {
  let s: string;
  try {
    s = normalizeUuid(uuid);
  } catch {
    return uuid;
  }
  return LABELS[s] ?? shortUuid(s) ?? s.slice(0, 8);
}
