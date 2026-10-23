import { Balancer, Demod, MACHINE, Result, WheelSpec, solve, abs } from './physics'
import { DisplayState } from './display'

export type Stato = 'pronto' | 'rilievo' | 'carter' | 'lancio' | 'misura' | 'frenata' | 'risultato' | 'posiziona' | 'gira'

const GUARD_UP = -1.7
const TAU = Math.PI * 2
const wrap = (a: number) => a - TAU * Math.round(a / TAU)

/** Ciclo di lavoro dell'equilibratrice: rilievo, lancio, misura, frenata, posizionamento pesi. */
export class Controller {
  readonly b = new Balancer()
  private demod = new Demod()
  stato: Stato = 'pronto'
  messaggio = 'Premi Avvia misura'
  result: Result | null = null
  /** Valore reale simulato al momento della misura, per il confronto. */
  vero: { int: number; est: number } | null = null

  guard = GUARD_UP
  guardTarget = GUARD_UP
  /** Estensione del calibro, m. */
  cal = 0
  private calTarget = 0
  private calHold = 0
  private stable = 0
  private startAngle = 0
  private omegaSum = 0
  private omegaN = 0
  private queue: { plane: 'int' | 'est'; grams: number; angle: number }[] = []
  private posTarget: number | null = null
  private posVel = 0
  private posWait = 0
  /** Stato a cui tornare dopo una rotazione a mano (gira) e cosa fare all'arrivo. */
  private after: { stato: Stato; done: () => void } | null = null
  /** Piano che si sta posizionando, per l'indicatore del display. */
  posPlane: 'int' | 'est' | null = null

  /** Campioni per l'oscilloscopio (sensore A e B). */
  readonly scopeA = new Float32Array(200)
  readonly scopeB = new Float32Array(200)
  scopeHead = 0
  private scopeTick = 0
  onWeights: () => void = () => {}

  get busy() { return this.stato !== 'pronto' && this.stato !== 'risultato' }
  get spinning() { return this.b.omega > 0.01 || this.b.motor !== 'off' }

  setWheel(spec: WheelSpec, xInner: number) {
    if (this.busy) return false
    this.b.setWheel(spec, xInner)
    this.result = null
    this.vero = null
    this.rilievo()
    return true
  }

  newWheel() {
    if (this.busy) return false
    this.b.randomize()
    this.result = null
    this.vero = null
    this.onWeights()
    this.rilievo()
    return true
  }

  private rilievo() {
    this.stato = 'rilievo'
    this.messaggio = 'Il calibro rileva distanza e diametro'
    this.calTarget = this.b.xInner + 0.008 - 0.03
    this.calHold = 0.6
  }

  /** Gira la ruota a mano finché il punto all'angolo psi (sistema della ruota) è a ore 12. */
  turnTo(psi: number, msg: string, done: () => void) {
    if (this.busy) return false
    this.guardTarget = GUARD_UP
    this.after = { stato: this.stato, done }
    this.stato = 'gira'
    this.posTarget = this.b.angle + wrap(-psi - this.b.angle)
    this.posVel = 0
    this.messaggio = msg
    return true
  }

  measure() {
    if (this.busy) return
    this.result = null
    this.stato = 'carter'
    this.messaggio = 'Carter abbassato: avvio'
    this.guardTarget = 0
  }

  toggleGuard() {
    if (this.stato === 'lancio' || this.stato === 'misura') {
      // Alzare il carter durante il lancio frena la ruota.
      this.guardTarget = GUARD_UP
      this.b.motor = 'brake'
      this.stato = 'frenata'
      this.messaggio = 'Carter alzato: misura interrotta'
      this.result = null
      return
    }
    if (this.busy) return
    this.guardTarget = this.guardTarget === 0 ? GUARD_UP : 0
  }

  applyWeights() {
    if (!this.result || this.busy) return
    this.queue = []
    for (const plane of ['int', 'est'] as const) {
      const r = this.result[plane]
      if (r.shown > 0) this.queue.push({ plane, grams: r.shown, angle: r.angle })
    }
    if (!this.queue.length) return
    this.guardTarget = GUARD_UP
    this.nextWeight()
  }

  private nextWeight() {
    const q = this.queue[0]
    if (!q) {
      this.stato = 'pronto'
      this.posPlane = null
      this.posTarget = null
      this.result = null
      this.messaggio = 'Pesi applicati: rilancia per verificare'
      return
    }
    this.stato = 'posiziona'
    this.posPlane = q.plane
    // Il peso va a ore 12: la ruota deve girare finché il suo angolo non è in alto.
    this.posTarget = this.b.angle + wrap(-q.angle - this.b.angle)
    this.posWait = 0.45
    this.messaggio = `Posizionamento ${q.plane === 'int' ? 'interno' : 'esterno'}: ${q.grams} g a ore 12`
  }

  /** Avanza la simulazione. Restituisce true se qualcosa si muove. */
  update(dt: number): boolean {
    let moving = false

    // carter
    if (this.guard !== this.guardTarget) {
      const d = this.guardTarget - this.guard
      const s = Math.sign(d) * Math.min(Math.abs(d), dt * 3.2)
      this.guard += s
      moving = true
    } else if (this.stato === 'carter') {
      this.b.motor = 'run'
      this.stato = 'lancio'
      this.messaggio = 'Lancio fino a ' + MACHINE.rpmMeasure + ' giri/min'
      this.stable = 0
    }

    // calibro
    if (this.stato === 'rilievo') {
      moving = true
      const d = this.calTarget - this.cal
      if (Math.abs(d) > 1e-4) this.cal += Math.sign(d) * Math.min(Math.abs(d), dt * 0.35)
      else if (this.calTarget > 0) {
        this.calHold -= dt
        if (this.calHold <= 0) this.calTarget = 0
      } else {
        this.cal = 0
        this.stato = 'pronto'
        this.messaggio = 'Dati ruota acquisiti: premi Avvia misura'
      }
    }

    // fisica a passo fisso
    if (this.spinning || this.stato === 'lancio') {
      moving = true
      const h = 1 / 600
      const n = Math.min(Math.ceil(dt / h), 60)
      for (let i = 0; i < n; i++) this.physicsStep(h)
    }

    // rotazione a mano fino a ore 12
    if (this.stato === 'gira' && this.posTarget !== null) {
      moving = true
      const e = this.posTarget - this.b.angle
      const k = 28
      this.posVel += (k * e - 2 * Math.sqrt(k) * this.posVel) * dt
      this.b.angle += this.posVel * dt
      if (Math.abs(e) < 0.003 && Math.abs(this.posVel) < 0.02) {
        this.b.angle = this.posTarget
        this.posVel = 0
        this.posTarget = null
        const a = this.after!
        this.after = null
        this.stato = a.stato
        a.done()
      }
    }

    // posizionamento
    if (this.stato === 'posiziona' && this.posTarget !== null) {
      moving = true
      const e = this.posTarget - this.b.angle
      // molla smorzata criticamente
      const k = 28
      this.posVel += (k * e - 2 * Math.sqrt(k) * this.posVel) * dt
      this.b.angle += this.posVel * dt
      if (Math.abs(e) < 0.003 && Math.abs(this.posVel) < 0.02) {
        this.b.angle = this.posTarget
        this.posVel = 0
        this.posWait -= dt
        if (this.posWait <= 0) {
          const q = this.queue.shift()!
          this.b.weights.push({ plane: q.plane, grams: q.grams, angle: q.angle })
          this.onWeights()
          this.posWait = 0.45
          this.posTarget = null
        }
      }
    } else if (this.stato === 'posiziona') {
      // breve pausa dopo aver messo il peso, poi il piano successivo
      moving = true
      this.posWait -= dt
      if (this.posWait <= 0) this.nextWeight()
    }
    return moving
  }

  private physicsStep(h: number) {
    const b = this.b
    b.step(h)
    const sig = b.signals()
    if (++this.scopeTick % 4 === 0) {
      this.scopeA[this.scopeHead] = sig.a
      this.scopeB[this.scopeHead] = sig.b
      this.scopeHead = (this.scopeHead + 1) % this.scopeA.length
    }
    const target = (MACHINE.rpmMeasure * Math.PI) / 30
    if (this.stato === 'lancio') {
      this.stable = Math.abs(b.omega - target) / target < 0.02 ? this.stable + h : 0
      if (this.stable > 0.3) {
        this.stato = 'misura'
        this.messaggio = `Misura su ${MACHINE.measureRevs} giri`
        this.demod.reset()
        this.startAngle = b.angle
        this.omegaSum = 0
        this.omegaN = 0
      }
    } else if (this.stato === 'misura') {
      this.demod.push(sig.a, sig.b, b.angle)
      this.omegaSum += b.omega
      this.omegaN++
      if (b.angle - this.startAngle >= MACHINE.measureRevs * TAU) {
        const { fa, fb } = this.demod.result()
        this.result = solve(b, fa, fb, this.omegaSum / this.omegaN)
        const ui = b.total('int'), uo = b.total('est')
        this.vero = { int: (abs(ui) / b.rWeight) * 1000, est: (abs(uo) / b.rWeight) * 1000 }
        b.motor = 'brake'
        this.stato = 'frenata'
        this.messaggio = 'Frenata'
      }
    } else if (this.stato === 'frenata' && b.omega <= 0) {
      b.motor = 'off'
      this.guardTarget = GUARD_UP
      if (this.result) {
        this.stato = 'risultato'
        const ok = this.result.int.shown === 0 && this.result.est.shown === 0
        this.messaggio = ok ? 'Ruota equilibrata' : 'Applica i pesi indicati'
      } else {
        this.stato = 'pronto'
      }
    }
  }

  display(rimInch: number, widthInch: number): DisplayState {
    const r = this.result
    const fmt = (p: 'int' | 'est') => {
      if (!r) return '---'
      return r[p].shown === 0 ? 'OK' : String(r[p].shown)
    }
    const pos = (p: 'int' | 'est') => {
      if (!r || r[p].shown === 0 || this.spinning) return null
      if (this.stato === 'posiziona' && this.posPlane !== p) return null
      return wrap(this.b.angle + r[p].angle) / Math.PI
    }
    const status: Record<Stato, string> = {
      pronto: 'PRONTO', rilievo: 'RILIEVO DATI', carter: 'AVVIO', lancio: 'LANCIO',
      misura: 'MISURA', frenata: 'FRENATA', risultato: 'RISULTATO', posiziona: 'POSIZIONA', gira: 'SEGNI',
    }
    return {
      status: status[this.stato],
      int: fmt('int'),
      est: fmt('est'),
      posInt: pos('int'),
      posEst: pos('est'),
      rpm: (this.b.omega * 30) / Math.PI,
      a: this.b.xInner * 1000,
      b: widthInch,
      d: rimInch,
    }
  }
}
