import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { Section } from '../core/section'
import { MachineModel, LOOK, Look } from '../core/model'
import type { Shape } from '../core/interference'
import { box, revolveX, RX } from '../core/geo'
import { SPEC, Auto, puntiAuto } from './physics'

/**
 * Sollevatore a due colonne elettromeccanico, auto compresa.
 *
 * Sistema di riferimento come nelle altre macchine: y in alto, pavimento a y = 0,
 * z verso l'operatore. Le colonne stanno a x = ±XC; l'auto entra da +z con il muso
 * verso −z e si ferma con il baricentro vicino alla linea delle colonne (z = 0).
 */

/** Asse delle colonne, m. */
export const XC = 1.48
/** Colonna: larghezza (x), profondità (z), altezza. */
const CW = 0.3, CD = 0.28, CH = 3.5
/** Perni dei bracci sul carrello: |x| e |z|. */
export const PIV_X = 1.17, PIV_Z = 0.13
/** Tubo esterno dei bracci a carrello in basso: quota inferiore e superiore. */
const ARM_Y0 = 0.045, ARM_Y1 = 0.105
/** Cima del tampone con la vite tutta giù, a carrello in basso; corsa di regolazione del tampone. */
export const PAD0 = 0.135
export const PAD_MAX = 0.12
/** Lunghezza dei bracci dal perno al centro del tampone: rientrati e tutti fuori. */
export const REACH = { ant: [0.6, 1.05], post: [0.75, 1.4] } as const
/** Quote della testata, della trave superiore e della barra di sicurezza sotto la trave. */
const HEAD_Y = 3.5, BEAM_Y = 3.72
export const ROOF_BAR = 3.47
/** Vite: estremità; madrevite portante: base a carrello in basso. */
const SCREW_Y0 = 0.1, SCREW_Y1 = 3.62, SCREW_R = 0.018
const NUT_Y = 0.42
/** Ingranaggi nella testata: quota e interasse; motore accanto alla colonna; pulegge sopra la testata. */
const GEAR_Y = 3.6, PINION_DX = 0.084, MOTOR_DX = 0.3, PULLEY_Y = 3.8
/** Carrello: quote a carrello in basso. */
const CAR_Y0 = 0.03, CAR_Y1 = 1.03

const BLUE: Look = { c: 0x2c5fa0, m: 0.35, r: 0.45, h: 0x8a93a0 }
const BRONZE: Look = { c: 0xb0793a, m: 0.9, r: 0.35, h: 0xe0892b }
const NYLON: Look = { c: 0xe9e4d4, m: 0, r: 0.5, h: 0x3a7bd5 }
const GREEN: Look = { c: 0x2f9e44, m: 0.1, r: 0.5, h: 0x3a7bd5 }

/** Indici dei bracci: sinistra anteriore, sinistra posteriore, destra anteriore, destra posteriore. */
export const ARMS = [
  { s: -1, kind: 'ant' as const }, { s: -1, kind: 'post' as const },
  { s: 1, kind: 'ant' as const }, { s: 1, kind: 'post' as const },
]
/** Perno di un braccio (x, z). */
export const pivotOf = (i: number) => ({ x: ARMS[i].s * PIV_X, z: ARMS[i].kind === 'ant' ? -PIV_Z : PIV_Z })
/** Angolo del braccio a riposo: i bracci anteriori puntano verso −z, i posteriori verso +z. */
export const parkedPsi = (i: number) => (ARMS[i].kind === 'ant' ? Math.PI / 2 : -Math.PI / 2)

export interface ArmPose { psi: number; ext: number; e: number }
export interface Pose {
  /** Corsa dei due carrelli (sinistra, destra) e calo dopo la rottura della madrevite portante, m. */
  h: [number, number]
  drop: [number, number]
  /** Angolo delle viti, rad. */
  screw: [number, number]
  arms: ArmPose[]
  locked: boolean
  car: { z: number; y: number; roll: number; wheels: number } | null
  pressed: { su: boolean; giu: boolean; stop: boolean }
  /** Barra di sicurezza spinta dal tetto (0 = libera, 1 = finecorsa aperto). */
  barra: number
  /** Madrevite di sicurezza in presa (lato), per farla risaltare. */
  sicurezza: number
}

type Gear = { teeth: number; r: number; t: number }

export class LiftModel extends MachineModel {
  /** Carrelli (si muovono in y), madreviti di sicurezza, viti, pignoni e pulegge motore. */
  private readonly carriage: THREE.Group[] = []
  private readonly safety: THREE.Group[] = []
  private readonly screws: THREE.Group[] = []
  private readonly pinions: THREE.Group[] = []
  private readonly motorPulleys: THREE.Group[] = []
  /** Bracci: perno (rotazione), tubo interno (sfilo), tampone (regolazione). */
  private readonly arms: { pivot: THREE.Group; slide: THREE.Group; pad: THREE.Group; pawl: THREE.Group }[] = []
  private readonly buttons: Record<'su' | 'giu' | 'stop', THREE.Group> = {} as never
  private barG!: THREE.Group
  private cablesG!: THREE.Group
  private cableMat!: THREE.MeshStandardMaterial
  private lastCableH = [-1, -1]
  private safetyMats: THREE.MeshStandardMaterial[] = []
  /** Auto: gruppo che si muove, gruppo che si smonta, ruote. */
  readonly carMove = new THREE.Group()
  private carG: THREE.Group | null = null
  private wheels: THREE.Group[] = []
  private auto: Auto | null = null
  private shape: Shape | null = null
  /** Frecce dei carichi sui tamponi. */
  readonly arrows: THREE.ArrowHelper[] = []

  constructor(section: Section) {
    super(section)
    this.root.add(this.carMove)
    this.cablesG = this.piece('cavi', [0, 1.0, 0.4])
    for (const s of [-1, 1]) this.column(s)
    this.beam()
    this.panel()
    for (let i = 0; i < 4; i++) this.arm(i)
    this.cableMat = this.mat('cavi', LOOK.steel)
    for (let i = 0; i < 4; i++) {
      const a = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 0.3, 0xffb21e, 0.07, 0.045)
      a.traverse((o) => (o.userData.noPick = true))
      ;(a.line.material as THREE.LineBasicMaterial).toneMapped = false
      ;(a.cone.material as THREE.MeshBasicMaterial).toneMapped = false
      a.visible = false
      this.root.add(a)
      this.arrows.push(a)
    }
  }

  // ---------- colonne ----------

  private column(s: number) {
    const i = s < 0 ? 0 : 1
    const x = s * XC
    // basamento e tasselli di ancoraggio
    const base = this.piece('basamento', [0, 0, 0])
    this.mesh(base, box(0.56, 0.02, 0.5, x, 0.01, 0), LOOK.dark)
    for (const dz of [-0.16, 0.16]) this.mesh(base, box(0.012, 0.18, 0.012, x - s * 0.21, 0.11, dz), LOOK.dark)
    const bolts = this.piece('tasselli', [0, 0.3, 0])
    for (const dx of [-0.22, 0.22]) for (const dz of [-0.2, 0, 0.2]) {
      this.mesh(bolts, new THREE.CylinderGeometry(0.016, 0.016, 0.012, 6).translate(x + dx, 0.026, dz), LOOK.steel)
      this.mesh(bolts, new THREE.CylinderGeometry(0.022, 0.022, 0.004, 20).translate(x + dx, 0.022, dz), LOOK.steel)
      this.mesh(bolts, new THREE.CylinderGeometry(0.007, 0.007, 0.03, 10).translate(x + dx, 0.045, dz), LOOK.steel)
    }

    // profilo della colonna: quattro pareti, la parete interna ha la feritoia per la madrevite
    const y = 0.02 + CH / 2
    this.mesh(this.piece('colonna', [s * 0.7, 0, 0]), box(0.012, CH, CD, x + s * (CW / 2 - 0.006), y, 0), BLUE)
    this.mesh(this.piece('colonna', [0, 0, 0.6]), box(CW, CH, 0.012, x, y, CD / 2 - 0.006), BLUE)
    this.mesh(this.piece('colonna', [0, 0, -0.6]), box(CW, CH, 0.012, x, y, -CD / 2 + 0.006), BLUE)
    const inner = this.piece('colonna', [0, 0, 0])
    for (const dz of [-1, 1]) this.mesh(inner, box(0.012, CH, 0.09, x - s * (CW / 2 - 0.006), y, dz * 0.095), BLUE)

    // finecorsa superiore e inferiore sulla parete interna, fuori dalla feritoia
    const fc = this.piece('finecorsa', [-s * 0.3, 0, 0.3])
    for (const yy of [CAR_Y1 + SPEC.corsa + 0.02, CAR_Y1 + 0.03]) {
      this.mesh(fc, box(0.03, 0.06, 0.04, x - s * (CW / 2 + 0.016), yy, -0.115), LOOK.yellow)
      this.mesh(fc, box(0.012, 0.012, 0.03, x - s * (CW / 2 + 0.036), yy - 0.035, -0.115), LOOK.dark)
    }

    // cuscinetto reggispinta in cima: la vite è appesa e lavora in trazione
    const cus = this.piece('cuscinetto', [0, 0.5, 0])
    this.mesh(cus, revolveY([[0.02, 3.42], [0.06, 3.42], [0.06, 3.48], [0.02, 3.48]]).translate(x, 0, 0), LOOK.steel)
    this.mesh(cus, box(CW - 0.03, 0.02, CD - 0.03, x, 3.41, 0), LOOK.dark)
    noClash(cus)

    // vite trapezia con il filetto vero (passo 6 mm), che gira
    const scr = new THREE.Group()
    scr.position.set(x, 0, 0)
    this.root.add(scr)
    this.screws.push(scr)
    const sp = this.piece('vite', [0, 1.4, 0], scr)
    this.mesh(sp, new THREE.CylinderGeometry(SCREW_R - 0.0035, SCREW_R - 0.0035, SCREW_Y1 - SCREW_Y0, 20).translate(0, (SCREW_Y0 + SCREW_Y1) / 2, 0), LOOK.steel)
    this.mesh(sp, helix(SCREW_R - 0.0035, SPEC.passo, SCREW_Y0 + 0.01, 3.4, 0.0028), LOOK.steel)
    this.mesh(sp, new THREE.CylinderGeometry(0.012, 0.012, 0.25, 16).translate(0, SCREW_Y1 + 0.02, 0), LOOK.steel)
    // ingranaggio condotto sulla vite (riduttore)
    const gear = this.piece('ingranaggi', [s * 0.3, 0.9, 0], scr)
    this.mesh(gear, gearGeo({ teeth: 30, r: 0.06, t: 0.03 }).translate(0, GEAR_Y, 0), LOOK.brass)
    noClash(scr)

    // testata: scatola cava del riduttore (si apre in sezione) con il pignone dentro
    const head = this.piece('ingranaggi', [s * 0.4, 0.8, 0])
    const hx0 = x - s * 0.16, hx1 = x + s * 0.21, hcx = (hx0 + hx1) / 2, hw = Math.abs(hx1 - hx0)
    this.mesh(head, box(hw, 0.012, CD + 0.02, hcx, HEAD_Y + 0.006, 0), BLUE)
    this.mesh(head, box(hw, 0.012, CD + 0.02, hcx, HEAD_Y + 0.2, 0), BLUE)
    for (const dz of [-1, 1]) this.mesh(head, box(hw, 0.2, 0.012, hcx, HEAD_Y + 0.1, dz * (CD / 2 + 0.004)), BLUE)
    for (const xx of [hx0, hx1]) this.mesh(head, box(0.012, 0.2, CD + 0.02, xx, HEAD_Y + 0.1, 0), BLUE)
    const pin = new THREE.Group()
    pin.position.set(x + s * PINION_DX, 0, 0)
    this.root.add(pin)
    this.pinions.push(pin)
    const pg = this.piece('ingranaggi', [s * 0.4, 0.8, 0], pin)
    this.mesh(pg, gearGeo({ teeth: 12, r: 0.024, t: 0.03 }).translate(0, GEAR_Y, 0), LOOK.steel)
    this.mesh(pg, new THREE.CylinderGeometry(0.01, 0.01, 0.3, 14).translate(0, (GEAR_Y + PULLEY_Y) / 2 + 0.02, 0), LOOK.steel)
    // puleggia condotta sopra la testata
    const pul = this.piece('cinghia', [s * 0.6, 0.9, 0], pin)
    this.mesh(pul, pulley(0.07).translate(0, PULLEY_Y, 0), LOOK.alu)
    noClash(pin)

    // motore appeso al fianco esterno della colonna, con la puleggia motrice
    const mot = this.piece('motore', [s * 0.9, 0.6, 0])
    const mx = x + s * MOTOR_DX
    this.mesh(mot, new THREE.CylinderGeometry(0.085, 0.085, 0.34, 32).translate(mx, 3.42, 0), LOOK.grey)
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      this.mesh(mot, box(0.012, 0.3, 0.012, mx + Math.cos(a) * 0.088, 3.42, Math.sin(a) * 0.088), LOOK.grey)
    }
    this.mesh(mot, new THREE.CylinderGeometry(0.07, 0.08, 0.06, 32).translate(mx, 3.22, 0), LOOK.dark)
    this.mesh(mot, box(0.08, 0.07, 0.09, mx + s * 0.1, 3.5, 0), LOOK.dark)
    this.mesh(mot, box(Math.abs(mx - (x + s * 0.15)) + 0.02, 0.012, 0.18, (mx + x + s * 0.15) / 2, 3.62, 0), LOOK.dark)
    this.mesh(mot, new THREE.CylinderGeometry(0.1, 0.1, 0.03, 32).translate(mx, 3.605, 0), LOOK.dark)
    const mp = new THREE.Group()
    mp.position.set(mx, 0, 0)
    this.root.add(mp)
    this.motorPulleys.push(mp)
    const mpp = this.piece('cinghia', [s * 0.6, 0.9, 0], mp)
    this.mesh(mpp, pulley(0.035).translate(0, PULLEY_Y, 0), LOOK.alu)
    this.mesh(mpp, new THREE.CylinderGeometry(0.012, 0.012, 0.2, 14).translate(0, PULLEY_Y - 0.08, 0), LOOK.steel)
    noClash(mot)
    noClash(mp)
    // cinghia tra le due pulegge
    const belt = this.piece('cinghia', [s * 0.6, 0.9, 0])
    this.mesh(belt, beltXZ(x + s * PINION_DX, 0.07, mx, 0.035, PULLEY_Y), LOOK.rubber)
    noClash(belt)

    // carrello che sale: madrevite portante, pattini, perni dei bracci, protezioni
    const car = new THREE.Group()
    this.root.add(car)
    this.carriage.push(car)
    const ci = x - s * (CW / 2 + 0.005)
    const body = this.piece('carrello', [-s * 0.5, 0, 0], car)
    this.mesh(body, box(0.105, CAR_Y1 - CAR_Y0, 0.34, ci - s * 0.0525, (CAR_Y0 + CAR_Y1) / 2, 0), BLUE)
    for (const dz of [-1, 1]) this.mesh(body, box(0.095, CAR_Y1 - CAR_Y0, 0.014, x - s * 0.105, (CAR_Y0 + CAR_Y1) / 2, dz * 0.157), BLUE)
    // staffa della madrevite che passa nella feritoia
    this.mesh(body, box(0.13, 0.12, 0.07, x - s * 0.095, NUT_Y + 0.07, 0), BLUE)
    // orecchie dei perni
    for (const dz of [-PIV_Z, PIV_Z]) {
      const ex0 = s * (PIV_X - 0.06), ex1 = ci - s * 0.105
      this.mesh(body, box(Math.abs(ex1 - ex0), 0.02, 0.1, (ex0 + ex1) / 2, ARM_Y1 + 0.015, dz), BLUE)
      this.mesh(body, box(Math.abs(ex1 - ex0), 0.02, 0.1, (ex0 + ex1) / 2, ARM_Y0 - 0.015, dz), BLUE)
      this.mesh(body, new THREE.CylinderGeometry(0.02, 0.02, 0.13, 20).translate(s * PIV_X, (ARM_Y0 + ARM_Y1) / 2, dz), LOOK.steel)
    }
    const nut = this.piece('madrevite', [-s * 0.25, 0.3, 0], car)
    this.mesh(nut, revolveY([[SCREW_R, NUT_Y], [0.046, NUT_Y], [0.046, NUT_Y + 0.12], [0.06, NUT_Y + 0.12], [0.06, NUT_Y + 0.14], [SCREW_R, NUT_Y + 0.14]]).translate(x, 0, 0), BRONZE)
    noClash(nut)
    const pads = this.piece('pattini', [-s * 0.15, 0, 0], car)
    for (const yy of [CAR_Y0 + 0.08, CAR_Y1 - 0.08]) {
      for (const dz of [-0.09, 0.09]) this.mesh(pads, box(0.005, 0.08, 0.06, x - s * (CW / 2 + 0.0025), yy, dz), NYLON)
      for (const dz of [-1, 1]) this.mesh(pads, box(0.06, 0.08, 0.009, x - s * 0.1, yy, dz * (CD / 2 + 0.0045)), NYLON)
    }
    const guards = this.piece('protezioni', [-s * 0.3, 0, 0.2], car)
    for (const dz of [-1, 1]) this.mesh(guards, box(0.11, 0.05, 0.02, ci - s * 0.0525, CAR_Y0 + 0.025, dz * 0.18), LOOK.yellow)
    // microinterruttore della madrevite di sicurezza e camma del finecorsa
    const sw = this.piece('finecorsa', [-s * 0.3, 0, 0.3], car)
    this.mesh(sw, box(0.03, 0.04, 0.03, x - s * 0.13, NUT_Y - 0.03, 0.06), LOOK.yellow)
    this.mesh(sw, box(0.02, 0.02, 0.05, x - s * (CW / 2 + 0.02), CAR_Y1 - 0.01, -0.115), LOOK.dark)

    // madrevite di sicurezza: sotto la portante, gira sulla vite senza portare niente
    const sg = new THREE.Group()
    this.root.add(sg)
    this.safety.push(sg)
    const sn = this.piece('sicurezza', [-s * 0.25, -0.25, 0], sg)
    const top = NUT_Y - SPEC.giocoSicurezza
    const sm = this.mesh(sn, revolveY([[SCREW_R, top - 0.09], [0.042, top - 0.09], [0.042, top], [SCREW_R, top]]).translate(x, 0, 0), LOOK.brass)
    this.safetyMats[i] = sm.material as THREE.MeshStandardMaterial
    this.mesh(sn, box(0.1, 0.02, 0.05, x - s * 0.07, top - 0.045, 0), LOOK.brass)
    noClash(sg)
  }

  // ---------- trave superiore, cavi, barra di sicurezza ----------

  private beam() {
    const g = this.piece('trave', [0, 1.2, 0])
    this.mesh(g, box(2 * XC + 0.3, 0.18, 0.18, 0, BEAM_Y + 0.09, 0), BLUE)
    this.mesh(g, box(2 * XC - 0.4, 0.05, 0.08, 0, BEAM_Y + 0.205, 0), LOOK.dark)
    const bar = this.piece('barra', [0, 0.8, 0])
    this.barG = new THREE.Group()
    this.barG.position.set(0, BEAM_Y, 0)
    bar.add(this.barG)
    this.barG.userData.part = 'barra'
    this.mesh(this.barG, new RoundedBoxGeometry(1.9, 0.05, 0.08, 2, 0.02).translate(0, ROOF_BAR + 0.025 - BEAM_Y, 0), LOOK.yellow)
    for (const x of [-0.8, 0.8]) this.mesh(this.barG, box(0.02, BEAM_Y - ROOF_BAR - 0.05, 0.02, x, (ROOF_BAR + 0.05 - BEAM_Y) / 2, 0), LOOK.steel)
    this.mesh(bar, box(0.05, 0.05, 0.06, 0.85, BEAM_Y - 0.025, 0.06), LOOK.yellow)
  }

  /** Cavi di sincronizzazione: da un carrello su per la colonna, lungo la trave, giù nell'altra colonna fino all'altro carrello. */
  private cables(h: [number, number]) {
    if (Math.abs(h[0] - this.lastCableH[0]) < 0.002 && Math.abs(h[1] - this.lastCableH[1]) < 0.002) return
    this.lastCableH = [...h]
    for (const c of [...this.cablesG.children]) { this.cablesG.remove(c); (c as THREE.Mesh).geometry.dispose() }
    for (const s of [-1, 1]) {
      const a = s < 0 ? 0 : 1, b = 1 - a, z = s * 0.06
      const xa = s * (XC - 0.105), xb = -s * (XC - 0.105)
      const pts = [
        [xa, CAR_Y1 + h[a] - 0.02, z], [xa, HEAD_Y - 0.12, z], [s * (XC - 0.15), BEAM_Y + 0.05, z], [-s * (XC - 0.15), BEAM_Y + 0.05, z],
        [xb, HEAD_Y - 0.12, z], [xb + s * 0.02, 0.12, z], [xb, CAR_Y0 + h[b] + 0.02, z],
      ].map(([px, py, pz]) => new THREE.Vector3(px, py, pz))
      const path = new THREE.CurvePath<THREE.Vector3>()
      for (let k = 0; k + 1 < pts.length; k++) path.add(new THREE.LineCurve3(pts[k], pts[k + 1]))
      const m = new THREE.Mesh(new THREE.TubeGeometry(path as unknown as THREE.Curve<THREE.Vector3>, 120, 0.004, 6, false), this.cableMat)
      m.userData.noClash = true
      this.cablesG.add(m)
    }
  }

  // ---------- quadro comandi ----------

  private panel() {
    const g = this.piece('quadro', [0, 0, 0.5])
    const x = -XC, z0 = CD / 2 + 0.006
    this.mesh(g, new RoundedBoxGeometry(0.24, 0.4, 0.1, 2, 0.01).translate(x, 1.25, z0 + 0.05), LOOK.grey)
    this.mesh(g, box(0.16, 0.1, 0.004, x, 1.13, z0 + 0.101), LOOK.yellow)
    const btn = (id: 'su' | 'giu' | 'stop', y: number, look: Look, r: number) => {
      const b = new THREE.Group()
      b.userData.part = 'quadro'
      b.position.set(x, y, z0 + 0.1)
      g.add(b)
      this.mesh(b, new THREE.CylinderGeometry(r, r, 0.03, 28).rotateX(Math.PI / 2).translate(0, 0, 0.015), look)
      this.buttons[id] = b
    }
    btn('su', 1.38, GREEN, 0.022)
    btn('giu', 1.29, LOOK.dark, 0.022)
    btn('stop', 1.13, LOOK.accent, 0.035)
    // interruttore generale sul fianco
    this.mesh(g, new THREE.CylinderGeometry(0.03, 0.03, 0.02, 24).rotateZ(Math.PI / 2).translate(x - 0.13, 1.35, z0 + 0.05), LOOK.accent)
  }

  // ---------- bracci ----------

  private arm(i: number) {
    const { s, kind } = ARMS[i]
    const p = pivotOf(i)
    const [base, max] = REACH[kind]
    const id = kind === 'ant' ? 'braccio-ant' : 'braccio-post'
    const pivot = new THREE.Group()
    pivot.position.set(p.x, 0, p.z)
    pivot.rotation.y = parkedPsi(i)
    this.carriage[s < 0 ? 0 : 1].add(pivot)
    // tubo esterno, lungo il braccio (asse +x del perno)
    const outerEnd = base - 0.1
    const g = this.piece(id, [0.4, 0, 0], pivot)
    this.mesh(g, new RoundedBoxGeometry(outerEnd + 0.06, ARM_Y1 - ARM_Y0, 0.11, 2, 0.01).translate((outerEnd - 0.06) / 2, (ARM_Y0 + ARM_Y1) / 2, 0), BLUE)
    // protezione piedi in testa al tubo esterno
    this.mesh(this.piece('protezioni', [0.4, 0, 0], pivot), box(0.03, ARM_Y1 - ARM_Y0 + 0.01, 0.12, outerEnd - 0.005, (ARM_Y0 + ARM_Y1) / 2, 0), LOOK.yellow)
    // blocco anti-rotazione: settore dentato sul braccio e nottolino sul carrello
    const lock = this.piece('blocco', [0, 0.25, 0], pivot)
    this.mesh(lock, sector(0.075, 28).translate(0, ARM_Y1 + 0.001, 0), LOOK.steel)
    const pawl = new THREE.Group()
    pawl.userData.part = 'blocco'
    pivot.parent!.add(pawl)
    const toward = new THREE.Vector3(s * (XC - CW / 2 - 0.11) - p.x, 0, 0).normalize()
    this.mesh(pawl, box(0.05, 0.012, 0.03, p.x + toward.x * 0.1, ARM_Y1 + 0.0075, p.z), LOOK.dark)
    // tubo interno che si sfila
    const slide = new THREE.Group()
    pivot.add(slide)
    const innerStart = outerEnd - 0.07 - (max - base)
    const ig = this.piece(id, [0.4, 0, 0], slide)
    this.mesh(ig, box(base + 0.06 - innerStart, ARM_Y1 - ARM_Y0 - 0.016, 0.085, (innerStart + base + 0.06) / 2, (ARM_Y0 + ARM_Y1) / 2, 0), LOOK.dark)
    // tampone: tazza sul tubo interno e vite regolabile con il disco di gomma
    const cup = this.piece('tampone', [0.4, 0.2, 0], slide)
    this.mesh(cup, new THREE.CylinderGeometry(0.055, 0.055, 0.03, 28).translate(base, ARM_Y1 + 0.015, 0), LOOK.dark)
    const pad = new THREE.Group()
    slide.add(pad)
    const pg = this.piece('tampone', [0.4, 0.3, 0], pad)
    this.mesh(pg, new THREE.CylinderGeometry(0.026, 0.026, 0.1, 20).translate(base, PAD0 - 0.07, 0), LOOK.steel)
    this.mesh(pg, new THREE.CylinderGeometry(0.06, 0.062, 0.02, 32).translate(base, PAD0 - 0.01, 0), LOOK.rubber)
    this.arms.push({ pivot, slide, pad, pawl })
  }

  // ---------- auto ----------

  setCar(c: Auto | null) {
    if (this.carG) {
      this.carMove.remove(this.carG)
      this.carG.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
      const p = this.parts.get('auto')!
      p.pieces = []
      p.mats = []
    }
    this.carG = null
    this.wheels = []
    this.auto = c
    this.shape = null
    if (!c) return
    const g = this.piece('auto', [0, 0, 6], this.carMove)
    this.carG = g
    const own = (look: Look, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
      const m = new THREE.MeshStandardMaterial({ color: look.c, metalness: look.m, roughness: look.r, ...extra })
      this.part('auto').mats.push(m)
      return m
    }
    const paint = own({ c: c.id === 'suv' ? 0x3c5a4a : c.id === 'posteriore' ? 0xd9682b : 0x9aa3ad, m: 0.55, r: 0.35, h: 0 })
    const glass = own({ c: 0x18222c, m: 0.3, r: 0.12, h: 0 })
    const tyre = own(LOOK.rubber), rim = own(LOOK.alu)
    const P = profilo(c)
    const yb = cintura(c)
    const W = c.larghezza
    const ext = (pts: [number, number][], w: number, m: THREE.Material) => {
      const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)))
      const geo = new THREE.ExtrudeGeometry(sh, { depth: w - 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelOffset: -0.02, bevelSegments: 2, curveSegments: 12 })
      geo.rotateY(Math.PI / 2).translate(-(w - 0.04) / 2, 0, 0)
      const mesh = new THREE.Mesh(geo, m)
      g.add(mesh)
      return mesh
    }
    // carrozzeria fino alla linea di cintura, con i passaruota; sopra, la cabina vetrata e il tetto
    // le tre fasce non si toccano sulle stesse quote: niente facce sovrapposte che sfarfallano
    ext(passaruota(clip(P, yb, false), c), W, paint)
    ext(clip(clip(P, yb + 0.003, true), c.altezza - 0.053, false), W - 0.1, glass)
    ext(clip(P, c.altezza - 0.05, true), W - 0.08, paint)
    // ruote
    for (const sx of [-1, 1]) for (const za of [-c.a, c.passo - c.a]) {
      const wg = new THREE.Group()
      wg.position.set(sx * c.carreggiata / 2, c.ruotaR, za)
      g.add(wg)
      const r = c.ruotaR, hw = c.ruotaL / 2, rr = r * 0.62
      wg.add(new THREE.Mesh(revolveX([[rr, -hw], [r - 0.03, -hw], [r, -hw + 0.03], [r, hw - 0.03], [r - 0.03, hw], [rr, hw]], 40), tyre))
      wg.add(new THREE.Mesh(revolveX([[0, -hw + 0.02], [rr, -hw + 0.02], [rr, hw - 0.02], [0, hw - 0.02]], 32), rim))
      for (let k = 0; k < 5; k++) {
        const sp = new THREE.Mesh(box(0.02, rr * 1.9, 0.035, sx * (hw - 0.01), 0, 0), rim)
        sp.rotation.x = (k / 5) * Math.PI
        wg.add(sp)
      }
      this.wheels.push(wg)
    }
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.userData.part = 'auto' })
    this.shape = carShape(c, P, g)
  }

  /** Forma dell'auto per il controllo di compenetrazione (sagoma piena e ruote). */
  carShapes(): Shape[] { return this.shape ? [this.shape] : [] }

  isCarOrMarker(o: THREE.Object3D) {
    return o === this.carMove || !!o.userData.noPick || !!o.userData.noClash || o.type === 'ArrowHelper'
  }

  // ---------- posa ----------

  setPose(p: Pose) {
    for (let i = 0; i < 2; i++) {
      this.carriage[i].position.y = p.h[i] - p.drop[i]
      this.safety[i].position.y = p.h[i]
      this.screws[i].rotation.y = p.screw[i]
      // pignone (12 denti) contro ingranaggio (30): gira 2,5 volte più veloce, al contrario
      this.pinions[i].rotation.y = -p.screw[i] * SPEC.rapportoIngranaggi
      this.motorPulleys[i].rotation.y = -p.screw[i] * SPEC.rapportoIngranaggi * SPEC.rapportoCinghia
      const on = p.sicurezza === i
      this.safetyMats[i].emissive.setHex(on ? 0xffb21e : 0)
      this.safetyMats[i].emissiveIntensity = on ? 0.6 : 0
    }
    p.arms.forEach((a, i) => {
      const arm = this.arms[i]
      arm.pivot.rotation.y = a.psi
      arm.slide.position.x = a.ext
      arm.pad.position.y = a.e
      arm.pawl.position.set(0, 0, 0)
      arm.pawl.children[0].position.x = p.locked ? 0 : -ARMS[i].s * 0.03
    })
    for (const k of ['su', 'giu', 'stop'] as const) this.buttons[k].position.z = CD / 2 + 0.006 + 0.1 - (p.pressed[k] ? 0.012 : 0)
    this.barG.rotation.x = -p.barra * 0.15
    this.cables([p.h[0] - p.drop[0], p.h[1] - p.drop[1]])
    if (p.car && this.auto) {
      this.carMove.visible = true
      this.carMove.position.set(0, p.car.y, p.car.z)
      this.carMove.rotation.z = p.car.roll
      for (const w of this.wheels) w.rotation.x = p.car.wheels
    } else this.carMove.visible = false
  }

  /** Inquadratura di una parte: il suo ingombro com'è adesso, con un po' di margine attorno. */
  viewOf(id: string) {
    const p = this.parts.get(id)
    if (!p) return null
    const b = new THREE.Box3()
    this.root.updateMatrixWorld(true)
    for (const pc of p.pieces) pc.obj.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.noPick) b.expandByObject(o) })
    if (b.isEmpty()) return null
    const size = b.getSize(new THREE.Vector3())
    return { target: b.getCenter(new THREE.Vector3()).toArray() as [number, number, number], halfWidth: Math.min(Math.max(Math.max(size.x, size.y) * 0.6 + 0.15, 0.3), 3.2) }
  }

  /** Frecce dei carichi sui tamponi (N), in rosso se oltre il massimo del braccio. */
  setArrows(on: boolean, forces: number[], max: number) {
    this.root.updateMatrixWorld(true)
    this.arrows.forEach((a, i) => {
      a.visible = on && forces[i] > 1
      if (!a.visible) return
      const pad = this.arms[i].pad
      const at = new THREE.Vector3(REACH[ARMS[i].kind][0], PAD0 + 0.02, 0)
      pad.localToWorld(at)
      const len = 0.15 + (forces[i] / (max * 9.81)) * 0.45
      a.position.copy(at).add(new THREE.Vector3(0, len, 0))
      a.setDirection(new THREE.Vector3(0, -1, 0))
      a.setLength(len, 0.07, 0.045)
      a.setColor(forces[i] > max * 9.81 ? 0xff4d3d : 0xffb21e)
    })
  }
}

// ---------- geometrie ----------

/** Solido di rivoluzione attorno all'asse y (profilo r, y). */
function revolveY(profile: RX[], seg = 40) {
  return revolveX(profile, seg).rotateZ(Math.PI / 2)
}

/** Filetto della vite: tubo lungo un'elica di passo p attorno a y. */
function helix(r: number, p: number, y0: number, len: number, t: number) {
  const turns = len / p
  const n = Math.ceil(turns * 10)
  const pts: THREE.Vector3[] = []
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * turns * Math.PI * 2
    pts.push(new THREE.Vector3(Math.cos(a) * r, y0 + (k / n) * len, Math.sin(a) * r))
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, t, 4, false)
}

/** Ruota dentata piana (asse y). */
function gearGeo({ teeth, r, t }: Gear) {
  const s = new THREE.Shape()
  const h = r * 0.12 + 0.004
  for (let k = 0; k < teeth; k++) {
    const a0 = (k / teeth) * Math.PI * 2, da = (Math.PI * 2) / teeth
    const pts: [number, number][] = [[r - h, a0], [r + h, a0 + da * 0.2], [r + h, a0 + da * 0.45], [r - h, a0 + da * 0.65]]
    pts.forEach(([rr, a], j) => (k === 0 && j === 0 ? s.moveTo(rr * Math.cos(a), rr * Math.sin(a)) : s.lineTo(rr * Math.cos(a), rr * Math.sin(a))))
  }
  s.closePath()
  const hole = new THREE.Path()
  hole.absarc(0, 0, Math.min(0.012, r * 0.4), 0, Math.PI * 2, true)
  s.holes.push(hole)
  // razze: quattro finestre sulle ruote grandi, così la rotazione si vede
  if (r > 0.04) for (let k = 0; k < 4; k++) {
    const w = new THREE.Path()
    const a = (k / 4) * Math.PI * 2
    w.absarc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.17, 0, Math.PI * 2, true)
    s.holes.push(w)
  }
  return new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 6 }).rotateX(-Math.PI / 2).translate(0, -t / 2, 0)
}

/** Puleggia con le razze (asse y). */
function pulley(r: number) {
  const s = new THREE.Shape()
  s.absarc(0, 0, r, 0, Math.PI * 2, false)
  const hole = new THREE.Path()
  hole.absarc(0, 0, 0.012, 0, Math.PI * 2, true)
  s.holes.push(hole)
  for (let k = 0; k < 3; k++) {
    const w = new THREE.Path()
    const a = (k / 3) * Math.PI * 2
    w.absarc(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.22, 0, Math.PI * 2, true)
    s.holes.push(w)
  }
  return new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: false, curveSegments: 24 }).rotateX(-Math.PI / 2).translate(0, -0.0175, 0)
}

/** Cinghia piana tra due pulegge nel piano orizzontale y = yy (tangenti esterne). */
function beltXZ(x1: number, r1: number, x2: number, r2: number, yy: number) {
  const c1 = new THREE.Vector2(x1, 0), c2 = new THREE.Vector2(x2, 0)
  const d = c2.clone().sub(c1)
  const L = d.length(), base = Math.atan2(d.y, d.x), beta = Math.acos((r1 - r2) / L)
  const pts: THREE.Vector3[] = []
  const arc = (c: THREE.Vector2, r: number, a0: number, a1: number, n: number) => {
    for (let k = 0; k <= n; k++) {
      const a = a0 + ((a1 - a0) * k) / n
      pts.push(new THREE.Vector3(c.x + Math.cos(a) * (r + 0.004), yy, c.y + Math.sin(a) * (r + 0.004)))
    }
  }
  arc(c1, r1, base + beta, base + Math.PI * 2 - beta, 30)
  arc(c2, r2, base - beta, base + beta, 20)
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'centripetal'), 120, 0.005, 6, true)
}

/** Settore dentato del blocco anti-rotazione (asse y, sul perno). */
function sector(r: number, teeth: number) {
  const s = new THREE.Shape()
  const a0 = -Math.PI * 0.75, a1 = Math.PI * 0.75
  s.moveTo(0, 0)
  for (let k = 0; k <= teeth; k++) {
    const a = a0 + ((a1 - a0) * k) / teeth
    const rr = k % 2 ? r : r - 0.008
    s.lineTo(rr * Math.cos(a), rr * Math.sin(a))
  }
  s.closePath()
  return new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false }).rotateX(-Math.PI / 2)
}

/** I pezzi interni alle colonne non possono toccare l'auto: il controllo li salta. */
function noClash(o: THREE.Object3D) {
  o.traverse((c) => (c.userData.noClash = true))
}

// ---------- auto generica ----------

/** Linea di cintura: sotto la carrozzeria, sopra la cabina vetrata. */
const cintura = (c: Auto) => c.sottoscocca + 0.62 * (c.altezza - c.sottoscocca)

/** Sagoma laterale dell'auto (z, y) nel suo sistema, muso verso −z, senza passaruota. */
function profilo(c: Auto): [number, number][] {
  const zF = -c.a - c.sbalzo, zR = zF + c.lunghezza, y0 = c.sottoscocca, H = c.altezza, L = c.lunghezza
  const yb = cintura(c)
  const suv = c.id === 'suv'
  const cofano = y0 + (suv ? 0.6 : 0.52) * (H - y0)
  const zW0 = zF + (suv ? 0.27 : 0.3) * L, zW1 = zW0 + (suv ? 0.5 : 0.62)
  const zT1 = zR - (suv ? 0.2 : c.id === 'posteriore' ? 0.95 : 0.85)
  const zD = zR - (suv ? 0.12 : 0.42)
  const coda = suv ? H - 0.12 : yb + 0.04
  return [
    [zF + 0.12, y0], [zR - 0.12, y0], [zR - 0.03, y0 + 0.12], [zR, y0 + 0.3], [zR + 0.01, coda - 0.08], [zR - 0.02, coda],
    [zD, coda + 0.01], [zT1, H - 0.02], [zT1 - 0.15, H], [zW1 + 0.1, H], [zW1, H - 0.03], [zW0, yb + 0.02],
    [zF + 0.25, cofano], [zF + 0.03, cofano - 0.06], [zF, y0 + 0.3], [zF + 0.03, y0 + 0.12],
  ]
}

/** Parte del poligono sopra (above) o sotto la quota y (Sutherland–Hodgman). */
function clip(P: [number, number][], y: number, above: boolean): [number, number][] {
  const inside = (p: [number, number]) => (above ? p[1] >= y : p[1] <= y)
  const out: [number, number][] = []
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length]
    if (inside(a)) out.push(a)
    if (inside(a) !== inside(b)) {
      const t = (y - a[1]) / (b[1] - a[1])
      out.push([a[0] + (b[0] - a[0]) * t, y])
    }
  }
  return out
}

/** Aggiunge i passaruota al bordo inferiore della carrozzeria. */
function passaruota(P: [number, number][], c: Auto): [number, number][] {
  const out: [number, number][] = []
  const y0 = P[0][1]
  const rA = c.ruotaR + 0.035
  const axles = [c.passo - c.a, -c.a]
  // il primo lato va da davanti a dietro lungo il fondo: si inseriscono gli archi in ordine di z
  out.push(P[0])
  for (const za of [...axles].sort((a, b) => a - b)) {
    const dy = c.ruotaR - y0
    if (dy >= rA) continue
    const half = Math.sqrt(rA * rA - dy * dy)
    const a0 = Math.atan2(y0 - c.ruotaR, -half), a1 = Math.atan2(y0 - c.ruotaR, half)
    for (let k = 0; k <= 16; k++) {
      const a = a0 - ((a0 - (a1 - Math.PI * 2)) * k) / 16
      out.push([za + Math.cos(a) * rA, c.ruotaR + Math.sin(a) * rA])
    }
  }
  for (let i = 1; i < P.length; i++) out.push(P[i])
  return out
}

/** Distanza con segno dal contorno di un poligono (positiva dentro). */
function polyDepth(P: [number, number][], u: number, v: number) {
  let inside = false, d2 = Infinity
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [ui, vi] = P[i], [uj, vj] = P[j]
    if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) inside = !inside
    const du = uj - ui, dv = vj - vi, L = du * du + dv * dv
    const t = L > 0 ? Math.max(0, Math.min(1, ((u - ui) * du + (v - vi) * dv) / L)) : 0
    d2 = Math.min(d2, (ui + t * du - u) ** 2 + (vi + t * dv - v) ** 2)
  }
  return inside ? Math.sqrt(d2) : -Math.sqrt(d2)
}

/** L'auto per il controllo di compenetrazione: sagoma piena (senza passaruota) larga quanto l'auto, più le quattro ruote. */
function carShape(c: Auto, P: [number, number][], frame: THREE.Object3D): Shape {
  const W = c.larghezza / 2
  const zs = P.map((p) => p[0])
  const wheels = [-1, 1].flatMap((sx) => [-c.a, c.passo - c.a].map((za) => ({ x: (sx * c.carreggiata) / 2, z: za })))
  return {
    name: 'auto',
    frame,
    bounds: new THREE.Box3(new THREE.Vector3(-W - 0.05, 0, Math.min(...zs) - 0.05), new THREE.Vector3(W + 0.05, c.altezza + 0.02, Math.max(...zs) + 0.05)),
    depth(x, y, z) {
      let d = -1
      const dx = W - Math.abs(x)
      if (dx > 0) {
        const dp = polyDepth(P, z, y)
        if (dp > 0) d = Math.min(dx, dp)
      }
      for (const w of wheels) {
        const dw = c.ruotaL / 2 - Math.abs(x - w.x), dr = c.ruotaR - Math.hypot(y - c.ruotaR, z - w.z)
        if (dw > 0 && dr > 0) d = Math.max(d, Math.min(dw, dr))
      }
      return d
    },
  }
}

export { puntiAuto }
