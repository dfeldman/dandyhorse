/**
 * Something to ride through when you get somewhere.
 *
 * A route already knows where its places are — the baker writes them into the manifest as landmarks, with a
 * kind each: the towns along the Katy, the hairpins and the summit of the Alpe, the viewpoints worth looking
 * up from the front wheel for. Until now they existed only as a line of text in the corner of the screen,
 * which is not an arrival. An hour into a climb, passing something ought to be a moment.
 *
 * So each one gets a gate over the road: two posts, a crossbar, and a banner with a symbol on it, coloured by
 * what sort of place it is. They are visible from a long way off, which is the point — a summit gate on the
 * skyline is a thing to ride toward — and they are the one piece of scenery here that is not pretending to be
 * real. That is deliberate. It is the game's own furniture, like a finish arch at a sportive, and a rider
 * reads it instantly for what it is.
 *
 * Cheap, because there are never many at once: one mesh per kind of place, thin-instanced at whichever
 * landmarks are within sight, rebuilt when the rider has moved far enough to change which those are.
 */
import {
  Color3,
  DynamicTexture,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  type Scene,
  StandardMaterial,
  Vector3,
  VertexData,
} from '@babylonjs/core'
import { Config } from '../config.ts'
import type { RouteManifest } from '../route/package.ts'
import type { Route } from '../route/route.ts'
import type { Frame } from './frame.ts'
import { Layer } from './layers.ts'
import type { Atmosphere } from './materials/aerial.ts'

type Kind = RouteManifest['landmarks'][number]['kind']

/**
 * What each sort of place looks like: a symbol drawn on the banner and the colour of the gate.
 *
 * The symbols are glyphs rather than artwork, drawn into a small texture at load. That keeps the whole feature
 * to a few kilobytes and, more usefully, means a new kind of landmark needs one line here rather than an
 * asset — the baker has invented kinds before and will again.
 */
const LOOK: Record<Kind, { glyph: string; colour: string; ink: string }> = {
  start: { glyph: '▶', colour: '#2f6f4f', ink: '#f4f1e6' },
  finish: { glyph: '★', colour: '#b5432d', ink: '#f9f4d8' },
  summit: { glyph: '▲', colour: '#4a5d7e', ink: '#f4f1e6' },
  town: { glyph: '■', colour: '#8a6a3a', ink: '#f7f0df' },
  hairpin: { glyph: '↩', colour: '#7b5ea8', ink: '#f4f1e6' },
  viewpoint: { glyph: '●', colour: '#2d6cb5', ink: '#f4f1e6' },
  water: { glyph: '≈', colour: '#20808d', ink: '#eef7f8' },
}

/**
 * The board, with the name of the place on it.
 *
 * It began as one texture per KIND — a symbol on a colour, and nothing else — on the reasoning that a board
 * carries one idea at the distance it is read from. That was wrong in the way that only shows up when you ride
 * past one: a gate that says nothing but "a viewpoint" is furniture, and a gate that says "Roche du Regardet"
 * is somewhere. The name is the whole point of a landmark.
 *
 * So a board is drawn per landmark instead. The cost is a texture and a draw call each, which is why only the
 * handful of gates actually in range have one (see the pool in `Markers`), and why the towns of the Katy —
 * sixty-three of them — never cost anything until the rider is near them.
 *
 * It is painted as a sign rather than as a label: a dark surround, a lighter panel inset into it, the symbol
 * small and the name large. The inset is what makes it read as a made object at two hundred metres, where the
 * text is a few pixels tall and only the shape is left.
 */
function paintBoard(scene: Scene, kind: Kind, name: string, texture?: DynamicTexture): DynamicTexture {
  const look = LOOK[kind]
  const w = 512
  const h = 256
  const board = texture ?? new DynamicTexture(`marker${name}`, { width: w, height: h }, scene, true)
  const ctx = board.getContext() as CanvasRenderingContext2D
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = look.colour
  ctx.fillRect(0, 0, w, h)
  // the inset panel, a shade lighter, with a dark line around it
  ctx.fillStyle = 'rgba(255,255,255,0.10)'
  ctx.fillRect(14, 14, w - 28, h - 28)
  ctx.strokeStyle = 'rgba(0,0,0,0.30)'
  ctx.lineWidth = 5
  ctx.strokeRect(14, 14, w - 28, h - 28)

  ctx.fillStyle = look.ink
  ctx.textBaseline = 'middle'

  /**
   * The name, as large as the board will carry, because that is what the board is FOR.
   *
   * The first version put a symbol at the left and the name beside it at a fixed size, which at sixty metres —
   * the distance a gate is first read from — was a few pixels tall and unreadable. A road sign solves this the
   * same way every time: one line of text, as big as it will go, and everything else small and out of its way.
   */
  let size = 96
  ctx.textAlign = 'center'
  do {
    ctx.font = `600 ${size}px system-ui, sans-serif`
    size -= 4
  } while (size > 26 && ctx.measureText(name).width > w - 70)
  ctx.fillText(name, w / 2, h / 2 + 4)

  // the symbol, small, in the corner, where it says what KIND of place this is without competing for the name
  ctx.font = '38px system-ui, sans-serif'
  ctx.globalAlpha = 0.85
  ctx.textAlign = 'left'
  ctx.fillText(look.glyph, 34, 48)
  ctx.globalAlpha = 1

  board.update()
  return board
}

/**
 * The frame of a gate — two posts and a crossbar — built about the origin, pointing down the route.
 *
 * Everything is in metres, so an instance is a rotation and a translation and never a scale: a gate over a
 * five-metre road and one over a three-metre trail are different gates, and the width is taken from the route
 * when they are built. One frame serves every kind of landmark; only the board differs.
 */
function buildFrame(scene: Scene, half: number): Mesh {
  const reach = half + 0.7
  const top = 4.4
  const buried = 1.2
  const parts: Mesh[] = []
  for (const side of [-1, 1]) {
    const post = MeshBuilder.CreateCylinder('markerPost', { height: top + buried, diameter: 0.22, tessellation: 7 }, scene)
    post.position.set(reach * side, (top - buried) / 2, 0)
    parts.push(post)
  }
  const beam = MeshBuilder.CreateBox('markerBeam', { width: reach * 2 + 0.22, height: 0.22, depth: 0.22 }, scene)
  beam.position.set(0, top, 0)
  parts.push(beam)
  const frame = Mesh.MergeMeshes(parts, true, true) as Mesh
  frame.name = 'markerFrame'
  return frame
}

/** The board that hangs under the beam, square across the road so it is read head-on from either direction. */
function buildBoard(scene: Scene, half: number, index: number): Mesh {
  const reach = half + 0.7
  const top = 4.4
  const board = new Mesh(`markerBoard${index}`, scene)
  const w = Math.min(3.4, reach * 1.6)
  const h = w / 2
  const data = new VertexData()
  data.positions = [-w / 2, top - 0.14 - h, 0, w / 2, top - 0.14 - h, 0, w / 2, top - 0.14, 0, -w / 2, top - 0.14, 0]
  data.normals = [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1]
  data.uvs = [0, 0, 1, 0, 1, 1, 0, 1]
  data.indices = [0, 1, 2, 0, 2, 3]
  data.applyToMesh(board, false)
  return board
}

/** As many boards as can be in sight at once. Beyond this the furthest gate simply has no sign on it. */
const BOARDS = 8

export class Markers {
  private readonly scene: Scene
  private readonly route: Route
  private readonly frame: Frame
  private readonly gate: Mesh
  private readonly matrices: number[] = []
  /**
   * A pool of boards, each with a texture of its own.
   *
   * A board carries a place's NAME, so it cannot be shared between places — but the Katy has sixty-three
   * landmarks and painting a texture for each at load would be sixty-three canvases for the handful ever on
   * screen. So there are eight, and each is repainted when it is given a new landmark to be. The `for` field
   * is what stops it being repainted every time the rider moves sixty metres, which would be a canvas draw and
   * a texture upload several times a minute for a sign that has not changed.
   */
  private readonly boards: Array<{ mesh: Mesh; material: StandardMaterial; texture: DynamicTexture; for: string }> = []
  private readonly materials: StandardMaterial[] = []
  private placedAt = Number.NaN

  constructor(scene: Scene, route: Route, frame: Frame, atmosphere?: Atmosphere) {
    this.scene = scene
    this.route = route
    this.frame = frame
    const half = Config.trailWidth / 2

    const wood = new StandardMaterial('markerWood', scene)
    wood.diffuseColor = new Color3(0.42, 0.36, 0.30)
    wood.specularColor = Color3.Black()
    wood.emissiveColor = new Color3(0.05, 0.045, 0.04)
    this.materials.push(wood)
    atmosphere?.attach(wood)

    this.gate = buildFrame(scene, half)
    this.gate.material = wood
    this.dress(this.gate)

    for (let i = 0; i < BOARDS; i++) {
      const mesh = buildBoard(scene, half, i)
      const texture = paintBoard(scene, 'town', '', undefined)
      const material = new StandardMaterial(`markerBoardMat${i}`, scene)
      material.diffuseTexture = texture
      material.specularColor = Color3.Black()
      material.backFaceCulling = false
      this.materials.push(material)
      atmosphere?.attach(material)
      mesh.material = material
      this.dress(mesh)
      this.boards.push({ mesh, material, texture, for: '' })
    }
    frame.onShift(() => { this.placedAt = Number.NaN })
  }

  private dress(mesh: Mesh): void {
    mesh.renderingGroupId = Layer.near
    mesh.isPickable = false
    mesh.receiveShadows = false
    mesh.alwaysSelectAsActiveMesh = true
    mesh.setEnabled(false)
  }

  /**
   * Put a gate at every landmark within sight of `s` metres along the route.
   *
   * Rebuilt only when the rider has moved a good way, because which landmarks are in range changes slowly and
   * the answer is a handful of matrices either way.
   */
  update(s: number): void {
    if (Number.isFinite(this.placedAt) && Math.abs(s - this.placedAt) < 60) return
    this.placedAt = s
    this.matrices.length = 0

    const scaling = new Vector3(1, 1, 1)
    const position = new Vector3()
    const rotation = new Quaternion()
    // Two landmarks can share a metre of route — the Alpe's start and the town it starts in are both at zero —
    // and two gates in the same place are two boards fighting for the same pixels.
    const placed = new Set<number>()
    const wanted: Array<{ name: string; kind: Kind; x: number; y: number; z: number; yaw: number }> = []

    for (const landmark of this.route.manifest.landmarks) {
      const ahead = landmark.s - s
      // far enough back to still be behind the rider on screen, far enough ahead to be ridden toward
      if (ahead < -60 || ahead > Config.markerReach) continue
      const slot = Math.round(landmark.s / 12)
      if (placed.has(slot)) continue
      placed.add(slot)
      const pose = this.route.poseAt(landmark.s)
      const yaw = Math.atan2(pose.hx, pose.hz)
      position.set(pose.x - this.frame.x, pose.y + Config.trailLift, pose.z - this.frame.z)
      Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, rotation)
      const m = Matrix.Compose(scaling, rotation, position)
      for (let i = 0; i < 16; i++) this.matrices.push(m.m[i])
      wanted.push({ name: landmark.name, kind: landmark.kind, x: position.x, y: position.y, z: position.z, yaw })
    }

    if (this.matrices.length) {
      this.gate.thinInstanceSetBuffer('matrix', new Float32Array(this.matrices), 16, true)
      this.gate.setEnabled(true)
    } else {
      this.gate.setEnabled(false)
    }

    // the nearest ones get the boards, because those are the ones anybody can read
    wanted.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))
    this.boards.forEach((board, i) => {
      const want = wanted[i]
      if (!want) { board.mesh.setEnabled(false); return }
      const id = `${want.kind}/${want.name}`
      if (board.for !== id) {
        paintBoard(this.scene, want.kind, want.name, board.texture)
        board.for = id
      }
      board.mesh.position.set(want.x, want.y, want.z)
      board.mesh.rotationQuaternion = Quaternion.RotationYawPitchRoll(want.yaw, 0, 0)
      board.mesh.setEnabled(true)
    })
  }

  dispose(): void {
    this.gate.dispose()
    for (const board of this.boards) { board.mesh.dispose(); board.texture.dispose() }
    for (const m of this.materials) m.dispose()
  }
}
