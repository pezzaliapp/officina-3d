import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { Section } from '../core/section'
import { MachineModel, LOOK, Look } from '../core/model'
import { revolveX, cylX, tubeX, box, beltPath, RX } from '../core/geo'
import { WheelSpec, wheelGeometry, wheelMeshes, rimSection, tireShell, tireHalfWidth } from '../core/wheel'
import { Solid } from '../core/interference'
import { MarkSet, MarkState } from '../core/marks'

/** Quota del piano del piatto e sua posizione in profondità, m. */
export const TT_Y = 0.765
export const TT_Z = -0.03
/** Cerniera del palo ribaltabile. */
export const COL_P = new THREE.Vector3(0, 0.5, -0.49)
export const COL_BACK = -0.42
/**
 * Stallonatore: perno verticale sul fianco destro del mobile, verso il retro.
 * Il braccio è a gomito: un tratto esce dal fianco dietro la ruota (lungo x), uno
 * corre in avanti fuori dal fianco del pneumatico (lungo z) e porta la lama, che
 * guarda verso il mobile. Valori nel sistema del braccio con angolo 0.
 */
export const BB_P = new THREE.Vector3(0.43, 0.48, -0.33)
export const BB_OUT = 0.3
export const ARM_L = 0.68
export const BLADE_Y = 0.305
/** Bordo di spinta della lama (centro) e raggio del suo arco, concentrico al cerchio. */
export const BLADE = new THREE.Vector3(0.182, BLADE_Y - BB_P.y, ARM_L)
export const BLADE_R = 0.25
/** Mezza altezza della lama lungo l'arco, m. */
export const BLADE_HALF = 0.085
/** Faccia esterna dei tamponi su cui appoggia la ruota. */
export const PAD_X = 0.41
/** Leva corta dietro il perno, su cui spinge il cilindro (nel sistema del braccio). */
export const BB_LEVER = new THREE.Vector3(-0.2, -0.14, -0.06)
/** Attacco fisso del cilindro dello stallonatore. */
export const BB_ANCHOR = new THREE.Vector3(0.2, 0.28, 0.12)
/** Elettrovalvola dello stallonatore e pulsantiera sul fianco. */
const EV = new THREE.Vector3(0.24, 0.55, -0.14)
const PB = new THREE.Vector3(0.38, 0.635, -0.2)
const TILT_ANCHOR = new THREE.Vector3(0, 0.1, -0.32)
const ZW = TT_Z + 0.091 // asse della vite senza fine
/** Asse della colonna del braccio di aiuto (x, z). */
export const HC = { x: -0.56, z: -0.05 }
/** Fermo per matching: faccia del pattino a stelo rientrato e raggio del pattino, m (valori indicativi). */
export const MATCH_FACE = -0.36, MATCH_PAD_R = 0.32
/** Gioco tra pattino e battistrada a contatto, m. */
export const MATCH_GAP = 0.0005
const BELT_X = -0.27

const JAW_ANGLES = [0.25, 0.75, 1.25, 1.75].map((k) => k * Math.PI)
/** Labbro delle griffe: spessore radiale e quota della sommità sopra il piatto. */
export const JAW_LIP = 0.012, JAW_TOP = 0.044

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

/**
 * Lastra di spessore t piegata ad arco di raggio R attorno a un asse parallelo a x che passa
 * per (cy, cz). La sagoma è data lungo l'arco: per ogni s in [-H, H] la lastra va da x0(s) a x1(s).
 */
function bentPlate(R: number, cy: number, cz: number, H: number, t: number, x0: (s: number) => number, x1: (s: number) => number) {
  const g = new THREE.BoxGeometry(1, 2 * H, t, 6, 32, 1)
  const p = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5, sv = p.getY(i), d = p.getZ(i)
    const th = sv / R, rho = R + d
    p.setXYZ(i, x0(sv) + (x1(sv) - x0(sv)) * u, cy + rho * Math.sin(th), cz + rho * Math.cos(th))
  }
  g.computeVertexNormals()
  return g
}

/**
 * Un utensile del braccio di aiuto: braccio girevole, carrello, cilindro verticale e utensile.
 * y è la quota del braccio, rod la lunghezza dello stelo, ext la prolunga sotto lo stelo fino al punto di lavoro.
 */
export interface HelperTool { arm: THREE.Group; carrier: THREE.Group; slide: THREE.Group; piston: THREE.Object3D; tool: THREE.Group; y: number; rod: number; ext: number }

/** Quota dello stelo con l'utensile alzato. */
export const HOLD = -0.12

/** Contatto di un utensile che schiaccia il fianco: punto (mondo), profondità, estensione radiale oltre il punto e mezza larghezza. */
export interface Press { at: THREE.Vector3; depth: number; reach?: number; half?: number }

/**
 * Talloni allargati attorno alla testina durante montaggio e smontaggio: at è un punto
 * della testina (mondo), upper e lower quanto è uscito ciascun tallone (0..1).
 */
export interface Bulge { at: THREE.Vector3; upper: number; lower: number }

/** Allargamento del tallone attorno alla testina: radiale (al tallone; il battistrada si sposta di BULGE_TREAD volte tanto) e verso l'alto, m. */
const BULGE_DR = 0.12, BULGE_TREAD = 0.4, BULGE_DX = 0.02
/** Mezza larghezza (lungo il tallone) della zona allargata a pieno e lunghezza del raccordo, m. */
const BULGE_HALF = 0.06, BULGE_FADE = 0.08
const smooth01 = (t: number) => { const k = Math.min(Math.max(t, 0), 1); return k * k * (3 - 2 * k) }

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
  /** Testina dell'utensile di montaggio, per riferire la deformazione dei talloni. */
  head!: THREE.Group
  readonly airLines: AirLine[] = []
  readonly beltMap: THREE.CanvasTexture
  readonly bladeArrow: THREE.ArrowHelper
  /** Pulsanti della pulsantiera dello stallonatore. */
  readonly buttons: Record<'stallona' | 'ritorno' | 'arresto', THREE.Group> = {} as never
  /** Bobine dell'elettrovalvola: si illuminano quando sono eccitate. */
  readonly coils: Record<'a' | 'b', THREE.MeshStandardMaterial> = {} as never
  readonly cables: AirLine[] = []
  /** Fermo per matching: carrello regolato all'altezza della ruota e stelo che spinge il pattino. */
  readonly matchCarriage = new THREE.Group()
  readonly matchSlide = new THREE.Group()
  private marks!: MarkSet
  beltLen = 1
  private bbRam!: Ram
  private tiltRam!: Ram
  private rimG!: THREE.Group
  private tireG!: THREE.Group
  private tireMesh: THREE.Mesh | null = null
  private tireBase: Float32Array | null = null
  /** Deformazione del pneumatico in corso, nel suo sistema di riferimento. */
  private warp: { cs: { side: number; phi: number; rc: number; depth: number; reach: number; half: number }[]; bulge: { phi: number; upper: number; lower: number } | null; R: number; Rt: number; Wt: number } = { cs: [], bulge: null, R: 0, Rt: 0, Wt: 0 }
  private cableG = new THREE.Group()
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
    this.pushbuttons()
    this.col.add(this.colAir)
    this.airLine('asta', [new THREE.Vector3(0.03, 0.0, 0.03), new THREE.Vector3(0.03, 0.6, 0.03), new THREE.Vector3(0.03, 0.95, 0.05), new THREE.Vector3(-0.06, 1.0, 0.13)], this.colAir, 'bloccaggio')
    this.helperArm()
    this.matchingClamp()
    this.inflator()
    this.leverTool()
    this.rimG = this.piece('cerchio', [0, 0, 0], this.rimSpin)
    this.tireG = this.piece('pneumatico', [0.32, 0, 0], this.tireSpin)
    // segni del marcatore: giallo sul cerchio e sul pneumatico (da allineare), bianco il riferimento
    const glow = (id: string, c: number) => this.custom(id, new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.6, side: THREE.DoubleSide }), 0x8a93a0, true)
    this.marks = new MarkSet({ rim: glow('cerchio', 0xffd21e), ref: glow('pneumatico', 0xf2f2f2), target: glow('pneumatico', 0xffd21e), arc: glow('cerchio', 0xffb21e) })

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
    // staffa del perno dello stallonatore: due orecchie sopra e sotto il mozzo del braccio
    for (const y of [BB_P.y + 0.07, BB_P.y - 0.2]) this.mesh(right, box(BB_P.x + 0.045 - x1, 0.025, 0.09, (x1 + BB_P.x + 0.045) / 2, y, BB_P.z), LOOK.dark)
    this.mesh(right, box(0.012, 0.32, 0.12, x1 + 0.006, BB_P.y - 0.065, BB_P.z), LOOK.dark)
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

    // pedaliera: da sinistra rotazione, griffe, palo (lo stallonatore ha la sua pulsantiera)
    const ped = this.piece('pedaliera', [0, 0, 0.55])
    this.mesh(ped, box(0.4, 0.03, 0.06, 0, 0.075, 0.37), LOOK.dark)
    const looks: Look[] = [LOOK.accent, LOOK.dark, LOOK.dark]
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Group()
      p.userData.part = 'pedaliera'
      p.userData.front = true
      p.position.set(-0.12 + i * 0.12, 0.085, 0.37)
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
      // corpo basso sotto il fianco, gradino su cui appoggia il cerchio e labbro dentato che stringe la balconata
      this.mesh(j, box(0.05, 0.015, 0.05, 0.025, TT_Y + 0.0075, 0), LOOK.dark)
      this.mesh(j, box(0.035, 0.03, 0.04, -0.0175, TT_Y + 0.015, 0), LOOK.dark)
      this.mesh(j, box(JAW_LIP, JAW_TOP - 0.015, 0.04, JAW_LIP / 2, TT_Y + (JAW_TOP + 0.015) / 2, 0), LOOK.dark)
      for (let k = 0; k < 3; k++) this.mesh(j, box(0.003, 0.003, 0.04, 0.0015, TT_Y + 0.033 + k * 0.004, 0), LOOK.steel)
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
    this.mesh(this.hexSlide, new THREE.CylinderGeometry(0.025, 0.025, 0.8, 6).translate(0, 0.4 + 0.09, -0.02), LOOK.steel)
    this.mesh(this.hexSlide, new THREE.CylinderGeometry(0.03, 0.03, 0.02, 6).translate(0, 0.9, -0.02), LOOK.dark)

    // utensile: profilo laterale estruso, con la lingua verso il centro del cerchio (+z)
    const u = this.piece('utensile', [0, 0.08, 0.2], this.hexSlide)
    this.head = u
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
    // mozzo sul perno e braccio a gomito: esce dal fianco dietro la ruota, poi corre in avanti fuori dal pneumatico
    this.mesh(g, new THREE.CylinderGeometry(0.04, 0.04, 0.22, 24).translate(0, -0.06, 0), LOOK.paint)
    this.mesh(g, new THREE.CylinderGeometry(0.02, 0.02, 0.3, 16).translate(0, -0.065, 0), LOOK.steel)
    this.mesh(g, new RoundedBoxGeometry(BB_OUT + 0.07, 0.07, 0.06, 2, 0.01).translate(BB_OUT / 2, 0, 0), LOOK.paint)
    this.mesh(g, new RoundedBoxGeometry(0.06, 0.07, ARM_L + 0.06, 2, 0.01).translate(BB_OUT, 0, ARM_L / 2), LOOK.paint)
    this.mesh(g, box(0.002, 0.045, 0.06, BB_OUT + 0.031, 0, ARM_L - 0.13), LOOK.yellow)
    // supporto della lama: scende dall'estremità del braccio fino all'altezza del bordo del cerchio
    const xb = BLADE.x + 0.07
    this.mesh(g, box(BB_OUT + 0.025 - xb, 0.29, 0.08, (xb + BB_OUT + 0.025) / 2, BLADE.y - 0.095 + 0.145, ARM_L - 0.005), LOOK.dark)
    // leva corta interna su cui spinge il cilindro
    const lv = BB_LEVER
    const len = Math.hypot(lv.x, lv.z)
    const lb = box(len, 0.04, 0.04)
    lb.rotateY(Math.atan2(-lv.z, lv.x)).translate(lv.x / 2, lv.y, lv.z / 2)
    this.mesh(g, lb, LOOK.dark)
    this.mesh(g, new THREE.CylinderGeometry(0.014, 0.014, 0.06, 14).translate(lv.x, lv.y, lv.z), LOOK.steel)

    // lama in acciaio: lastra curva concentrica al cerchio, bordo di spinta arrotondato verso il mobile
    const lam = this.piece('paletta', [0.42, 0, 0.12], this.bb)
    const cy = BLADE.y, cz = BLADE.z - BLADE_R, H = BLADE_HALF
    // sagoma laterale come nella foto: spigolo alto raccordato, angolo basso smussato
    const x0 = (sv: number) => BLADE.x + Math.max(0, sv - (H - 0.012)) * 0.9 + Math.max(0, -(H - 0.03) - sv) * 0.9
    const x1 = () => BLADE.x + 0.105
    this.mesh(lam, bentPlate(BLADE_R, cy, cz, H, 0.008, x0, x1), LOOK.steel)
    const edge: THREE.Vector3[] = []
    for (let i = 0; i <= 24; i++) {
      const sv = -H + (2 * H * i) / 24
      edge.push(new THREE.Vector3(x0(sv) + 0.005, cy + BLADE_R * Math.sin(sv / BLADE_R), cz + BLADE_R * Math.cos(sv / BLADE_R)))
    }
    this.mesh(lam, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge), 48, 0.005, 10), LOOK.steel)
    for (const sv of [-0.045, 0.045]) {
      const y = cy + BLADE_R * Math.sin(sv / BLADE_R), z = cz + BLADE_R * Math.cos(sv / BLADE_R)
      this.mesh(lam, cylX(0.006, BLADE.x + 0.065, BLADE.x + 0.115, 12).translate(0, y, z), LOOK.dark)
    }

    const rg = this.piece('cilindro-stallonatore', [0, 0, 0.35])
    const bp = ramParts(0.11, 0.22, (l) => this.mat('cilindro-stallonatore', l, true))
    rg.add(bp.barrel, bp.piston, bp.rod)
    this.bbRam = new Ram(rg, bp.barrel, bp.rod, bp.piston, 0.22, 0.33)

    const tg = this.piece('cilindro-palo', [0, 0, -0.3])
    const tp = ramParts(0.04, 0.24, (l) => this.mat('cilindro-palo', l))
    tg.add(tp.barrel, tp.piston, tp.rod)
    this.tiltRam = new Ram(tg, tp.barrel, tp.rod, tp.piston, 0.24, 0.2)
  }

  // ---------- pulsantiera ed elettrovalvola dello stallonatore ----------

  private pushbuttons() {
    const g = this.piece('pulsantiera', [0.3, 0.1, 0])
    const fx = PB.x + 0.04
    this.mesh(g, new RoundedBoxGeometry(0.04, 0.12, 0.17, 2, 0.008).translate(PB.x + 0.02, PB.y, PB.z), LOOK.grey)
    // targhetta con le scritte sopra i pulsanti
    const cv = document.createElement('canvas')
    cv.width = 512; cv.height = 128
    const c = cv.getContext('2d')!
    c.fillStyle = '#e9e6dd'; c.fillRect(0, 0, 512, 128)
    c.fillStyle = '#1a1b1e'; c.font = '700 34px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'
    ;['STALLONA', 'RITORNO', 'ARRESTO'].forEach((t, i) => c.fillText(t, 90 + i * 166, 64))
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.0375), this.custom('pulsantiera', new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), LOOK.grey.h))
    plate.rotation.y = Math.PI / 2
    plate.position.set(fx + 0.001, PB.y + 0.038, PB.z)
    g.add(plate)
    const specs: ['stallona' | 'ritorno' | 'arresto', number, number][] = [['stallona', 0x2fa34a, 0.05], ['ritorno', 0x2a2d33, 0], ['arresto', 0xd23a2a, -0.05]]
    for (const [name, col, dz] of specs) {
      const b = new THREE.Group()
      b.userData.part = 'pulsantiera'
      b.position.set(fx, PB.y - 0.012, PB.z + dz)
      g.add(b)
      const m = this.custom('pulsantiera', new THREE.MeshStandardMaterial({ color: col, roughness: 0.4, metalness: 0.1 }), LOOK.grey.h)
      if (name === 'arresto') {
        // fungo rosso su ghiera gialla
        this.mesh(g, cylX(0.022, fx - 0.001, fx + 0.004, 32).translate(0, PB.y - 0.012, PB.z + dz), LOOK.yellow)
        b.add(new THREE.Mesh(new THREE.SphereGeometry(0.02, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).rotateZ(-Math.PI / 2).translate(0.012, 0, 0), m))
        b.add(new THREE.Mesh(cylX(0.009, 0, 0.013, 16), m))
      } else {
        this.mesh(g, cylX(0.016, fx - 0.001, fx + 0.004, 32).translate(0, PB.y - 0.012, PB.z + dz), LOOK.dark)
        b.add(new THREE.Mesh(cylX(0.012, 0, 0.011, 28), m))
      }
      this.buttons[name] = b
    }

    // elettrovalvola 5/3 a centro in scarico: corpo, due bobine, sottobase con le bocche
    const ev = this.piece('elettrovalvola', [0, 0.1, -0.3])
    this.mesh(ev, box(0.12, 0.04, 0.045, EV.x, EV.y, EV.z), LOOK.grey)
    this.mesh(ev, box(0.14, 0.015, 0.06, EV.x, EV.y - 0.027, EV.z), LOOK.dark)
    for (const [k, sx] of [['a', 1], ['b', -1]] as const) {
      const m = this.custom('elettrovalvola', new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5, emissive: 0xffc23a, emissiveIntensity: 0 }), 0x3a7bd5, true)
      const coil = new THREE.Mesh(box(0.04, 0.042, 0.042, EV.x + sx * 0.08, EV.y, EV.z), m)
      coil.userData.part = 'elettrovalvola'
      ev.add(coil)
      this.mesh(ev, box(0.012, 0.02, 0.02, EV.x + sx * 0.106, EV.y + 0.008, EV.z), LOOK.dark)
      this.coils[k] = m
    }

    // cavi dalla pulsantiera alle bobine: i segnali corrono quando un pulsante è premuto
    this.root.add(this.cableG)
    const cm = this.custom('pulsantiera', new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.6 }), 0x3a7bd5)
    const V = (a: number, b: number, c: number) => new THREE.Vector3(a, b, c)
    const paths: [string, THREE.Vector3[]][] = [
      ['a', [V(PB.x - 0.002, PB.y + 0.01, PB.z + 0.03), V(0.33, 0.62, -0.18), V(EV.x + 0.12, EV.y + 0.04, EV.z), V(EV.x + 0.112, EV.y + 0.008, EV.z)]],
      ['b', [V(PB.x - 0.002, PB.y - 0.01, PB.z + 0.03), V(0.3, 0.64, -0.17), V(EV.x - 0.02, EV.y + 0.07, EV.z), V(EV.x - 0.112, EV.y + 0.008, EV.z)]],
    ]
    const dotM = new THREE.MeshBasicMaterial({ color: 0xffd23f, toneMapped: false })
    for (const [kind, pts] of paths) {
      const curve = new THREE.CatmullRomCurve3(pts)
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.0035, 6), cm)
      m.userData.part = 'pulsantiera'
      this.cableG.add(m)
      const dots: THREE.Mesh[] = []
      for (let i = 0; i < 4; i++) {
        const d = new THREE.Mesh(this.dotG, dotM)
        d.userData.noPick = true
        d.visible = false
        this.cableG.add(d)
        dots.push(d)
      }
      this.cables.push({ curve, dots, kind })
    }
  }

  /** Segnali elettrici nei cavi della pulsantiera e bobine accese. */
  signals(a: boolean, b: boolean, phase: number) {
    for (const l of this.cables) {
      const on = l.kind === 'a' ? a : b
      l.dots.forEach((d, i) => {
        d.visible = on
        if (on) l.curve.getPointAt((((phase * 1.6 + i / l.dots.length) % 1) + 1) % 1, d.position)
      })
    }
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
    // bocche del cilindro dello stallonatore: sul fondello e sulla testata lato stelo
    const lev = BB_LEVER.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.1).add(BB_P)
    const dir = lev.sub(BB_ANCHOR).normalize()
    const up = new THREE.Vector3(0, 1, 0).addScaledVector(dir, -dir.y).normalize()
    const capPort = BB_ANCHOR.clone().addScaledVector(dir, 0.02).addScaledVector(up, 0.11)
    const rodPort = BB_ANCHOR.clone().addScaledVector(dir, 0.2).addScaledVector(up, 0.11)
    const evP = V(EV.x, EV.y - 0.035, EV.z), evA = V(EV.x + 0.03, EV.y - 0.035, EV.z + 0.03), evB = V(EV.x - 0.03, EV.y - 0.035, EV.z + 0.03)
    const lines: [string, THREE.Vector3[]][] = [
      ['linea', [V(x, 0.6, -0.3), V(-0.36, 0.6, -0.28), V(-0.25, 0.45, 0.1), V(-0.2, 0.33, 0.25)]],
      // stallonatore: distributori → elettrovalvola → una delle due camere del cilindro
      ['bb', [vbOut, V(0.05, 0.4, 0.2), V(0.2, 0.47, -0.05), evP]],
      ['bb-spinta', [evA, V(EV.x + 0.04, EV.y - 0.08, EV.z + 0.12), capPort.clone().add(V(0, 0.05, 0)), capPort]],
      ['bb-ritorno', [evB, V(EV.x - 0.05, EV.y - 0.07, EV.z + 0.08), rodPort.clone().add(V(0, 0.04, 0)), rodPort]],
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
    this.mesh(col, new RoundedBoxGeometry(0.11, 1.56, 0.11, 2, 0.01).translate(hx, 0.84, hz), LOOK.paint)
    this.mesh(col, box(0.26, 0.03, 0.26, hx, 0.075, hz), LOOK.dark)
    for (const y of [0.35, 0.62]) this.mesh(col, box(-0.38 - (hx + 0.055), 0.06, 0.06, (hx + 0.055 - 0.38) / 2, y, hz), LOOK.dark)
    this.mesh(col, box(0.13, 0.04, 0.13, hx, 1.64, hz), LOOK.accent)

    // comando dedicato: leva a croce su una scatola valvole sulla colonna
    const cmd = this.piece('helper-comando', [-0.15, 0, 0.25])
    this.mesh(cmd, new RoundedBoxGeometry(0.09, 0.12, 0.06, 2, 0.01).translate(hx + 0.02, 0.98, hz + 0.085), LOOK.grey)
    cmd.add(this.joystick)
    this.joystick.position.set(hx + 0.02, 1.04, hz + 0.085)
    this.joystick.userData.part = 'helper-comando'
    this.joystick.userData.front = true
    this.mesh(this.joystick, new THREE.CylinderGeometry(0.006, 0.006, 0.07, 10).translate(0, 0.035, 0), LOOK.steel)
    this.mesh(this.joystick, new THREE.SphereGeometry(0.016, 14, 10).translate(0, 0.075, 0), LOOK.accent)

    // quota del braccio, stelo e prolunga: il cono lavora più in basso degli altri
    const tools: ['rullo' | 'disco' | 'cono', number, number, number][] = [['disco', 1.3, 0.3, 0], ['rullo', 1.38, 0.33, 0], ['cono', 1.46, 0.17, 0.3]]
    for (const [name, y, rod, ext] of tools) {
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
      // cilindro verticale dell'utensile, a cavallo del carrello: canna cava, stelo e pistone visibili in sezione
      const cyl = this.piece('helper-cilindri', [0, 0.18, 0], carrier)
      this.mesh(cyl, new THREE.CylinderGeometry(0.03, 0.03, 0.34, 24, 1, true).translate(0, 0.05, 0), LOOK.air)
      for (const yy of [-0.12, 0.22]) this.mesh(cyl, new THREE.CylinderGeometry(0.033, 0.033, 0.015, 24).translate(0, yy, 0), LOOK.dark)
      const slide = new THREE.Group()
      carrier.add(slide)
      slide.userData.part = 'helper-cilindri'
      this.mesh(slide, new THREE.CylinderGeometry(0.011, 0.011, rod, 12).translate(0, rod / 2, 0), LOOK.steel)
      const piston = new THREE.Group()
      piston.userData.part = 'helper-cilindri'
      piston.position.y = rod
      slide.add(piston)
      this.mesh(piston, new THREE.CylinderGeometry(0.026, 0.026, 0.02, 20), LOOK.accent)
      const tool = this.piece('helper-' + name, [0, -0.12, 0.1], slide)
      this.helper[name] = { arm, carrier, slide, piston, tool, y, rod, ext }
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

    // cono di centraggio in fondo alla sua prolunga: preme il cerchio contro il piatto dal centro
    const c = this.helper.cono.tool, ce = this.helper.cono.ext
    this.mesh(c, new THREE.CylinderGeometry(0.012, 0.012, ce, 14).translate(0, -ce / 2, 0), LOOK.steel)
    this.mesh(c, revolveX([[0, 0], [0.012, 0], [0.05, 0.06], [0.05, 0.08], [0.015, 0.08], [0.015, 0.12], [0, 0.12]], 40).rotateZ(Math.PI / 2).translate(0, -ce, 0), LOOK.steel)

    for (const t of Object.values(this.helper)) this.park(t)
  }

  /** Utensile del braccio di aiuto a riposo: braccio girato indietro, stelo rientrato. */
  park(t: HelperTool) {
    t.arm.rotation.y = 2.3
    t.carrier.position.x = 0.4
    t.slide.position.y = HOLD
  }

  /**
   * Posa di un utensile per portarlo sul punto target (mondo).
   * Restituisce angolo del braccio, distanza del carrello e quota dello stelo.
   */
  helperPose(t: HelperTool, target: THREE.Vector3) {
    const dx = target.x - HC.x, dz = target.z - HC.z
    return { swing: Math.atan2(-dz, dx), reach: Math.hypot(dx, dz), drop: target.y + t.ext - t.y }
  }

  /** Orienta l'asse del rullo in direzione radiale rispetto al piatto, così rotola sul fianco. */
  aimRoller(swing: number, target: THREE.Vector3) {
    const radial = new THREE.Vector3(target.x, 0, target.z - TT_Z).normalize()
    radial.applyAxisAngle(new THREE.Vector3(0, 1, 0), -swing)
    const roll = this.helper.rullo.tool.userData.roll as THREE.Object3D
    roll.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), radial)
  }

  // ---------- fermo per matching ----------

  /**
   * Accessorio per il matching, sul traverso alto del braccio di aiuto: montante, carrello
   * regolabile in altezza, cilindro orizzontale e pattino di gomma curvo che si appoggia
   * al battistrada in direzione radiale e tiene fermo il pneumatico mentre il cerchio gira.
   */
  private matchingClamp() {
    const g = this.piece('matching', [-0.3, 0.12, 0])
    const z = TT_Z, pz = z - 0.045
    // staffa sul traverso e montante
    this.mesh(g, box(0.05, 0.02, 0.07, -0.43, 0.66, -0.05), LOOK.dark)
    this.mesh(g, box(0.02, 0.33, 0.02, -0.43, 0.835, pz), LOOK.steel)
    this.mesh(g, box(0.028, 0.012, 0.028, -0.43, 1.006, pz), LOOK.dark)
    g.add(this.matchCarriage)
    this.matchCarriage.userData.part = 'matching'
    const c = this.matchCarriage
    // carrello: blocco che stringe montante e cilindro, con il pomello di bloccaggio
    this.mesh(c, box(0.04, 0.05, 0.075, -0.43, 0, z - 0.02), LOOK.paint)
    this.mesh(c, new THREE.CylinderGeometry(0.004, 0.004, 0.03, 10).rotateX(Math.PI / 2).translate(-0.43, 0, pz - 0.025), LOOK.steel)
    this.mesh(c, new THREE.CylinderGeometry(0.012, 0.012, 0.012, 16).rotateX(Math.PI / 2).translate(-0.43, 0, pz - 0.045), LOOK.accent)
    // cilindro: canna cava e testate (in sezione si vedono pistone e stelo)
    this.mesh(c, new THREE.CylinderGeometry(0.018, 0.018, 0.08, 24, 1, true).rotateZ(Math.PI / 2).translate(-0.43, 0, z), LOOK.air)
    for (const x of [-0.47, -0.39]) this.mesh(c, cylX(0.02, x - 0.005, x + 0.005).translate(0, 0, z), LOOK.dark)
    c.add(this.matchSlide)
    this.matchSlide.userData.part = 'matching'
    const sl = this.matchSlide
    this.mesh(sl, cylX(0.016, -0.468, -0.458).translate(0, 0, z), LOOK.accent)
    this.mesh(sl, cylX(0.007, -0.465, -0.385).translate(0, 0, z), LOOK.steel)
    this.mesh(sl, box(0.01, 0.08, 0.11, -0.38, 0, z), LOOK.dark)
    // pattino: settore d'anello concavo verso la ruota, raggio MATCH_PAD_R
    const a = 0.05 / MATCH_PAD_R
    const sh = new THREE.Shape()
    sh.absarc(0, 0, MATCH_PAD_R + 0.015, Math.PI - a, Math.PI + a, false)
    sh.absarc(0, 0, MATCH_PAD_R, Math.PI + a, Math.PI - a, true)
    sh.closePath()
    const pad = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: false, curveSegments: 24 }).rotateX(-Math.PI / 2).translate(MATCH_FACE + MATCH_PAD_R, -0.035, z)
    this.mesh(sl, pad, LOOK.rubber)
    this.airLine('matching', [new THREE.Vector3(HC.x + 0.04, 0.93, HC.z + 0.085), new THREE.Vector3(-0.5, 0.9, 0.03), new THREE.Vector3(-0.48, 0.86, z)], g, 'matching')
  }

  /** Altezza del carrello (centro della ruota sdraiata) e uscita dello stelo, m. */
  setMatching(y: number, ext: number) {
    this.matchCarriage.position.y = y
    this.matchSlide.position.x = ext
  }

  /** Segni del marcatore e rotazione da fare; text è l'angolo scritto accanto all'arco. */
  setMarks(s: MarkState | null, text?: string) {
    this.marks.rimG.visible = this.marks.tireG.visible = !!s
    if (!s) return
    const before = this.marks.tireMeshes
    this.marks.set(this.spec, s, text)
    // segni nuovi: vanno deformati come la gomma
    if (this.marks.tireMeshes !== before) this.warpMarks()
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
  setHose(to: THREE.Vector3 | null, above = 0) {
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
    // il tubo scende dalla pistola, sale oltre il pneumatico e cala dentro il cerchio fino alla valvola
    const from = new THREE.Vector3(-0.32, 0.86, 0.3)
    const { tireR: Rt } = wheelGeometry(this.spec)
    const axis = new THREE.Vector3(0, to.y, TT_Z)
    const dv = to.clone().sub(axis).setY(0).normalize()
    const out = axis.clone().addScaledVector(dv, Rt + 0.07).setY(above + 0.02)
    const over = to.clone().setY(above + 0.06)
    const curve = new THREE.CatmullRomCurve3([from, from.clone().add(new THREE.Vector3(0.02, -0.05, 0.06)), out, over, to.clone().add(new THREE.Vector3(0, 0.03, 0)), to])
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
    this.solids = null
    this.clear(this.rimG)
    this.clear(this.tireG)
    const geo = wheelMeshes(spec)
    for (const r of geo.rim) this.mesh(this.rimG, r.geo, LOOK[r.look])
    this.tireMesh = this.mesh(this.tireG, geo.tire, LOOK.rubber)
    this.tireBase = (geo.tire.attributes.position.array as Float32Array).slice()
    this.marks.attach(this.rimG, this.tireG)
  }

  /** Cerchio (canale e disco) e pneumatico come solidi per il controllo di compenetrazione. */
  wheelSolids(): Solid[] {
    if (this.solids?.spec === this.spec) return this.solids.list
    const { rimR: R } = wheelGeometry(this.spec)
    const e = this.spec.et
    const disc: RX[] = [[0.0285, e], [R - 0.0055, e], [R - 0.0055, e + 0.016], [0.0285, e + 0.016]]
    const list = [
      { name: 'cerchio', frame: this.rimG, sections: [rimSection(this.spec), disc] },
      { name: 'pneumatico', frame: this.tireMesh!, sections: [tireShell(this.spec)], unwarp: this.unwarp, slack: this.slack },
    ]
    this.solids = { spec: this.spec, list }
    return list
  }
  private solids: { spec: WheelSpec; list: Solid[] } | null = null

  /** Oggetti esclusi dal controllo: la ruota stessa e gli indicatori dei flussi. */
  isWheelOrMarker(o: THREE.Object3D) {
    return o === this.rimG || o === this.tireG || o === this.bladeArrow || !!o.userData.noPick
  }

  /** Posizione della valvola nel mondo. */
  valveWorld() {
    const { rimR: R, width: w } = wheelGeometry(this.spec)
    this.root.updateMatrixWorld(true)
    // estremità della valvola che sporge verso l'asse, dentro il canale
    const r = R - 0.026
    return this.rimSpin.localToWorld(new THREE.Vector3(w / 2 - 0.02, r * Math.cos(2.4), r * Math.sin(2.4)))
  }

  /**
   * Deformazione del pneumatico: fianco schiacciato da paletta, rullo, disco e griffe
   * (i vertici dalla parte dell'utensile vengono spinti verso il piano centrale) e
   * talloni allargati attorno alla testina in montaggio e smontaggio.
   */
  deform(presses: Press[], bulge: Bulge | null) {
    const mesh = this.tireMesh, base = this.tireBase
    if (!mesh || !base) return
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const act = presses.filter((c) => c.depth > 1e-4)
    const bu = bulge && (bulge.upper > 1e-3 || bulge.lower > 1e-3) ? bulge : null
    if (!act.length && !bu) {
      this.warp.cs = []
      this.warp.bulge = null
      if (mesh.userData.dented) {
        arr.set(base)
        pos.needsUpdate = true
        mesh.geometry.computeVertexNormals()
        mesh.userData.dented = false
        this.warpMarks()
      }
      return
    }
    this.root.updateMatrixWorld(true)
    const { rimR: R, tireR: Rt, tireW: Wt } = wheelGeometry(this.spec)
    const cs = act.map((c) => {
      const l = mesh.worldToLocal(c.at.clone())
      return { side: Math.sign(l.x) || 1, phi: Math.atan2(l.z, l.y), rc: Math.max(Math.hypot(l.y, l.z), R + 0.02), depth: c.depth, reach: c.reach ?? 0, half: c.half ?? 0 }
    })
    let b = null
    if (bu) {
      const l = mesh.worldToLocal(bu.at.clone())
      b = { phi: Math.atan2(l.z, l.y), upper: bu.upper, lower: bu.lower }
    }
    this.warp = { cs, bulge: b, R, Rt, Wt }
    const d = new THREE.Vector3()
    let polar = mesh.userData.polar as Float32Array | undefined
    if (!polar) {
      // raggio e angolo dei vertici a riposo, calcolati una volta sola
      polar = new Float32Array((base.length / 3) * 2)
      for (let i = 0, j = 0; i < base.length; i += 3, j += 2) { polar[j] = Math.hypot(base[i + 1], base[i + 2]); polar[j + 1] = Math.atan2(base[i + 2], base[i + 1]) }
      mesh.userData.polar = polar
    }
    for (let i = 0, j = 0; i < arr.length; i += 3, j += 2) {
      this.warpAt(base[i], base[i + 1], base[i + 2], d, polar[j], polar[j + 1])
      arr[i] = base[i] + d.x
      arr[i + 1] = base[i + 1] + d.y
      arr[i + 2] = base[i + 2] + d.z
    }
    pos.needsUpdate = true
    mesh.geometry.computeVertexNormals()
    mesh.userData.dented = true
    this.warpMarks()
  }

  /** I segni sul fianco seguono la gomma deformata. */
  private warpMarks() {
    const d = new THREE.Vector3()
    const on = this.warp.cs.length > 0 || !!this.warp.bulge
    for (const m of this.marks.tireMeshes) {
      const pos = m.geometry.attributes.position as THREE.BufferAttribute
      const arr = pos.array as Float32Array
      const base = (m.geometry.userData.base ??= arr.slice()) as Float32Array
      for (let i = 0; i < arr.length; i += 3) {
        if (on) this.warpAt(base[i], base[i + 1], base[i + 2], d)
        else d.set(0, 0, 0)
        arr[i] = base[i] + d.x
        arr[i + 1] = base[i + 1] + d.y
        arr[i + 2] = base[i + 2] + d.z
      }
      pos.needsUpdate = true
    }
  }

  /** Spostamento di un punto del pneumatico indeformato (sistema del pneumatico) secondo la deformazione corrente. */
  private warpAt(x: number, y: number, z: number, out: THREE.Vector3, r = Math.hypot(y, z), phi = Math.atan2(z, y)) {
    const k = this.bulgeK(x, phi) * this.bulgeR(r)
    const s = r > 1e-6 ? (BULGE_DR * k) / r : 0
    return out.set(this.axial(x, r, phi), s * y, s * z)
  }

  /** Allargamento del tallone (senza il calo verso il battistrada) per un punto a quota x e angolo phi. */
  private bulgeK(x: number, phi: number) {
    const b = this.warp.bulge
    if (!b) return 0
    let a = phi - b.phi
    a -= Math.PI * 2 * Math.round(a / (Math.PI * 2))
    const t = Math.max(0, Math.abs(a) * this.warp.R - BULGE_HALF)
    if (t > 0.2) return 0
    // il lato del tallone superiore (+x) segue upper, quello inferiore lower
    const sx = smooth01((x / (this.warp.Wt / 2) + 1) / 2)
    return (b.lower + (b.upper - b.lower) * sx) * Math.exp(-((t / BULGE_FADE) ** 2))
  }

  /** Il tallone esce di più, il battistrada poco: calo lineare lungo il fianco (il fianco si piega senza ripiegarsi). */
  private bulgeR(r: number) {
    const { R, Rt } = this.warp
    return 1 - (1 - BULGE_TREAD) * Math.min(Math.max((r - R) / (Rt - R), 0), 1)
  }

  /** Spostamento lungo l'asse: fianco schiacciato dagli utensili e tallone superiore sollevato attorno alla testina. */
  private axial(x: number, r: number, phi: number) {
    const { R, Rt, Wt } = this.warp
    let dx = 0
    for (const c of this.warp.cs) {
      if (x * c.side <= 0) continue
      let a = phi - c.phi
      a -= Math.PI * 2 * Math.round(a / (Math.PI * 2))
      // a pieno sotto l'utensile, poi raccordo lungo il tallone
      const t = Math.max(0, Math.abs(a) * c.rc - c.half)
      if (t > 0.22) continue
      const fa = Math.exp(-((t / 0.1) ** 2))
      // il fianco cede vicino al tallone, molto meno verso il battistrada
      const rp = c.rc + c.reach
      const fr = r < rp ? 1 : Math.max(0, 1 - (r - rp) / Math.max(Rt - rp, 0.01)) ** 1.6
      const fb = r < R + 0.004 ? 0.6 : 1
      const v = c.depth * fa * fr * fb
      if (v > Math.abs(dx)) dx = -c.side * v
    }
    const b = this.warp.bulge
    if (b && b.upper > 0) {
      let a = phi - b.phi
      a -= Math.PI * 2 * Math.round(a / (Math.PI * 2))
      const t = Math.max(0, Math.abs(a) * R - BULGE_HALF)
      if (t < 0.2) dx += BULGE_DX * b.upper * Math.exp(-((t / BULGE_FADE) ** 2)) * smooth01((x / (Wt / 2) + 1) / 2)
    }
    return dx
  }

  /** Spostamento massimo dei punti del pneumatico nella deformazione corrente. */
  private slack = () => {
    let m = 0
    for (const c of this.warp.cs) m = Math.max(m, c.depth)
    const b = this.warp.bulge
    if (b) m = Math.max(m, BULGE_DR * Math.max(b.upper, b.lower) + BULGE_DX)
    return m + 0.005
  }

  /** Riporta un punto del pneumatico deformato (sistema del pneumatico) alla forma indeformata. */
  private unwarp = (p: THREE.Vector3) => {
    if (!this.warp.cs.length && !this.warp.bulge) return
    const { R, Rt } = this.warp
    const rd = Math.hypot(p.y, p.z), phi = Math.atan2(p.z, p.y)
    const c = (1 - BULGE_TREAD) / (Rt - R)
    let x = p.x, r = rd
    for (let i = 0; i < 4; i++) {
      // raggio: rd = r + DR·K·(1 − c·(r − R)), lineare in r tra cerchio e battistrada
      const D = BULGE_DR * this.bulgeK(x, phi)
      r = (rd - D * (1 + c * R)) / (1 - D * c)
      if (r < R) r = rd - D
      else if (r > Rt) r = rd - D * BULGE_TREAD
      x = p.x - this.axial(x, r, phi)
    }
    const f = rd > 1e-9 ? r / rd : 1
    p.set(x, p.y * f, p.z * f)
  }

  /** Quota massima del fianco superiore sotto un utensile di raggio rho centrato in (x, z). */
  surfaceMax(x: number, z: number, rho: number) {
    let y = this.surfaceY(x, z)
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2
      for (const f of [0.35, 0.7, 1]) y = Math.max(y, this.surfaceY(x + Math.cos(a) * rho * f, z + Math.sin(a) * rho * f))
    }
    return y
  }

  /** Quota del fianco superiore del pneumatico (non deformato) sulla verticale per (x, z). */
  surfaceY(x: number, z: number) {
    const m = this.tireMesh!
    this.root.updateMatrixWorld(true)
    const p = new THREE.Vector3()
    let y = this.tireHolder.position.y
    for (let i = 0; i < 4; i++) {
      m.worldToLocal(p.set(x, y, z))
      p.x = tireHalfWidth(this.spec, Math.hypot(p.y, p.z))
      y = m.localToWorld(p).y
    }
    return y
  }

  /** Punto del mondo nel sistema del pneumatico (indeformato): raggio e posizione lungo l'asse. */
  tireLocal(p: THREE.Vector3) {
    const l = this.tireMesh!.worldToLocal(p.clone())
    return { r: Math.hypot(l.y, l.z), x: l.x }
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
    this.cableG.visible = t < 0.02 && !this.parts.get('pulsantiera')?.hidden
    this.updateRams()
  }

  protected afterHidden(id: string, hidden: boolean) {
    if (id === 'valvole') this.airG.visible = !hidden && this.explodeT < 0.02
    if (id === 'pulsantiera') this.cableG.visible = !hidden && this.explodeT < 0.02
  }
}
