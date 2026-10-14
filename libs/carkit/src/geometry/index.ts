/** The Babylon-free half of the kit: specs, geometry and poses, for tests, workers and other renderers. */
export * from '../spec.ts'
export { Builder, Role, type GeometryData, type RoleId, type V3 } from './builder.ts'
export { buildBody, type CarLayout, type WheelSlot } from './body.ts'
export { buildWheel, WHEEL_SIDES } from './wheel.ts'
export * from '../pose.ts'
