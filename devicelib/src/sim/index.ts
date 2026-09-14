import { MockAdapter } from '../transport/mock.ts';
import { SimulatedBike, type SimBikeOptions } from './bike.ts';
import { SimulatedTreadmill, type SimTreadmillOptions } from './treadmill.ts';

export { SimulatedBike, SimulatedTreadmill };
export type { SimBikeOptions, SimTreadmillOptions };

/**
 * An adapter whose chooser offers simulated devices, so a game can run with no hardware.
 * The simulators stream telemetry on their own timers.
 */
export function createSimulatorAdapter(opts: { treadmill?: SimTreadmillOptions | false; bike?: SimBikeOptions | false } = {}): {
  adapter: MockAdapter;
  treadmill?: SimulatedTreadmill;
  bike?: SimulatedBike;
} {
  const treadmill = opts.treadmill === false ? undefined : new SimulatedTreadmill(opts.treadmill ?? {});
  const bike = opts.bike === false ? undefined : new SimulatedBike(opts.bike ?? {});
  treadmill?.start();
  bike?.start();
  const devices = [treadmill?.peripheral, bike?.peripheral].filter((d) => d !== undefined);
  return { adapter: new MockAdapter(devices), treadmill, bike };
}
