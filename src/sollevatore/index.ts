import { Section } from '../core/section'
import { Machine, IND } from '../core/machine'
import { InterferenceCheck, Hit } from '../core/interference'
import { num, setText } from '../ui'
import { PARTS, ORDER } from './parts'
import { LiftModel, ARMS, REACH, PAD0, PAD_MAX, ROOF_BAR, pivotOf, parkedPsi, ArmPose } from './model'
import { SPEC, G, AUTO, Auto, vite, coppiaVite, motore, velocita, puntiAuto, baricentro, carichi } from './physics'

/** Tolleranza del controllo di compenetrazione, m; i tamponi toccano l'auto per mestiere. */
const CLASH_TOL = 0.002
const PAD_TOL = 0.004
const CHECK_EVERY = 5
/** Velocità dell'auto che entra (m/s) e dei movimenti dei bracci. */
const CAR_V = 1.2, PSI_V = 1.2, EXT_V = 0.35, PAD_V = 0.06
/** Quota dell'auto fuori dal sollevatore, davanti all'operatore. */
const FUORI = 6.5
/** Spostamento del baricentro dalla linea delle colonne oltre il quale compare l'avviso, m. */
const CG_MAX = 0.3

type Fase = 'vuoto' | 'entrata' | 'auto' | 'bracci' | 'pronto' | 'riponi' | 'uscita'
type Moto = 'fermo' | 'salita' | 'discesa'
type Co = Generator<void, void, number>

const PANE = `
  <p data-id="messaggio" class="messaggio"></p>
  <div class="manometro">
    <div><small>Tamponi</small><b data-id="m-h">0 mm</b></div>
    <div><small>Carico</small><b data-id="m-kg">0 kg</b></div>
    <div><small>Velocità</small><b data-id="m-v">0 mm/s</b></div>
  </div>
  <div class="riga">
    <label class="campo">Auto <select data-id="auto"></select></label>
    <label class="campo">Carico nel vano, kg <input data-id="carico" type="number" min="0" max="2000" step="50" value="0" /></label>
  </div>
  <label class="campo">Posizione dell'auto <output data-id="o-pos">consigliata</output>
    <input data-id="pos" type="range" min="-60" max="60" value="0" /></label>
  <div class="riga">
    <button data-id="entra">Entra l'auto</button>
    <button data-id="bracci">Posiziona i bracci</button>
  </div>
  <p class="legenda">Quadro comandi: SALITA e DISCESA si tengono premuti</p>
  <div class="riga pulsantiera">
    <button data-id="su" class="uomo-presente">▲ SALITA</button>
    <button data-id="giu" class="uomo-presente">▼ DISCESA</button>
    <button data-id="stop" class="emergenza">STOP</button>
  </div>
  <div class="riga">
    <button data-id="ciclo" class="primario">▶ Ciclo completo</button>
    <button data-id="rompi">Rompi la madrevite portante</button>
  </div>
  <div data-id="avvisi" class="avvisi" role="status"></div>`

const TEXT = `
  <h3>Come si ripartisce il peso</h3>
  <p>L'auto appoggia su quattro tamponi. Con l'equilibrio di forze e momenti (regola della leva) il peso si divide tra davanti e dietro in proporzione inversa alla distanza del baricentro: <code>F<sub>ant</sub> = P · (z<sub>post</sub> − z<sub>G</sub>) / (z<sub>post</sub> − z<sub>ant</sub>)</code>. Allo stesso modo si divide tra sinistra e destra. Un'auto a motore anteriore carica di più i bracci corti davanti; una a motore posteriore quelli lunghi dietro. Il baricentro va tenuto vicino alla linea delle colonne: se è troppo avanti o troppo indietro i carrelli lavorano con un forte momento ribaltante e un braccio può superare il suo carico massimo.</p>
  <h3>Vite trapezia e autobloccaggio</h3>
  <p>La vite è un piano inclinato avvolto: l'angolo d'elica è <code>λ = arctan(p / π d<sub>2</sub>)</code>. L'attrito del filetto trapezio vale come un angolo <code>φ' = arctan(μ / cos 15°)</code>. Per salire serve la coppia <code>C = F · d<sub>2</sub>/2 · tan(λ + φ')</code>, e il rendimento è <code>η = tan λ / tan(λ + φ')</code>. Se <code>λ &lt; φ'</code> la vite è autobloccante: il peso non riesce a farla girare da solo, il carrello sta su anche a motore spento. Il prezzo è un rendimento sotto il 50%.</p>
  <h3>Motore e velocità</h3>
  <p>Cinghia e ingranaggi riducono i giri del motore di ${SPEC.rapportoCinghia * SPEC.rapportoIngranaggi} volte; a ogni giro della vite il carrello sale di un passo. La potenza è <code>P = C · ω / η<sub>trasmissione</sub></code>. Il motore asincrono rallenta un poco quando la coppia cresce: la colonna più carica resta indietro di qualche millimetro e il quadro ferma per un attimo quella più veloce (sincronismo), mentre i cavi d'acciaio nella trave fanno da rinforzo meccanico.</p>
  <h3>Madrevite di sicurezza</h3>
  <p>Sotto la madrevite portante ce n'è una seconda che sale vuota, a ${SPEC.giocoSicurezza * 1000} mm. Se la portante cede, il carrello cala di quei millimetri, si appoggia alla seconda e un microinterruttore ferma tutto. Con «Rompi la madrevite portante» si vede succedere: in sezione la madrevite di sicurezza si illumina.</p>`

/** Compenetrazione registrata, con la fase in cui è avvenuta. */
export interface LiftClash extends Hit { step: string; car: string }

/** Sollevatore con gli agganci per la verifica automatica (tools/verifica.ts). */
export interface Lift extends Machine {
  readonly test: {
    setCar(id: string): boolean
    setCarico(kg: number): void
    setOffset(m: number): void
    entra(): boolean
    esci(): boolean
    bracci(): boolean
    riponi(): boolean
    press(k: 'su' | 'giu', on: boolean): void
    stop(): void
    ciclo(): boolean
    rompi(): boolean
    ripristina(): void
    checkEveryFrame(): void
    readonly clashes: LiftClash[]
    readonly fase: string
    readonly moto: string
    /** Corsa dei carrelli e calo dopo la rottura, m. */
    readonly h: number[]
    readonly drop: number[]
    /** Carichi sui bracci (N), sulle colonne (N), avvisi attivi, dislivello massimo visto in salita (m). */
    readonly bracciN: number[]
    readonly colonneN: number[]
    readonly avvisi: string[]
    readonly dislivelloMax: number
    readonly carY: number
    readonly messaggio: string
    /** Prova del controllo: alza i tamponi di dy (m) dentro l'auto e riporta cosa tocca. */
    probePads(dy: number): Hit[]
  }
}

export function createLift(section: Section): Lift {
  const model = new LiftModel(section)
  let auto: Auto = AUTO[0]
  let carico = 0
  let offset = 0
  let fase: Fase = 'vuoto'
  let moto: Moto = 'fermo'
  let messaggio = 'Scegli l\'auto e premi «Entra l\'auto»'
  let carZ = FUORI, carTarget = 0, wheelRot = 0
  const h = [0, 0], drop = [0, 0], dropV = [0, 0], screw = [0, 0], pausa = [false, false]
  const v = [0, 0], n = [0, 0], coppia = [0, 0], potenza = [0, 0]
  let rottura = -1
  let emergenza = false
  let barra = 0
  let syncMax = 0
  const hold = { su: false, giu: false }
  const arms: ArmPose[] = [0, 1, 2, 3].map((i) => ({ psi: parkedPsi(i), ext: 0, e: 0 }))
  let targets: ArmPose[] | null = null
  let job: Co | null = null
  let el: Record<string, HTMLElement> = {}
  let changed = true

  // ---------- geometria del carico ----------

  const pos = () => consigliata(auto) + offset
  /** Punti di sollevamento (mondo), baricentro e carichi per l'auto alla posizione attuale. */
  function stato() {
    const pt = puntiAuto(auto)
    const bc = baricentro(auto, carico)
    const z0 = fase === 'entrata' || fase === 'uscita' ? carZ : pos()
    const zA = z0 + pt.zAnt, zP = z0 + pt.zPost, zG = z0 + bc.z
    const c = carichi(bc.m, zG, bc.x, zA, zP, pt.x)
    const bracci = [c.as, c.ps, c.ad, c.pd]
    return { pt, bc, zA, zP, zG, c, bracci }
  }
  /** Posa dei bracci sotto i punti di sollevamento: angolo, sfilo e tampone; null se un punto non si raggiunge. */
  function armTargets(): { pose: ArmPose[]; ok: boolean } {
    const s = stato()
    let ok = true
    const pose = ARMS.map((a, i) => {
      const p = pivotOf(i)
      const tx = a.s * s.pt.x, tz = a.kind === 'ant' ? s.zA : s.zP
      const dx = tx - p.x, dz = tz - p.z
      const L = Math.hypot(dx, dz)
      const [lo, hi] = REACH[a.kind]
      if (L < lo - 1e-6 || L > hi + 1e-6) ok = false
      const e = auto.sottoscocca - PAD0
      if (e < 0 || e > PAD_MAX) ok = false
      return { psi: Math.atan2(-dz, dx), ext: Math.min(Math.max(L - lo, 0), hi - lo), e: Math.min(Math.max(e, 0), PAD_MAX) }
    })
    return { pose, ok }
  }
  const caricata = () => fase === 'pronto'
  /** Avvisi: quelli che bloccano la salita e quelli che segnalano soltanto. */
  function avvisi(): { blocca: string[]; segnala: string[] } {
    const blocca: string[] = [], segnala: string[] = []
    if (fase === 'vuoto' || fase === 'entrata' || fase === 'uscita') return { blocca, segnala }
    const s = stato()
    if (s.bc.m > SPEC.portata) blocca.push(`Portata superata: ${num(s.bc.m, 0)} kg su ${SPEC.portata} kg`)
    const neg = s.bracci.findIndex((f) => f < 0)
    if (neg >= 0) blocca.push('Baricentro fuori dai punti di sollevamento: l\'auto si ribalterebbe')
    s.bracci.forEach((f, i) => {
      if (f > SPEC.braccioMax * G) blocca.push(`Braccio ${nomeBraccio(i)} sovraccarico: ${num(f / G, 0)} kg su ${SPEC.braccioMax} kg`)
    })
    if (!armTargets().ok) blocca.push('Punti di sollevamento fuori dalla portata dei bracci: sposta l\'auto')
    if (Math.abs(s.zG) > CG_MAX) segnala.push(`Baricentro spostato di ${num(Math.abs(s.zG) * 1000, 0)} mm ${s.zG > 0 ? 'verso i bracci posteriori' : 'verso i bracci anteriori'} rispetto alle colonne: sposta l'auto`)
    const qa = s.c.ant / (s.c.ant + s.c.post)
    if (qa > 0.7 || qa < 0.3) segnala.push(`Ripartizione sbilanciata: ${Math.round(qa * 100)} % davanti, ${Math.round((1 - qa) * 100)} % dietro`)
    return { blocca, segnala }
  }

  // ---------- comandi ----------

  const apart = () => model.exploded > 0.01
  const fermo = () => moto === 'fermo' && !job
  const giu = () => h[0] < 1e-4 && h[1] < 1e-4
  // il ciclo automatico usa gli stessi comandi: qui non conta se c'è un ciclo in corso
  const libera = () => !apart() && moto === 'fermo' && !emergenza && rottura < 0
  function setCar(id: string) {
    const c = AUTO.find((a) => a.id === id)
    if (!c || !(fase === 'vuoto' || fase === 'auto') || !giu() || !libera()) return false
    auto = c
    if (fase === 'auto') model.setCar(c)
    changed = true
    return true
  }
  function entra() {
    if (fase !== 'vuoto' || !giu() || !libera()) return false
    model.setCar(auto)
    carZ = FUORI
    carTarget = pos()
    fase = 'entrata'
    messaggio = 'L\'auto entra tra le colonne'
    return true
  }
  function esci() {
    if (fase !== 'auto' || !giu() || !libera()) return false
    fase = 'uscita'
    carZ = pos()
    carTarget = FUORI
    messaggio = 'L\'auto esce'
    return true
  }
  function bracci() {
    if (fase !== 'auto' || !giu() || !libera()) return false
    const t = armTargets()
    if (!t.ok) { messaggio = 'I bracci non arrivano ai punti di sollevamento: sposta l\'auto'; return false }
    targets = t.pose
    fase = 'bracci'
    messaggio = 'Bracci sotto i punti di sollevamento, tamponi regolati in altezza'
    return true
  }
  function riponi() {
    if (fase !== 'pronto' || !giu() || !libera()) return false
    targets = [0, 1, 2, 3].map((i) => ({ psi: parkedPsi(i), ext: 0, e: 0 }))
    fase = 'riponi'
    messaggio = 'Bracci a riposo'
    return true
  }
  function stop() {
    job = null
    hold.su = hold.giu = false
    emergenza = !emergenza
    if (emergenza) { moto = 'fermo'; messaggio = 'STOP di emergenza: motori fermi. Riarma per continuare' }
    else messaggio = 'Riarmato'
    changed = true
  }
  function rompi() {
    if (rottura >= 0 || apart() || Math.max(h[0], h[1]) < 0.05) return false
    const s = stato()
    // cede la madrevite della colonna più carica
    const col = [s.bracci[0] + s.bracci[1], s.bracci[2] + s.bracci[3]]
    rottura = col[0] >= col[1] ? 0 : 1
    dropV[rottura] = 0
    messaggio = `Madrevite portante della colonna ${rottura === 0 ? 'sinistra' : 'destra'} rotta`
    changed = true
    return true
  }
  function ripristina() {
    rottura = -1
    drop[0] = drop[1] = 0
    dropV[0] = dropV[1] = 0
    messaggio = 'Madrevite portante sostituita: il sollevatore è di nuovo libero'
    changed = true
  }
  function press(k: 'su' | 'giu', on: boolean) {
    if (on) job = null
    hold[k] = on
  }

  /** Ciclo completo: entra, bracci, salita fino al fine corsa, pausa, discesa, bracci a riposo, esce. */
  function* ciclo(): Co {
    // la fase cambia dentro update: la si rilegge ogni volta
    const f = (): Fase => fase
    if (f() === 'vuoto') { entra(); while (f() === 'entrata') yield }
    if (f() === 'auto') { if (!bracci()) return; while (f() === 'bracci') yield }
    hold.su = true
    yield
    while (moto !== 'fermo') yield
    hold.su = false
    for (let t = 0; t < 2; t += yield);
    hold.giu = true
    yield
    while (moto !== 'fermo') yield
    hold.giu = false
    if (!giu()) return
    riponi()
    while (f() === 'riponi') yield
    esci()
    while (f() === 'uscita') yield
  }
  function avviaCiclo() {
    if (!libera() || !(fase === 'vuoto' || fase === 'auto' || fase === 'pronto')) return false
    hold.su = hold.giu = false
    const g = ciclo()
    g.next()
    job = g
    return true
  }

  // ---------- controllo di compenetrazione ----------

  const checker = new InterferenceCheck(model.root, (o) => model.isCarOrMarker(o))
  const clashes: LiftClash[] = []
  const seen = new Set<string>()
  let frame = 0, checkEvery = CHECK_EVERY
  function checkClash() {
    const step = moto !== 'fermo' ? moto : fase
    for (const hit of checker.runShapes(model.carShapes(), (p) => (p === 'tampone' ? PAD_TOL : CLASH_TOL))) {
      const key = auto.id + '|' + step + '|' + hit.part
      if (seen.has(key)) continue
      seen.add(key)
      clashes.push({ ...hit, step, car: auto.id })
      console.warn(`[compenetrazione] Sollevatore ${auto.label} · ${step} · ${PARTS[hit.part]?.name ?? hit.part} dentro l'auto di ${num(hit.depth * 1000, 1)} mm`)
    }
  }

  // ---------- simulazione ----------

  const approach = (x: number, to: number, step: number) => (Math.abs(to - x) <= step ? to : x + Math.sign(to - x) * step)

  function update(dt: number): boolean {
    let moving = false
    if (job) {
      const r = job.next(dt)
      if (r.done) job = null
      moving = true
    }

    // auto che entra o esce
    if (fase === 'entrata' || fase === 'uscita') {
      const z = approach(carZ, carTarget, CAR_V * dt * Math.min(1, 0.4 + Math.abs(carTarget - carZ)))
      wheelRot -= (z - carZ) / auto.ruotaR
      carZ = z
      moving = true
      if (carZ === carTarget) {
        if (fase === 'entrata') { fase = 'auto'; messaggio = 'Auto tra le colonne: posiziona i bracci' }
        else { fase = 'vuoto'; model.setCar(null); messaggio = 'Sollevatore libero' }
      }
    }

    // bracci: prima girano, poi si sfilano, poi i tamponi salgono (in uscita al contrario)
    if ((fase === 'bracci' || fase === 'riponi') && targets) {
      moving = true
      const out = fase === 'bracci'
      let done = true
      arms.forEach((a, i) => {
        const t = targets![i]
        const turnDone = Math.abs(a.psi - t.psi) < 1e-6, extDone = Math.abs(a.ext - t.ext) < 1e-6
        if (out) {
          if (!turnDone) a.psi = approach(a.psi, t.psi, PSI_V * dt)
          else if (!extDone) a.ext = approach(a.ext, t.ext, EXT_V * dt)
          else a.e = approach(a.e, t.e, PAD_V * dt)
        } else {
          if (Math.abs(a.e - t.e) > 1e-6) a.e = approach(a.e, t.e, PAD_V * dt)
          else if (!extDone) a.ext = approach(a.ext, t.ext, EXT_V * dt)
          else a.psi = approach(a.psi, t.psi, PSI_V * dt)
        }
        if (Math.abs(a.psi - t.psi) > 1e-6 || Math.abs(a.ext - t.ext) > 1e-6 || Math.abs(a.e - t.e) > 1e-6) done = false
      })
      if (done) {
        targets = null
        if (out) { fase = 'pronto'; messaggio = 'Pronto: tieni premuto SALITA' }
        else { fase = 'auto'; messaggio = 'Bracci a riposo: l\'auto può uscire' }
      }
    }

    // salita e discesa a uomo presente
    const prima = moto
    const su = hold.su && !hold.giu, dis = hold.giu && !hold.su
    let want: Moto = su ? 'salita' : dis ? 'discesa' : 'fermo'
    const allowed = !apart() && !emergenza && rottura < 0 && (fase === 'vuoto' || fase === 'auto' || fase === 'pronto')
    if (want !== 'fermo' && !allowed) {
      want = 'fermo'
      if (hold.su || hold.giu) messaggio = emergenza ? 'STOP di emergenza premuto: riarma prima' : rottura >= 0 ? 'Madrevite di sicurezza in presa: comandi bloccati' : apart() ? 'Rimonta la macchina per lavorare' : messaggio
    }
    if (want === 'salita') {
      const blocchi = fase === 'pronto' ? avvisi().blocca : []
      if (blocchi.length) { want = 'fermo'; messaggio = 'Salita bloccata: ' + blocchi[0] }
      else if (Math.max(h[0], h[1]) >= SPEC.corsa - 1e-6) { want = 'fermo'; messaggio = 'Fine corsa superiore' }
      else if (barra >= 1) { want = 'fermo'; messaggio = 'Barra di sicurezza: il tetto tocca la trave' }
    }
    if (want === 'discesa' && giu()) { want = 'fermo'; messaggio = 'Fine corsa inferiore' }
    moto = want
    const s = stato()
    const conAuto = caricata()
    const colN = [0, 1].map((k) => (conAuto && Math.max(h[0], h[1]) > 0 ? s.bracci[2 * k] + s.bracci[2 * k + 1] : 0) + SPEC.massaCarrello * G)
    for (let k = 0; k < 2; k++) {
      coppia[k] = coppiaVite(colN[k], moto !== 'discesa')
      const mt = motore(coppia[k])
      n[k] = moto === 'fermo' || pausa[k] ? 0 : mt.n
      potenza[k] = moto === 'fermo' || pausa[k] ? 0 : mt.assorbita
      v[k] = velocita(n[k]) * (moto === 'discesa' ? -1 : 1)
    }
    if (moto !== 'fermo') {
      moving = true
      // sincronismo: il quadro ferma un attimo la colonna che va avanti
      const d = (h[0] - h[1]) * (moto === 'salita' ? 1 : -1)
      if (d > SPEC.dislivelloMax) pausa[0] = true
      if (-d > SPEC.dislivelloMax) pausa[1] = true
      if (Math.abs(d) < 0.001) pausa[0] = pausa[1] = false
      for (let k = 0; k < 2; k++) {
        const nh = Math.min(Math.max(h[k] + v[k] * dt, 0), SPEC.corsa)
        screw[k] += ((nh - h[k]) / SPEC.passo) * Math.PI * 2
        h[k] = nh
      }
      if (moto === 'salita') syncMax = Math.max(syncMax, Math.abs(h[0] - h[1]))
      // barra del tetto: si ferma prima che il tetto la tocchi
      if (conAuto && carTop() >= ROOF_BAR - 0.004) { barra = 1; moto = 'fermo'; messaggio = 'Barra di sicurezza: il tetto ha toccato la barra, salita ferma' }
      if (moto === 'salita' && Math.max(h[0], h[1]) >= SPEC.corsa - 1e-6) { moto = 'fermo'; messaggio = 'Fine corsa superiore: auto in alto' }
      if (moto === 'discesa' && giu()) { moto = 'fermo'; h[0] = h[1] = 0; messaggio = conAuto ? 'Fine corsa inferiore: auto a terra' : 'Fine corsa inferiore' }
    } else pausa[0] = pausa[1] = false
    if (moto === 'discesa' && conAuto && carTop() < ROOF_BAR - 0.03) barra = 0
    if (prima !== moto && moto !== 'fermo') messaggio = moto === 'salita' ? 'Salita: colonne sincronizzate' : 'Discesa'

    // rottura: il carrello cala del gioco e si appoggia sulla madrevite di sicurezza
    if (rottura >= 0 && drop[rottura] < SPEC.giocoSicurezza) {
      moving = true
      moto = 'fermo'
      hold.su = hold.giu = false
      job = null
      dropV[rottura] += G * dt
      drop[rottura] = Math.min(drop[rottura] + dropV[rottura] * dt, SPEC.giocoSicurezza)
      if (drop[rottura] >= SPEC.giocoSicurezza) messaggio = `Madrevite di sicurezza in presa: carrello ${rottura === 0 ? 'sinistro' : 'destro'} fermo dopo ${SPEC.giocoSicurezza * 1000} mm, microinterruttore aperto, comandi bloccati`
    }

    pose()
    if ((moving || changed) && ++frame % checkEvery === 0) checkClash()
    return moving
  }

  /** Altezza dei tamponi sopra il carrello in basso e quota dell'auto. */
  const hEff = (k: number) => h[k] - drop[k]
  function carPose() {
    if (fase === 'vuoto') return null
    const pt = puntiAuto(auto)
    const z = fase === 'entrata' || fase === 'uscita' ? carZ : pos()
    if (!caricata()) return { z, y: 0, roll: 0, wheels: wheelRot }
    const l = Math.max(hEff(0), 0), r = Math.max(hEff(1), 0)
    return { z, y: (l + r) / 2, roll: (r - l) / (2 * pt.x), wheels: wheelRot }
  }
  const carTop = () => (carPose()?.y ?? 0) + auto.altezza

  function pose() {
    model.setPose({
      h: [h[0], h[1]], drop: [drop[0], drop[1]], screw: [screw[0], screw[1]], arms,
      locked: Math.max(h[0], h[1]) > 0.02, car: carPose(),
      pressed: { su: moto === 'salita', giu: moto === 'discesa', stop: emergenza }, barra,
      sicurezza: rottura >= 0 && drop[rottura] >= SPEC.giocoSicurezza ? rottura : -1,
    })
  }
  pose()

  // ---------- pannello ----------

  const nomeBraccio = (i: number) => ['sinistro anteriore', 'sinistro posteriore', 'destro anteriore', 'destro posteriore'][i]
  const holdButton = (b: HTMLElement, k: 'su' | 'giu') => {
    const off = () => press(k, false)
    b.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; b.setPointerCapture?.(e.pointerId); press(k, true) })
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) b.addEventListener(ev, off)
    b.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(k, true) } })
    b.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') off() })
    b.addEventListener('blur', off)
    b.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  return {
    id: 'sollevatore',
    name: 'Sollevatore',
    subtitle: 'a due colonne elettromeccanico',
    workTab: 'Lavoro',
    model,
    parts: PARTS,
    order: ORDER,
    view: { target: [0, 1.75, 0], halfWidth: 3.2, dir: [-1, 0.5, 0.7] },
    stage: { maxDistance: 16, fog: [10, 22] },
    physicsText: TEXT,
    partView: (id) => model.viewOf(id),
    get busy() { return !fermo() || fase === 'entrata' || fase === 'uscita' || fase === 'bracci' || fase === 'riponi' },

    test: {
      setCar,
      setCarico(kg) { carico = Math.max(0, kg); changed = true },
      setOffset(m) { offset = m; changed = true },
      entra, esci, bracci, riponi, press, stop, rompi, ripristina,
      ciclo: avviaCiclo,
      checkEveryFrame() { checkEvery = 1 },
      clashes,
      get fase() { return fase },
      get moto() { return moto },
      get h() { return [h[0], h[1]] },
      get drop() { return [drop[0], drop[1]] },
      get bracciN() { return stato().bracci },
      get colonneN() { const b = stato().bracci; return [b[0] + b[1], b[2] + b[3]] },
      get avvisi() { const a = avvisi(); return [...a.blocca, ...a.segnala] },
      get dislivelloMax() { return syncMax },
      get carY() { return carPose()?.y ?? 0 },
      get messaggio() { return messaggio },
      probePads(dy) {
        for (const a of arms) a.e += dy
        pose()
        const hits = checker.runShapes(model.carShapes(), (p) => (p === 'tampone' ? PAD_TOL : CLASH_TOL))
        for (const a of arms) a.e -= dy
        pose()
        return hits
      },
    },

    mount(pane) {
      pane.innerHTML = PANE
      el = {}
      pane.querySelectorAll<HTMLElement>('[data-id]').forEach((e) => (el[e.dataset.id!] = e))
      const sel = el.auto as HTMLSelectElement
      for (const a of AUTO) sel.append(new Option(a.label, a.id))
      sel.value = auto.id
      sel.addEventListener('change', () => { if (!setCar(sel.value)) sel.value = auto.id })
      const ca = el.carico as HTMLInputElement
      ca.value = String(carico)
      ca.addEventListener('change', () => {
        if (Math.max(h[0], h[1]) > 0 || fase === 'bracci') { ca.value = String(carico); return }
        carico = Math.min(Math.max(+ca.value || 0, 0), 2000)
        ca.value = String(carico)
        changed = true
      })
      const ps = el.pos as HTMLInputElement
      ps.value = String(Math.round(offset * 100))
      ps.addEventListener('input', () => {
        if (!(fase === 'vuoto' || fase === 'auto') || !giu()) { ps.value = String(Math.round(offset * 100)); return }
        offset = +ps.value / 100
        changed = true
      })
      el.entra.addEventListener('click', () => { job = null; if (fase === 'auto') esci(); else entra() })
      el.bracci.addEventListener('click', () => { job = null; if (fase === 'pronto') riponi(); else bracci() })
      holdButton(el.su, 'su')
      holdButton(el.giu, 'giu')
      el.stop.addEventListener('click', stop)
      el.ciclo.addEventListener('click', () => avviaCiclo())
      el.rompi.addEventListener('click', () => { if (rottura >= 0) ripristina(); else rompi() })
    },

    update(dt, _now, flows) {
      const moving = update(dt)
      const s = stato()
      const lifted = caricata() && Math.max(h[0], h[1]) > 0.002
      model.setArrows(flows && lifted, s.bracci, SPEC.braccioMax)
      const redraw = moving || changed
      changed = false
      return redraw
    },

    refresh() {
      if (el.messaggio) {
        setText(el.messaggio, messaggio)
        const s = stato()
        setText(el['m-h'], `${num((PAD0 + (arms[0].e + arms[2].e) / 2 + (hEff(0) + hEff(1)) / 2) * 1000, 0)} mm`)
        setText(el['m-kg'], fase === 'vuoto' || fase === 'entrata' || fase === 'uscita' ? '0 kg' : `${num(s.bc.m, 0)} kg`)
        setText(el['m-v'], `${num(Math.abs((v[0] + v[1]) / 2) * 1000, 0)} mm/s`)
        setText(el['o-pos'], offset === 0 ? 'consigliata' : `${offset > 0 ? '+' : ''}${num(offset * 100, 0)} cm dalla consigliata`)
        const lib = libera() && !job
        const ent = el.entra as HTMLButtonElement
        setText(ent, fase === 'auto' || fase === 'uscita' ? 'Esci l\'auto' : 'Entra l\'auto')
        ent.disabled = !lib || !giu() || !(fase === 'vuoto' || fase === 'auto')
        const br = el.bracci as HTMLButtonElement
        setText(br, fase === 'pronto' || fase === 'riponi' ? 'Riponi i bracci' : 'Posiziona i bracci')
        br.disabled = !lib || !giu() || !(fase === 'auto' || fase === 'pronto')
        ;(el.auto as HTMLSelectElement).disabled = !lib || !giu() || !(fase === 'vuoto' || fase === 'auto')
        ;(el.carico as HTMLInputElement).disabled = !giu() || !(fase === 'vuoto' || fase === 'auto' || fase === 'pronto')
        ;(el.pos as HTMLInputElement).disabled = !giu() || !(fase === 'vuoto' || fase === 'auto')
        const ok = !apart() && !emergenza && rottura < 0 && (fase === 'vuoto' || fase === 'auto' || fase === 'pronto')
        ;(el.su as HTMLButtonElement).disabled = !ok
        ;(el.giu as HTMLButtonElement).disabled = !ok
        el.su.classList.toggle('attivo', moto === 'salita')
        el.giu.classList.toggle('attivo', moto === 'discesa')
        setText(el.stop, emergenza ? 'RIARMO' : 'STOP')
        el.stop.classList.toggle('attivo', emergenza)
        const ci = el.ciclo as HTMLButtonElement
        ci.disabled = !lib || !(fase === 'vuoto' || fase === 'auto' || fase === 'pronto')
        setText(ci, apart() ? 'Rimonta per lavorare' : '▶ Ciclo completo')
        const ro = el.rompi as HTMLButtonElement
        setText(ro, rottura >= 0 ? 'Sostituisci la madrevite' : 'Rompi la madrevite portante')
        ro.disabled = rottura < 0 && (Math.max(h[0], h[1]) < 0.05 || apart())
        const a = avvisi()
        const html = [...a.blocca.map((t) => `<p class="blocca">⛔ ${t}</p>`), ...a.segnala.map((t) => `<p>⚠️ ${t}</p>`)].join('')
        if (el.avvisi.dataset.html !== html) { el.avvisi.innerHTML = html; el.avvisi.dataset.html = html }
      }
      const label: Record<Fase, string> = { vuoto: 'LIBERO', entrata: 'ENTRATA', auto: 'AUTO DENTRO', bracci: 'BRACCI', pronto: 'PRONTO', riponi: 'BRACCI', uscita: 'USCITA' }
      const st = rottura >= 0 ? 'SICUREZZA' : emergenza ? 'EMERGENZA' : moto === 'salita' ? 'SALITA' : moto === 'discesa' ? 'DISCESA' : fase === 'pronto' && !giu() ? 'IN ALTO' : label[fase]
      return { status: st, detail: `${num(((hEff(0) + hEff(1)) / 2) * 1000, 0)} mm` }
    },

    physics() {
      const s = stato()
      const vt = vite()
      const has = !(fase === 'vuoto' || fase === 'entrata' || fase === 'uscita')
      const kg = (N: number) => `${num(N / G, 0)} kg · ${num(N / 1000, 2)} kN`
      const deg = (r: number) => num((r * 180) / Math.PI, 2)
      const giro = (k: number) => n[k] / RAP
      const rows: [string, string][] = [
        ['Auto', `${auto.label}, ${num(auto.massa, 0)} kg${carico ? ` + ${num(carico, 0)} kg nel vano` : ''} ${IND}`],
        ['Portata', `${SPEC.portata} kg; braccio ${SPEC.braccioMax} kg ${IND}`],
      ]
      if (has) {
        const qa = s.c.ant / (s.c.ant + s.c.post)
        rows.push(
          ['Baricentro dalle colonne', `${num(s.zG * 1000, 0)} mm (${s.zG >= 0 ? 'verso dietro' : 'verso davanti'}), alto ${num(s.bc.y * 1000, 0)} mm ${IND}`],
          ['Ripartizione avanti / dietro', `${Math.round(qa * 100)} % / ${Math.round((1 - qa) * 100)} %`],
          ['Colonna sinistra', kg(s.bracci[0] + s.bracci[1])],
          ['Colonna destra', kg(s.bracci[2] + s.bracci[3])],
          ...s.bracci.map((f, i) => [`Braccio ${nomeBraccio(i)}`, `${kg(f)}${f > SPEC.braccioMax * G ? ' ⛔' : ''}`] as [string, string]),
        )
      }
      rows.push(
        ['Vite', `Tr ${SPEC.viteD * 1000} × ${SPEC.passo * 1000}, d₂ ${num(vt.d2 * 1000, 0)} mm ${IND}`],
        ['Angolo d\'elica λ / d\'attrito φ\'', `${deg(vt.lambda)}° / ${deg(vt.phi)}°`],
        ['Rendimento della vite in salita', `${num(vt.rendimento * 100, 0)} %`],
        ['Autobloccante', vt.autobloccante ? `sì: λ < φ', il carico non fa girare la vite (η < 50 %)` : 'no'],
        ['Coppia sulla vite sx / dx', `${num(coppia[0], 1)} / ${num(coppia[1], 1)} N·m${moto === 'discesa' ? ' (discesa: serve coppia per trascinare la vite)' : ''}`],
        ['Motori sx / dx', `${num(n[0], 0)} / ${num(n[1], 0)} giri/min · vite ${num(giro(0), 0)} / ${num(giro(1), 0)} giri/min`],
        ['Potenza assorbita sx / dx', `${num(potenza[0] / 1000, 2)} / ${num(potenza[1] / 1000, 2)} kW su ${SPEC.motoreP / 1000} kW ${IND}`],
        ['Velocità di salita', `${num(Math.abs(v[0]) * 1000, 1)} / ${num(Math.abs(v[1]) * 1000, 1)} mm/s`],
        ['Corsa carrelli sx / dx', `${num(hEff(0) * 1000, 1)} / ${num(hEff(1) * 1000, 1)} mm`],
        ['Dislivello tra i carrelli', `${num(Math.abs(hEff(0) - hEff(1)) * 1000, 1)} mm (il quadro interviene a ${SPEC.dislivelloMax * 1000} mm)`],
        ['Madrevite di sicurezza', rottura >= 0 ? `in presa a ${rottura === 0 ? 'sinistra' : 'destra'}, gioco ${num((SPEC.giocoSicurezza - drop[rottura]) * 1000, 1)} mm` : `a ${SPEC.giocoSicurezza * 1000} mm sotto la portante, scarica`],
        ['Compenetrazioni con l\'auto', `${clashes.length}`],
      )
      return rows
    },
  }

  /** Posizione dell'auto (z del baricentro) che tiene il baricentro più vicino alle colonne con tutti i punti raggiungibili. */
  function consigliata(c: Auto) {
    const pt = puntiAuto(c)
    let best = 0, bestErr = Infinity
    for (let k = -120; k <= 120; k++) {
      const z0 = k * 0.005
      let err = 0
      ARMS.forEach((a, i) => {
        const p = pivotOf(i)
        const L = Math.hypot(a.s * pt.x - p.x, (a.kind === 'ant' ? z0 + pt.zAnt : z0 + pt.zPost) - p.z)
        const [lo, hi] = REACH[a.kind]
        err += Math.max(0, lo + 0.02 - L) + Math.max(0, L - hi + 0.02)
      })
      const score = err * 100 + Math.abs(z0 + baricentro(c, 0).z)
      if (score < bestErr) { bestErr = score; best = z0 }
    }
    return best
  }
}

const RAP = SPEC.rapportoCinghia * SPEC.rapportoIngranaggi
