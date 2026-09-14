/**
 * devicelib: talk to treadmills, bikes, trainers, ellipticals, rowers and sensors over Bluetooth LE.
 *
 * Typical web use:
 *   const manager = new DeviceManager(new WebBluetoothAdapter(), { log });
 *   button.onclick = async () => { const s = await manager.requestAndConnect(); s.setGrade(3); };
 *   manager.events.on('telemetry', (t) => game.update(t));
 */

// Core
export * from './core/types.ts';
export { DeviceError, type DeviceErrorCode } from './core/errors.ts';
export { Emitter, type Listener } from './core/events.ts';
export { Logger, consoleSink, TraceRecorder, silentLogger, type LogLevel, type LogRecord, type LogSink, type TraceRecord } from './core/log.ts';
export { realClock, sleep, type Clock } from './core/clock.ts';
export { UUID, normalizeUuid, uuidLabel } from './core/uuid.ts';
export { hex, fromHex, crc16CcittFalse } from './core/bytes.ts';

// Transport
export type { BleAdapter, BleDevice, BleConnection, BleService, BleCharacteristic, CharacteristicProperties, RequestDeviceOptions } from './transport/types.ts';
export { WebBluetoothAdapter } from './transport/webbluetooth.ts';
export { MockAdapter, MockPeripheral, type MockPeripheralSpec } from './transport/mock.ts';
export { Gatt, type GattSnapshot } from './transport/gatt.ts';

// Registry and quirks
export { REGISTRY_ENTRIES } from './registry/entries.generated.ts';
export { matchDevice, variantsFor, entryById, evaluate, type MatchContext, type MatchResult, type Variant } from './registry/matcher.ts';
export { protocolDisplayName } from './registry/protocolNames.ts';
export { defaultOptionalServices } from './registry/services.ts';
export type { RegistryEntry, MatchRule, Recommend, RegistryClass } from './registry/types.ts';
export { Quirks, type QuirkOverrides } from './quirks/quirks.ts';
export { QUIRK_FLAGS, type QuirkFlag } from './quirks/flags.generated.ts';

// Drivers
export { BaseDriver, type DeviceDriver, type DriverContext, type DriverNotice, type DriverOptions } from './protocols/driver.ts';
export { registerDriver, createDriver, hasDriver, detectStandardProtocol, type DriverCreator } from './protocols/index.ts';
export { FtmsDriver } from './protocols/ftms/driver.ts';
export { HorizonDriver } from './protocols/horizon.ts';
export { ZWIFT_GEAR_RATIOS } from './protocols/zwift/zap.ts';
/** FTMS wire format for diagnostics tools: frame builders, parsers, op, result and status names. */
export * as ftmsCodec from './protocols/ftms/codec.ts';

// Sessions
export { DeviceSession, type SessionOptions, type SessionInfo, type SessionState, type SessionEvents, type RoadSettings, type GearSettings, type ProtocolSelection, type ProtocolPreference, type ProtocolOptions } from './session/session.ts';
export { DeviceManager, type ManagerOptions, type DeviceFilter } from './session/manager.ts';
export * as physics from './session/physics.ts';

// Simulators
export { SimulatedBike, SimulatedTreadmill, createSimulatorAdapter } from './sim/index.ts';
