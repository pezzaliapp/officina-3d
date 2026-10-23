import * as THREE from 'three'
import type { RX } from './geo'

/**
 * Solido di rivoluzione della ruota (cerchio o pneumatico): una o più sezioni
 * chiuse nel piano (r, x) del sistema di riferimento frame, asse lungo X.
 */
export interface Solid {
  name: string
  frame: THREE.Object3D
  sections: RX[][]
  /** Per un solido deformato: riporta un punto (sistema di frame) alla forma indeformata. */
  unwarp?: (p: THREE.Vector3) => void
  /** Spostamento massimo della deformazione in corso, m. */
  slack?: () => number
}

/**
 * Forma qualsiasi (per esempio un'auto) data come funzione di profondità nel sistema di frame:
 * positiva dentro la forma, negativa fuori. bounds è il suo ingombro nello stesso sistema.
 */
export interface Shape {
  name: string
  frame: THREE.Object3D
  bounds: THREE.Box3
  depth(x: number, y: number, z: number): number
}

/** Compenetrazione trovata: parte della macchina, pezzo della ruota, profondità (m) e punto (mondo). */
export interface Hit { part: string; solid: string; depth: number; at: THREE.Vector3; r: number; x: number }

/** Distanza minima dei campioni sulle superfici dei pezzi, m. */
const STEP = 0.008

/**
 * Controllo di compenetrazione tra i pezzi della macchina e la ruota.
 *
 * Ogni superficie dei pezzi viene campionata con una griglia fitta di punti
 * (vertici, spigoli e interno dei triangoli). A ogni controllo i punti dei pezzi
 * vicini alla ruota vengono portati nel sistema di cerchio e pneumatico e
 * provati contro le loro sezioni: un punto dentro una sezione è dentro la ruota,
 * e la sua distanza dal contorno è la profondità di compenetrazione.
 */
export class InterferenceCheck {
  private readonly samples = new WeakMap<THREE.BufferGeometry, { pts: Float32Array; chunks: Float32Array }>()
  private readonly m = new THREE.Matrix4()
  private readonly p = new THREE.Vector3()
  private readonly sphere = new THREE.Sphere()

  /**
   * root: la macchina; skip: oggetti da non controllare (la ruota stessa, gli indicatori).
   */
  constructor(private root: THREE.Object3D, private skip: (o: THREE.Object3D) => boolean) {}

  /**
   * Compenetrazioni del momento, la più profonda per ogni coppia parte–solido.
   * allow(part) è la profondità ammessa per quella parte (contatto voluto che deforma il pneumatico).
   */
  run(solids: Solid[], allow: (part: string) => number): Hit[] {
    this.root.updateMatrixWorld(true)
    const prepared = solids.map((s) => prepare(s))
    const worst = new Map<string, Hit>()
    const visit = (o: THREE.Object3D, part: string) => {
      if (this.skip(o)) return
      if (o.userData.part) part = o.userData.part
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) this.mesh(mesh, part, prepared, allow(part), worst)
      for (const c of o.children) visit(c, part)
    }
    visit(this.root, '')
    return [...worst.values()].sort((a, b) => b.depth - a.depth)
  }

  private mesh(mesh: THREE.Mesh, part: string, solids: Prepared[], allowed: number, worst: Map<string, Hit>) {
    const geo = mesh.geometry
    if (!geo.boundingSphere) geo.computeBoundingSphere()
    this.sphere.copy(geo.boundingSphere!).applyMatrix4(mesh.matrixWorld)
    for (const s of solids) {
      if (this.sphere.center.distanceTo(s.center) > this.sphere.radius + s.radius) continue
      const { pts, chunks } = this.pointsOf(geo)
      this.m.copy(s.inverse).multiply(mesh.matrixWorld)
      const e = this.m.elements
      const sc = Math.max(1, mesh.matrixWorld.getMaxScaleOnAxis()) / s.scale
      let best = allowed, bi = -1, br = 0, bx = 0
      // la deformazione può spostare la gomma fino a m oltre la sua forma a riposo
      const m = s.unwarp ? s.slack?.() ?? 0.15 : 0
      const q = this.p
      for (let c = 0; c < chunks.length; c += 6) {
        // gruppo di punti vicini: si scarta tutto insieme se la sua sfera è lontana dal solido
        const cx = chunks[c + 2], cy = chunks[c + 3], cz = chunks[c + 4], cr = chunks[c + 5] * sc + m
        const gx = e[0] * cx + e[4] * cy + e[8] * cz + e[12]
        if (gx < s.x0 - cr || gx > s.x1 + cr) continue
        const gy = e[1] * cx + e[5] * cy + e[9] * cz + e[13]
        const gz = e[2] * cx + e[6] * cy + e[10] * cz + e[14]
        const gr = Math.hypot(gy, gz)
        if (gr > s.r1 + cr || gr < s.r0 - cr || lookup(s.grid, gr, gx) < -cr) continue
        for (let i = chunks[c]; i < chunks[c + 1]; i += 3) {
          const x = pts[i], y = pts[i + 1], z = pts[i + 2]
          let lx = e[0] * x + e[4] * y + e[8] * z + e[12]
          if (lx < s.x0 - m || lx > s.x1 + m) continue
          let ly = e[1] * x + e[5] * y + e[9] * z + e[13]
          let lz = e[2] * x + e[6] * y + e[10] * z + e[14]
          let rr = Math.hypot(ly, lz)
          if (rr > s.r1 + m || rr < s.r0 - m) continue
          if (m > 0) {
            if (lookup(s.grid, rr, lx) < -m) continue
            s.unwarp!(q.set(lx, ly, lz))
            lx = q.x; ly = q.y; lz = q.z
            rr = Math.hypot(ly, lz)
          }
          const d = lookup(s.grid, rr, lx)
          if (d > best) { best = d; bi = i; br = rr; bx = lx }
        }
      }
      if (bi < 0) continue
      const key = part + '|' + s.name
      const prev = worst.get(key)
      if (prev && prev.depth >= best) continue
      this.p.set(pts[bi], pts[bi + 1], pts[bi + 2]).applyMatrix4(mesh.matrixWorld)
      worst.set(key, { part, solid: s.name, depth: best, at: this.p.clone(), r: br, x: bx })
    }
  }

  /**
   * Come run, ma contro forme qualsiasi date dalla loro funzione di profondità (Shape).
   * Nei risultati r e x sono la quota y e la z del punto nel sistema della forma.
   */
  runShapes(shapes: Shape[], allow: (part: string) => number): Hit[] {
    this.root.updateMatrixWorld(true)
    const prepared = shapes.map((s) => ({
      s,
      inverse: s.frame.matrixWorld.clone().invert(),
      sphere: s.bounds.getBoundingSphere(new THREE.Sphere()).applyMatrix4(s.frame.matrixWorld),
    }))
    const worst = new Map<string, Hit>()
    const visit = (o: THREE.Object3D, part: string) => {
      if (this.skip(o)) return
      if (o.userData.part) part = o.userData.part
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) this.meshShapes(mesh, part, prepared, allow(part), worst)
      for (const c of o.children) visit(c, part)
    }
    visit(this.root, '')
    return [...worst.values()].sort((a, b) => b.depth - a.depth)
  }

  private meshShapes(mesh: THREE.Mesh, part: string, shapes: { s: Shape; inverse: THREE.Matrix4; sphere: THREE.Sphere }[], allowed: number, worst: Map<string, Hit>) {
    const geo = mesh.geometry
    if (!geo.boundingSphere) geo.computeBoundingSphere()
    this.sphere.copy(geo.boundingSphere!).applyMatrix4(mesh.matrixWorld)
    for (const { s, inverse, sphere } of shapes) {
      if (this.sphere.center.distanceTo(sphere.center) > this.sphere.radius + sphere.radius) continue
      const { pts, chunks } = this.pointsOf(geo)
      this.m.copy(inverse).multiply(mesh.matrixWorld)
      const e = this.m.elements
      const sc = Math.max(1, mesh.matrixWorld.getMaxScaleOnAxis())
      const b = s.bounds
      let best = allowed, bi = -1, by = 0, bz = 0
      for (let c = 0; c < chunks.length; c += 6) {
        // gruppo di punti vicini: si scarta tutto insieme se la sua sfera è fuori dall'ingombro
        const cx = chunks[c + 2], cy = chunks[c + 3], cz = chunks[c + 4], cr = chunks[c + 5] * sc
        const gx = e[0] * cx + e[4] * cy + e[8] * cz + e[12]
        const gy = e[1] * cx + e[5] * cy + e[9] * cz + e[13]
        const gz = e[2] * cx + e[6] * cy + e[10] * cz + e[14]
        if (gx < b.min.x - cr || gx > b.max.x + cr || gy < b.min.y - cr || gy > b.max.y + cr || gz < b.min.z - cr || gz > b.max.z + cr) continue
        for (let i = chunks[c]; i < chunks[c + 1]; i += 3) {
          const x = pts[i], y = pts[i + 1], z = pts[i + 2]
          const lx = e[0] * x + e[4] * y + e[8] * z + e[12]
          const ly = e[1] * x + e[5] * y + e[9] * z + e[13]
          const lz = e[2] * x + e[6] * y + e[10] * z + e[14]
          if (lx < b.min.x || lx > b.max.x || ly < b.min.y || ly > b.max.y || lz < b.min.z || lz > b.max.z) continue
          const d = s.depth(lx, ly, lz)
          if (d > best) { best = d; bi = i; by = ly; bz = lz }
        }
      }
      if (bi < 0) continue
      const key = part + '|' + s.name
      const prev = worst.get(key)
      if (prev && prev.depth >= best) continue
      this.p.set(pts[bi], pts[bi + 1], pts[bi + 2]).applyMatrix4(mesh.matrixWorld)
      worst.set(key, { part, solid: s.name, depth: best, at: this.p.clone(), r: by, x: bz })
    }
  }

  /**
   * Punti di campionamento della geometria, calcolati una volta sola, a gruppi di punti
   * vicini con la loro sfera: [inizio, fine, centro x, y, z, raggio] per ogni gruppo.
   */
  private pointsOf(geo: THREE.BufferGeometry) {
    let smp = this.samples.get(geo)
    if (smp) return smp
    const pos = geo.attributes.position as THREE.BufferAttribute
    const idx = geo.index
    const n = idx ? idx.count : pos.count
    const out: number[] = []
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
    for (let t = 0; t + 2 < n; t += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(t) : t)
      b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1)
      c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2)
      // griglia sui due lati che partono da a, più il terzo lato: i triangoli lunghi e stretti restano leggeri
      const ku = Math.max(1, Math.ceil(a.distanceTo(b) / STEP)), kv = Math.max(1, Math.ceil(a.distanceTo(c) / STEP))
      const push = (u: number, v: number) => {
        const w = 1 - u - v
        out.push(a.x * w + b.x * u + c.x * v, a.y * w + b.y * u + c.y * v, a.z * w + b.z * u + c.z * v)
      }
      for (let i = 0; i <= ku; i++)
        for (let j = 0; j <= kv; j++) if (i / ku + j / kv <= 1 + 1e-9) push(i / ku, j / kv)
      const kw = Math.max(1, Math.ceil(b.distanceTo(c) / STEP))
      for (let i = 1; i < kw; i++) push(1 - i / kw, i / kw)
    }
    const pts = new Float32Array(out)
    const ch: number[] = []
    const GROUP = 64 * 3
    for (let i0 = 0; i0 < pts.length; i0 += GROUP) {
      const i1 = Math.min(i0 + GROUP, pts.length)
      let cx = 0, cy = 0, cz = 0
      for (let i = i0; i < i1; i += 3) { cx += pts[i]; cy += pts[i + 1]; cz += pts[i + 2] }
      const k = (i1 - i0) / 3
      cx /= k; cy /= k; cz /= k
      let r = 0
      for (let i = i0; i < i1; i += 3) r = Math.max(r, Math.hypot(pts[i] - cx, pts[i + 1] - cy, pts[i + 2] - cz))
      ch.push(i0, i1, cx, cy, cz, r)
    }
    smp = { pts, chunks: new Float32Array(ch) }
    this.samples.set(geo, smp)
    return smp
  }
}

interface Prepared { name: string; scale: number; grid: Grid; unwarp?: (p: THREE.Vector3) => void; slack?: () => number; inverse: THREE.Matrix4; center: THREE.Vector3; radius: number; x0: number; x1: number; r0: number; r1: number }

/**
 * Distanza dal contorno precalcolata su una griglia (r, x) a passo CELL, positiva dentro e
 * negativa fuori (fino a −FAR): si legge in tempo costante.
 */
interface Grid { r0: number; x0: number; nr: number; nx: number; d: Float32Array }
const CELL = 0.001, FAR = 0.2, PAD = 0.15
const grids = new WeakMap<RX[][], Grid>()

function gridOf(sections: RX[][]): Grid {
  let g = grids.get(sections)
  if (g) return g
  let r0 = Infinity, r1 = 0, x0 = Infinity, x1 = -Infinity
  for (const sec of sections) for (const [r, x] of sec) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); x0 = Math.min(x0, x); x1 = Math.max(x1, x) }
  // margine attorno al solido, per sapere quanto è lontano un punto fuori
  r0 = Math.max(0, r0 - PAD); r1 += PAD; x0 -= PAD; x1 += PAD
  const nr = Math.ceil((r1 - r0) / CELL) + 1, nx = Math.ceil((x1 - x0) / CELL) + 1
  const d = new Float32Array(nr * nx)
  for (let i = 0; i < nr; i++) for (let j = 0; j < nx; j++) d[i * nx + j] = depthIn(sections, r0 + i * CELL, x0 + j * CELL)
  g = { r0, x0, nr, nx, d }
  grids.set(sections, g)
  return g
}

function lookup(g: Grid, r: number, x: number) {
  const i = Math.round((r - g.r0) / CELL), j = Math.round((x - g.x0) / CELL)
  if (i < 0 || j < 0 || i >= g.nr || j >= g.nx) return -FAR
  return g.d[i * g.nx + j]
}

function prepare(s: Solid): Prepared {
  const grid = gridOf(s.sections)
  let x0 = Infinity, x1 = -Infinity, r0 = Infinity, r1 = 0
  for (const sec of s.sections) for (const [r, x] of sec) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); x0 = Math.min(x0, x); x1 = Math.max(x1, x) }
  const w = s.frame.matrixWorld
  const scale = w.getMaxScaleOnAxis()
  const center = new THREE.Vector3((x0 + x1) / 2, 0, 0).applyMatrix4(w)
  return { name: s.name, scale, grid, unwarp: s.unwarp, slack: s.slack, inverse: w.clone().invert(), center, radius: Math.hypot(r1, (x1 - x0) / 2) * scale, x0, x1, r0, r1 }
}

/** Distanza del punto (r, x) dal contorno delle sezioni: positiva dentro, negativa fuori. */
function depthIn(sections: RX[][], r: number, x: number) {
  let best = -Infinity
  for (const sec of sections) {
    let inside = false, d2 = Infinity
    for (let i = 0, j = sec.length - 1; i < sec.length; j = i++) {
      const [ri, xi] = sec[i], [rj, xj] = sec[j]
      if (xi > x !== xj > x && r < ((rj - ri) * (x - xi)) / (xj - xi) + ri) inside = !inside
      const dr = rj - ri, dx = xj - xi
      const L = dr * dr + dx * dx
      const t = L > 0 ? Math.max(0, Math.min(1, ((r - ri) * dr + (x - xi) * dx) / L)) : 0
      d2 = Math.min(d2, (ri + t * dr - r) ** 2 + (xi + t * dx - x) ** 2)
    }
    const d = inside ? Math.sqrt(d2) : -Math.sqrt(d2)
    if (d > best) best = d
  }
  return Math.max(best, -FAR)
}
