/**
 * carkit: procedural low-poly vehicles for Dandyhorse games.
 *
 *   const fleet = new Fleet(scene)
 *   const taxi = fleet.add(randomSpec('sedan', 42, 'taxi'))
 *   // each frame:
 *   taxi.place(x, z, heading, (x, z) => ground.heightAt(x, z), dt)   // on the hill, wheels on the road
 *   taxi.steer = steerForCurvature(taxi.layout, k)
 *   taxi.drive(speed * dt)
 *   taxi.lights.brake = slowing
 *   taxi.lights.indicator = turningLeft ? 'left' : 'off'
 *   fleet.update(dt)
 */
export * from './geometry/index.ts'
export { Car, Fleet, type CarLights, type FleetOptions, type Indicator } from './render/fleet.ts'
export { carMaterial, DEFAULT_LOOK, setCarLook, shadowMaterial, type CarLook } from './render/material.ts'
