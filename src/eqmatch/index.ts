import { Section } from '../core/section'
import { Machine, IND } from '../core/machine'
import { InterferenceCheck, Hit } from '../core/interference'
import { match, touch, turnFor, wrapAngle, VALVE } from '../core/match'
import { num, drawScope } from '../ui'
import { BalancerModel } from './model'
import { ConsoleDisplay } from './display'
import { Controller } from './controller'
import { PARTS } from './parts'
import { WHEELS, LAYOUT, MACHINE, wheelGeometry, abs, arg, add, sub, scale, rot, C } from './physics'

/** Soglia predefinita dello squilibrio statico oltre cui si propone il matching, g. */
const SOGLIA = 60
/** Tolleranza del controllo di compenetrazione, m. */
const CLASH_TOL = 0.002
const CHECK_EVERY = 3
const deg = (a: number) => Math.round((a * 180) / Math.PI)

/** Passi della procedura di matching. */
type MStep = 'off' | 'proposta' | 'segni' | 'm1' | 'giro' | 'm2' | 'ottimale' | 'verifica' | 'fine'

const PANE = `
  <p data-id="messaggio" class="messaggio">Premi Avvia misura</p>
  <div class="risultati">
    <div><small>Interno</small><b data-id="r-int">---</b></div>
    <div><small>Esterno</small><b data-id="r-est">---</b></div>
  </div>
  <div class="riga">
    <button data-id="misura" class="primario">▶ Avvia misura</button>
    <button data-id="pesi" disabled>Applica pesi</button>
  </div>
  <div data-id="match" class="matching" hidden>
    <b data-id="m-titolo"></b>
    <p data-id="m-testo"></p>
    <div class="riga">
      <button data-id="m-avanti" class="primario"></button>
      <button data-id="m-altro"></button>
    </div>
  </div>
  <div class="riga">
    <label class="campo">Ruota <select data-id="ruota"></select></label>
    <button data-id="nuova">Nuova ruota</button>
  </div>
  <div class="riga">
    <label class="campo">Soglia matching, g (indicativa) <input data-id="soglia" type="number" min="10" max="200" step="5" value="${SOGLIA}" /></label>
    <button data-id="carter">Alza / abbassa carter</button>
  </div>
  <canvas data-id="scope" class="scope" aria-label="Segnali dei sensori A e B"></canvas>
  <p class="legenda"><i class="a"></i> sensore A <i class="b"></i> sensore B · forza orizzontale (N)</p>`

const TEXT = `
  <h3>Perché una ruota vibra</h3>
  <p>Se la massa non è distribuita in modo uniforme attorno all'asse, il punto pesante tira verso l'esterno con la forza centrifuga <code>F = m · r · ω²</code>. La forza cresce col quadrato della velocità e la direzione gira con la ruota.</p>
  <h3>Cerchio più pneumatico</h3>
  <p>Lo squilibrio della ruota è la somma di due vettori: quello del cerchio e quello del pneumatico. Il secondo gira con il pneumatico quando lo si sposta sul cerchio. Se i due punti pesanti sono dalla stessa parte si sommano; portando il pneumatico dalla parte opposta si sottraggono, e servono meno grammi di piombo.</p>
  <h3>Matching: due misure e mezzo giro</h3>
  <p>Con il pneumatico in una posizione si misura <code>M1 = C + P</code>. Girato il pneumatico di 180° sul cerchio, il suo vettore cambia verso: <code>M2 = C − P</code>. Quindi <code>C = (M1 + M2) / 2</code> e <code>P = (M1 − M2) / 2</code>, riferiti al segno sulla valvola.</p>
  <p>Il pneumatico va girato dell'angolo che porta il suo punto pesante opposto a quello del cerchio: <code>δ = arg C + 180° − arg P</code>. Lo squilibrio statico che resta è <code>| |C| − |P| |</code>. Il matching lavora sullo squilibrio statico: quel che resta, statico e dinamico, si corregge poi con i pesi.</p>
  <h3>Come misura la macchina</h3>
  <p>L'albero è una trave su due appoggi, i sensori A e B. Dalle due forze lette e dalle distanze dei piani si ricavano i due squilibri; l'encoder dà la fase, quindi l'angolo di ogni vettore rispetto alla valvola.</p>`

export interface EqMatch extends Machine {
  readonly test: {
    readonly step: MStep
    setWheel(id: string): void
    setSoglia(g: number): void
    measure(): void
    /** Pulsante principale e secondario del riquadro di matching. */
    next(): void
    other(): void
    checkEveryFrame(): void
    readonly clashes: (Hit & { step: string })[]
    readonly stato: string
    /** Corsa attuale dell'asta del calibro, m. */
    readonly calibro: number
    /** Prova del controllo: sposta il calibro di dy (m, verso il basso se negativo) e riporta cosa tocca. */
    probeCaliper(dy: number): Hit[]
    /** Risultato del matching: vettori misurati e previsione. */
    readonly result: Mt
    readonly staticG: number | null
  }
}

const newMt = () => ({
  step: 'off' as MStep,
  soglia: SOGLIA,
  /** Squilibri statici misurati, kg·m nel sistema del cerchio. */
  M1: null as C | null,
  M2: null as C | null,
  theta1: 0,
  rim: null as C | null,
  tire: null as C | null,
  /** Angolo ottimale del pneumatico rispetto alla posizione di M1, rad. */
  delta: 0,
  /** Residuo previsto e risparmio, g. */
  residual: 0,
  saved: 0,
  final: null as number | null,
  /** Risultato già proposto (per non riproporre il matching sulla stessa misura). */
  seen: null as object | null,
})
type Mt = ReturnType<typeof newMt>

export function createEqMatch(section: Section): EqMatch {
  const lcd = new ConsoleDisplay()
  const model = new BalancerModel(section, lcd.texture)
  const ctrl = new Controller()
  const mt = newMt()
  let spec = WHEELS[1]
  const xInnerOf = (s = spec) => LAYOUT.flangeFace - s.et - wheelGeometry(s).width / 2
  ctrl.b.setWheel(spec, xInnerOf())
  model.buildWheel(spec)
  ctrl.onWeights = () => model.setWeights(ctrl.b.weights, spec)

  let el: Record<string, HTMLElement> = {}
  let beltLen = 1
  model.root.traverse((o) => { if (o.userData.length) beltLen = o.userData.length })
  let pulse = 0
  let lastLcd = 0
  let changed = true
  let version = -1
  let lastResult: object | null = null

  const grams = (u: C) => (abs(u) / ctrl.b.rWeight) * 1000
  /** Angolo rispetto alla valvola, in gradi da 0 a 359, positivo in senso antiorario visto dal lato esterno. */
  const fromValve = (u: C) => ((deg(arg(u) - VALVE) % 360) + 360) % 360
  const turnText = (a: number) => `${Math.abs(deg(a))}° ${a >= 0 ? '↺' : '↻'}`
  const sense = (a: number) => (a >= 0 ? 'antiorario' : 'orario')

  function resetMatch() {
    Object.assign(mt, { step: 'off', M1: null, M2: null, rim: null, tire: null, final: null, delta: 0, residual: 0, saved: 0 })
    match.ref = null
    match.target = null
    match.request = null
    touch()
  }

  /** Lo stato condiviso è cambiato (SmontMatch ha girato il pneumatico, o è cambiata la ruota). */
  function sync() {
    if (match.version === version) return
    version = match.version
    const r = match.request
    if (r?.done && (mt.step === 'giro' || mt.step === 'ottimale')) {
      // la ruota torna dallo smontagomme: la misura vecchia non vale più
      const half = mt.step === 'giro'
      mt.step = half ? 'm2' : 'verifica'
      match.request = null
      if (!half) match.target = r.marks.tire
      else match.target = null
      ctrl.result = null
      ctrl.vero = null
      if (!ctrl.busy) ctrl.stato = 'pronto'
      ctrl.messaggio = half ? 'Ruota di nuovo sull\'albero, pneumatico girato di 180°: misura M2' : 'Ruota rimontata con i segni allineati: misura di verifica'
      ctrl.b.weights = []
      ctrl.onWeights()
    }
    changed = true
  }

  /** Una misura è finita: la procedura decide cosa farne. */
  function measured() {
    const r = ctrl.result
    if (!r) return
    const S = r.S
    if (mt.step === 'off' && r.staticG > mt.soglia && mt.seen !== r) {
      mt.seen = r
      mt.step = 'proposta'
    } else if (mt.step === 'm1') {
      mt.M1 = S
      mt.theta1 = match.theta
      // mezzo giro: il segno opposto al riferimento va sulla valvola
      match.request = { reason: 'm2', marks: { rim: VALVE, tire: wrapAngle(match.ref! + Math.PI) }, done: false }
      match.target = match.request.marks.tire
      touch()
      mt.step = 'giro'
      ctrl.messaggio = `M1 = ${num(grams(S))} g: ora il pneumatico va girato di 180° sul cerchio`
    } else if (mt.step === 'm2') {
      mt.M2 = S
      const M1 = mt.M1!
      mt.rim = scale(add(M1, S), 0.5)
      mt.tire = scale(sub(M1, S), 0.5)
      // punto pesante del pneumatico opposto a quello del cerchio
      mt.delta = wrapAngle(arg(mt.rim) + Math.PI - arg(mt.tire))
      mt.residual = Math.abs(grams(mt.rim) - grams(mt.tire))
      mt.saved = grams(M1) - mt.residual
      // segno del pneumatico da portare sulla valvola: il riferimento girato di −δ
      const target = wrapAngle(match.ref! - mt.delta)
      match.request = { reason: 'ottimale', marks: { rim: VALVE, tire: target }, done: false }
      match.target = target
      touch()
      mt.step = 'ottimale'
      ctrl.messaggio = `Matching calcolato: residuo previsto ${num(mt.residual)} g`
    } else if (mt.step === 'verifica') {
      mt.final = r.staticG
      mt.step = 'fine'
      ctrl.messaggio = `Verifica: statico ${num(r.staticG)} g (previsto ${num(mt.residual)} g)`
    }
  }

  function next() {
    switch (mt.step) {
      case 'proposta':
        // i pesi messi falserebbero le due misure
        ctrl.b.weights = []
        ctrl.onWeights()
        ctrl.result = null
        ctrl.stato = 'pronto'
        mt.step = 'segni'
        break
      case 'segni':
        ctrl.turnTo(VALVE, 'La valvola va a ore 12: lì si segnano cerchio e pneumatico', () => {
          match.ref = wrapAngle(VALVE - match.theta)
          touch()
          mt.step = 'm1'
          ctrl.messaggio = 'Segni fatti: il giallo sul cerchio alla valvola, il bianco sul pneumatico allineato'
        })
        break
      case 'm1': case 'm2': case 'verifica':
        ctrl.measure()
        break
      case 'giro': case 'ottimale':
        location.hash = '#smontmatch'
        break
      case 'fine':
        if (ctrl.result && (ctrl.result.int.shown || ctrl.result.est.shown)) ctrl.applyWeights()
        resetMatch()
        break
    }
    changed = true
  }

  function other() {
    if (mt.step === 'proposta') mt.step = 'off'
    else resetMatch()
    changed = true
  }

  /** Testi del riquadro di matching per il passo corrente. */
  function box(): { title: string; text: string; next: string; other: string; busy: boolean } | null {
    const busy = ctrl.busy || model.exploded > 0.01
    const g = (u: C | null) => (u ? num(grams(u)) + ' g' : '---')
    switch (mt.step) {
      case 'off': return null
      case 'proposta': return { title: 'Conviene il matching', text: `Squilibrio statico ${num(ctrl.result?.staticG ?? 0)} g, oltre la soglia di ${mt.soglia} g. Girando il pneumatico sul cerchio i punti pesanti di cerchio e pneumatico si possono compensare: servono meno grammi di piombo.`, next: 'Avvia matching', other: 'No, applica i pesi', busy }
      case 'segni': return { title: '1 · Segni di riferimento', text: 'Pesi tolti. La valvola va a ore 12: col marcatore si segna il cerchio alla valvola (giallo) e il pneumatico allineato (bianco).', next: 'Gira e segna', other: 'Annulla matching', busy }
      case 'm1': return { title: '2 · Prima misura M1', text: 'Misura con il pneumatico nella posizione di partenza.', next: '▶ Misura M1', other: 'Annulla matching', busy }
      case 'giro': return { title: '3 · Pneumatico girato di 180°', text: `M1 = ${g(mt.M1)}. Allo smontagomme: stallonatura, cerchio bloccato, pneumatico tenuto fermo e cerchio girato di 180° fino a portare il segno giallo del pneumatico sul segno del cerchio. Poi gonfiaggio e di nuovo qui.`, next: 'Vai a SmontMatch', other: 'Annulla matching', busy }
      case 'm2': return { title: '4 · Seconda misura M2', text: `M1 = ${g(mt.M1)}. Misura con il pneumatico girato di mezzo giro.`, next: '▶ Misura M2', other: 'Annulla matching', busy }
      case 'ottimale': {
        const t = match.request ? turnFor(match.request.marks) : 0
        const low = mt.saved < 5
        return {
          title: '5 · Risultato del matching',
          text: `Cerchio ${g(mt.rim)} a ${fromValve(mt.rim!)}° dalla valvola, pneumatico ${g(mt.tire)} a ${fromValve(mt.tire!)}°. Angolo ottimale ${deg(mt.delta)}° rispetto alla prima posizione: dalla posizione attuale il pneumatico gira di ${Math.abs(deg(t))}° in senso ${sense(t)} (lato esterno), finché il segno giallo nuovo è sul segno del cerchio. Residuo previsto ${num(mt.residual)} g, ${num(Math.max(mt.saved, 0))} g di piombo risparmiati.${low ? ' Il risparmio è piccolo: il matching qui serve a poco.' : ''}`,
          next: 'Vai a SmontMatch', other: 'Concludi senza girare', busy,
        }
      }
      case 'verifica': return { title: '6 · Misura finale di verifica', text: `Segni allineati. Residuo previsto ${num(mt.residual)} g.`, next: '▶ Misura di verifica', other: 'Annulla matching', busy }
      case 'fine': return { title: 'Matching concluso', text: `Statico misurato ${num(mt.final ?? 0)} g contro ${num(mt.residual)} g previsti, partendo da ${g(mt.M1)}. Il resto si corregge con i pesi.`, next: ctrl.result && (ctrl.result.int.shown || ctrl.result.est.shown) ? 'Applica pesi' : 'Chiudi', other: 'Chiudi', busy }
    }
  }

  // ---------- controllo di compenetrazione ----------

  const checker = new InterferenceCheck(model.root, (o) => model.isWheelOrMarker(o))
  const clashes: (Hit & { step: string })[] = []
  const seen = new Set<string>()
  let frame = 0, checkEvery = CHECK_EVERY
  function checkClash() {
    for (const h of checker.run(model.wheelSolids(), () => CLASH_TOL)) {
      const key = spec.id + '|' + ctrl.stato + '|' + h.part + '|' + h.solid
      if (seen.has(key)) continue
      seen.add(key)
      clashes.push({ ...h, step: ctrl.stato })
      console.warn(`[compenetrazione] EqMatch ${spec.label} · ${ctrl.stato} · ${PARTS[h.part]?.name ?? h.part} dentro ${h.solid} di ${num(h.depth * 1000, 1)} mm`)
    }
  }

  // ---------- diagramma polare ----------

  function polar(): string {
    if (!mt.M1) return ''
    const list: { u: C | null; c: string; t: string; dash?: boolean }[] = [
      { u: mt.M1, c: '#3fe0ff', t: 'M1' },
      { u: mt.M2, c: '#ffb21e', t: 'M2' },
      { u: mt.rim, c: '#c3c8cf', t: 'cerchio' },
      { u: mt.tire, c: '#ff6a4d', t: 'pneumatico' },
      { u: mt.tire && rot(mt.tire, mt.delta), c: '#ff6a4d', t: 'pneumatico dopo il matching', dash: true },
    ]
    const max = Math.max(...list.map((l) => (l.u ? grams(l.u) : 0)), 10)
    const S = 220, c = S / 2, R = c - 22
    // valvola in alto; angoli positivi in senso antiorario, come visti dal lato esterno
    const pt = (u: C) => { const d = arg(u) - VALVE, k = (grams(u) / max) * R; return [c - k * Math.sin(d), c - k * Math.cos(d)] }
    let svg = `<svg viewBox="0 0 ${S} ${S}" width="100%" style="max-width:${S + 40}px;display:block;margin:10px auto" role="img" aria-label="Diagramma polare dei vettori di squilibrio">`
    svg += `<defs>${list.map((l, i) => `<marker id="pm${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="${l.c}"/></marker>`).join('')}</defs>`
    for (const f of [1, 0.5]) svg += `<circle cx="${c}" cy="${c}" r="${R * f}" fill="none" stroke="#1d2b38"/>`
    svg += `<line x1="${c}" y1="${c - R - 6}" x2="${c}" y2="${c + R}" stroke="#1d2b38"/><line x1="${c - R}" y1="${c}" x2="${c + R}" y2="${c}" stroke="#1d2b38"/>`
    svg += `<text x="${c}" y="12" fill="#ffd21e" font-size="11" text-anchor="middle">valvola</text>`
    svg += `<text x="${c + R * 0.5 + 3}" y="${c - 3}" fill="#5b6b7a" font-size="10">${num(max * 0.5, 0)} g</text>`
    list.forEach((l, i) => {
      if (!l.u) return
      const [x, y] = pt(l.u)
      svg += `<line x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${l.c}" stroke-width="2.4"${l.dash ? ' stroke-dasharray="5 4"' : ''} marker-end="url(#pm${i})"/>`
    })
    svg += '</svg>'
    const legend = list.filter((l) => l.u).map((l) => `<span style="white-space:nowrap"><i style="display:inline-block;width:14px;height:0;border-top:3px ${l.dash ? 'dashed' : 'solid'} ${l.c};vertical-align:middle;margin-right:4px"></i>${l.t}</span>`).join(' · ')
    return `${svg}<p class="legenda" style="text-align:center">${legend}</p>`
  }

  return {
    id: 'eqmatch',
    name: 'EqMatch',
    subtitle: 'equilibratrice con matching',
    workTab: 'Misura',
    model,
    parts: PARTS,
    order: ['pneumatico', 'cerchio', 'pesi', 'ghiera', 'cono', 'flangia', 'albero', 'cannotto', 'sensori', 'encoder', 'cinghia', 'motore', 'scheda', 'calibro', 'carter', 'console', 'vaschetta', 'telaio', 'mobile', 'pedale'],
    view: { target: [-0.08, 0.6, 0], halfWidth: 0.85 },
    physicsText: TEXT,
    get busy() { return ctrl.busy },

    test: {
      get step() { return mt.step },
      setWheel(id) {
        const next = WHEELS.find((w) => w.id === id)!
        if (ctrl.setWheel(next, xInnerOf(next))) { spec = next; Object.assign(mt, newMt(), { soglia: mt.soglia }); model.buildWheel(spec) }
      },
      setSoglia(g) { mt.soglia = g },
      measure() { ctrl.measure() },
      next,
      other,
      checkEveryFrame() { checkEvery = 1 },
      clashes,
      get stato() { return ctrl.stato },
      get calibro() { return model.calSlide.position.x },
      probeCaliper(dy) {
        const y = model.calSlide.position.y
        model.calSlide.position.y = y + dy
        const hits = checker.run(model.wheelSolids(), () => CLASH_TOL).filter((h) => h.part === 'calibro')
        model.calSlide.position.y = y
        return hits
      },
      result: mt,
      get staticG() { return ctrl.result?.staticG ?? null },
    },

    mount(pane) {
      pane.innerHTML = PANE
      el = {}
      pane.querySelectorAll<HTMLElement>('[data-id]').forEach((e) => (el[e.dataset.id!] = e))
      const sel = el.ruota as HTMLSelectElement
      for (const w of WHEELS) sel.append(new Option(w.label, w.id))
      sel.value = spec.id
      sel.addEventListener('change', () => {
        const next = WHEELS.find((w) => w.id === sel.value)!
        if (!ctrl.setWheel(next, xInnerOf(next))) { sel.value = spec.id; return }
        spec = next
        resetMatch()
        model.buildWheel(spec)
        changed = true
      })
      const so = el.soglia as HTMLInputElement
      so.value = String(mt.soglia)
      so.addEventListener('change', () => { mt.soglia = Math.max(5, +so.value || SOGLIA); so.value = String(mt.soglia) })
      el.misura.addEventListener('click', () => ctrl.measure())
      el.pesi.addEventListener('click', () => { if (mt.step === 'proposta') mt.step = 'off'; ctrl.applyWeights() })
      el.nuova.addEventListener('click', () => { if (ctrl.newWheel()) resetMatch() })
      el.carter.addEventListener('click', () => ctrl.toggleGuard())
      el['m-avanti'].addEventListener('click', next)
      el['m-altro'].addEventListener('click', other)
      sync()
      requestAnimationFrame(() => drawScope(el.scope as HTMLCanvasElement, ctrl.scopeA, ctrl.scopeB, ctrl.scopeHead))
    },

    update(dt, now, flows) {
      sync()
      const moving = ctrl.update(dt)
      if (ctrl.stato === 'risultato' && ctrl.result && ctrl.result !== lastResult) { lastResult = ctrl.result; measured() }
      if (!ctrl.result) lastResult = null
      const b = ctrl.b
      model.rotor.rotation.x = b.angle
      model.guard.rotation.x = ctrl.guard
      model.calSlide.position.x = ctrl.cal

      // segni del marcatore e rotazione da fare
      const req = match.request
      const turn = req && !req.done ? turnFor(req.marks) : null
      model.setMarks({ rim: match.ref !== null ? VALVE : null, ref: match.ref, target: match.target, theta: match.theta, turn }, turn !== null ? turnText(turn) : undefined)

      model.beltMap.offset.x -= ((b.omega * 0.078 * dt) / beltLen) * model.beltMap.repeat.x

      const w2 = b.omega ** 2
      const ui = b.total('int'), uo = b.total('est')
      model.setArrows(flows && b.omega > 1, [
        { x: b.xInner, angle: arg(ui), force: abs(ui) * w2 },
        { x: b.xOuter, angle: arg(uo), force: abs(uo) * w2 },
      ])
      const { fa, fb } = b.sensorForces()
      const s = Math.sin(b.angle), c = Math.cos(b.angle)
      const inst = [fa.re * s + fa.im * c, fb.re * s + fb.im * c]
      model.piezo.forEach((m, i) => (m.emissiveIntensity = flows ? Math.min(Math.abs(inst[i]) * 0.5, 1.6) : 0))

      const live = flows && (ctrl.stato === 'lancio' || ctrl.stato === 'misura' || ctrl.stato === 'frenata')
      pulse += dt * 0.9
      for (const cab of model.cables) {
        const on = live && (cab.kind !== 'display' || ctrl.stato === 'misura')
        cab.dots.forEach((d, i) => {
          d.visible = on
          if (on) cab.curve.getPointAt((((pulse * (cab.kind === 'encoder' ? 1.6 : 1) + i / cab.dots.length) % 1) + 1) % 1, d.position)
        })
      }
      if ((moving || changed) && ++frame % checkEvery === 0) checkClash()

      let redraw = moving || live || changed
      changed = false
      if (!moving || now - lastLcd > 66) {
        lastLcd = now
        if (lcd.draw(ctrl.display(spec.rimInch, spec.rimWidthInch))) redraw = true
        if (ctrl.spinning && el.scope) drawScope(el.scope as HTMLCanvasElement, ctrl.scopeA, ctrl.scopeB, ctrl.scopeHead)
      }
      return redraw
    },

    refresh() {
      const ds = ctrl.display(spec.rimInch, spec.rimWidthInch)
      if (el.messaggio) {
        el.messaggio.textContent = ctrl.messaggio
        for (const [e, v] of [[el['r-int'], ds.int], [el['r-est'], ds.est]] as const) {
          e.textContent = v === 'OK' || v === '---' ? v : v + ' g'
          e.classList.toggle('ok', v === 'OK')
        }
        const apart = model.exploded > 0.01
        const misura = el.misura as HTMLButtonElement
        misura.disabled = ctrl.busy || apart
        misura.textContent = apart ? 'Rimonta per misurare' : '▶ Avvia misura'
        const inMatch = mt.step !== 'off' && mt.step !== 'proposta' && mt.step !== 'fine'
        ;(el.pesi as HTMLButtonElement).disabled = inMatch || ctrl.stato !== 'risultato' || !ctrl.result || (ctrl.result.int.shown === 0 && ctrl.result.est.shown === 0)
        ;(el.nuova as HTMLButtonElement).disabled = ctrl.busy
        ;(el.ruota as HTMLSelectElement).disabled = ctrl.busy
        const bx = box()
        el.match.hidden = !bx
        if (bx) {
          el['m-titolo'].textContent = bx.title
          el['m-testo'].textContent = bx.text
          const a = el['m-avanti'] as HTMLButtonElement, o = el['m-altro'] as HTMLButtonElement
          a.textContent = bx.next
          o.textContent = bx.other
          a.disabled = bx.busy
          o.disabled = ctrl.busy
          o.hidden = bx.other === bx.next
        }
      }
      const st = mt.step === 'giro' || mt.step === 'ottimale' ? 'ALLO SMONTAGOMME' : ds.status
      return { status: st, detail: `${Math.round(ds.rpm)} giri/min` }
    },

    physics() {
      const b = ctrl.b
      const { fa, fb } = b.sensorForces()
      const r = ctrl.result, v = ctrl.vero
      const gv = (u: C | null) => (u ? `${num(grams(u))} g a ${fromValve(u)}°` : '---')
      // valori reali, nascosti alla macchina: cerchio e pneumatico (riferito alla posizione di M1)
      const rimTrue = add(match.rim.int, match.rim.est)
      const tireTrue = rot(add(match.tire.int, match.tire.est), mt.M1 ? mt.theta1 : match.theta)
      const rows: [string, string][] = [
        ['Velocità', `${num((b.omega * 30) / Math.PI, 0)} giri/min · ${num(b.omega)} rad/s`],
        ['Velocità di misura', `${MACHINE.rpmMeasure} giri/min ${IND}`],
        ['Forza sensore A', `${num(abs(fa), 2)} N`],
        ['Forza sensore B', `${num(abs(fb), 2)} N`],
        ['Raggio dei pesi', `${num(b.rWeight * 1000, 0)} mm`],
      ]
      if (r && v) {
        rows.push(
          ['Interno: misurato / reale', `${num(r.int.grams)} / ${num(v.int)} g`],
          ['Esterno: misurato / reale', `${num(r.est.grams)} / ${num(v.est)} g`],
          ['Squilibrio statico', `${num(r.staticG)} g`],
        )
      }
      rows.push(
        ['Soglia di matching', `${mt.soglia} g ${IND}`],
        ['Riferimento del pneumatico', match.ref !== null ? `a ${(((deg(match.ref + match.theta - VALVE)) % 360) + 360) % 360}° dalla valvola` : '---'],
        ['M1 (statico)', gv(mt.M1)],
        ['M2 (statico)', gv(mt.M2)],
        ['Cerchio: misurato', gv(mt.rim)],
        ['Cerchio: reale', gv(rimTrue)],
        ['Pneumatico: misurato', gv(mt.tire)],
        ['Pneumatico: reale', gv(tireTrue)],
        ['Angolo ottimale', mt.rim ? `${deg(mt.delta)}° (${sense(mt.delta)}, lato esterno)` : '---'],
        ['Residuo previsto', mt.rim ? `${num(mt.residual)} g` : '---'],
        ['Peso risparmiato', mt.rim ? `${num(Math.max(mt.saved, 0))} g` : '---'],
        ['Residuo misurato', mt.final !== null ? `${num(mt.final)} g` : '---'],
        ['Squilibri nascosti', `cerchio e pneumatico casuali ${IND}`],
        ['Compenetrazioni con la ruota', `${clashes.length}`],
      )
      return rows
    },

    physicsExtra: polar,
  }
}
