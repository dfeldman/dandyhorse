export type DeviceErrorCode =
  | 'unavailable' // no Bluetooth on this platform or it is turned off
  | 'cancelled' // the user dismissed the device chooser
  | 'connect_failed'
  | 'disconnected'
  | 'not_supported' // the device or its protocol cannot do what was asked
  | 'timeout'
  | 'protocol'; // the device answered with something we did not expect

export class DeviceError extends Error {
  readonly code: DeviceErrorCode;
  override readonly cause?: unknown;

  constructor(code: DeviceErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'DeviceError';
    this.code = code;
    this.cause = cause;
  }
}
