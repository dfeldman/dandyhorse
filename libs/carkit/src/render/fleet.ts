/**
 * A fleet: every vehicle in a scene, drawn with thin instances.
 *
 * Vehicles that share a shape (`shapeKey`: same archetype and dimensions, any colour) share one body mesh; all
 * the wheels of every vehicle are copies of ONE wheel mesh. A city with forty shapes and three hundred cars is
 * forty-two draw calls (forty bodies, the wheels, the shadows). Colour, light state and blink phase ride along
 * per copy, so none of them costs a mesh either.
 *
 * Each frame the game sets what it knows on each `Car` — where it is, which way it points, how far it moved,
 * what the driver is doing — and calls `fleet.update(dt)`, which writes every buffer once.
 *
 * Two lessons carried over from Street Runner's own pools (render/life.ts there):
 * - a thin-instanced mesh with NO instances is still drawn once as a plain mesh, with garbage world matrices:
 *   an empty shape is disabled, not just emptied;
 * - the source mesh sits at the origin while its copies are all over the map, so Babylon's frustum test on it
 *   is meaningless: shapes are always selected and the GPU does the culling.
 */
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial'
import type { Scene } from '@babylonjs/core/scene'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import { shapeKey, type CarSpec, type Rgb } from '../spec.ts'
import { buildBody, type CarLayout } from '../geometry/body.ts'
import { buildWheel } from '../geometry/wheel.ts'
import type { Builder } from '../geometry/builder.ts'
import { ackermann, groundPose, PoseSmoother, wheelDrops, type HeightFn, type Pose } from '../pose.ts'
import { carMaterial, setCarLook, shadowMaterial, type CarLook } from './material.ts'

export type Indicator = 'off' | 'left' | 'right' | 'hazard'

export interface CarLights {
  brake: boolean
  indicator: Indicator
  headlights: boolean
  reverse: boolean
  /** emergency beacons (police, ambulance) */
  beacon: boolean
  /** a taxi's roof sign by day ("for hire"); signs always light at night */
  sign: boolean
}

/** One vehicle in a fleet. Set its fields; the fleet draws it on the next `update`. */
export class Car {
  x = 0
  y = 0
  z = 0
  /** heading: 0 is +z, π/2 is +x */
  yaw = 0
  /** positive = nose down (Babylon's convention); see pose.ts */
  pitch = 0
  /** positive = right side up */
  roll = 0
  /** bicycle-model steer angle, radians, positive = right; split per wheel by Ackermann */
  steer = 0
  /** how far each wheel hangs below rest (layout order), from `place` */
  drops: number[]
  readonly lights: CarLights = { brake: false, indicator: 'off', headlights: false, reverse: false, beacon: false, sign: false }
  paint: Rgb
  paint2: Rgb
  /** a livery painted in bands by the shader (Muni's red over silver): the body's height, or 0 for none */
  bands = 0
  visible = true
  /** seconds added to the fleet clock for this car's flashing lamps */
  phase: number
  /** wheel rotation, radians */
  spin = 0
  private smoother?: PoseSmoother

  readonly spec: CarSpec
  readonly layout: CarLayout
  /** the shape key: which mesh this car is a copy of */
  readonly shape: string

  constructor(spec: CarSpec, layout: CarLayout, shape: string) {
    this.spec = spec
    this.layout = layout
    this.shape = shape
    this.paint = [...spec.paint]
    this.paint2 = [...spec.paint2]
    if (spec.livery === 'transit') this.bands = spec.height
    this.drops = layout.wheels.map(() => 0)
    this.phase = Math.random() * 0.66
  }

  /** Turn the wheels for `distance` metres travelled SINCE THE LAST CALL (negative backwards). */
  drive(distance: number): void {
    this.spin = (this.spin + distance / this.layout.wheels[0].radius) % (Math.PI * 2)
  }

  /** Set the full pose at once. */
  setPose(p: Pose): void {
    this.x = p.x; this.y = p.y; this.z = p.z
    this.yaw = p.yaw; this.pitch = p.pitch; this.roll = p.roll
  }

  /**
   * Put the car on the ground at (x, z) facing `yaw`: pitch, roll and height from the ground under its four
   * tyres, and each wheel dropped onto the road. Pass `dt` to settle smoothly over crests instead of snapping.
   */
  place(x: number, z: number, yaw: number, height: HeightFn, dt?: number): void {
    let p = groundPose(this.layout, x, z, yaw, height)
    if (dt !== undefined) {
      this.smoother ??= new PoseSmoother()
      p = this.smoother.update(p, dt)
      // the body now lags the ground a little: drop the wheels onto the road from where the body IS
      p.drops = wheelDrops(this.layout, p, height)
    }
    this.setPose(p)
    this.drops = p.drops
  }

  get length(): number { return this.spec.length }
}

interface Shape {
  key: string
  mesh: Mesh
  layout: CarLayout
  cars: Car[]
  capacity: number
  matrices: Float32Array
  paint: Float32Array
  paint2: Float32Array
  lights: Float32Array
}

function meshFrom(scene: Scene, name: string, b: Builder): Mesh {
  const g = b.build()
  const mesh = new Mesh(name, scene)
  const vd = new VertexData()
  vd.positions = g.positions
  vd.normals = g.normals
  vd.colors = g.colors
  vd.indices = g.indices
  vd.applyToMesh(mesh)
  mesh.setVerticesData('role', g.roles, false, 1)
  return mesh
}

const INDICATOR: Record<Indicator, number> = { off: 0, left: 1, right: 2, hazard: 3 }

export interface FleetOptions {
  /** soft blob shadows under every vehicle (Street Runner draws its own; the demo wants these) */
  shadows?: boolean
  renderingGroupId?: number
  /** a material to draw with instead of the kit's own (must accept the same attributes) */
  material?: ShaderMaterial
}

export class Fleet {
  readonly material: ShaderMaterial
  private readonly shapes = new Map<string, Shape>()
  private readonly wheel: Shape
  private readonly shadow?: Shape
  private time = 0
  private readonly group: number
  // scratch
  private readonly m = new Matrix()
  private readonly wm = new Matrix()
  private readonly t1 = new Matrix()
  private readonly t2 = new Matrix()
  private readonly q = new Quaternion()
  private readonly v = new Vector3()
  private readonly one = Vector3.One()

  private readonly scene: Scene

  constructor(scene: Scene, opts: FleetOptions = {}) {
    this.scene = scene
    this.group = opts.renderingGroupId ?? 0
    this.material = opts.material ?? carMaterial(scene)
    const wheelLayout = undefined as unknown as CarLayout
    this.wheel = this.makeShape('wheels', meshFrom(scene, 'carkit.wheels', buildWheel()), wheelLayout)
    if (opts.shadows) {
      const quad = new Mesh('carkit.shadows', scene)
      const vd = new VertexData()
      vd.positions = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]
      vd.uvs = [0, 0, 1, 0, 1, 1, 0, 1]
      vd.indices = [0, 2, 1, 0, 3, 2]
      vd.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]
      vd.applyToMesh(quad)
      quad.material = shadowMaterial(scene)
      this.shadow = this.makeShape('shadows', quad, wheelLayout, false)
    }
  }

  private makeShape(key: string, mesh: Mesh, layout: CarLayout, lit = true): Shape {
    if (lit) mesh.material = this.material
    mesh.isPickable = false
    mesh.alwaysSelectAsActiveMesh = true
    mesh.renderingGroupId = this.group
    mesh.setEnabled(false)
    const shape: Shape = { key, mesh, layout, cars: [], capacity: 0, matrices: new Float32Array(0),
      paint: new Float32Array(0), paint2: new Float32Array(0), lights: new Float32Array(0) }
    return shape
  }

  /** Make sure a shape's buffers hold `n` copies, growing (by doubling) and re-registering them if not. */
  private reserve(s: Shape, n: number, lit = true): void {
    if (n <= s.capacity) return
    const cap = Math.max(8, 1 << Math.ceil(Math.log2(n)))
    const grow = (old: Float32Array, stride: number): Float32Array => {
      const a = new Float32Array(cap * stride)
      a.set(old.subarray(0, Math.min(old.length, a.length)))
      return a
    }
    s.matrices = grow(s.matrices, 16)
    s.mesh.thinInstanceSetBuffer('matrix', s.matrices, 16, false)
    if (lit) {
      s.paint = grow(s.paint, 4)
      s.paint2 = grow(s.paint2, 4)
      s.lights = grow(s.lights, 4)
      s.mesh.thinInstanceSetBuffer('paint', s.paint, 4, false)
      s.mesh.thinInstanceSetBuffer('paint2', s.paint2, 4, false)
      s.mesh.thinInstanceSetBuffer('lights', s.lights, 4, false)
    }
    s.capacity = cap
  }

  /** Add a vehicle. Vehicles of the same shape share a mesh; the first of a new shape builds it. */
  add(spec: CarSpec): Car {
    const key = shapeKey(spec)
    let shape = this.shapes.get(key)
    if (!shape) {
      const { body, layout } = buildBody(spec)
      shape = this.makeShape(key, meshFrom(this.scene, `carkit.${spec.archetype}.${this.shapes.size}`, body), layout)
      this.shapes.set(key, shape)
    }
    const car = new Car(spec, shape.layout, key)
    shape.cars.push(car)
    return car
  }

  remove(car: Car): void {
    const shape = this.shapes.get(car.shape)
    if (!shape) return
    const i = shape.cars.indexOf(car)
    if (i >= 0) shape.cars.splice(i, 1)
    if (shape.cars.length === 0) {
      shape.mesh.dispose()
      this.shapes.delete(car.shape)
    }
  }

  clear(): void {
    for (const s of this.shapes.values()) s.mesh.dispose()
    this.shapes.clear()
  }

  get cars(): Car[] { return [...this.shapes.values()].flatMap((s) => s.cars) }

  get stats(): { cars: number; shapes: number; drawCalls: number; triangles: number } {
    let cars = 0, tris = 0
    for (const s of this.shapes.values()) {
      const n = s.cars.filter((c) => c.visible).length
      cars += n
      tris += n * (s.mesh.getTotalIndices() / 3)
    }
    const wheelTris = this.wheel.mesh.getTotalIndices() / 3
    tris += this.wheel.mesh.thinInstanceCount * wheelTris
    return { cars, shapes: this.shapes.size, drawCalls: this.shapes.size + 1 + (this.shadow ? 1 : 0), triangles: tris }
  }

  setLook(look: CarLook): void { setCarLook(this.material, look) }

  /** Advance the lamp clock by `dt` seconds and write every vehicle, wheel and shadow into its buffers. */
  update(dt: number): void {
    this.time += dt
    this.material.setFloat('time', this.time)
    const cam = this.scene.activeCamera
    if (cam) this.material.setVector3('eye', cam.globalPosition)

    let wheels = 0
    let shadows = 0
    for (const s of this.shapes.values()) {
      wheels += s.cars.length * s.layout.wheels.length
      shadows += s.cars.length
    }
    this.reserve(this.wheel, wheels)
    if (this.shadow) this.reserve(this.shadow, shadows, false)

    let wi = 0, si = 0
    for (const s of this.shapes.values()) {
      this.reserve(s, s.cars.length)
      let n = 0
      for (const c of s.cars) {
        if (!c.visible) continue
        Quaternion.RotationYawPitchRollToRef(c.yaw, c.pitch, c.roll, this.q)
        this.v.set(c.x, c.y, c.z)
        Matrix.ComposeToRef(this.one, this.q, this.v, this.m)
        this.m.copyToArray(s.matrices, n * 16)
        const o = n * 4
        s.paint[o] = c.paint[0]; s.paint[o + 1] = c.paint[1]; s.paint[o + 2] = c.paint[2]; s.paint[o + 3] = c.phase
        s.paint2[o] = c.paint2[0]; s.paint2[o + 1] = c.paint2[1]; s.paint2[o + 2] = c.paint2[2]; s.paint2[o + 3] = c.bands
        const L = c.lights
        s.lights[o] = L.brake ? 1 : 0
        s.lights[o + 1] = INDICATOR[L.indicator]
        s.lights[o + 2] = L.headlights ? 1 : 0
        s.lights[o + 3] = (L.reverse ? 1 : 0) + (L.beacon ? 2 : 0) + (L.sign ? 4 : 0)
        n++

        // the wheels: scale to the tyre, spin, steer, drop onto the road, then the body's matrix
        const [steerL, steerR] = ackermann(c.layout, c.steer)
        c.layout.wheels.forEach((w, k) => {
          const steer = w.steers ? (w.side < 0 ? steerL : steerR) : 0
          Matrix.ScalingToRef(w.width, w.radius, w.radius, this.t1)
          Matrix.RotationXToRef(w.side < 0 ? -c.spin : c.spin, this.t2)
          this.t1.multiplyToRef(this.t2, this.wm)
          Matrix.RotationYToRef(steer + (w.side < 0 ? Math.PI : 0), this.t2)
          this.wm.multiplyToRef(this.t2, this.t1)
          Matrix.TranslationToRef(w.x, w.y - (c.drops[k] ?? 0), w.z, this.t2)
          this.t1.multiplyToRef(this.t2, this.wm)
          this.wm.multiplyToRef(this.m, this.t1)
          this.t1.copyToArray(this.wheel.matrices, wi * 16)
          wi++
        })

        if (this.shadow) {
          // flat under the car, a touch larger than its footprint, on the road under its middle
          const sx = (c.layout.max[0] - c.layout.min[0]) * 0.92 + 0.3
          const sz = (c.layout.max[2] - c.layout.min[2]) + 0.5
          const mid = (c.layout.max[2] + c.layout.min[2]) / 2
          Quaternion.RotationYawPitchRollToRef(c.yaw, c.pitch, c.roll, this.q)
          Matrix.ScalingToRef(sx, 1, sz, this.t1)
          Matrix.TranslationToRef(0, 0.02, mid, this.t2)
          this.t1.multiplyToRef(this.t2, this.wm)
          this.wm.multiplyToRef(this.m, this.t1)
          this.t1.copyToArray(this.shadow.matrices, si * 16)
          si++
        }
      }
      s.mesh.thinInstanceCount = n
      s.mesh.setEnabled(n > 0)
      if (n > 0) {
        s.mesh.thinInstanceBufferUpdated('matrix')
        s.mesh.thinInstanceBufferUpdated('paint')
        s.mesh.thinInstanceBufferUpdated('paint2')
        s.mesh.thinInstanceBufferUpdated('lights')
      }
    }
    this.wheel.mesh.thinInstanceCount = wi
    this.wheel.mesh.setEnabled(wi > 0)
    if (wi > 0) this.wheel.mesh.thinInstanceBufferUpdated('matrix')
    if (this.shadow) {
      this.shadow.mesh.thinInstanceCount = si
      this.shadow.mesh.setEnabled(si > 0)
      if (si > 0) this.shadow.mesh.thinInstanceBufferUpdated('matrix')
    }
  }

  dispose(): void {
    this.clear()
    this.wheel.mesh.dispose()
    this.shadow?.mesh.dispose()
  }
}

