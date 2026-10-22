import * as THREE from 'three'
import { Section } from '../core/section'
import { Machine, IND } from '../core/machine'
import { WHEELS, WheelSpec, wheelGeometry } from '../core/wheel'
import { num } from '../ui'
import { PARTS } from './parts'
import { TireChangerModel, TT_Y, TT_Z, COL_P, BB_P, ARM_L, BLADE_Y, PAD_X, BB_LEVER, BB_ANCHOR, HelperTool } from './model'
import { SPEC, BAR, area, tireData, turntableTorque, jawForce, inflowRate, pressureRise, reduction } from './physics'

type Fase = 'pronta' | 'stallonata' | 'bloccata' | 'smontata' | 'montata' | 'gonfia'
type Co = Generator<void, void, number>

const COL_BACK_TILT = -0.42
const HEX_UP = 0.24
const Y = new THREE.Vector3(0, 1, 0)
const ease = (k: number) => k * k * (3 - 2 * k)
const lerp = THREE.MathUtils.lerp

/** Passi del ciclo con la fase da cui partono. */
const STEPS: { id: string; from: Fase; title: string; desc: string }[] = [
  { id: 'stallona', from: 'pronta', title: 'Stallonatura', desc: 'paletta sui due fianchi' },
  { id: 'blocca', from: 'stallonata', title: 'Bloccaggio', desc: 'cono di centraggio e griffe' },
  { id: 'smonta', from: 'bloccata', title: 'Smontaggio', desc: 'disco, rullo, leva e utensile' },
  { id: 'monta', from: 'smontata', title: 'Montaggio', desc: 'rullo e disco tengono il tallone nel canale' },
  { id: 'gonfia', from: 'montata', title: 'Gonfiaggio', desc: 'tallonamento e pressione finale' },
]
const ORDER: Fase[] = ['pronta', 'stallonata', 'bloccata', 'smontata', 'montata', 'gonfia']

const PANE = `
  <p data-id="messaggio" class="messaggio"></p>
  <div class="manometro">
    <div><small>Pneumatico</small><b data-id="pt">0,00 bar</b></div>
    <div><small>Forza paletta</small><b data-id="fb">0,0 kN</b></div>
    <div><small>Piatto</small><b data-id="rpm">0 giri/min</b></div>
  </div>
  <ol class="passi">${STEPS.map((s, i) => `<li><button data-step="${s.id}"><span class="n">${i + 1}</span><span>${s.title}<small>${s.desc}</small></span></button></li>`).join('')}</ol>
  <div class="riga">
    <button data-id="ciclo" class="primario">▶ Ciclo completo</button>
    <button data-id="nuovo">Nuovo ciclo</button>
  </div>
  <div class="riga">
    <label class="campo">Ruota <select data-id="ruota"></select></label>
  </div>
  <label class="spunta"><input data-id="helper" type="checkbox" checked /> Usa il braccio di aiuto</label>`

const TEXT = `
  <h3>Stallonatura: pressione per area, poi leva</h3>
  <p>Il cilindro dello stallonatore spinge con <code>F = p · A</code>: a 10 bar un alesaggio di 200 mm dà circa 31 kN. La forza arriva alla paletta attraverso il braccio, che è una leva: vale l'equilibrio dei momenti attorno al perno, <code>F<sub>cil</sub> · b<sub>cil</sub> = F<sub>pal</sub> · b<sub>pal</sub></code>. La paletta schiaccia il fianco finché la forza supera la tenuta del tallone sulla sede conica del cerchio, poi il tallone scatta verso il canale.</p>
  <h3>Smontaggio e montaggio: il canale del cerchio</h3>
  <p>Il tallone contiene un cerchietto d'acciaio che non si allunga. Per farlo passare sopra la balconata bisogna portare la parte opposta nel canale, dove il diametro è più piccolo: la "corda" che avanza basta a superare la balconata vicino all'utensile. Il braccio di aiuto fa proprio questo, tenendo il tallone nel canale col rullo e col disco mentre il piatto gira.</p>
  <h3>Rotazione: il riduttore</h3>
  <p>Cinghia e vite senza fine riducono la velocità del motore di circa 200 volte. La coppia al piatto è <code>C = η · P / ω</code>: con 1,1 kW, rendimento 55% e 14 giri/min sono circa 400 N·m.</p>
  <h3>Gonfiaggio: la legge dei gas</h3>
  <p>Il volume del pneumatico resta quasi costante, quindi a temperatura costante la pressione cresce in proporzione all'aria immessa: <code>dp = p<sub>atm</sub> · dV<sub>aria</sub> / V</code>. La portata cala man mano che la pressione nel pneumatico si avvicina a quella di linea. Il tallonamento avviene a bassa pressione: oltre il limite indicato non si va mai.</p>`

export function createTireChanger(section: Section): Machine {
  const model = new TireChangerModel(section)
  let spec: WheelSpec = WHEELS[1]
  let geo = wheelGeometry(spec)
  let tire = tireData(spec)
  let useHelper = true

  // ---------- stato della macchina ----------
  const st = {
    fase: 'pronta' as Fase,
    msg: 'Ruota sgonfia appoggiata ai tamponi: inizia dalla stallonatura',
    tilt: COL_BACK_TILT,
    hex: HEX_UP,
    lock: 0,
    leverK: 0,
    bbPhi: 0.6,
    jawR: 0.27,
    ttAngle: 0,
    ttOmega: 0,
    wheelSpin: 0,
    onTT: false,
    pose: { pos: new THREE.Vector3(), quat: new THREE.Quaternion() },
    tire: { u: 0, alpha: 0, rest: 0, lag: 0 },
    pBead: 0,
    pJaw: 0,
    pTire: 0,
    bladeForce: 0,
    bladeTravel: 0,
    load: 0,
    flow: 0,
    seat: 1,
    air: new Set<string>(),
    pedal: [0, 0, 0, 0],
    pedalT: [0, 0, 0, 0],
    joy: 0,
    worm: 0,
    roll: 0,
    contacts: new Map<string, { at: THREE.Vector3; depth: number }>(),
    tools: {
      rullo: { swing: 2.3, reach: 0.4, drop: -0.18 },
      disco: { swing: 2.3, reach: 0.4, drop: -0.18 },
      cono: { swing: 2.3, reach: 0.4, drop: -0.18 },
    } as Record<'rullo' | 'disco' | 'cono', { swing: number; reach: number; drop: number }>,
  }
  let job: Co | null = null
  let el: Record<string, HTMLElement> = {}
  let airPhase = 0
  let dirty = true

  // ---------- geometria che dipende dalla ruota ----------

  const flangeR = () => geo.rimR + 0.019
  /** Centro della ruota sdraiata sul piatto, appoggiata sui gradini delle griffe. */
  const ttCenterY = () => TT_Y + 0.039 + geo.width / 2
  const flangeTopY = () => ttCenterY() + geo.width / 2 + 0.009
  /** Faccia interna della paletta in funzione dell'angolo del braccio. */
  const bladeX = (phi: number) => BB_P.x + ARM_L * Math.sin(phi) - 0.037
  const phiForX = (x: number) => Math.asin(THREE.MathUtils.clamp((x + 0.037 - BB_P.x) / ARM_L, -1, 1))
  const wheelX = () => PAD_X + geo.tireW / 2
  const sideX = () => wheelX() + geo.tireW / 2
  const phiContact = () => phiForX(sideX())
  const phiOpen = () => phiForX(sideX() + 0.16)
  const wheelZ = () => BB_P.z + ARM_L * Math.cos(phiContact()) - (geo.rimR + 0.045)

  function poseBB(inner: boolean) {
    const q = new THREE.Quaternion()
    if (inner) q.setFromAxisAngle(Y, Math.PI)
    return { pos: new THREE.Vector3(wheelX(), geo.tireR, wheelZ()), quat: q }
  }
  function poseTT() {
    return { pos: new THREE.Vector3(0, ttCenterY(), TT_Z), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2) }
  }
  const restPose = () => ({ pos: new THREE.Vector3(-0.9, geo.tireW / 2, 0.5), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2) })

  /** Punti di lavoro degli utensili dell'helper sulla ruota sdraiata. */
  const sideTopY = () => ttCenterY() + geo.width / 2 + 0.016
  const target = {
    // rullo davanti, dal lato opposto all'utensile di montaggio (che è dietro)
    rullo: () => new THREE.Vector3(-0.06, sideTopY(), TT_Z + geo.rimR + 0.035),
    // disco a sinistra, vicino alla balconata
    disco: () => new THREE.Vector3(-(geo.rimR + 0.04), sideTopY(), TT_Z + 0.04),
    // cono sul mozzo del cerchio
    cono: () => new THREE.Vector3(0, ttCenterY() + spec.et + 0.016, TT_Z),
  }

  /** Rapporto tra forza alla paletta e forza del cilindro (equilibrio dei momenti attorno al perno). */
  function leverRatio(phi: number) {
    const q = new THREE.Quaternion().setFromAxisAngle(Y, phi)
    const le = BB_LEVER.clone().applyQuaternion(q) // leva, rispetto al perno
    const dir = le.clone().add(BB_P).sub(BB_ANCHOR).normalize() // spinta del cilindro
    const tc = Math.abs(le.z * dir.x - le.x * dir.z)
    const blade = new THREE.Vector3(-0.037, BLADE_Y - BB_P.y, ARM_L).applyQuaternion(q)
    const tb = Math.abs(blade.z) // la paletta spinge lungo −x
    return tc / tb
  }

  function setWheel(next: WheelSpec) {
    spec = next
    geo = wheelGeometry(spec)
    tire = tireData(spec)
    model.buildWheel(spec)
    st.bbPhi = phiOpen()
    st.jawR = Math.min(flangeR() + 0.05, 0.275)
    const p = poseBB(false)
    st.pose.pos.copy(p.pos)
    st.pose.quat.copy(p.quat)
    st.onTT = false
    st.tire = { u: 0, alpha: 0, rest: 0, lag: 0 }
    st.pTire = 0
    st.seat = 1
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

  /** Gira il piatto di un angolo alla velocità di lavoro; during() riceve l'avanzamento 0..1. */
  function* rotate(turns: number, load: number, during?: (k: number) => void): Co {
    const omega = (SPEC.turntableRpm * Math.PI) / 30
    const total = Math.abs(turns) * Math.PI * 2
    press(0, true)
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
      st.roll += da
      during?.(done / total)
    }
    st.ttOmega = 0
    st.load = 0
    press(0, false)
  }

  function* moveTool(name: 'rullo' | 'disco' | 'cono', to: THREE.Vector3 | null, s = 0.9): Co {
    const t = model.helper[name]
    const from = { ...st.tools[name] }
    const goal = to ? model.helperPose(t, to) : { swing: 2.3, reach: 0.4, drop: -0.18 }
    if (to && name === 'rullo') model.aimRoller(goal.swing, to)
    st.air.add('helper')
    st.joy = to ? 1 : -1
    // prima gira e allunga il braccio con l'utensile alto, poi scende col cilindro
    const hold = Math.max(from.drop, -0.18)
    yield* tween(s * 0.6, (k) => {
      st.tools[name] = { swing: lerp(from.swing, goal.swing, k), reach: lerp(from.reach, goal.reach, k), drop: lerp(from.drop, to ? hold : goal.drop, k) }
    })
    if (to) yield* tween(s * 0.4, (k) => { st.tools[name].drop = lerp(hold, goal.drop, k) })
    st.air.delete('helper')
    st.joy = 0
  }

  /** L'utensile dell'helper preme il fianco: il contatto schiaccia il pneumatico. */
  function* pushTool(name: 'rullo' | 'disco', depth: number, s = 0.4): Co {
    const p = target[name]()
    st.air.add('helper')
    st.joy = 1
    yield* tween(s, (k) => {
      st.tools[name].drop = model.helperPose(model.helper[name], p).drop - depth * k
      st.contacts.set(name, { at: p.clone().setY(p.y - depth * k), depth: depth * k })
    })
    st.air.delete('helper')
    st.joy = 0
  }
  function* releaseTool(name: 'rullo' | 'disco'): Co {
    const c = st.contacts.get(name)
    const d0 = c?.depth ?? 0
    yield* tween(0.3, (k) => { if (c) c.depth = d0 * (1 - k) })
    st.contacts.delete(name)
    yield* moveTool(name, null, 0.8)
  }

  function* column(up: boolean): Co {
    press(3, true)
    st.air.add('palo')
    const a = st.tilt
    yield* tween(1.0, (k) => (st.tilt = lerp(a, up ? 0 : COL_BACK_TILT, k)))
    st.air.delete('palo')
    press(3, false)
  }
  function* hexTo(down: boolean): Co {
    if (!down && st.lock > 0) {
      st.air.add('asta')
      yield* tween(0.25, (k) => (st.lock = 1 - k))
      st.air.delete('asta')
    }
    const a = st.hex
    yield* tween(0.8, (k) => (st.hex = lerp(a, down ? 0 : HEX_UP, k)))
    if (down) {
      st.air.add('asta')
      yield* tween(0.25, (k) => (st.lock = k))
      st.air.delete('asta')
    }
  }
  function* moveWheel(to: { pos: THREE.Vector3; quat: THREE.Quaternion }, s: number, lift = 0.3): Co {
    const p0 = st.pose.pos.clone(), q0 = st.pose.quat.clone()
    yield* tween(s, (k) => {
      st.pose.pos.lerpVectors(p0, to.pos, k)
      st.pose.pos.y += Math.sin(Math.PI * k) * lift
      st.pose.quat.slerpQuaternions(q0, to.quat, k)
    })
  }
  function* leverWork(lift: number, alpha: number): Co {
    const u0 = st.tire.u, a0 = st.tire.alpha
    yield* tween(0.7, (k) => (st.leverK = k))
    yield* tween(0.6, (k) => {
      st.leverK = 1 + k
      st.tire.u = lerp(u0, lift, k)
      st.tire.alpha = lerp(a0, alpha, k)
    })
    yield* tween(0.6, (k) => (st.leverK = 2 * (1 - k)))
  }

  // ---------- passi ----------

  function* stallona(): Co {
    for (const inner of [false, true]) {
      if (inner) {
        say('Si gira la ruota per stallonare l\'altro fianco')
        yield* moveWheel(poseBB(true), 1.3, 0.15)
      }
      say(`Paletta contro il fianco ${inner ? 'interno' : 'esterno'}, vicino al cerchio`)
      const p0 = st.bbPhi
      yield* tween(0.8, (k) => (st.bbPhi = lerp(p0, phiContact(), k)))
      say('Pedale dello stallonatore: la pressione nel cilindro sale')
      press(2, true)
      st.air.add('stallonatore')
      const k = tire.breakForce / tire.breakTravel
      let popped = false
      while (!popped) {
        const dt: number = yield
        st.pBead += ((SPEC.linePressure - st.pBead) * dt) / SPEC.cylTau
        const fc = st.pBead * BAR * area(SPEC.beadCylBore)
        st.bladeForce = fc * leverRatio(st.bbPhi)
        st.bladeTravel = Math.min(st.bladeForce / k, tire.breakTravel)
        if (st.bladeForce >= tire.breakForce) popped = true
        st.bbPhi = phiForX(sideX() - st.bladeTravel)
      }
      say(`Il tallone si stacca dalla sede a ${num(st.bladeForce / 1000)} kN e scivola verso il canale`)
      const t0 = st.bladeTravel
      yield* tween(0.18, (q) => {
        st.bladeTravel = t0 + 0.02 * q
        st.bladeForce = lerp(tire.breakForce, tire.breakForce * 0.15, q)
        st.bbPhi = phiForX(sideX() - st.bladeTravel)
      })
      yield* wait(0.5)
      press(2, false)
      st.air.delete('stallonatore')
      const pb = st.pBead, f0 = st.bladeForce, tr = st.bladeTravel, ph = st.bbPhi
      yield* tween(0.7, (q) => {
        st.pBead = pb * (1 - q)
        st.bladeForce = f0 * (1 - q)
        st.bladeTravel = tr * (1 - q)
        st.bbPhi = lerp(ph, phiOpen(), q)
      })
      st.bladeTravel = 0
    }
    st.fase = 'stallonata'
    say('Talloni staccati su entrambi i lati: ora la ruota va sul piatto')
  }

  function* blocca(): Co {
    say('Griffe aperte, la ruota si appoggia sul piatto')
    press(1, true)
    st.air.add('griffe')
    const j0 = st.jawR
    yield* tween(0.4, (k) => (st.jawR = lerp(j0, Math.min(flangeR() + 0.05, 0.275), k)))
    st.air.delete('griffe')
    press(1, false)
    yield* moveWheel(poseTT(), 1.8, 0.35)
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
    say('Il palo torna in verticale, l\'asta scende e si blocca')
    yield* column(true)
    yield* hexTo(true)
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
    say('Con la leva il tallone superiore sale sopra la lingua dell\'utensile')
    yield* leverWork(0.03, -0.1)
    say('Il piatto gira: il tallone superiore scivola fuori dal cerchio')
    yield* rotate(1.15, SPEC.peelTorque, (k) => {
      st.tire.u = lerp(0.03, 0.065, k)
      st.tire.alpha = lerp(-0.1, -0.22, k)
      st.tire.lag = -0.15 * Math.sin(Math.PI * k)
    })
    if (useHelper) yield* releaseTool('rullo')
    say('Tallone inferiore: la leva lo porta sopra l\'utensile, poi un altro giro')
    yield* leverWork(0.09, -0.24)
    const u1 = geo.width + 0.05
    yield* rotate(1, SPEC.peelTorque * 0.8, (k) => {
      st.tire.u = lerp(0.09, u1, k)
      st.tire.alpha = lerp(-0.24, -0.05, k)
    })
    say('L\'asta si sblocca e si alza, il pneumatico viene tolto')
    yield* hexTo(false)
    yield* tween(1.4, (k) => (st.tire.rest = k))
    st.fase = 'smontata'
    say('Pneumatico smontato: il cerchio è libero sul piatto')
  }

  function* monta(): Co {
    const u1 = geo.width + 0.05
    say('Il pneumatico torna sopra il cerchio, inclinato verso l\'utensile')
    st.tire.u = u1
    st.tire.alpha = -0.22
    yield* tween(1.4, (k) => (st.tire.rest = 1 - k))
    yield* hexTo(true)
    say('Tallone inferiore: girando il piatto scorre sotto la lingua ed entra nel cerchio')
    yield* rotate(1, SPEC.peelTorque * 0.6, (k) => {
      st.tire.u = lerp(u1, 0.06, k)
      st.tire.alpha = lerp(-0.22, -0.15, k)
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
    say('Talloni dentro il cerchio: asta su, palo indietro')
    yield* hexTo(false)
    yield* column(false)
    st.fase = 'montata'
    say('Pneumatico montato, talloni ancora nel canale: si gonfia')
  }

  function* gonfia(): Co {
    // porta la valvola verso il manometro (davanti a sinistra)
    const psi = Math.atan2(0.3, 0.32)
    let d = (psi - 2.4 - st.wheelSpin) % (Math.PI * 2)
    if (d < 0) d += Math.PI * 2
    say('Il piatto porta la valvola verso il gruppo di gonfiaggio')
    yield* rotate(d / (Math.PI * 2), 20)
    model.setHose(model.valveWorld())
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
        st.jawR = lerp(j0, Math.min(flangeR() + 0.05, 0.275), k)
        st.pJaw = SPEC.linePressure * (1 - k)
      })
      st.air.delete('griffe')
      press(1, false)
      st.onTT = false
      yield* moveWheel(poseBB(false), 1.6, 0.35)
    }
    st.seat = 1
    st.fase = 'pronta'
    say('Ruota sgonfia appoggiata ai tamponi: inizia dalla stallonatura')
  }

  const RUN: Record<string, () => Co> = { stallona, blocca, smonta, monta, gonfia }
  function* ciclo(): Co {
    if (st.fase === 'gonfia') yield* nuovo()
    for (const s of STEPS) if (st.fase === s.from) yield* RUN[s.id]()
  }
  const start = (co: Co) => { if (!job && model.exploded < 0.01) { job = co; job.next(0) } }

  // ---------- applicazione dello stato al modello ----------

  const tmpQ = new THREE.Quaternion()
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

    // leva: riposo sul piano, poi infilata accanto all'utensile, poi premuta
    const rest = { p: new THREE.Vector3(-0.3, 0.745, 0.12), q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2) }
    const tip = new THREE.Vector3(0.07, flangeTopY() - 0.004, TT_Z - flangeR() + 0.014)
    const ins = { p: tip, q: new THREE.Quaternion().setFromUnitVectors(Y, new THREE.Vector3(0.15, 0.75, -0.65).normalize()) }
    const prs = { p: tip.clone().add(new THREE.Vector3(0, 0.02, 0)), q: new THREE.Quaternion().setFromUnitVectors(Y, new THREE.Vector3(0.15, 0.28, -0.95).normalize()) }
    const [a, b, k] = st.leverK <= 1 ? [rest, ins, st.leverK] : [ins, prs, st.leverK - 1]
    model.lever.position.lerpVectors(a.p, b.p, k)
    if (st.leverK > 0 && st.leverK < 1) model.lever.position.y += Math.sin(Math.PI * k) * 0.15
    model.lever.quaternion.slerpQuaternions(a.q, b.q, k)

    // ruota e pneumatico
    model.wheelPose.position.copy(st.pose.pos)
    model.wheelPose.quaternion.copy(st.pose.quat)
    model.rimSpin.rotation.x = st.wheelSpin
    const hp = st.pose.pos.clone().add(new THREE.Vector3(st.tire.u, 0, 0).applyQuaternion(st.pose.quat))
    const hq = st.pose.quat.clone().multiply(tmpQ.setFromAxisAngle(Y, st.tire.alpha))
    if (st.tire.rest > 0) {
      const r = restPose()
      hp.lerp(r.pos, st.tire.rest)
      hp.y += Math.sin(Math.PI * st.tire.rest) * 0.3
      hq.slerp(r.quat, st.tire.rest)
    }
    model.tireHolder.position.copy(hp)
    model.tireHolder.quaternion.copy(hq)
    model.tireSpin.rotation.x = st.wheelSpin + st.tire.lag
    model.setSeat(st.seat)

    // helper
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
  }

  // ---------- pannello ----------

  const faseLabel: Record<Fase, string> = { pronta: 'PRONTA', stallonata: 'STALLONATA', bloccata: 'BLOCCATA', smontata: 'SMONTATA', montata: 'MONTATA', gonfia: 'GONFIA' }

  return {
    id: 'smontagomme',
    name: 'Smontagomme',
    subtitle: 'con braccio di aiuto',
    workTab: 'Lavoro',
    model,
    parts: PARTS,
    order: ['pneumatico', 'cerchio', 'piatto', 'griffe', 'cilindri-griffe', 'palo', 'cilindro-palo', 'braccio', 'asta', 'bloccaggio', 'utensile', 'leva', 'stallonatore', 'cilindro-stallonatore', 'tamponi', 'helper', 'helper-rullo', 'helper-disco', 'helper-cono', 'helper-cilindri', 'helper-comando', 'pedaliera', 'valvole', 'frl', 'gonfiaggio', 'riduttore', 'cinghia', 'motore', 'mobile'],
    view: { target: [0.0, 0.72, 0.0], halfWidth: 1.15 },
    physicsText: TEXT,
    get busy() { return job !== null },

    mount(pane) {
      pane.innerHTML = PANE
      el = {}
      pane.querySelectorAll<HTMLElement>('[data-id]').forEach((e) => (el[e.dataset.id!] = e))
      const sel = el.ruota as HTMLSelectElement
      for (const w of WHEELS) sel.append(new Option(w.label + (w.aspect <= 45 ? ' · ribassato' : ''), w.id))
      sel.value = spec.id
      sel.addEventListener('change', () => {
        if (job || st.fase !== 'pronta') { sel.value = spec.id; return }
        setWheel(WHEELS.find((w) => w.id === sel.value)!)
      })
      const hc = el.helper as HTMLInputElement
      hc.checked = useHelper
      hc.addEventListener('change', () => (useHelper = hc.checked))
      pane.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => b.addEventListener('click', () => start(RUN[b.dataset.step!]())))
      el.ciclo.addEventListener('click', () => start(ciclo()))
      el.nuovo.addEventListener('click', () => start(nuovo()))
    },

    update(dt, _now, flows) {
      let moving = false
      if (job) {
        moving = true
        if (job.next(dt).done) job = null
      }
      // pedali e motore
      for (let i = 0; i < 4; i++) {
        const d = st.pedalT[i] - st.pedal[i]
        if (Math.abs(d) > 1e-3) { st.pedal[i] += d * Math.min(1, dt * 12); moving = true }
      }
      if (st.ttOmega > 0) {
        st.worm += st.ttOmega * SPEC.wormTeeth * dt
        model.beltMap.offset.x -= ((st.ttOmega * SPEC.wormTeeth * 0.034 * dt) / model.beltLen) * model.beltMap.repeat.x
      }
      // pneumatico schiacciato da paletta e utensili dell'helper
      const contacts = [...st.contacts.values()]
      if (st.bladeTravel > 0) {
        const z = BB_P.z + ARM_L * Math.cos(st.bbPhi)
        contacts.push({ at: new THREE.Vector3(sideX(), BLADE_Y, z), depth: st.bladeTravel })
      }
      if (moving || contacts.length) model.dent(contacts)

      // flussi: aria nei tubi, forza sulla paletta
      airPhase += dt * 0.9
      model.air(flows ? st.air : new Set(), airPhase)
      const showF = flows && st.bladeForce > 50
      model.bladeArrow.visible = showF
      if (showF) {
        const z = BB_P.z + ARM_L * Math.cos(st.bbPhi)
        // la freccia finisce sulla paletta: lunghezza proporzionale alla forza
        const len = 0.06 + (st.bladeForce / 10000) * 0.2
        model.bladeArrow.position.set(bladeX(st.bbPhi) + 0.03 + len, BLADE_Y + 0.06, z)
        model.bladeArrow.setLength(len, 0.05, 0.035)
      }
      if (moving || dirty) apply()
      const redraw = moving || dirty || (flows && st.air.size > 0)
      dirty = false
      return redraw
    },

    refresh() {
      if (el.messaggio) {
        el.messaggio.textContent = st.msg
        el.pt.textContent = `${num(st.pTire, 2)} bar`
        el.fb.textContent = `${num(st.bladeForce / 1000)} kN`
        el.rpm.textContent = `${num((st.ttOmega * 30) / Math.PI, 0)} giri/min`
        const cur = ORDER.indexOf(st.fase)
        const apart = model.exploded > 0.01
        document.querySelectorAll<HTMLButtonElement>('#pane-lavoro [data-step]').forEach((b, i) => {
          b.disabled = !!job || apart || STEPS[i].from !== st.fase
          b.classList.toggle('fatto', cur > i)
          b.classList.toggle('corrente', STEPS[i].from === st.fase && !apart)
        })
        const ciclo = el.ciclo as HTMLButtonElement
        ciclo.disabled = !!job || apart
        ciclo.textContent = apart ? 'Rimonta per lavorare' : '▶ Ciclo completo'
        ;(el.nuovo as HTMLButtonElement).disabled = !!job || apart || st.fase === 'pronta'
        ;(el.ruota as HTMLSelectElement).disabled = !!job || st.fase !== 'pronta'
      }
      return { status: faseLabel[st.fase], detail: `${num(st.pTire, 2)} bar` }
    },

    physics() {
      const fc = st.pBead * BAR * area(SPEC.beadCylBore)
      const tt = turntableTorque()
      const rows: [string, string][] = [
        ['Pressione di linea', `${SPEC.linePressure} bar ${IND}`],
        ['Cilindro stallonatore', `${num(st.pBead, 1)} bar · ${num(fc / 1000)} kN`],
        ['Rapporto di leva', `${num(leverRatio(st.bbPhi), 2)}`],
        ['Forza sulla paletta', `${num(st.bladeForce / 1000)} kN`],
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
      ]
      return rows
    },
  }
}
