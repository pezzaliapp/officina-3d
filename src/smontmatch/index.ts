import * as THREE from 'three'
import { Section } from '../core/section'
import { Machine, View, IND } from '../core/machine'
import { InterferenceCheck, Hit } from '../core/interference'
import { WHEELS, WheelSpec, wheelGeometry, tireHalfWidth } from '../core/wheel'
import { match, touch, turnFor, halfTurnMarks, Marks, MatchRequest, VALVE } from '../core/match'
import { num, setText } from '../ui'
import { nav } from '../core/nav'
import { PARTS } from './parts'
import { TireChangerModel, MATCH_FACE, MATCH_GAP, TT_Y, TT_Z, COL_P, BB_P, BLADE, BLADE_Y, BLADE_HALF, PAD_X, BB_LEVER, BB_ANCHOR, HOLD, JAW_LIP, JAW_TOP, HelperTool, Press } from './model'
import { SPEC, BAR, area, tireData, turntableTorque, jawForce, inflowRate, pressureRise, reduction } from './physics'

type Fase = 'pronta' | 'stallonata' | 'bloccata' | 'smontata' | 'montata' | 'ruotata' | 'gonfia'
type Co = Generator<void, void, number>
type Tool = 'rullo' | 'disco' | 'cono'
type Pose = { pos: THREE.Vector3; quat: THREE.Quaternion }
/** Stato del comando dello stallonatore. */
type BBMode = 'riposo' | 'avvicinamento' | 'spinta' | 'distacco' | 'ritorno' | 'arresto' | 'fermo'

const COL_BACK_TILT = -0.42
/** Corsa dell'asta: alzata, la testina passa sopra il pneumatico sfilato. */
const HEX_UP = 0.34
/** Quota in profondità dove la ruota in piedi può girare e alzarsi lontano dal mobile. */
const Z_CLEAR = 0.8
const Y = new THREE.Vector3(0, 1, 0)
const ease = (k: number) => k * k * (3 - 2 * k)
const lerp = THREE.MathUtils.lerp
const qY = (a: number) => new THREE.Quaternion().setFromAxisAngle(Y, a)
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
const PARK = { swing: 2.3, reach: 0.4, drop: HOLD }

/** Passi del ciclo con la fase da cui partono. */
const STEPS: { id: string; from: Fase; title: string; desc: string }[] = [
  { id: 'stallona', from: 'pronta', title: 'Stallonatura', desc: 'pulsantiera: lama sui due fianchi' },
  { id: 'blocca', from: 'stallonata', title: 'Bloccaggio', desc: 'cono di centraggio e griffe' },
  { id: 'smonta', from: 'bloccata', title: 'Smontaggio', desc: 'disco, rullo, leva e utensile' },
  { id: 'monta', from: 'smontata', title: 'Montaggio', desc: 'rullo e disco tengono il tallone nel canale' },
  { id: 'gonfia', from: 'montata', title: 'Gonfiaggio', desc: 'tallonamento e pressione finale' },
]
const ORDER: Fase[] = ['pronta', 'stallonata', 'bloccata', 'smontata', 'montata', 'gonfia']
/** Matching: il pneumatico gira sul cerchio senza essere smontato. */
const STEPS_M: typeof STEPS = [
  { id: 'stallona', from: 'pronta', title: 'Sgonfiaggio e stallonatura', desc: 'obice tolto, lama sui due fianchi' },
  { id: 'blocca', from: 'stallonata', title: 'Bloccaggio', desc: 'cono di centraggio e griffe' },
  { id: 'ruota', from: 'bloccata', title: 'Matching', desc: 'pneumatico fermo, il cerchio gira fino ai segni' },
  { id: 'gonfia', from: 'ruotata', title: 'Gonfiaggio', desc: 'tallonamento e pressione finale' },
]
const ORDER_M: Fase[] = ['pronta', 'stallonata', 'bloccata', 'ruotata', 'gonfia']
const deg = (a: number) => Math.round((a * 180) / Math.PI)
const stepList = (steps: typeof STEPS) => steps.map((s, i) => `<li><button data-step="${s.id}"><span class="n">${i + 1}</span><span>${s.title}<small>${s.desc}</small></span></button></li>`).join('')

const PANE = `
  <p data-id="messaggio" class="messaggio"></p>
  <div class="manometro">
    <div><small>Pneumatico</small><b data-id="pt">0,00 bar</b></div>
    <div><small>Forza lama</small><b data-id="fb">0,0 kN</b></div>
    <div><small>Piatto</small><b data-id="rpm">0 giri/min</b></div>
  </div>
  <label class="spunta"><input data-id="matching" type="checkbox" checked /> Matching: ruota il pneumatico sul cerchio</label>
  <div data-id="m-box" class="manometro due">
    <div><small>Angolo percorso</small><b data-id="m-ang">0°</b></div>
    <div><small>Rotazione richiesta</small><b data-id="m-req">180°</b></div>
  </div>
  <p data-id="m-info" class="legenda"></p>
  <ol data-id="passi" class="passi"></ol>
  <div class="riga"><button data-id="torna" class="primario">↩ Torna a EqMatch per la verifica</button></div>
  <div class="riga">
    <button data-id="ciclo" class="primario">▶ Ciclo completo</button>
    <button data-id="nuovo">Nuovo ciclo</button>
  </div>
  <p class="legenda">Pulsantiera dello stallonatore</p>
  <div class="riga">
    <button data-id="b-stallona">STALLONA</button>
    <button data-id="b-ritorno">RITORNO</button>
    <button data-id="b-arresto">ARRESTO</button>
  </div>
  <div class="riga">
    <label class="campo">Ruota <select data-id="ruota"></select></label>
  </div>
  <label class="spunta"><input data-id="helper" type="checkbox" checked /> Usa il braccio di aiuto</label>`

const TEXT = `
  <h3>Matching: il pneumatico gira sul cerchio</h3>
  <p>Per spostare il punto pesante del pneumatico rispetto a quello del cerchio non serve smontarlo: si sgonfia, si staccano i due talloni e si blocca il cerchio sul piatto con le griffe. Il disco premitallone del braccio di aiuto preme il fianco e il fermo per matching appoggia il pattino di gomma al battistrada: il pneumatico resta fermo. Il pedale fa girare il piatto, e con lui il cerchio, finché il segno giallo del cerchio arriva sul segno giallo del pneumatico. La rotazione relativa è la stessa: girare il cerchio di −δ sotto il pneumatico fermo equivale a girare il pneumatico di δ sul cerchio.</p>
  <p>L'angolo e i segni arrivano da EqMatch; se mancano, la macchina fa il mezzo giro della seconda misura (180°). Il fermo spinge con <code>F = p · A</code>: a 10 bar un alesaggio di 36 mm dà circa 1 kN sul battistrada.</p>
  <h3>Stallonatura: pulsantiera, elettrovalvola, cilindro</h3>
  <p>Lo stallonatore si comanda dalla pulsantiera sul fianco. STALLONA eccita una bobina dell'elettrovalvola, che manda aria alla camera di spinta del cilindro: il braccio avvicina la lama al fianco, poi la pressione sale finché il tallone si stacca. La centralina riconosce il distacco dallo scatto in avanti della lama, toglie corrente alla prima bobina ed eccita la seconda: l'aria va nella camera lato stelo e il braccio torna indietro. RITORNO fa tornare subito il braccio; ARRESTO toglie corrente a entrambe le bobine e l'elettrovalvola, al centro, scarica le due camere.</p>
  <h3>Forza sulla lama: pressione per area, poi leva</h3>
  <p>Il cilindro spinge con <code>F = p · A</code>: a 10 bar un alesaggio di 200 mm dà circa 31 kN. La forza arriva alla lama attraverso il braccio, che è una leva: vale l'equilibrio dei momenti attorno al perno, <code>F<sub>cil</sub> · b<sub>cil</sub> = F<sub>lama</sub> · b<sub>lama</sub></code>. Il braccio è a gomito: esce dal fianco dietro la ruota e corre in avanti fuori dal pneumatico, così solo la lama tocca il fianco, vicino alla balconata.</p>
  <h3>Smontaggio e montaggio: il canale del cerchio</h3>
  <p>Il tallone contiene un cerchietto d'acciaio che non si allunga. Per farlo passare sopra la balconata bisogna portare la parte opposta nel canale, dove il diametro è più piccolo: la "corda" che avanza basta a superare la balconata vicino all'utensile. Il braccio di aiuto fa proprio questo, tenendo il tallone nel canale col rullo e col disco mentre il piatto gira.</p>
  <h3>Rotazione: il riduttore</h3>
  <p>Cinghia e vite senza fine riducono la velocità del motore di circa 200 volte. La coppia al piatto è <code>C = η · P / ω</code>: con 1,1 kW, rendimento 55% e 14 giri/min sono circa 400 N·m.</p>
  <h3>Gonfiaggio: la legge dei gas</h3>
  <p>Il volume del pneumatico resta quasi costante, quindi a temperatura costante la pressione cresce in proporzione all'aria immessa: <code>dp = p<sub>atm</sub> · dV<sub>aria</sub> / V</code>. La portata cala man mano che la pressione nel pneumatico si avvicina a quella di linea. Il tallonamento avviene a bassa pressione: oltre il limite indicato non si va mai.</p>`

/** Compenetrazione registrata durante un passo del ciclo. */
export interface Clash extends Hit { wheel: string; step: string; msg: string }

/** Smontagomme con gli agganci per la verifica automatica del ciclo (tools/verifica.ts). */
export interface TireChanger extends Machine {
  readonly test: {
    setWheel(id: string): void
    setHelper(on: boolean): void
    /** Controllo di compenetrazione a ogni fotogramma invece che uno su tre. */
    checkEveryFrame(): void
    run(id: string): void
    /** Pulsanti della pulsantiera, come dal pannello. */
    button(id: 'stallona' | 'ritorno' | 'arresto'): void
    /** Modo matching (rotazione del pneumatico sul cerchio) invece del ciclo di smontaggio. */
    setMatching(on: boolean): void
    /** Rotazione del pneumatico sul cerchio fatta nell'ultimo matching, rad. */
    readonly turned: number
    readonly clashes: Clash[]
  }
}

/** Tolleranza del controllo di compenetrazione, m. */
const CLASH_TOL = 0.002
/** Nel browser il controllo di compenetrazione gira un fotogramma su tre. */
const CHECK_EVERY = 3

/** Posa lungo una spezzata di pose, con k da 0 a 1 in proporzione alla strada fatta (le rotazioni contano come strada). */
function posePath(poses: Pose[], k: number): Pose {
  const len = [0]
  for (let i = 1; i < poses.length; i++) len.push(len[i - 1] + poses[i].pos.distanceTo(poses[i - 1].pos) + 0.3 * poses[i].quat.angleTo(poses[i - 1].quat) + 1e-6)
  const at = THREE.MathUtils.clamp(k, 0, 1) * len[len.length - 1]
  let i = 1
  while (i < poses.length - 1 && len[i] < at) i++
  const t = (at - len[i - 1]) / (len[i] - len[i - 1])
  return { pos: poses[i - 1].pos.clone().lerp(poses[i].pos, t), quat: poses[i - 1].quat.clone().slerp(poses[i].quat, t) }
}
const pose = (x: number, y: number, z: number, q: THREE.Quaternion): Pose => ({ pos: new THREE.Vector3(x, y, z), quat: q.clone() })

export function createSmontMatch(section: Section): TireChanger {
  const model = new TireChangerModel(section)
  let spec: WheelSpec = WHEELS[1]
  let geo = wheelGeometry(spec)
  let tire = tireData(spec)
  let useHelper = true
  let matching = true
  let version = -1
  /** Segni del matching in corso, null se non ce n'è uno. */
  let marks: Marks | null = null
  /** Da quale richiesta di EqMatch vengono i segni; null per il mezzo giro senza richiesta. */
  let marksFrom: MatchRequest['reason'] | null = null
  const steps = () => (matching ? STEPS_M : STEPS)
  const order = () => (matching ? ORDER_M : ORDER)

  // ---------- stato della macchina ----------
  const st = {
    fase: 'pronta' as Fase,
    msg: 'Ruota sgonfia appoggiata ai tamponi: inizia dalla stallonatura',
    tilt: COL_BACK_TILT,
    hex: HEX_UP,
    lock: 0,
    leverK: 0,
    leverSet: 'upper' as 'upper' | 'lower',
    bbPhi: 0.3,
    jawR: 0.27,
    ttAngle: 0,
    ttOmega: 0,
    wheelSpin: 0,
    onTT: false,
    pose: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() } as Pose,
    /** Pneumatico rispetto al cerchio: alzata lungo l'asse, inclinazione, ritardo di rotazione e tragitto verso terra. */
    tire: { u: 0, alpha: 0, lag: 0, away: 0 },
    /** Talloni allargati attorno alla testina (0..1). */
    bulge: { upper: 0, lower: 0 },
    pBead: 0,
    pJaw: 0,
    pTire: 0,
    /** Angolo del pneumatico sul cerchio; held = pneumatico tenuto fermo mentre il cerchio gira. */
    theta: 0,
    held: false,
    /** Fermo per matching: 0 rientrato, 1 sul battistrada; focus = la camera lo inquadra. */
    clamp: 0,
    focus: false,
    /** Rotazione del pneumatico sul cerchio: fatta e richiesta, rad. */
    turned: 0,
    turnReq: 0,
    bladeForce: 0,
    bladeTravel: 0,
    load: 0,
    flow: 0,
    seat: 1,
    air: new Set<string>(),
    pedal: [0, 0, 0],
    pedalT: [0, 0, 0],
    btn: { stallona: 0, ritorno: 0, arresto: 0 },
    btnT: { stallona: 0, ritorno: 0, arresto: 0 },
    bb: { mode: 'riposo' as BBMode, a: false, b: false, sides: 0, flipped: false },
    joy: 0,
    worm: 0,
    roll: 0,
    /** Utensili dell'helper che premono il fianco: punto (x, z) fisso e schiacciamento. */
    press: new Map<'rullo' | 'disco', { x: number; z: number; depth: number }>(),
    tools: { rullo: { ...PARK }, disco: { ...PARK }, cono: { ...PARK } } as Record<Tool, { swing: number; reach: number; drop: number }>,
  }
  let job: Co | null = null
  let stepId = ''
  let el: Record<string, HTMLElement> = {}
  let airPhase = 0
  let dirty = true

  // ---------- geometria che dipende dalla ruota ----------

  const flangeR = () => geo.rimR + 0.019
  const jawOpen = () => Math.min(flangeR() + 0.012, 0.275)
  /** Centro della ruota sdraiata sul piatto, appoggiata sui gradini delle griffe. */
  const ttCenterY = () => TT_Y + 0.039 + geo.width / 2
  const flangeTopY = () => ttCenterY() + geo.width / 2 + 0.009

  // Lama: il bordo di spinta gira attorno al perno con il braccio.
  const RE = Math.hypot(BLADE.x, BLADE.z), TH = Math.atan2(BLADE.x, BLADE.z)
  const bladeX = (phi: number) => BB_P.x + RE * Math.sin(phi + TH)
  const bladeZ = (phi: number) => BB_P.z + RE * Math.cos(phi + TH)
  const phiForX = (x: number) => Math.asin(THREE.MathUtils.clamp((x - BB_P.x) / RE, -1, 1)) - TH
  /** Raggio a cui la lama tocca il fianco, a 45 mm dalla sede del tallone. */
  const contactR = () => geo.rimR + 0.045
  /** Distanza orizzontale tra il centro della ruota e il bordo della lama. */
  const contactZ = () => Math.sqrt(Math.max(contactR() ** 2 - (BLADE_Y - geo.tireR) ** 2, 0))
  const wheelX = () => PAD_X + geo.tireW / 2
  /** Fianco più sporgente sotto il bordo della lama (il bordo è un arco alto 2·BLADE_HALF). */
  const sideX = () => {
    let m = 0
    for (let i = -4; i <= 4; i++) m = Math.max(m, tireHalfWidth(spec, Math.hypot(BLADE_Y + (BLADE_HALF * i) / 4 - geo.tireR, contactZ())))
    return wheelX() + m
  }
  const phiContact = () => phiForX(sideX())
  const phiOpen = () => phiForX(sideX() + 0.16)
  const wheelZ = () => bladeZ(phiContact()) - contactZ()

  const poseBB = (inner: boolean) => pose(wheelX(), geo.tireR, wheelZ(), inner ? qY(Math.PI) : new THREE.Quaternion())
  const poseTT = () => pose(0, ttCenterY(), TT_Z, FLAT)
  const restPose = () => pose(-0.9, geo.tireW / 2, 0.5, FLAT)

  /** Ruota in piedi: si stacca dai tamponi, avanza fuori dall'ingombro di lama e mobile, gira su sé stessa e torna. */
  function flipPath(fromInner: boolean): Pose[] {
    const a = poseBB(fromInner), b = poseBB(!fromInner)
    const x = a.pos.x + 0.03, y = geo.tireR
    return [a, pose(x, y, a.pos.z, a.quat), pose(x, y, Z_CLEAR, a.quat), pose(x, y, Z_CLEAR, qY(Math.PI / 2).multiply(a.quat)), pose(x, y, Z_CLEAR, b.quat), pose(x, y, b.pos.z, b.quat), b]
  }
  /** Dallo stallonatore al piatto: avanti, su in piedi, poi sdraiata sopra il piatto e giù sulle griffe. */
  function toTTPath(from: Pose): Pose[] {
    const x = from.pos.x + 0.03, up = ttCenterY() + 0.16
    return [from, pose(x, from.pos.y, from.pos.z, from.quat), pose(x, from.pos.y, Z_CLEAR, from.quat), pose(0.55, 1.3, Z_CLEAR, from.quat), pose(0.25, up, 0.35, FLAT), pose(0, up, TT_Z, FLAT), poseTT()]
  }
  /** Pneumatico sfilato: avanti sopra il piano, a sinistra oltre il braccio di aiuto, poi a terra. */
  function awayPath(start: Pose): Pose[] {
    const y = start.pos.y + 0.03, r = restPose()
    return [start, pose(start.pos.x, y, 0.55, start.quat), pose(r.pos.x, y, r.pos.z, FLAT), r]
  }

  /** Raggio dell'impronta di rullo e disco sul fianco. */
  const FOOT = { rullo: 0.027, disco: 0.062 }
  /** Punti di lavoro degli utensili dell'helper, sul punto più alto del fianco sotto l'impronta, com'è adesso. */
  const onSide = (x: number, z: number, rho: number) => new THREE.Vector3(x, model.surfaceMax(x, z, rho) + 0.003, z)
  const target = {
    // rullo davanti, dal lato opposto all'utensile di montaggio (che è dietro)
    rullo: () => onSide(-0.06, TT_Z + geo.rimR + 0.035, FOOT.rullo),
    // disco a sinistra, vicino alla balconata
    disco: () => onSide(-(geo.rimR + 0.04), TT_Z + 0.04, FOOT.disco),
    // cono sul mozzo del cerchio
    cono: () => new THREE.Vector3(0, ttCenterY() + spec.et + 0.016, TT_Z),
  }

  /** Rapporto tra forza alla lama e forza del cilindro (equilibrio dei momenti attorno al perno). */
  function leverRatio(phi: number) {
    const q = qY(phi)
    const le = BB_LEVER.clone().applyQuaternion(q) // leva, rispetto al perno
    const dir = le.clone().add(BB_P).sub(BB_ANCHOR).normalize() // spinta del cilindro
    const tc = Math.abs(le.z * dir.x - le.x * dir.z)
    const blade = BLADE.clone().applyQuaternion(q)
    const tb = Math.abs(blade.z) // la lama spinge lungo −x
    return tc / tb
  }

  function setWheel(next: WheelSpec) {
    spec = next
    geo = wheelGeometry(spec)
    tire = tireData(spec)
    model.buildWheel(spec)
    st.bbPhi = phiOpen()
    st.jawR = jawOpen()
    const p = poseBB(false)
    st.pose.pos.copy(p.pos)
    st.pose.quat.copy(p.quat)
    st.onTT = false
    st.tire = { u: 0, alpha: 0, lag: 0, away: 0 }
    st.bulge = { upper: 0, lower: 0 }
    st.pTire = 0
    st.seat = 1
    st.bb.sides = 0
    st.bb.flipped = false
    // braccio orizzontale regolato sul diametro del cerchio
    model.armSlide.position.z = TT_Z - flangeR() - 0.005 - COL_P.z
    dirty = true
  }
  setWheel(spec)

  // ---------- primitive del ciclo ----------

  function* wait(s: number): Co {
    for (let t = 0; t < s; ) t += yield
  }
  function* tween(s: number, fn: (k: number) => void): Co {
    for (let t = 0; t < s; ) {
      t += yield
      fn(ease(Math.min(t / s, 1)))
    }
  }
  const say = (m: string) => { st.msg = m }
  function press(i: number, on: boolean) { st.pedalT[i] = on ? 1 : 0 }
  /** Pressione breve di un pulsante della pulsantiera. */
  function* tap(b: 'stallona' | 'ritorno' | 'arresto'): Co {
    st.btnT[b] = 1
    yield* wait(0.18)
    st.btnT[b] = 0
  }

  /** Gira il piatto di un angolo alla velocità di lavoro; during() riceve l'avanzamento 0..1. */
  function* rotate(turns: number, load: number, during?: (k: number) => void): Co {
    const omega = (SPEC.turntableRpm * Math.PI) / 30
    const total = Math.abs(turns) * Math.PI * 2
    // pedale premuto: il piatto gira in un verso; alzato: nell'altro
    st.pedalT[0] = turns < 0 ? -1 : 1
    st.load = load
    let done = 0
    while (done < total) {
      const dt: number = yield
      const w = Math.min(omega, st.ttOmega + omega * dt * 4) // breve avviamento
      st.ttOmega = w
      const da = Math.min(w * dt, total - done)
      done += da
      st.ttAngle += da * Math.sign(turns)
      if (st.onTT) st.wheelSpin += da * Math.sign(turns)
      // pneumatico tenuto fermo: gira sul cerchio al contrario del piatto
      if (st.held) st.theta -= da * Math.sign(turns)
      st.roll += da
      during?.(done / total)
    }
    st.ttOmega = 0
    st.load = 0
    press(0, false)
  }

  /** Porta un utensile dell'helper sul punto to (o a riposo): prima alza, poi gira e allunga il braccio, poi scende. */
  function* moveTool(name: Tool, to: THREE.Vector3 | null, s = 0.9): Co {
    const t = model.helper[name]
    const from = { ...st.tools[name] }
    const goal = to ? model.helperPose(t, to) : PARK
    if (to && name === 'rullo') model.aimRoller(goal.swing, to)
    st.air.add('helper')
    st.joy = to ? 1 : -1
    if (from.drop < HOLD - 1e-3) yield* tween(0.35, (k) => { st.tools[name].drop = lerp(from.drop, HOLD, k) })
    yield* tween(s * 0.6, (k) => {
      st.tools[name] = { swing: lerp(from.swing, goal.swing, k), reach: lerp(from.reach, goal.reach, k), drop: HOLD }
    })
    if (to) yield* tween(s * 0.4, (k) => { st.tools[name].drop = lerp(HOLD, goal.drop, k) })
    st.air.delete('helper')
    st.joy = 0
  }

  /** L'utensile dell'helper preme il fianco e lo segue mentre il pneumatico si muove. */
  function* pushTool(name: 'rullo' | 'disco', depth: number, s = 0.4): Co {
    const t = model.helper[name], v = st.tools[name]
    const p = { x: t.arm.position.x + Math.cos(v.swing) * v.reach, z: t.arm.position.z - Math.sin(v.swing) * v.reach, depth: 0 }
    st.press.set(name, p)
    st.air.add('helper')
    st.joy = 1
    yield* tween(s, (k) => (p.depth = depth * k))
    st.air.delete('helper')
    st.joy = 0
  }
  function* releaseTool(name: 'rullo' | 'disco'): Co {
    const p = st.press.get(name)
    const d0 = p?.depth ?? 0
    yield* tween(0.3, (k) => { if (p) p.depth = d0 * (1 - k) })
    st.press.delete(name)
    yield* moveTool(name, null, 0.8)
  }

  function* column(up: boolean): Co {
    press(2, true)
    st.air.add('palo')
    const a = st.tilt
    yield* tween(1.0, (k) => (st.tilt = lerp(a, up ? 0 : COL_BACK_TILT, k)))
    st.air.delete('palo')
    press(2, false)
  }
  function* hexTo(down: boolean): Co {
    if (!down && st.lock > 0) {
      st.air.add('asta')
      yield* tween(0.25, (k) => (st.lock = 1 - k))
      st.air.delete('asta')
    }
    const a = st.hex
    yield* tween(0.9, (k) => (st.hex = lerp(a, down ? 0 : HEX_UP, k)))
    if (down) {
      st.air.add('asta')
      yield* tween(0.25, (k) => (st.lock = k))
      st.air.delete('asta')
    }
  }
  function* travel(path: Pose[], s: number): Co {
    yield* tween(s, (k) => {
      const p = posePath(path, k)
      st.pose.pos.copy(p.pos)
      st.pose.quat.copy(p.quat)
    })
  }
  /** Leva: presa dal piano, infilata accanto all'utensile, leva, e di nuovo sul piano. */
  function* leverWork(which: 'upper' | 'lower', during: (k: number) => void): Co {
    st.leverSet = which
    yield* tween(1.3, (k) => (st.leverK = k))
    yield* tween(0.8, (k) => {
      st.leverK = 1 + k
      during(k)
    })
    yield* tween(1.3, (k) => (st.leverK = 2 * (1 - k)))
  }

  // ---------- stallonatore: comando automatico dalla pulsantiera ----------

  const bbActive = () => st.bb.mode === 'avvicinamento' || st.bb.mode === 'spinta' || st.bb.mode === 'distacco' || st.bb.mode === 'ritorno'
  function coils(a: boolean, b: boolean) {
    st.bb.a = a
    st.bb.b = b
    for (const k of ['bb', 'bb-spinta', 'bb-ritorno']) st.air.delete(k)
    if (a || b) st.air.add('bb')
    if (a) st.air.add('bb-spinta')
    if (b) st.air.add('bb-ritorno')
  }

  /** STALLONA: avvicinamento, spinta fino al distacco del tallone, ritorno. */
  function* bbCycle(inner: boolean): Co {
    yield* tap('stallona')
    coils(true, false)
    st.bb.mode = 'avvicinamento'
    say('STALLONA: la bobina di spinta apre l\'elettrovalvola, il braccio avvicina la lama al fianco')
    const p0 = st.bbPhi, pc = phiContact(), b0 = st.pBead
    // a vuoto il cilindro incontra solo gli attriti: velocità della lama limitata dallo scarico, circa 0,25 m/s
    yield* tween(Math.max(0.3, (Math.abs(p0 - pc) * RE) / 0.25), (k) => {
      st.bbPhi = lerp(p0, pc, k)
      st.pBead = lerp(b0, 0.4, k)
    })
    st.bb.mode = 'spinta'
    say(`Lama sul fianco ${inner ? 'interno' : 'esterno'}, vicino al cerchio: la pressione nel cilindro sale`)
    const k = tire.breakForce / tire.breakTravel
    while (st.bladeForce < tire.breakForce) {
      const dt: number = yield
      st.pBead += ((SPEC.linePressure - st.pBead) * dt) / SPEC.cylTau
      const fc = st.pBead * BAR * area(SPEC.beadCylBore)
      st.bladeForce = Math.min(fc * leverRatio(st.bbPhi), tire.breakForce)
      st.bladeTravel = Math.min(st.bladeForce / k, tire.breakTravel)
      st.bbPhi = phiForX(sideX() - st.bladeTravel)
    }
    st.bb.mode = 'distacco'
    say(`Il tallone si stacca dalla sede a ${num(st.bladeForce / 1000)} kN: la lama scatta in avanti e la centralina comanda il ritorno`)
    const t0 = st.bladeTravel
    yield* tween(0.18, (q) => {
      st.bladeTravel = t0 + 0.02 * q
      st.bladeForce = lerp(tire.breakForce, tire.breakForce * 0.15, q)
      st.bbPhi = phiForX(sideX() - st.bladeTravel)
    })
    yield* wait(0.35)
    yield* bbReturn()
  }

  /** Ritorno: bobina di ritorno, aria nella camera lato stelo, braccio in apertura. */
  function* bbReturn(): Co {
    coils(false, true)
    st.bb.mode = 'ritorno'
    say('Ritorno: la seconda bobina manda l\'aria nella camera lato stelo, la lama si allontana')
    const pb = st.pBead, f0 = st.bladeForce, tr = st.bladeTravel, ph = st.bbPhi
    yield* tween(0.9, (q) => {
      st.pBead = pb * (1 - q)
      st.bladeForce = f0 * (1 - q)
      st.bladeTravel = tr * (1 - q)
      st.bbPhi = lerp(ph, phiOpen(), q)
    })
    st.bladeTravel = 0
    coils(false, false)
    st.bb.mode = 'riposo'
  }

  /** ARRESTO: bobine diseccitate, elettrovalvola al centro con le camere in scarico. */
  function* bbStop(): Co {
    coils(false, false)
    st.bb.mode = 'arresto'
    say('ARRESTO: bobine senza corrente, l\'elettrovalvola scarica il cilindro e il braccio si ferma')
    const pb = st.pBead, f0 = st.bladeForce, tr = st.bladeTravel
    yield* tap('arresto')
    yield* tween(0.6, (q) => {
      st.pBead = pb * (1 - q)
      st.bladeForce = f0 * (1 - q)
      // il fianco si rilassa e riporta indietro la lama
      st.bladeTravel = tr * (1 - q)
      if (tr > 0) st.bbPhi = phiForX(sideX() - st.bladeTravel)
    })
    st.bb.mode = 'fermo'
    say('Stallonatore fermo: RITORNO riporta indietro il braccio, STALLONA riprende')
  }
  function* bbManualReturn(): Co {
    yield* tap('ritorno')
    yield* bbReturn()
    say('Braccio dello stallonatore aperto')
  }

  // ---------- passi ----------

  /** Stallonatura di un fianco (one) o di quelli che mancano. */
  function* stallona(one = false): Co {
    if (st.pTire > 0) {
      say('Si toglie l\'obice dalla valvola: il pneumatico si sgonfia')
      const p0 = st.pTire
      yield* tween(1.6, (k) => (st.pTire = p0 * (1 - k)))
      st.pTire = 0
    }
    while (st.bb.sides < 2) {
      const inner = st.bb.sides === 1
      if (inner && !st.bb.flipped) {
        say('Si stacca la ruota dai tamponi, la si gira e si riappoggia per l\'altro fianco')
        yield* travel(flipPath(false), 3.2)
        st.bb.flipped = true
      }
      yield* bbCycle(inner)
      st.bb.sides++
      if (one) break
    }
    if (st.bb.sides >= 2) {
      st.fase = 'stallonata'
      say('Talloni staccati su entrambi i lati: ora la ruota va sul piatto')
    } else say('Primo fianco stallonato: STALLONA di nuovo per girare la ruota e fare l\'altro')
  }

  function* blocca(): Co {
    say('Griffe aperte, la ruota si sposta davanti, si alza e si sdraia sul piatto')
    press(1, true)
    st.air.add('griffe')
    const j0 = st.jawR
    yield* tween(0.4, (k) => (st.jawR = lerp(j0, jawOpen(), k)))
    st.air.delete('griffe')
    press(1, false)
    yield* travel(toTTPath({ pos: st.pose.pos.clone(), quat: st.pose.quat.clone() }), 3.6)
    st.onTT = true
    if (useHelper) {
      say('Il cono di centraggio scende sul mozzo e tiene il cerchio contro il piatto')
      yield* moveTool('cono', target.cono(), 1.1)
    }
    say('Le griffe chiudono sulla balconata dall\'esterno')
    press(1, true)
    st.air.add('griffe')
    const j1 = st.jawR
    yield* tween(0.8, (k) => {
      st.jawR = lerp(j1, flangeR(), k)
      st.pJaw = SPEC.linePressure * k
    })
    st.air.delete('griffe')
    press(1, false)
    if (useHelper) yield* moveTool('cono', null, 0.9)
    st.fase = 'bloccata'
    say(`Cerchio bloccato: ${num(jawForce(st.pJaw) / 1000)} kN su ogni griffa`)
  }

  function* smonta(): Co {
    say('Il palo torna in verticale con l\'asta alzata')
    yield* column(true)
    if (useHelper) {
      say('Helper: il disco premitallone completa lo stallonamento dall\'alto mentre il piatto gira')
      yield* moveTool('disco', target.disco())
      yield* pushTool('disco', 0.028)
      yield* rotate(0.6, SPEC.peelTorque * 0.4)
      yield* releaseTool('disco')
      say('Helper: il rullo spinge il tallone nel canale dal lato opposto all\'utensile')
      yield* moveTool('rullo', target.rullo())
      yield* pushTool('rullo', 0.035)
    }
    say('Con la leva il tallone superiore esce sopra la balconata, dietro')
    yield* leverWork('upper', (k) => (st.bulge.upper = k))
    say('L\'asta scende: la testina entra tra tallone e cerchio e si blocca')
    yield* hexTo(true)
    say('Il piatto gira: il tallone superiore scivola sulla testina e fuori dal cerchio')
    yield* rotate(1.15, SPEC.peelTorque, (k) => {
      st.tire.u = lerp(0, 0.065, k)
      st.tire.alpha = lerp(0, -0.22, k)
      st.tire.lag = -0.15 * Math.sin(Math.PI * k)
    })
    if (useHelper) yield* releaseTool('rullo')
    say('Tallone inferiore: la leva lo porta oltre la testina, poi un altro giro')
    yield* leverWork('lower', (k) => {
      st.bulge.lower = k
      st.tire.u = lerp(0.065, 0.09, k)
      st.tire.alpha = lerp(-0.22, -0.24, k)
    })
    const u1 = geo.width + 0.05
    yield* rotate(1, SPEC.peelTorque * 0.8, (k) => {
      st.tire.u = lerp(0.09, u1, k)
      st.tire.alpha = lerp(-0.24, -0.05, k)
    })
    say('L\'asta si sblocca e si alza, il pneumatico viene tolto')
    yield* hexTo(false)
    yield* tween(0.4, (k) => { st.bulge.upper = st.bulge.lower = 1 - k })
    yield* tween(2.2, (k) => (st.tire.away = k))
    st.fase = 'smontata'
    say('Pneumatico smontato: il cerchio è libero sul piatto')
  }

  function* monta(): Co {
    const u1 = geo.width + 0.05
    say('Il pneumatico torna sopra il cerchio')
    st.tire.u = u1
    st.tire.alpha = 0
    yield* tween(2.2, (k) => (st.tire.away = 1 - k))
    say('Il tallone inferiore si allarga dietro, sotto l\'utensile: l\'asta scende e si blocca')
    yield* tween(0.5, (k) => { st.bulge.upper = st.bulge.lower = k })
    yield* hexTo(true)
    say('Tallone inferiore: girando il piatto scorre sotto la testina ed entra nel cerchio')
    yield* rotate(1, SPEC.peelTorque * 0.6, (k) => {
      st.tire.u = lerp(u1, 0.06, k)
      st.tire.alpha = lerp(0, -0.15, k)
      st.bulge.lower = 1 - THREE.MathUtils.smoothstep(k, 0.6, 1)
    })
    if (useHelper) {
      say('Helper: rullo e disco tengono il tallone superiore nel canale mentre il piatto gira')
      yield* moveTool('rullo', target.rullo())
      yield* pushTool('rullo', 0.035)
      yield* moveTool('disco', target.disco())
      yield* pushTool('disco', 0.028)
    } else {
      say(spec.aspect <= 45 ? 'Senza helper il fianco rigido del ribassato fa risalire il tallone: serve una mano che lo tenga nel canale' : 'Tallone superiore: si tiene premuto a mano nel canale')
    }
    yield* rotate(1.25, SPEC.peelTorque * (useHelper ? 0.9 : 1.2), (k) => {
      st.tire.u = lerp(0.06, 0, k)
      st.tire.alpha = lerp(-0.15, 0, k)
    })
    if (useHelper) {
      yield* releaseTool('disco')
      yield* releaseTool('rullo')
    }
    st.seat = 0
    say('Talloni dentro il cerchio: asta su, l\'ultimo tratto di tallone scende nel canale, palo indietro')
    yield* hexTo(false)
    yield* tween(0.4, (k) => (st.bulge.upper = 1 - k))
    yield* column(false)
    st.fase = 'montata'
    say('Pneumatico montato, talloni ancora nel canale: si gonfia')
  }

  /** Inquadratura del fermo per matching: da sinistra, davanti e in alto, con il pattino e il fianco segnato. */
  const clampView = (): View => ({ target: [-0.26, ttCenterY(), TT_Z], halfWidth: 0.48, dir: [0.15, 1.4, 1.0] })

  /** Uscita dello stelo del fermo che porta il pattino a contatto con il battistrada. */
  const clampExt = () => -geo.tireR - MATCH_GAP - MATCH_FACE

  /** Matching: pneumatico tenuto fermo da disco e fermo, il cerchio gira fino ad allineare i segni. */
  function* ruota(): Co {
    const m = marks ?? (marks = halfTurnMarks(st.theta))
    const turn = turnFor(m, st.theta)
    st.turnReq = turn
    st.turned = 0
    say('Helper: il disco premitallone scende sul fianco vicino alla balconata e tiene giù il pneumatico')
    yield* moveTool('disco', target.disco())
    yield* pushTool('disco', 0.02)
    say('Il fermo per matching appoggia il pattino di gomma al battistrada')
    st.focus = true
    st.air.add('matching')
    yield* tween(0.9, (k) => (st.clamp = k))
    st.air.delete('matching')
    st.held = true
    const t0 = st.theta
    say(`Pedale ${turn >= 0 ? 'alzato' : 'premuto'}: il piatto gira il cerchio di ${Math.abs(deg(turn))}° sotto il pneumatico fermo, il segno del cerchio va verso quello del pneumatico`)
    // il cerchio gira di −turn: rispetto al cerchio il pneumatico gira di turn
    yield* rotate(-turn / (Math.PI * 2), SPEC.peelTorque * 0.5, () => (st.turned = st.theta - t0))
    st.held = false
    st.theta = t0 + turn
    st.turned = turn
    match.theta = st.theta
    touch()
    version = match.version
    say('Segni allineati: il fermo torna indietro e il disco si alza')
    st.air.add('matching')
    yield* tween(0.7, (k) => (st.clamp = 1 - k))
    st.air.delete('matching')
    st.focus = false
    yield* releaseTool('disco')
    // talloni ancora fuori sede: salteranno in sede col gonfiaggio
    st.seat = 0
    st.fase = 'ruotata'
    say(`Pneumatico girato di ${Math.abs(deg(turn))}° sul cerchio: si gonfia`)
  }

  function* gonfia(): Co {
    // porta la valvola verso il manometro (davanti a sinistra)
    const psi = Math.atan2(0.3, 0.32)
    let d = (psi - 2.4 - st.wheelSpin) % (Math.PI * 2)
    if (d < 0) d += Math.PI * 2
    say('Il piatto porta la valvola verso il gruppo di gonfiaggio')
    yield* rotate(d / (Math.PI * 2), 20)
    model.setHose(model.valveWorld(), ttCenterY() + geo.tireW / 2)
    say('Attacco sulla valvola: l\'aria entra e la pressione sale')
    st.air.add('gonfiaggio')
    while (st.pTire < SPEC.workPressure) {
      const dt: number = yield
      st.flow = inflowRate(st.pTire)
      st.pTire += pressureRise(st.flow, dt, tire.volume)
      if (st.seat < 1 && st.pTire >= tire.seatPressure) {
        say(`Tallonamento a ${num(st.pTire, 2)} bar: i talloni saltano in sede`)
        yield* tween(0.15, (k) => (st.seat = k))
      }
    }
    st.flow = 0
    st.air.delete('gonfiaggio')
    model.setHose(null)
    st.fase = 'gonfia'
    say(`Pressione finale ${num(st.pTire, 2)} bar: ruota pronta`)
    if (matching && st.turned !== 0) {
      if (match.request && !match.request.done) match.request.done = true
      touch()
      version = match.version
      say(`Pressione finale ${num(st.pTire, 2)} bar, segni allineati: la ruota torna all'equilibratrice per la misura`)
    }
  }

  function* nuovo(): Co {
    if (st.pTire > 0) {
      say('Sgonfiaggio')
      const p0 = st.pTire
      yield* tween(1.0, (k) => (st.pTire = p0 * (1 - k)))
    }
    if (st.onTT) {
      say('Griffe aperte, la ruota torna ai tamponi')
      press(1, true)
      st.air.add('griffe')
      const j0 = st.jawR
      yield* tween(0.5, (k) => {
        st.jawR = lerp(j0, jawOpen(), k)
        st.pJaw = SPEC.linePressure * (1 - k)
      })
      st.air.delete('griffe')
      press(1, false)
      st.onTT = false
      yield* travel(toTTPath(poseBB(false)).reverse(), 3.6)
    }
    st.seat = 1
    st.bb.sides = 0
    st.bb.flipped = false
    st.turned = 0
    st.fase = 'pronta'
    if (matching && !(match.request && !match.request.done)) { marks = halfTurnMarks(st.theta); marksFrom = null }
    say('Ruota sgonfia appoggiata ai tamponi: inizia dalla stallonatura')
  }

  /** Ruota che arriva dall'equilibratrice: gonfia, appoggiata ai tamponi, con i segni del matching. */
  function arrive() {
    setWheel(spec)
    st.fase = 'pronta'
    st.pTire = SPEC.workPressure
    st.ttAngle = 0
    st.wheelSpin = 0
    st.turned = 0
    st.jawR = jawOpen()
    st.pJaw = 0
  }

  /** Legge lo stato condiviso con EqMatch: ruota, angolo del pneumatico sul cerchio, segni richiesti. */
  function sync() {
    if (match.version === version) return
    version = match.version
    const idle = !job && ((st.fase === 'pronta' && st.bb.sides === 0) || st.fase === 'gonfia')
    const req = match.request && !match.request.done ? match.request : null
    if (idle && matching) {
      spec = WHEELS.find((x) => x.id === match.wheel) ?? spec
      st.theta = match.theta
      arrive()
    }
    // senza richiesta da EqMatch: mezzo giro, segno del pneumatico opposto alla valvola
    marks = req ? { ...req.marks } : matching ? halfTurnMarks(st.theta) : null
    marksFrom = req?.reason ?? null
    dirty = true
  }

  /** Ogni passo annota il suo nome per il controllo di compenetrazione. */
  function* named(id: string, co: () => Co): Co {
    stepId = id
    yield* co()
  }
  const RUN: Record<string, () => Co> = {
    stallona: () => named('stallona', () => stallona()),
    blocca: () => named('blocca', blocca),
    smonta: () => named('smonta', smonta),
    monta: () => named('monta', monta),
    gonfia: () => named('gonfia', gonfia),
    ruota: () => named('ruota', ruota),
    nuovo: () => named('nuovo', nuovo),
  }
  function* ciclo(): Co {
    if (st.fase === 'gonfia') yield* RUN.nuovo()
    for (const s of steps()) if (st.fase === s.from) yield* RUN[s.id]()
  }
  const start = (co: Co) => { if (!job && model.exploded < 0.01) { st.focus = false; job = co; job.next(0) } }
  /** Sostituisce il lavoro in corso (RITORNO e ARRESTO interrompono lo stallonatore). */
  const replace = (co: Co) => { job = co; job.next(0) }

  /** Pulsanti della pulsantiera. */
  function button(b: 'stallona' | 'ritorno' | 'arresto') {
    if (model.exploded > 0.01) return
    if (b === 'stallona') {
      if (!job && st.fase === 'pronta') start(named('stallona', () => stallona(true)))
    } else if (b === 'ritorno') {
      if (job && bbActive() && st.bb.mode !== 'ritorno') replace(named('stallona', bbManualReturn))
      else if (!job && st.bbPhi < phiOpen() - 1e-3) start(named('stallona', bbManualReturn))
    } else if (job && bbActive()) replace(named('stallona', bbStop))
  }

  // ---------- applicazione dello stato al modello ----------

  const tmpQ = new THREE.Quaternion()
  const PB_X = model.buttons.stallona.position.x
  /** Leva: a riposo sul piano davanti, presa e alzata, portata sopra l'utensile, infilata e premuta. */
  function leverPose(): Pose {
    const rest = pose(-0.13, 0.745, 0.345, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2))
    const upper = st.leverSet === 'upper'
    const tip = upper ? new THREE.Vector3(0.07, flangeTopY() + 0.02, TT_Z - flangeR() + 0.014) : new THREE.Vector3(0.07, flangeTopY() + 0.01, TT_Z - geo.rimR + 0.01)
    const dIns = upper ? new THREE.Vector3(0.15, 0.85, -0.5) : new THREE.Vector3(0.1, 0.95, -0.25)
    const dPrs = upper ? new THREE.Vector3(0.15, 0.45, -0.88) : new THREE.Vector3(0.1, 0.95, -0.3)
    const qi = new THREE.Quaternion().setFromUnitVectors(Y, dIns.normalize())
    if (st.leverK > 1) {
      const k = st.leverK - 1
      return { pos: tip.clone().add(new THREE.Vector3(0, 0.02 * k, 0)), quat: qi.clone().slerp(new THREE.Quaternion().setFromUnitVectors(Y, dPrs.normalize()), k) }
    }
    const lift = 0.45
    return posePath([rest, pose(rest.pos.x, rest.pos.y + lift, rest.pos.z, qi), pose(tip.x, tip.y + lift, tip.z, qi), { pos: tip, quat: qi }], st.leverK)
  }

  /** Griffe sotto il fianco inferiore: quanto labbro e corpo schiacciano il pneumatico appoggiato. */
  function jawPresses(): Press[] {
    if (st.tire.away > 0 || (!st.onTT && st.pose.pos.distanceTo(poseTT().pos) > 0.3)) return []
    const out: Press[] = []
    const pts = [new THREE.Vector3(JAW_LIP, TT_Y + JAW_TOP, 0), new THREE.Vector3(0, TT_Y + JAW_TOP, 0), new THREE.Vector3(JAW_LIP / 2, TT_Y + JAW_TOP, 0), new THREE.Vector3(0.05, TT_Y + 0.015, 0), new THREE.Vector3(0.035, TT_Y + 0.015, 0), new THREE.Vector3(0.02, TT_Y + 0.015, 0)]
    for (const j of model.jaws) {
      let depth = 0
      for (const p of pts)
        for (const dz of [-0.02, -0.01, 0, 0.01, 0.02]) {
          const l = model.tireLocal(j.localToWorld(p.clone().setZ(dz)))
          if (l.r < geo.rimR || l.r > geo.tireR) continue
          depth = Math.max(depth, l.x + tireHalfWidth(spec, l.r))
        }
      if (depth > 0) out.push({ at: j.localToWorld(pts[0].clone()), depth: Math.min(depth, 0.05) + 0.003, reach: 0.045, half: 0.03 })
    }
    return out
  }

  function apply() {
    model.col.rotation.x = st.tilt
    model.hexSlide.position.y = flangeTopY() + 0.003 - COL_P.y - 1.0 + st.hex
    model.lockPin.position.x = st.lock * 0.025
    model.bb.rotation.y = st.bbPhi
    model.tt.rotation.y = st.ttAngle
    model.jaws.forEach((j, i) => {
      const a = (0.25 + i * 0.5) * Math.PI
      j.position.set(Math.cos(a) * st.jawR, 0, Math.sin(a) * st.jawR)
    })
    model.worm.rotation.x = st.worm
    ;(model.worm.userData.pulley as THREE.Object3D).rotation.x = st.worm
    model.motorSpin.rotation.x = st.worm * SPEC.beltRatio
    st.pedal.forEach((p, i) => (model.pedals[i].rotation.x = p * 0.22))
    model.joystick.rotation.x = st.joy * 0.35
    for (const b of ['stallona', 'ritorno', 'arresto'] as const) model.buttons[b].position.x = PB_X - st.btn[b] * 0.006
    model.coils.a.emissiveIntensity = st.bb.a ? 0.9 : 0
    model.coils.b.emissiveIntensity = st.bb.b ? 0.9 : 0

    const lp = leverPose()
    model.lever.position.copy(lp.pos)
    model.lever.quaternion.copy(lp.quat)

    // ruota e pneumatico
    model.wheelPose.position.copy(st.pose.pos)
    model.wheelPose.quaternion.copy(st.pose.quat)
    model.rimSpin.rotation.x = st.wheelSpin
    const hp = st.pose.pos.clone().add(new THREE.Vector3(st.tire.u, 0, 0).applyQuaternion(st.pose.quat))
    const hq = st.pose.quat.clone().multiply(tmpQ.setFromAxisAngle(Y, st.tire.alpha))
    if (st.tire.away > 0) {
      const p = posePath(awayPath({ pos: hp, quat: hq }), st.tire.away)
      hp.copy(p.pos)
      hq.copy(p.quat)
    }
    model.tireHolder.position.copy(hp)
    model.tireHolder.quaternion.copy(hq)
    model.tireSpin.rotation.x = st.wheelSpin + st.tire.lag + st.theta
    model.setMatching(ttCenterY(), st.clamp * clampExt())
    model.setSeat(st.seat)

    // helper: gli utensili che premono seguono il fianco
    for (const [name, p] of st.press) {
      const t = model.helper[name]
      st.tools[name].drop = model.surfaceMax(p.x, p.z, FOOT[name]) - p.depth - t.y + t.ext
    }
    for (const name of ['rullo', 'disco', 'cono'] as const) {
      const t: HelperTool = model.helper[name], v = st.tools[name]
      t.arm.rotation.y = v.swing
      t.carrier.position.x = v.reach
      t.slide.position.y = v.drop
    }
    const roll = model.helper.rullo.tool.userData.roll as THREE.Object3D
    // il rullo rotola sul fianco: stessa velocità periferica del pneumatico nel punto di contatto
    roll.children.forEach((c) => (c.rotation.x = st.roll * ((geo.rimR + 0.035) / 0.04)))

    model.setGauge(st.pTire)
    model.updateRams()

    // segni del marcatore e rotazione ancora da fare
    if (matching) {
      const turn = marks ? turnFor(marks, st.theta) : null
      model.setMarks({ rim: marks || match.ref !== null ? VALVE : null, ref: match.ref, target: marks?.tire ?? null, theta: st.theta, turn }, turn !== null ? `${Math.abs(deg(turn))}° ${turn >= 0 ? '↺' : '↻'}` : undefined)
    } else model.setMarks(null)
  }

  /** Contatti che deformano il pneumatico in questo istante. */
  function presses(): Press[] {
    const out: Press[] = []
    if (st.bladeTravel > 0) {
      const e = model.bb.localToWorld(BLADE.clone())
      out.push({ at: new THREE.Vector3(sideX(), e.y, e.z), depth: st.bladeTravel, reach: 0.012, half: BLADE_HALF })
    }
    for (const [name, p] of st.press) {
      if (p.depth <= 0) continue
      // il fianco cede un poco più della corsa dell'utensile: resta a contatto senza entrarci
      out.push({ at: new THREE.Vector3(p.x, model.surfaceY(p.x, p.z) - p.depth, p.z), depth: p.depth + 0.003, reach: FOOT[name] + 0.01, half: FOOT[name] + 0.01 })
    }
    out.push(...jawPresses())
    return out
  }

  // ---------- controllo di compenetrazione ----------

  const checker = new InterferenceCheck(model.root, (o) => model.isWheelOrMarker(o))
  const clashes: Clash[] = []
  const seen = new Map<string, Clash>()
  let frame = 0, checkEvery = CHECK_EVERY
  /** Segnala in console i pezzi che entrano nella ruota, una volta per passo e coppia di pezzi. */
  function checkClash() {
    for (const h of checker.run(model.wheelSolids(), () => CLASH_TOL)) {
      const key = spec.id + '|' + stepId + '|' + h.part + '|' + h.solid
      const prev = seen.get(key)
      if (prev) {
        if (h.depth > prev.depth) Object.assign(prev, { depth: h.depth, at: h.at, msg: st.msg })
        continue
      }
      const c: Clash = { ...h, wheel: spec.label, step: stepId, msg: st.msg }
      seen.set(key, c)
      clashes.push(c)
      console.warn(`[compenetrazione] ${spec.label} · passo "${stepId}" · ${PARTS[h.part]?.name ?? h.part} dentro ${h.solid} di ${num(h.depth * 1000, 1)} mm · ${st.msg}`)
    }
  }

  // ---------- pannello ----------

  const faseLabel: Record<Fase, string> = { pronta: 'PRONTA', stallonata: 'STALLONATA', bloccata: 'BLOCCATA', smontata: 'SMONTATA', montata: 'MONTATA', ruotata: 'RUOTATA', gonfia: 'GONFIA' }
  const bbLabel: Record<BBMode, string> = { riposo: 'a riposo', avvicinamento: 'avvicinamento', spinta: 'spinta', distacco: 'distacco del tallone', ritorno: 'ritorno', arresto: 'arresto', fermo: 'fermo dopo l\'arresto' }

  return {
    id: 'smontmatch',
    name: 'SmontMatch',
    subtitle: 'smontagomme con matching',
    workTab: 'Lavoro',
    model,
    parts: PARTS,
    order: ['pneumatico', 'cerchio', 'piatto', 'griffe', 'cilindri-griffe', 'palo', 'cilindro-palo', 'braccio', 'asta', 'bloccaggio', 'utensile', 'leva', 'stallonatore', 'paletta', 'cilindro-stallonatore', 'pulsantiera', 'elettrovalvola', 'tamponi', 'helper', 'helper-rullo', 'helper-disco', 'helper-cono', 'helper-cilindri', 'helper-comando', 'matching', 'pedaliera', 'valvole', 'frl', 'gonfiaggio', 'riduttore', 'cinghia', 'motore', 'mobile'],
    view: { target: [0.0, 0.72, 0.0], halfWidth: 1.15 },
    partView: (id) => (id === 'matching' ? clampView() : null),
    cameraView: () => (st.focus && job ? clampView() : null),
    physicsText: TEXT,
    get busy() { return job !== null },

    test: {
      setWheel(id) { setWheel(WHEELS.find((w) => w.id === id)!) },
      setHelper(on) { useHelper = on },
      checkEveryFrame() { checkEvery = 1 },
      run(id) { start(id === 'ciclo' ? ciclo() : RUN[id]()) },
      button,
      setMatching(on) { matching = on; if (on) useHelper = true; version = -1; sync() },
      get turned() { return st.turned },
      clashes,
    },

    mount(pane) {
      pane.innerHTML = PANE
      el = {}
      pane.querySelectorAll<HTMLElement>('[data-id]').forEach((e) => (el[e.dataset.id!] = e))
      sync()
      const renderSteps = () => {
        el.passi.innerHTML = stepList(steps())
        pane.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => b.addEventListener('click', () => start(RUN[b.dataset.step!]())))
      }
      renderSteps()
      const mc = el.matching as HTMLInputElement
      mc.checked = matching
      mc.addEventListener('change', () => {
        // si cambia modo solo con la ruota ai tamponi, prima di cominciare
        if (job || st.fase !== 'pronta' || st.bb.sides > 0) { mc.checked = matching; return }
        matching = mc.checked
        if (matching) useHelper = true
        ;(el.helper as HTMLInputElement).checked = useHelper
        version = -1
        sync()
        renderSteps()
      })
      el.torna.addEventListener('click', () => nav.open(match.owner))
      const sel = el.ruota as HTMLSelectElement
      for (const w of WHEELS) sel.append(new Option(w.label + (w.aspect <= 45 ? ' · ribassato' : ''), w.id))
      sel.value = spec.id
      sel.addEventListener('change', () => {
        if (job || st.fase !== 'pronta' || st.bb.sides > 0) { sel.value = spec.id; return }
        setWheel(WHEELS.find((w) => w.id === sel.value)!)
      })
      const hc = el.helper as HTMLInputElement
      hc.checked = useHelper
      hc.addEventListener('change', () => { if (matching) hc.checked = true; useHelper = hc.checked })
      el.ciclo.addEventListener('click', () => start(ciclo()))
      el.nuovo.addEventListener('click', () => start(RUN.nuovo()))
      for (const b of ['stallona', 'ritorno', 'arresto'] as const) el['b-' + b].addEventListener('click', () => button(b))
    },

    update(dt, _now, flows) {
      sync()
      let moving = false
      if (job) {
        moving = true
        if (job.next(dt).done) job = null
      }
      // pedali, pulsanti e motore
      for (let i = 0; i < st.pedal.length; i++) {
        const d = st.pedalT[i] - st.pedal[i]
        if (Math.abs(d) > 1e-3) { st.pedal[i] += d * Math.min(1, dt * 12); moving = true }
      }
      for (const b of ['stallona', 'ritorno', 'arresto'] as const) {
        const d = st.btnT[b] - st.btn[b]
        if (Math.abs(d) > 1e-3) { st.btn[b] += d * Math.min(1, dt * 20); moving = true }
      }
      if (st.ttOmega > 0) {
        st.worm += st.ttOmega * SPEC.wormTeeth * dt
        model.beltMap.offset.x -= ((st.ttOmega * SPEC.wormTeeth * 0.034 * dt) / model.beltLen) * model.beltMap.repeat.x
      }
      if (moving || dirty) {
        apply()
        // pneumatico schiacciato da lama, utensili dell'helper e griffe; talloni allargati attorno alla testina
        model.deform(presses(), { at: model.head.getWorldPosition(new THREE.Vector3()), ...st.bulge })
      }
      // nel browser il controllo gira un fotogramma ogni CHECK_EVERY; la verifica automatica li controlla tutti
      if (job && ++frame % checkEvery === 0) checkClash()

      // flussi: aria nei tubi, segnali nei cavi, forza sulla lama
      airPhase += dt * 0.9
      model.air(flows ? st.air : new Set(), airPhase)
      model.signals(flows && st.bb.a, flows && st.bb.b, airPhase)
      const showF = flows && st.bladeForce > 50
      model.bladeArrow.visible = showF
      if (showF) {
        const e = model.bb.localToWorld(BLADE.clone())
        // la freccia arriva alla lama da fuori: lunghezza proporzionale alla forza
        const len = 0.06 + (st.bladeForce / 10000) * 0.2
        model.bladeArrow.position.set(bladeX(st.bbPhi) + 0.13 + len, e.y + 0.11, e.z)
        model.bladeArrow.setLength(len, 0.05, 0.035)
      }
      const redraw = moving || dirty || (flows && (st.air.size > 0 || st.bb.a || st.bb.b))
      dirty = false
      return redraw
    },

    refresh() {
      if (el.messaggio) {
        setText(el.messaggio, st.msg)
        setText(el.pt, `${num(st.pTire, 2)} bar`)
        setText(el.fb, `${num(st.bladeForce / 1000)} kN`)
        setText(el.rpm, `${num((st.ttOmega * 30) / Math.PI, 0)} giri/min`)
        const cur = order().indexOf(st.fase), list = steps()
        const apart = model.exploded > 0.01
        document.querySelectorAll<HTMLButtonElement>('#pane-lavoro [data-step]').forEach((b, i) => {
          if (!list[i]) return
          b.disabled = !!job || apart || list[i].from !== st.fase
          b.classList.toggle('fatto', cur > i)
          b.classList.toggle('corrente', list[i].from === st.fase && !apart)
        })
        el['m-box'].hidden = el['m-info'].hidden = !matching
        if (matching) {
          const req = marks ? turnFor(marks, st.theta) : 0
          setText(el['m-ang'], `${Math.abs(deg(st.turned))}°`)
          setText(el['m-req'], st.fase === 'ruotata' || st.fase === 'gonfia' ? `${Math.abs(deg(st.turnReq))}° fatti` : `${Math.abs(deg(req))}° ${req >= 0 ? '↺' : '↻'}`)
          const from = marksFrom === 'm2' ? 'da EqMatch: mezzo giro per la seconda misura' : marksFrom === 'ottimale' ? 'da EqMatch: angolo ottimale del matching' : 'senza richiesta da EqMatch: mezzo giro (180°)'
          const done = st.fase === 'gonfia' && st.turned !== 0 ? (marksFrom ? ', rotazione eseguita' : ' eseguito') : ''
          setText(el['m-info'], `Segni ${from}${done}. Senso visto dall'alto, lato esterno della ruota.`)
        }
        ;(el.matching as HTMLInputElement).disabled = !!job || st.fase !== 'pronta' || st.bb.sides > 0
        ;(el.helper as HTMLInputElement).disabled = matching
        el.torna.parentElement!.hidden = !(matching && st.fase === 'gonfia' && st.turned !== 0 && !job)
        setText(el.torna, `↩ Torna a ${match.ownerName} per la verifica`)
        const ciclo = el.ciclo as HTMLButtonElement
        ciclo.disabled = !!job || apart
        setText(ciclo, apart ? 'Rimonta per lavorare' : '▶ Ciclo completo')
        ;(el.nuovo as HTMLButtonElement).disabled = !!job || apart || st.fase === 'pronta'
        ;(el.ruota as HTMLSelectElement).disabled = !!job || st.fase !== 'pronta' || st.bb.sides > 0
        ;(el['b-stallona'] as HTMLButtonElement).disabled = !!job || apart || st.fase !== 'pronta'
        ;(el['b-ritorno'] as HTMLButtonElement).disabled = apart || (job ? !bbActive() || st.bb.mode === 'ritorno' : st.bbPhi >= phiOpen() - 1e-3)
        ;(el['b-arresto'] as HTMLButtonElement).disabled = apart || !job || !bbActive()
      }
      const detail = matching && (st.held || stepId === 'ruota') && job ? `${Math.abs(deg(st.turned))}° di ${Math.abs(deg(st.turnReq))}°` : `${num(st.pTire, 2)} bar`
      return { status: faseLabel[st.fase], detail }
    },

    physics() {
      const fc = st.pBead * BAR * area(SPEC.beadCylBore)
      const tt = turntableTorque()
      const ev = st.bb.a ? 'bobina di spinta eccitata' : st.bb.b ? 'bobina di ritorno eccitata' : 'al centro, camere in scarico'
      const rows: [string, string][] = [
        ['Pressione di linea', `${SPEC.linePressure} bar ${IND}`],
        ['Stallonatore', bbLabel[st.bb.mode]],
        ['Elettrovalvola 5/3', ev],
        ['Tensione delle bobine', `${st.bb.a || st.bb.b ? 24 : 0} V c.c. ${IND}`],
        ['Cilindro stallonatore', `${num(st.pBead, 1)} bar · ${num(fc / 1000)} kN`],
        ['Rapporto di leva', `${num(leverRatio(st.bbPhi), 2)}`],
        ['Forza sulla lama', `${num(st.bladeForce / 1000)} kN`],
        ['Tenuta del tallone', `${num(tire.breakForce / 1000)} kN ${IND}`],
        ['Schiacciamento fianco', `${num(st.bladeTravel * 1000, 0)} mm`],
        ['Serraggio per griffa', `${num(jawForce(st.pJaw) / 1000, 2)} kN`],
        ['Riduzione motore → piatto', `1 : ${num(reduction(), 0)} ${IND}`],
        ['Velocità piatto', `${num((st.ttOmega * 30) / Math.PI, 0)} giri/min (lavoro ${SPEC.turntableRpm}) ${IND}`],
        ['Coppia disponibile', `${num(tt, 0)} N·m ${IND}`],
        ['Coppia resistente', `${num(st.load, 0)} N·m ${IND}`],
        ['Volume del pneumatico', `${num(tire.volume * 1000, 0)} L`],
        ['Pressione pneumatico', `${num(st.pTire, 2)} bar`],
        ['Portata d\'aria', `${num(st.flow * 1000, 1)} L/s ${IND}`],
        ['Pressione di tallonamento', `${num(tire.seatPressure, 1)} bar ${IND}`],
        ['Limite di sicurezza', `${num(SPEC.safetyLimit, 1)} bar ${IND}`],
        ['Compenetrazioni con la ruota', `${clashes.length}`],
      ]
      if (matching) {
        const req = marks ? turnFor(marks, st.theta) : 0
        rows.splice(1, 0,
          ['Matching: rotazione richiesta', `${deg(st.fase === 'ruotata' || st.fase === 'gonfia' ? st.turnReq : req)}° (positivo = antiorario dall'alto)`],
          ['Matching: angolo percorso', `${deg(st.turned)}°`],
          ['Pneumatico tenuto fermo', st.held ? 'sì: disco premitallone e fermo' : 'no'],
          ['Forza del fermo sul battistrada', `${num(st.clamp > 0.99 ? (SPEC.linePressure * BAR * area(0.036)) / 1000 : 0, 2)} kN ${IND}`],
        )
      }
      return rows
    },
  }
}
