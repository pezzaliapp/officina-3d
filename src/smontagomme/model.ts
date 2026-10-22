import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { Section } from '../core/section'
import { MachineModel, LOOK, Look } from '../core/model'
import { revolveX, cylX, tubeX, box, beltPath, RX } from '../core/geo'
import { WheelSpec, wheelGeometry, wheelMeshes } from '../core/wheel'

/** Quota del piano del piatto e sua posizione in profondità, m. */
export const TT_Y = 0.765
export const TT_Z = -0.03
/** Cerniera del palo ribaltabile. */
export const COL_P = new THREE.Vector3(0, 0.5, -0.49)
export const COL_BACK = -0.42
/** Perno verticale del braccio stallonatore, lunghezza del braccio e quota della paletta. */
export const BB_P = new THREE.Vector3(0.4, 0.42, -0.34)
export const ARM_L = 0.8
export const BLADE_Y = 0.3
/** Faccia esterna dei tamponi su cui appoggia la ruota. */
export const PAD_X = 0.41
/** Leva corta dietro il perno, su cui spinge il cilindro (nel sistema del braccio). */
export const BB_LEVER = new THREE.Vector3(-0.2, -0.14, -0.06)
/** Attacco fisso del cilindro dello stallonatore. */
export const BB_ANCHOR = new THREE.Vector3(0.2, 0.28, 0.12)
const TILT_ANCHOR = new THREE.Vector3(0, 0.1, -0.32)
const ZW = TT_Z + 0.091 // asse della vite senza fine
/** Asse della colonna del braccio di aiuto (x, z). */
export const HC = { x: -0.56, z: -0.05 }
const BELT_X = -0.27

const JAW_ANGLES = [0.25, 0.75, 1.25, 1.75].map((k) => k * Math.PI)

/**
 * Cilindro pneumatico tra due punti: canna fissa sull'attacco, pistone e stelo
 * che scorrono verso il punto mobile. La canna è cava, così in sezione si vede il pistone.
 */
class Ram {
  readonly piston: THREE.Mesh
  constructor(private g: THREE.Group, private barrel: THREE.Mesh, private rod: THREE.Mesh, piston: THREE.Mesh, private len: number, private rodLen: number) {
    this.piston = piston
  }
  set(a: THREE.Vector3, b: THREE.Vector3) {
    const la = this.g.worldToLocal(a.clone()), lb = this.g.worldToLocal(b.clone())
    const d = lb.clone().sub(la)
    const L = d.length()
    const dir = d.normalize()
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
    // il pistone sta a una lunghezza di stelo dal punto mobile, dentro la canna
    const py = THREE.MathUtils.clamp(L - this.rodLen, 0.015, this.len - 0.015)
    this.barrel.position.copy(la)
    this.barrel.quaternion.copy(q)
    this.piston.position.copy(la).addScaledVector(dir, py)
    this.piston.quaternion.copy(q)
    this.rod.position.copy(this.piston.position)
    this.rod.quaternion.copy(q)
    this.rod.scale.set(1, Math.max(L - py, 0.01), 1)
  }
}

/** Costruisce i pezzi di un cilindro: canna cava, testate, pistone e stelo. */
function ramParts(r: number, len: number, mat: (look: Look) => THREE.Material) {
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 32, 1, true).translate(0, len / 2, 0), mat(LOOK.air))
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.9, len, 32, 1, true).translate(0, len / 2, 0), mat(LOOK.air))
  inner.scale.x = -1 // facce interne della canna
  barrel.add(inner)
  for (const y of [0, len]) barrel.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.05, 0.016, 32).translate(0, y, 0), mat(LOOK.dark)))
  const piston = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.88, r * 0.88, 0.025, 32), mat(LOOK.accent))
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.18, r * 0.18, 1, 14).translate(0, 0.5, 0), mat(LOOK.steel))
  return { barrel, piston, rod }
}

interface AirLine { curve: THREE.CatmullRomCurve3; dots: THREE.Mesh[]; kind: string }

/** Un utensile del braccio di aiuto: braccio girevole, carrello, cilindro verticale e utensile. */
export interface HelperTool { arm: THREE.Group; carrier: THREE.Group; slide: THREE.Group; tool: THREE.Group; y: number }

export class TireChangerModel extends MachineModel {
  readonly tt = new THREE.Group()
  readonly jaws: THREE.Group[] = []
  readonly col = new THREE.Group()
  readonly armSlide = new THREE.Group()
  readonly hexSlide = new THREE.Group()
  readonly lever = new THREE.Group()
  readonly bb = new THREE.Group()
  readonly worm = new THREE.Group()
  readonly motorSpin = new THREE.Group()
  readonly wheelPose = new THREE.Group()
  readonly rimSpin = new THREE.Group()
  readonly tireHolder = new THREE.Group()
  readonly tireSpin = new THREE.Group()
  readonly pedals: THREE.Group[] = []
  readonly needle = new THREE.Group()
  readonly lockPin = new THREE.Group()
  readonly helper: Record<'rullo' | 'disco' | 'cono', HelperTool> = {} as never
  readonly joystick = new THREE.Group()
  readonly airLines: AirLine[] = []
  readonly beltMap: THREE.CanvasTexture
  readonly bladeArrow: THREE.ArrowHelper
  beltLen = 1
  private bbRam!: Ram
  private tiltRam!: Ram
  private rimG!: THREE.Group
  private tireG!: THREE.Group
  private tireMesh: THREE.Mesh | null = null
  private tireBase: Float32Array | null = null
  private hose: THREE.Mesh | null = null
  private hoseG!: THREE.Group
  private airG = new THREE.Group()
  private colAir = new THREE.Group()
  spec!: WheelSpec

  constructor(section: Section) {
    super(section)
    this.root.add(this.tt, this.col, this.bb, this.wheelPose, this.tireHolder)
    this.tt.position.z = TT_Z
    this.col.position.copy(COL_P)
    this.bb.position.copy(BB_P)
    this.wheelPose.add(this.rimSpin)
    this.tireHolder.add(this.tireSpin)

    this.cabinet()
    this.turntable()
    this.drive()
    this.beltMap = this.belt()
    this.column()
    this.beadBreaker()
    this.pneumatics()
    this.col.add(this.colAir)
    this.airLine('asta', [new THREE.Vector3(0.03, 0.0, 0.03), new THREE.Vector3(0.03, 0.6, 0.03), new THREE.Vector3(0.03, 0.95, 0.05), new THREE.Vector3(-0.06, 1.0, 0.13)], this.colAir, 'bloccaggio')
    this.helperArm()
    this.inflator()
    this.leverTool()
    this.rimG = this.piece('cerchio', [0, 0, 0], this.rimSpin)
    this.tireG = this.piece('pneumatico', [0.32, 0, 0], this.tireSpin)

    this.bladeArrow = new THREE.ArrowHelper(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(), 0.2, 0xffb21e, 0.05, 0.035)
    this.bladeArrow.traverse((o) => (o.userData.noPick = true))
    ;(this.bladeArrow.line.material as THREE.LineBasicMaterial).toneMapped = false
    ;(this.bladeArrow.cone.material as THREE.MeshBasicMaterial).toneMapped = false
    this.bladeArrow.visible = false
    this.root.add(this.bladeArrow)
  }

  // ---------- carrozzeria ----------

  private cabinet() {
    const t = 0.012, x0 = -0.38, x1 = 0.38, z0 = COL_BACK, z1 = 0.36, y0 = 0.06, y1 = 0.7
    const W = x1 - x0, D = z1 - z0, H = y1 - y0, xc = 0, zc = (z0 + z1) / 2, yc = (y0 + y1) / 2
    const base = this.piece('mobile', [0, 0, 0])
    this.mesh(base, new RoundedBoxGeometry(W + 0.04, 0.06, D + 0.04, 2, 0.01).translate(xc, 0.03, zc), LOOK.dark)
    // cerniera del palo sul retro
    for (const s of [-1, 1]) this.mesh(base, box(0.02, 0.12, 0.1, s * 0.085, COL_P.y, COL_P.z + 0.03), LOOK.dark)
    this.mesh(base, cylX(0.015, -0.1, 0.1).translate(0, COL_P.y, COL_P.z), LOOK.steel)

    const left = this.piece('mobile', [-0.42, 0, 0])
    this.mesh(left, box(t, H, D, x0 + t / 2, yc, zc), LOOK.paint)
    const right = this.piece('mobile', [0.5, 0, 0])
    this.mesh(right, box(t, H, D, x1 - t / 2, yc, zc), LOOK.paint)
    const front = this.piece('mobile', [0, 0, 0.5])
    this.mesh(front, box(W - 2 * t, H, t, xc, yc, z1 - t / 2), LOOK.paint)
    this.mesh(front, box(W - 0.1, 0.22, 0.006, xc, 0.42, z1 + 0.002), LOOK.accent)
    this.mesh(front, box(W - 0.1, 0.01, 0.006, xc, 0.29, z1 + 0.002), LOOK.accent)
    const back = this.piece('mobile', [0, 0, -0.35])
    this.mesh(back, box(W - 2 * t, H, t, xc, yc, z0 + t / 2), LOOK.paint)
    const top = this.piece('mobile', [0, 0.32, 0])
    this.mesh(top, new RoundedBoxGeometry(W + 0.02, 0.025, D + 0.02, 2, 0.008).translate(xc, y1 + 0.0125, zc), LOOK.paint)
    // vaschetta per pasta di montaggio e attrezzi, sul piano davanti a sinistra
    this.mesh(top, box(0.2, 0.012, 0.14, -0.25, y1 + 0.031, 0.26), LOOK.grey)
    this.mesh(top, new THREE.CylinderGeometry(0.035, 0.035, 0.05, 24).translate(-0.29, y1 + 0.06, 0.26), LOOK.grey)
    this.mesh(top, new THREE.CylinderGeometry(0.03, 0.03, 0.004, 24).translate(-0.29, y1 + 0.087, 0.26), LOOK.ceramic)

    const pads = this.piece('tamponi', [0.3, 0, 0.1])
    for (const z of [0.0, 0.3]) this.mesh(pads, new RoundedBoxGeometry(0.03, 0.14, 0.1, 2, 0.01).translate(PAD_X - 0.015, 0.3, z), LOOK.rubber)
    this.mesh(pads, new RoundedBoxGeometry(0.03, 0.06, 0.5, 2, 0.01).translate(PAD_X - 0.015, 0.11, 0.15), LOOK.rubber)

    // pedaliera: da sinistra rotazione, griffe, stallonatore, palo
    const ped = this.piece('pedaliera', [0, 0, 0.55])
    this.mesh(ped, box(0.5, 0.03, 0.06, 0, 0.075, 0.37), LOOK.dark)
    const looks: Look[] = [LOOK.dark, LOOK.dark, LOOK.accent, LOOK.dark]
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Group()
      p.userData.part = 'pedaliera'
      p.userData.front = true
      p.position.set(-0.18 + i * 0.12, 0.085, 0.37)
      ped.add(p)
      this.mesh(p, new RoundedBoxGeometry(0.08, 0.018, 0.13, 2, 0.006).rotateX(-0.25).translate(0, 0.02, 0.07), looks[i])
      this.pedals.push(p)
    }
  }

  // ---------- piatto, griffe, riduttore, motore ----------

  private turntable() {
    const plate = this.piece('piatto', [0, 0.55, 0], this.tt)
    const s = new THREE.Shape()
    s.absarc(0, 0, 0.29, 0, Math.PI * 2, false)
    for (const a of JAW_ANGLES) {
      const p = new THREE.Path()
      const c = Math.cos(a), sn = Math.sin(a), w = 0.016
      const pts = [[0.1, -w], [0.28, -w], [0.28, w], [0.1, w]].map(([r, q]) => new THREE.Vector2(r * c - q * sn, -(r * sn + q * c)))
      p.setFromPoints(pts)
      p.closePath()
      s.holes.push(p)
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 1, curveSegments: 64 })
    g.rotateX(-Math.PI / 2).translate(0, TT_Y - 0.033, 0)
    this.mesh(plate, g, LOOK.steel)
    this.mesh(plate, new THREE.CylinderGeometry(0.06, 0.065, 0.02, 32).translate(0, TT_Y + 0.01, 0), LOOK.dark)

    const jg = this.piece('griffe', [0, 0.72, 0], this.tt)
    for (const a of JAW_ANGLES) {
      const j = new THREE.Group()
      j.userData.part = 'griffe'
      j.rotation.y = -a
      jg.add(j)
      // parte alta con la faccia dentata verso il centro, gradino su cui appoggia il cerchio
      this.mesh(j, box(0.05, 0.06, 0.05, 0.025, TT_Y + 0.03, 0), LOOK.dark)
      this.mesh(j, box(0.035, 0.03, 0.04, -0.0175, TT_Y + 0.015, 0), LOOK.dark)
      for (let k = 0; k < 3; k++) this.mesh(j, box(0.004, 0.006, 0.04, 0.002, TT_Y + 0.037 + k * 0.009, 0), LOOK.steel)
      this.mesh(j, box(0.02, 0.03, 0.03, 0.02, TT_Y - 0.03, 0), LOOK.steel)
      this.jaws.push(j)
    }

    // cilindri delle griffe, sotto il piatto, girano con lui
    const cg = this.piece('cilindri-griffe', [0, 0.36, 0], this.tt)
    for (const z of [-0.075, 0.075]) {
      this.mesh(cg, tubeX(0.026, 0.038, -0.2, 0.02).translate(0, 0.635, z), LOOK.air)
      this.mesh(cg, cylX(0.026, -0.205, -0.19).translate(0, 0.635, z), LOOK.dark)
      this.mesh(cg, cylX(0.026, 0.015, 0.025).translate(0, 0.635, z), LOOK.dark)
      this.mesh(cg, cylX(0.011, 0.02, 0.14).translate(0, 0.635, z), LOOK.steel)
    }
    this.mesh(cg, box(0.36, 0.02, 0.22, -0.03, 0.6, 0), LOOK.dark)

    // albero di uscita e ruota elicoidale del riduttore (girano col piatto)
    const out = this.piece('riduttore', [0, 0.06, 0], this.tt)
    this.mesh(out, new THREE.CylinderGeometry(0.028, 0.028, 0.26, 24).translate(0, 0.6, 0), LOOK.steel)
    const gear = new THREE.Shape()
    const N = 72
    for (let i = 0; i <= N * 4; i++) {
      const a = (i / (N * 4)) * Math.PI * 2
      const r = i % 4 < 2 ? 0.075 : 0.069
      if (i === 0) gear.moveTo(r * Math.cos(a), r * Math.sin(a))
      else gear.lineTo(r * Math.cos(a), r * Math.sin(a))
    }
    const hub = new THREE.Path(); hub.absarc(0, 0, 0.028, 0, Math.PI * 2, true); gear.holes.push(hub)
    this.mesh(out, new THREE.ExtrudeGeometry(gear, { depth: 0.026, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, 0.457, 0), LOOK.brass)
  }

  private drive() {
    // carcassa del riduttore, cava per vedere vite e ruota in sezione
    const hs = this.piece('riduttore', [0, 0, 0.55])
    const cx = 0, cy = 0.47, cz = TT_Z + 0.03, W = 0.26, H = 0.16, D = 0.26, t = 0.01
    this.mesh(hs, box(W, t, D, cx, cy - H / 2, cz), LOOK.dark)
    this.mesh(hs, box(W, t, D, cx, cy + H / 2, cz), LOOK.dark)
    this.mesh(hs, box(t, H, D, cx - W / 2, cy, cz), LOOK.dark)
    this.mesh(hs, box(t, H, D, cx + W / 2, cy, cz), LOOK.dark)
    this.mesh(hs, box(W, H, t, cx, cy, cz - D / 2), LOOK.dark)
    this.mesh(hs, box(W, H, t, cx, cy, cz + D / 2), LOOK.dark)
    this.mesh(hs, box(0.3, 0.02, 0.3, cx, cy - H / 2 - 0.02, cz), LOOK.dark)
    this.mesh(hs, box(0.04, 0.33, 0.04, cx - 0.13, 0.22, cz - 0.11), LOOK.dark)
    this.mesh(hs, box(0.04, 0.33, 0.04, cx + 0.13, 0.22, cz - 0.11), LOOK.dark)

    hs.add(this.worm)
    this.worm.position.set(0, 0.47, ZW)
    this.worm.userData.part = 'riduttore'
    this.worm.userData.front = true
    const p: RX[] = [[0, -0.1]]
    for (let x = -0.085; x <= 0.085; x += 0.006) p.push([0.012, x], [0.019, x + 0.003])
    p.push([0.012, 0.09], [0, 0.1])
    this.mesh(this.worm, revolveX(p, 24), LOOK.steel)
    this.mesh(this.worm, cylX(0.009, BELT_X - 0.02, 0.15), LOOK.steel)

    const pul = this.piece('cinghia', [-0.25, 0, 0.4])
    const wp = new THREE.Group()
    wp.userData.part = 'cinghia'
    wp.userData.front = true
    wp.position.set(0, 0.47, ZW)
    pul.add(wp)
    this.mesh(wp, revolveX([[0.009, BELT_X - 0.012], [0.037, BELT_X - 0.012], [0.03, BELT_X], [0.037, BELT_X + 0.012], [0.009, BELT_X + 0.012]], 40), LOOK.alu)
    this.worm.userData.pulley = wp

    const mot = this.piece('motore', [0, 0, 0.6])
    const body: RX[] = [[0, -0.24], [0.058, -0.24], [0.064, -0.232]]
    for (let x = -0.22; x < 0.03; x += 0.018) body.push([0.064, x], [0.072, x + 0.002], [0.072, x + 0.007], [0.064, x + 0.009])
    body.push([0.064, 0.05], [0.058, 0.058], [0, 0.058])
    this.mesh(mot, revolveX(body, 40).translate(0, 0.18, ZW), LOOK.air)
    this.mesh(mot, tubeX(0.034, 0.056, -0.21, 0.03).translate(0, 0.18, ZW + 0.0001), LOOK.copper)
    this.mesh(mot, box(0.24, 0.05, 0.14, -0.09, 0.09, ZW), LOOK.dark)
    mot.add(this.motorSpin)
    this.motorSpin.position.set(0, 0.18, ZW)
    this.motorSpin.userData.part = 'motore'
    this.motorSpin.userData.front = true
    this.mesh(this.motorSpin, cylX(0.032, -0.21, 0.03), LOOK.steel)
    this.mesh(this.motorSpin, cylX(0.007, BELT_X - 0.02, -0.24), LOOK.steel)
    this.mesh(this.motorSpin, revolveX([[0.007, BELT_X - 0.01], [0.015, BELT_X - 0.01], [0.011, BELT_X], [0.015, BELT_X + 0.01], [0.007, BELT_X + 0.01]], 24), LOOK.alu)
  }

  private belt() {
    const cv = document.createElement('canvas')
    cv.width = 64; cv.height = 8
    const c = cv.getContext('2d')!
    c.fillStyle = '#1a1b1e'; c.fillRect(0, 0, 64, 8)
    c.fillStyle = '#4a4e57'; c.fillRect(0, 0, 10, 8)
    const map = new THREE.CanvasTexture(cv)
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.repeat.set(40, 1)
    map.colorSpace = THREE.SRGBColorSpace
    const curve = beltPath(new THREE.Vector2(0.47, ZW), 0.034, new THREE.Vector2(0.18, ZW), 0.0125, BELT_X)
    this.beltLen = curve.getLength()
    const g = this.piece('cinghia', [-0.25, 0, 0.4])
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.005, 6, true), this.custom('cinghia', new THREE.MeshStandardMaterial({ map, roughness: 0.85 }), LOOK.rubber.h)))
    return map
  }

  // ---------- palo, bracci, utensile ----------

  private column() {
    const c = this.piece('palo', [0, 0.2, -0.45], this.col)
    this.mesh(c, new RoundedBoxGeometry(0.14, 1.05, 0.14, 2, 0.012).translate(0, 0.475, 0), LOOK.paint)
    this.mesh(c, box(0.04, 0.24, 0.05, 0, -0.1, 0), LOOK.dark)
    this.mesh(c, new RoundedBoxGeometry(0.17, 0.16, 0.24, 2, 0.02).translate(0, 1.0, 0.03), LOOK.paint)
    this.mesh(c, box(0.172, 0.03, 0.242, 0, 0.94, 0.03), LOOK.accent)

    const a = this.piece('braccio', [0, 0.12, 0.22], this.col)
    a.add(this.armSlide)
    this.armSlide.userData.part = 'braccio'
    this.armSlide.position.y = 1.0
    this.mesh(this.armSlide, box(0.07, 0.07, 0.5, 0, 0, -0.21), LOOK.steel)
    this.mesh(this.armSlide, new RoundedBoxGeometry(0.1, 0.12, 0.1, 2, 0.01).translate(0, 0, 0), LOOK.paint)
    this.mesh(this.armSlide, cylX(0.012, 0.05, 0.11), LOOK.dark)
    this.mesh(this.armSlide, new THREE.SphereGeometry(0.022, 16, 12).translate(0.12, 0, 0), LOOK.accent)

    // bloccaggio pneumatico dell'asta: un pistoncino stringe l'esagono nel suo manicotto
    const lk = this.piece('bloccaggio', [0.18, 0.1, 0.22], this.armSlide)
    this.mesh(lk, cylX(0.022, -0.11, -0.05), LOOK.air)
    this.mesh(lk, cylX(0.024, -0.115, -0.105), LOOK.dark)
    lk.add(this.lockPin)
    this.lockPin.userData.part = 'bloccaggio'
    this.mesh(this.lockPin, cylX(0.008, -0.05, -0.02), LOOK.steel)
    this.mesh(lk, box(0.03, 0.03, 0.03, 0, 0.075, 0.04), LOOK.accent)

    const h = this.piece('asta', [0, 0.25, 0.25], this.armSlide)
    h.add(this.hexSlide)
    this.hexSlide.userData.part = 'asta'
    this.mesh(this.hexSlide, new THREE.CylinderGeometry(0.025, 0.025, 0.95, 6).translate(0, 0.475 + 0.09, -0.02), LOOK.steel)
    this.mesh(this.hexSlide, new THREE.CylinderGeometry(0.03, 0.03, 0.02, 6).translate(0, 1.05, -0.02), LOOK.dark)

    // utensile: profilo laterale estruso, con la lingua verso il centro del cerchio (+z)
    const u = this.piece('utensile', [0, 0.08, 0.2], this.hexSlide)
    const s = new THREE.Shape()
    const pts: [number, number][] = [[-0.055, 0.09], [0.005, 0.09], [0.014, 0.034], [0.034, 0.018], [0.042, 0.005], [0.032, -0.004], [0.012, 0.003], [0.0, -0.004], [-0.018, -0.004], [-0.055, 0.025]]
    s.moveTo(pts[0][0], pts[0][1])
    for (const [z, y] of pts.slice(1)) s.lineTo(z, y)
    s.closePath()
    const hg = new THREE.ExtrudeGeometry(s, { depth: 0.046, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 2 })
    hg.rotateY(-Math.PI / 2).translate(0.023, 0, 0)
    this.mesh(u, hg, LOOK.plastic)
    this.mesh(u, cylX(0.011, -0.03, 0.03).translate(0, 0.012, -0.012), LOOK.steel)
    this.mesh(u, box(0.05, 0.03, 0.05, 0, 0.1, -0.02), LOOK.steel)
  }

  private leverTool() {
    const g = this.piece('leva', [-0.2, 0.2, 0.35])
    g.add(this.lever)
    this.lever.userData.part = 'leva'
    this.lever.userData.front = true
    this.mesh(this.lever, new THREE.CylinderGeometry(0.011, 0.011, 0.5, 14).translate(0, 0.27, 0), LOOK.steel)
    this.mesh(this.lever, new THREE.CylinderGeometry(0.016, 0.016, 0.14, 16).translate(0, 0.46, 0), LOOK.accent)
    this.mesh(this.lever, box(0.03, 0.05, 0.008, 0, 0.0, 0.006).rotateX(0.5), LOOK.steel)
  }

  // ---------- stallonatore ----------

  private beadBreaker() {
    const g = this.piece('stallonatore', [0.35, 0, 0.12], this.bb)
    this.mesh(g, new THREE.CylinderGeometry(0.026, 0.026, 0.26, 20).translate(0, -0.08, 0), LOOK.steel)
    this.mesh(g, new RoundedBoxGeometry(0.06, 0.05, ARM_L + 0.04, 2, 0.01).translate(0, 0, ARM_L / 2), LOOK.paint)
    this.mesh(g, box(0.045, 0.18, 0.045, 0, -0.06, ARM_L), LOOK.paint)
    // paletta rivolta verso il mobile (−x)
    this.mesh(g, new RoundedBoxGeometry(0.014, 0.075, 0.11, 2, 0.004).translate(-0.03, BLADE_Y - BB_P.y, ARM_L), LOOK.steel)
    this.mesh(g, new THREE.CylinderGeometry(0.013, 0.013, 0.2, 14).translate(0, 0.12, ARM_L), LOOK.steel)
    this.mesh(g, new THREE.CylinderGeometry(0.018, 0.018, 0.08, 16).translate(0, 0.2, ARM_L), LOOK.rubber)
    // leva corta interna su cui spinge il cilindro
    const lv = BB_LEVER
    const len = Math.hypot(lv.x, lv.z)
    const lb = box(len, 0.04, 0.04)
    lb.rotateY(Math.atan2(-lv.z, lv.x)).translate(lv.x / 2, lv.y, lv.z / 2)
    this.mesh(g, lb, LOOK.dark)
    this.mesh(g, new THREE.CylinderGeometry(0.014, 0.014, 0.06, 14).translate(lv.x, lv.y, lv.z), LOOK.steel)

    const rg = this.piece('cilindro-stallonatore', [0, 0, 0.35])
    const bp = ramParts(0.11, 0.22, (l) => this.mat('cilindro-stallonatore', l, true))
    rg.add(bp.barrel, bp.piston, bp.rod)
    this.bbRam = new Ram(rg, bp.barrel, bp.rod, bp.piston, 0.22, 0.26)

    const tg = this.piece('cilindro-palo', [0, 0, -0.3])
    const tp = ramParts(0.04, 0.24, (l) => this.mat('cilindro-palo', l))
    tg.add(tp.barrel, tp.piston, tp.rod)
    this.tiltRam = new Ram(tg, tp.barrel, tp.rod, tp.piston, 0.24, 0.2)
  }

  /** Riporta i cilindri tra i loro attacchi dopo un movimento di palo o stallonatore. */
  updateRams() {
    this.root.updateMatrixWorld(true)
    this.bbRam.set(BB_ANCHOR, this.bb.localToWorld(BB_LEVER.clone()))
    this.tiltRam.set(TILT_ANCHOR, this.col.localToWorld(new THREE.Vector3(0, -0.21, 0)))
  }

  // ---------- impianto pneumatico ----------

  private pneumatics() {
    const fr = this.piece('frl', [-0.3, 0, 0])
    const x = -0.43
    this.mesh(fr, box(0.02, 0.2, 0.18, -0.39, 0.55, -0.3), LOOK.dark)
    this.mesh(fr, box(0.05, 0.06, 0.16, x, 0.6, -0.3), LOOK.grey)
    for (const z of [-0.35, -0.25]) {
      this.mesh(fr, new THREE.CylinderGeometry(0.022, 0.018, 0.09, 20).translate(x, 0.525, z), LOOK.ceramic)
      this.mesh(fr, new THREE.CylinderGeometry(0.024, 0.024, 0.015, 20).translate(x, 0.575, z), LOOK.grey)
    }
    this.mesh(fr, new THREE.CylinderGeometry(0.026, 0.026, 0.015, 24).rotateZ(Math.PI / 2).translate(x - 0.03, 0.645, -0.3), LOOK.steel)
    this.mesh(fr, new THREE.CylinderGeometry(0.02, 0.02, 0.012, 20).translate(x, 0.638, -0.3), LOOK.accent)

    const vb = this.piece('valvole', [0, 0, 0.4])
    this.mesh(vb, box(0.24, 0.06, 0.07, -0.12, 0.3, 0.25), LOOK.grey)
    for (let i = 0; i < 4; i++) {
      this.mesh(vb, cylX(0.008, -0.25, -0.24).translate(0, 0.3, 0.22 + i * 0.02).translate(i * 0.0, 0, 0), LOOK.steel)
      this.mesh(vb, new THREE.CylinderGeometry(0.005, 0.005, 0.18, 8).translate(-0.18 + i * 0.12, 0.2, 0.3), LOOK.steel)
    }

    // linee d'aria: tubi blu con le particelle che mostrano dove va l'aria
    this.root.add(this.airG)
    // Le linee non seguono il piano di taglio: con la sezione aperta il circuito resta visibile.
    const lm = new THREE.MeshStandardMaterial({ color: 0x2f7fe0, roughness: 0.4 })
    this.part('valvole').mats.push(lm)
    this.lineMat = lm
    const V = (a: number, b: number, c: number) => new THREE.Vector3(a, b, c)
    const vbOut = V(-0.12, 0.33, 0.25)
    const lines: [string, THREE.Vector3[]][] = [
      ['linea', [V(x, 0.6, -0.3), V(-0.36, 0.6, -0.28), V(-0.25, 0.45, 0.1), V(-0.2, 0.33, 0.25)]],
      ['stallonatore', [vbOut, V(0.05, 0.36, 0.25), V(0.18, 0.4, 0.2), V(BB_ANCHOR.x, BB_ANCHOR.y + 0.11, BB_ANCHOR.z)]],
      ['griffe', [vbOut, V(-0.05, 0.42, 0.18), V(0.0, 0.5, 0.06), V(0.0, 0.58, TT_Z + 0.03)]],
      ['palo', [vbOut, V(-0.12, 0.2, 0.1), V(-0.05, 0.12, -0.15), V(TILT_ANCHOR.x, TILT_ANCHOR.y, TILT_ANCHOR.z)]],
      ['gonfiaggio', [vbOut, V(-0.22, 0.45, 0.28), V(-0.31, 0.62, 0.27), V(-0.32, 0.72, 0.27)]],
      ['asta', [vbOut, V(-0.06, 0.4, -0.1), V(-0.03, 0.47, -0.4), V(0, COL_P.y, COL_P.z + 0.075)]],
      ['helper', [vbOut, V(-0.3, 0.3, 0.12), V(-0.44, 0.22, HC.z + 0.04), V(HC.x + 0.06, 0.3, HC.z + 0.04)]],
    ]
    for (const [kind, pts] of lines) this.airLine(kind, pts, this.airG, 'valvole')
  }

  private lineMat!: THREE.MeshStandardMaterial
  private readonly dotM = new THREE.MeshBasicMaterial({ color: 0xbfe6ff, toneMapped: false })
  private readonly dotG = new THREE.SphereGeometry(0.008, 10, 8)

  /** Tubo dell'aria con le sue particelle, nel sistema di riferimento del gruppo parent. */
  private airLine(kind: string, pts: THREE.Vector3[], parent: THREE.Object3D, part: string) {
    const curve = new THREE.CatmullRomCurve3(pts)
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.005, 6), this.lineMat)
    m.userData.part = part
    parent.add(m)
    const dots: THREE.Mesh[] = []
    for (let i = 0; i < 5; i++) {
      const d = new THREE.Mesh(this.dotG, this.dotM)
      d.userData.noPick = true
      d.visible = false
      parent.add(d)
      dots.push(d)
    }
    this.airLines.push({ curve, dots, kind })
  }

  // ---------- braccio di aiuto (helper) ----------

  private helperArm() {
    const { x: hx, z: hz } = HC
    const col = this.piece('helper', [-0.4, 0.15, -0.1])
    this.mesh(col, new RoundedBoxGeometry(0.11, 1.42, 0.11, 2, 0.01).translate(hx, 0.77, hz), LOOK.paint)
    this.mesh(col, box(0.26, 0.03, 0.26, hx, 0.075, hz), LOOK.dark)
    for (const y of [0.35, 0.62]) this.mesh(col, box(-0.38 - (hx + 0.055), 0.06, 0.06, (hx + 0.055 - 0.38) / 2, y, hz), LOOK.dark)
    this.mesh(col, box(0.13, 0.04, 0.13, hx, 1.5, hz), LOOK.accent)

    // comando dedicato: leva a croce su una scatola valvole sulla colonna
    const cmd = this.piece('helper-comando', [-0.15, 0, 0.25])
    this.mesh(cmd, new RoundedBoxGeometry(0.09, 0.12, 0.06, 2, 0.01).translate(hx + 0.02, 0.98, hz + 0.085), LOOK.grey)
    cmd.add(this.joystick)
    this.joystick.position.set(hx + 0.02, 1.04, hz + 0.085)
    this.joystick.userData.part = 'helper-comando'
    this.joystick.userData.front = true
    this.mesh(this.joystick, new THREE.CylinderGeometry(0.006, 0.006, 0.07, 10).translate(0, 0.035, 0), LOOK.steel)
    this.mesh(this.joystick, new THREE.SphereGeometry(0.016, 14, 10).translate(0, 0.075, 0), LOOK.accent)

    const tools: ['rullo' | 'disco' | 'cono', number][] = [['disco', 1.22], ['rullo', 1.31], ['cono', 1.4]]
    for (const [name, y] of tools) {
      const arm = new THREE.Group()
      arm.position.set(hx, y, hz)
      arm.userData.part = 'helper'
      col.add(arm)
      this.mesh(arm, box(0.13, 0.05, 0.13, 0, 0, 0), LOOK.dark)
      this.mesh(arm, box(0.66, 0.045, 0.05, 0.38, 0, 0), LOOK.steel)
      const carrier = new THREE.Group()
      arm.add(carrier)
      carrier.userData.part = 'helper'
      this.mesh(carrier, box(0.07, 0.07, 0.07, 0, 0, 0), LOOK.paint)
      // cilindro verticale dell'utensile: canna cava e stelo, visibili in sezione
      const cyl = this.piece('helper-cilindri', [0, 0.18, 0], carrier)
      this.mesh(cyl, new THREE.CylinderGeometry(0.03, 0.03, 0.26, 24).translate(0, -0.16, 0), LOOK.air)
      this.mesh(cyl, new THREE.CylinderGeometry(0.033, 0.033, 0.015, 24).translate(0, -0.29, 0), LOOK.dark)
      const slide = new THREE.Group()
      carrier.add(slide)
      slide.userData.part = 'helper-cilindri'
      this.mesh(slide, new THREE.CylinderGeometry(0.011, 0.011, 0.28, 12).translate(0, 0.14, 0), LOOK.steel)
      const tool = this.piece('helper-' + name, [0, -0.12, 0.1], slide)
      this.helper[name] = { arm, carrier, slide, tool, y }
    }

    // rullo pressore: ruota di gomma folle su una forcella
    const r = this.helper.rullo.tool
    this.mesh(r, box(0.012, 0.07, 0.07, 0, 0.075, 0), LOOK.dark)
    const roll = new THREE.Group()
    roll.userData.part = 'helper-rullo'
    roll.position.y = 0.04
    r.add(roll)
    this.mesh(roll, new THREE.CylinderGeometry(0.04, 0.04, 0.05, 28).rotateZ(Math.PI / 2), LOOK.rubber)
    this.mesh(roll, new THREE.CylinderGeometry(0.018, 0.018, 0.054, 16).rotateZ(Math.PI / 2), LOOK.steel)
    r.userData.roll = roll

    // disco premitallone, leggermente inclinato verso il centro del cerchio
    const d = this.helper.disco.tool
    this.mesh(d, new THREE.CylinderGeometry(0.012, 0.012, 0.05, 12).translate(0, 0.055, 0), LOOK.steel)
    this.mesh(d, revolveX([[0.012, 0], [0.06, 0], [0.075, 0.012], [0.07, 0.03], [0.012, 0.03]], 40).rotateZ(Math.PI / 2), LOOK.plastic)

    // cono di centraggio: preme il cerchio contro il piatto dal centro
    const c = this.helper.cono.tool
    this.mesh(c, revolveX([[0, 0], [0.012, 0], [0.05, 0.06], [0.05, 0.08], [0.015, 0.08], [0.015, 0.12], [0, 0.12]], 40).rotateZ(Math.PI / 2), LOOK.steel)

    for (const t of Object.values(this.helper)) this.park(t)
  }

  /** Utensile del braccio di aiuto a riposo: braccio girato indietro, stelo rientrato. */
  park(t: HelperTool) {
    t.arm.rotation.y = 2.3
    t.carrier.position.x = 0.4
    t.slide.position.y = -0.18
  }

  /**
   * Posa di un utensile per portarlo sul punto target (mondo).
   * Restituisce angolo del braccio, distanza del carrello e quota dello stelo.
   */
  helperPose(t: HelperTool, target: THREE.Vector3) {
    const dx = target.x - HC.x, dz = target.z - HC.z
    return { swing: Math.atan2(-dz, dx), reach: Math.hypot(dx, dz), drop: target.y - t.y }
  }

  /** Orienta l'asse del rullo in direzione radiale rispetto al piatto, così rotola sul fianco. */
  aimRoller(swing: number, target: THREE.Vector3) {
    const radial = new THREE.Vector3(target.x, 0, target.z - TT_Z).normalize()
    radial.applyAxisAngle(new THREE.Vector3(0, 1, 0), -swing)
    const roll = this.helper.rullo.tool.userData.roll as THREE.Object3D
    roll.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), radial)
  }

  // ---------- gonfiaggio ----------

  private inflator() {
    const g = this.piece('gonfiaggio', [-0.2, 0.25, 0.25])
    this.mesh(g, new THREE.CylinderGeometry(0.012, 0.012, 0.16, 12).translate(-0.32, 0.8, 0.27), LOOK.steel)
    const head = new THREE.Group()
    head.userData.part = 'gonfiaggio'
    head.userData.front = true
    head.position.set(-0.32, 0.92, 0.28)
    head.rotation.x = -0.6
    g.add(head)
    this.mesh(head, new THREE.CylinderGeometry(0.06, 0.06, 0.035, 40).rotateX(Math.PI / 2), LOOK.dark)

    // quadrante 0–4 bar con zona rossa oltre il limite di tallonamento
    const cv = document.createElement('canvas')
    cv.width = cv.height = 256
    const c = cv.getContext('2d')!
    c.fillStyle = '#f2f0ea'
    c.beginPath(); c.arc(128, 128, 126, 0, Math.PI * 2); c.fill()
    const ang = (p: number) => (-225 + (p / 4) * 270) * (Math.PI / 180)
    c.strokeStyle = '#d23a2a'; c.lineWidth = 14
    c.beginPath(); c.arc(128, 128, 100, ang(3.5), ang(4)); c.stroke()
    c.strokeStyle = '#1a1b1e'; c.fillStyle = '#1a1b1e'
    c.font = '600 26px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'
    for (let i = 0; i <= 40; i++) {
      const a = ang(i / 10), major = i % 10 === 0
      c.lineWidth = major ? 4 : 2
      c.beginPath()
      c.moveTo(128 + Math.cos(a) * (major ? 86 : 94), 128 + Math.sin(a) * (major ? 86 : 94))
      c.lineTo(128 + Math.cos(a) * 106, 128 + Math.sin(a) * 106)
      c.stroke()
      if (major) c.fillText(String(i / 10), 128 + Math.cos(a) * 66, 128 + Math.sin(a) * 66)
    }
    c.font = '600 20px system-ui, sans-serif'
    c.fillText('bar', 128, 176)
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.052, 48), new THREE.MeshBasicMaterial({ map: tex }))
    face.position.z = 0.0181
    face.userData.part = 'gonfiaggio'
    head.add(face)
    this.needle.position.z = 0.02
    head.add(this.needle)
    const nm = new THREE.MeshBasicMaterial({ color: 0xd23a2a })
    const n = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.004, 0.002).translate(0.016, 0, 0), nm)
    n.userData.part = 'gonfiaggio'
    this.needle.add(n)
    this.setGauge(0)

    // pistola di gonfiaggio appesa sotto il manometro
    this.mesh(g, box(0.03, 0.09, 0.04, -0.37, 0.8, 0.3), LOOK.dark)
    this.mesh(g, new THREE.CylinderGeometry(0.006, 0.006, 0.08, 10).translate(-0.37, 0.72, 0.3), LOOK.steel)

    this.hoseG = this.piece('gonfiaggio', [-0.2, 0.25, 0.25])
  }

  setGauge(bar: number) {
    // −225° … +45° in senso orario sul quadrante: il canvas ha l'asse y verso il basso
    const a = (-225 + (Math.min(bar, 4.2) / 4) * 270) * (Math.PI / 180)
    this.needle.rotation.z = -a
  }

  /** Tubo dal manometro alla valvola del cerchio (ricostruito solo quando serve), con le sue particelle. */
  setHose(to: THREE.Vector3 | null) {
    if (this.hose) {
      this.hoseG.remove(this.hose)
      this.hose.geometry.dispose()
      this.hose = null
      const i = this.airLines.findIndex((l) => l.kind === 'tubo')
      if (i >= 0) {
        for (const d of this.airLines[i].dots) d.removeFromParent()
        this.airLines.splice(i, 1)
      }
    }
    if (!to) return
    const from = new THREE.Vector3(-0.32, 0.86, 0.3)
    const mid = from.clone().lerp(to, 0.5)
    mid.y = Math.max(from.y, to.y) + 0.05
    const curve = new THREE.CatmullRomCurve3([from, from.clone().add(new THREE.Vector3(0.02, -0.05, 0.06)), mid, to.clone().add(new THREE.Vector3(0, 0.05, 0)), to])
    this.hose = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 0.006, 8), this.mat('gonfiaggio', LOOK.rubber, true))
    this.hoseG.add(this.hose)
    const dots: THREE.Mesh[] = []
    for (let i = 0; i < 6; i++) {
      const d = new THREE.Mesh(this.dotG, this.dotM)
      d.userData.noPick = true
      d.visible = false
      this.hoseG.add(d)
      dots.push(d)
    }
    this.airLines.push({ curve, dots, kind: 'tubo' })
  }

  // ---------- ruota ----------

  buildWheel(spec: WheelSpec) {
    this.spec = spec
    this.clear(this.rimG)
    this.clear(this.tireG)
    const geo = wheelMeshes(spec)
    for (const r of geo.rim) this.mesh(this.rimG, r.geo, LOOK[r.look])
    this.tireMesh = this.mesh(this.tireG, geo.tire, LOOK.rubber)
    this.tireBase = (geo.tire.attributes.position.array as Float32Array).slice()
  }

  /** Posizione della valvola nel mondo. */
  valveWorld() {
    const { rimR: R, width: w } = wheelGeometry(this.spec)
    this.root.updateMatrixWorld(true)
    const r = R + 0.005
    return this.rimSpin.localToWorld(new THREE.Vector3(w / 2 - 0.02, r * Math.cos(2.4), r * Math.sin(2.4)))
  }

  /**
   * Schiacciamento del fianco sotto paletta, rullo o disco: i vertici dalla parte
   * dell'utensile vengono spinti verso il centro, di più vicino al punto di contatto.
   */
  dent(contacts: { at: THREE.Vector3; depth: number }[]) {
    const mesh = this.tireMesh, base = this.tireBase
    if (!mesh || !base) return
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const act = contacts.filter((c) => c.depth > 1e-4)
    if (!act.length) {
      if (mesh.userData.dented) {
        arr.set(base)
        pos.needsUpdate = true
        mesh.geometry.computeVertexNormals()
        mesh.userData.dented = false
      }
      return
    }
    this.root.updateMatrixWorld(true)
    const { rimR: R, tireR: Rt } = wheelGeometry(this.spec)
    const cs = act.map((c) => {
      const l = mesh.worldToLocal(c.at.clone())
      return { side: Math.sign(l.x) || 1, phi: Math.atan2(l.z, l.y), rc: Math.max(Math.hypot(l.y, l.z), R + 0.02), depth: c.depth }
    })
    for (let i = 0; i < arr.length; i += 3) {
      const x = base[i], y = base[i + 1], z = base[i + 2]
      const r = Math.hypot(y, z)
      const phi = Math.atan2(z, y)
      let dx = 0
      for (const c of cs) {
        if (x * c.side <= 0) continue
        let d = phi - c.phi
        d -= Math.PI * 2 * Math.round(d / (Math.PI * 2))
        const fa = Math.exp(-((d / 0.42) ** 2))
        if (fa < 0.01) continue
        // il fianco cede vicino al tallone, molto meno verso il battistrada
        const fr = r < c.rc ? 1 : Math.max(0, 1 - (r - c.rc) / (Rt - c.rc)) ** 1.6
        const fb = r < R + 0.004 ? 0.6 : 1
        const v = c.depth * fa * fr * fb
        if (v > Math.abs(dx)) dx = -c.side * v
      }
      arr[i] = x + dx
    }
    pos.needsUpdate = true
    mesh.geometry.computeVertexNormals()
    mesh.userData.dented = true
  }

  /** Tallonamento: prima del salto in sede il pneumatico è leggermente rientrato. */
  setSeat(k: number) {
    this.tireG.scale.setScalar(0.985 + 0.015 * k)
  }

  /** Mostra le particelle d'aria lungo le linee attive. */
  air(active: Set<string>, phase: number) {
    for (const l of this.airLines) {
      const on = active.has(l.kind) || (l.kind === 'linea' && active.size > 0) || (l.kind === 'tubo' && active.has('gonfiaggio'))
      l.dots.forEach((d, i) => {
        d.visible = on
        if (on) l.curve.getPointAt((((phase + i / l.dots.length) % 1) + 1) % 1, d.position)
      })
    }
  }

  protected afterExplode(t: number) {
    this.airG.visible = t < 0.02 && !this.parts.get('valvole')?.hidden
    this.colAir.visible = t < 0.02
    this.updateRams()
  }

  protected afterHidden(id: string, hidden: boolean) {
    if (id === 'valvole') this.airG.visible = !hidden && this.explodeT < 0.02
  }
}
