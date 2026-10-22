/**
 * Fisica dell'equilibratrice.
 *
 * Uno squilibrio è un vettore U = m·r (kg·m) che gira con la ruota: a velocità
 * angolare ω genera una forza centrifuga F = U·ω². I vettori sono numeri
 * complessi nel sistema della ruota (parte reale = verso l'alto a ruota ferma,
 * immaginaria = verso l'operatore).
 *
 * L'albero è una trave su due appoggi, i sensori A e B. Dalle due forze misurate
 * la macchina risale a due squilibri, uno per piano di correzione del cerchio
 * (interno ed esterno): è l'equilibratura dinamica su due piani.
 */

export interface C { re: number; im: number }
export const cx = (re = 0, im = 0): C => ({ re, im })
export const add = (a: C, b: C): C => cx(a.re + b.re, a.im + b.im)
export const sub = (a: C, b: C): C => cx(a.re - b.re, a.im - b.im)
export const scale = (a: C, k: number): C => cx(a.re * k, a.im * k)
export const abs = (a: C) => Math.hypot(a.re, a.im)
export const arg = (a: C) => Math.atan2(a.im, a.re)
export const polar = (m: number, a: number): C => cx(m * Math.cos(a), m * Math.sin(a))

export interface WheelSpec {
  id: string
  /** Misura come scritta sul fianco, es. 205/55 R16. */
  label: string
  tireWidth: number // mm
  aspect: number // %
  rimInch: number
  rimWidthInch: number
  /** Massa ruota completa, kg (indicativa). */
  mass: number
  /** Raggio d'inerzia, m (indicativo). */
  gyration: number
  /** Offset del cerchio ET, m. */
  et: number
}

export const WHEELS: WheelSpec[] = [
  { id: 's', label: '175/65 R14', tireWidth: 175, aspect: 65, rimInch: 14, rimWidthInch: 5.5, mass: 14, gyration: 0.21, et: 0.035 },
  { id: 'm', label: '205/55 R16', tireWidth: 205, aspect: 55, rimInch: 16, rimWidthInch: 6.5, mass: 19, gyration: 0.23, et: 0.045 },
  { id: 'l', label: '225/40 R18', tireWidth: 225, aspect: 40, rimInch: 18, rimWidthInch: 8, mass: 22, gyration: 0.25, et: 0.045 },
]

/** Dimensioni geometriche ricavate dalla sigla del pneumatico (norma ETRTO). */
export function wheelGeometry(w: WheelSpec) {
  const rimR = (w.rimInch * 0.0254) / 2
  const width = w.rimWidthInch * 0.0254
  const tireR = rimR + (w.tireWidth / 1000) * (w.aspect / 100)
  return { rimR, width, tireR, tireW: w.tireWidth / 1000 }
}

/** Posizioni lungo l'albero (m, x = 0 sul fianco del mobile). */
export const LAYOUT = {
  sensorA: -0.3,
  sensorB: -0.1,
  flangeFace: 0.22,
}

/** Parametri della macchina: tutti valori indicativi, non presi da una scheda tecnica. */
export const MACHINE = {
  rpmMeasure: 200,
  beltRatio: 0.08 / 0.03,
  motorStallTorque: 3.0, // N·m all'albero motore
  motorNoLoadRpm: 1450,
  viscous: 0.02, // N·m·s
  coulomb: 0.15, // N·m
  rotorInertia: 0.03, // kg·m² (albero, flangia, puleggia)
  measureRevs: 8,
  roundTo: 5, // g
  threshold: 5, // g, sotto questo valore il display mostra OK
  noise: 0.015, // N, rumore dei sensori
}

export interface Weight { plane: 'int' | 'est'; grams: number; angle: number }

export class Balancer {
  spec = WHEELS[1]
  geo = wheelGeometry(this.spec)
  /** Squilibrio della ruota sui due piani, kg·m. */
  base = { int: cx(), est: cx() }
  weights: Weight[] = []

  angle = 0 // rad, posizione della ruota (encoder)
  omega = 0 // rad/s
  motor: 'off' | 'run' | 'brake' = 'off'
  torque = 0

  setWheel(spec: WheelSpec, xInner: number) {
    this.spec = spec
    this.geo = wheelGeometry(spec)
    this.xInner = xInner
    this.randomize()
  }
  xInner = 0.09

  get xOuter() { return this.xInner + this.geo.width }
  /** Raggio dei pesi a molla sulle balconate del cerchio. */
  get rWeight() { return this.geo.rimR + 0.012 }
  get inertia() { return this.spec.mass * this.spec.gyration ** 2 + MACHINE.rotorInertia }

  randomize() {
    const g = () => 0.01 + Math.random() * 0.06 // 10..70 g
    this.base.int = polar(g() * this.rWeight, Math.random() * Math.PI * 2)
    this.base.est = polar(g() * this.rWeight, Math.random() * Math.PI * 2)
    this.weights = []
  }

  /** Squilibrio totale per piano, compresi i pesi applicati. */
  total(plane: 'int' | 'est') {
    let u = this.base[plane]
    for (const w of this.weights) if (w.plane === plane) u = add(u, polar((w.grams / 1000) * this.rWeight, w.angle))
    return u
  }

  /** Forze trasmesse ai due sensori (fasori nel sistema ruota), N. */
  sensorForces(omega = this.omega) {
    const w2 = omega * omega
    const ui = this.total('int'), uo = this.total('est')
    const { sensorA: xa, sensorB: xb } = LAYOUT
    const L = xb - xa
    const fb = scale(add(scale(ui, this.xInner - xa), scale(uo, this.xOuter - xa)), w2 / L)
    const fa = sub(scale(add(ui, uo), w2), fb)
    return { fa, fb }
  }

  /** Segnale istantaneo dei sensori: componente orizzontale della forza + rumore. */
  signals() {
    const { fa, fb } = this.sensorForces()
    const c = Math.cos(this.angle), s = Math.sin(this.angle)
    const n = () => (Math.random() + Math.random() + Math.random() - 1.5) * MACHINE.noise * 2
    return { a: fa.re * s + fa.im * c + n(), b: fb.re * s + fb.im * c + n() }
  }

  /** Coppia del motore asincrono riportata alla ruota (caratteristica lineare semplificata). */
  private motorTorque() {
    const k = MACHINE.beltRatio
    const wm = this.omega * k
    const wm0 = (MACHINE.motorNoLoadRpm * Math.PI) / 30
    const t0 = MACHINE.motorStallTorque
    if (this.motor === 'run') {
      const target = (MACHINE.rpmMeasure * Math.PI) / 30
      const avail = t0 * Math.max(0, 1 - wm / wm0) * k
      // Regolazione: piena coppia fino alla velocità di misura, poi solo quanto basta.
      const hold = MACHINE.coulomb + MACHINE.viscous * this.omega + (target - this.omega) * 40
      return Math.max(0, Math.min(avail, hold))
    }
    if (this.motor === 'brake') return this.omega > 0.05 ? -t0 * k : 0
    return 0
  }

  step(dt: number) {
    this.torque = this.motorTorque()
    const fr = this.omega > 0 ? MACHINE.coulomb + MACHINE.viscous * this.omega : 0
    let a = (this.torque - fr) / this.inertia
    if (this.motor !== 'run' && this.omega <= 0) a = 0
    this.omega = Math.max(0, this.omega + a * dt)
    this.angle += this.omega * dt
  }
}

/** Demodulazione sincrona: ricava ampiezza e fase dei segnali usando l'angolo dell'encoder. */
export class Demod {
  private sa = cx(); private sb = cx(); private n = 0
  reset() { this.sa = cx(); this.sb = cx(); this.n = 0 }
  push(a: number, b: number, angle: number) {
    const s = Math.sin(angle), c = Math.cos(angle)
    this.sa.re += a * s; this.sa.im += a * c
    this.sb.re += b * s; this.sb.im += b * c
    this.n++
  }
  result() {
    const k = this.n ? 2 / this.n : 0
    return { fa: scale(this.sa, k), fb: scale(this.sb, k) }
  }
}

export interface Result {
  int: { grams: number; angle: number; shown: number }
  est: { grams: number; angle: number; shown: number }
  staticG: number
  fa: number
  fb: number
}

/** Dalle forze misurate ai pesi di correzione: si risolve il sistema della trave su due appoggi. */
export function solve(b: Balancer, fa: C, fb: C, omega: number): Result {
  const w2 = omega * omega
  const { sensorA: xa, sensorB: xb } = LAYOUT
  const S = scale(add(fa, fb), 1 / w2)
  const M = scale(add(scale(fa, xa), scale(fb, xb)), 1 / w2)
  const uo = scale(sub(M, scale(S, b.xInner)), 1 / (b.xOuter - b.xInner))
  const ui = sub(S, uo)
  const corr = (u: C) => {
    const grams = (abs(u) / b.rWeight) * 1000
    const r = Math.round(grams / MACHINE.roundTo) * MACHINE.roundTo
    return { grams, angle: arg(u) + Math.PI, shown: grams < MACHINE.threshold ? 0 : Math.max(r, MACHINE.roundTo) }
  }
  return { int: corr(ui), est: corr(uo), staticG: (abs(S) / b.rWeight) * 1000, fa: abs(fa), fb: abs(fb) }
}
