import { Section } from '../core/section'
import { Machine, IND } from '../core/machine'
import { InterferenceCheck, Hit } from '../core/interference'
import { num, drawScope } from '../ui'
import { BalancerModel } from './model'
import { ConsoleDisplay } from './display'
import { Controller } from './controller'
import { PARTS } from './parts'
import { WHEELS, LAYOUT, MACHINE, wheelGeometry, abs, arg } from './physics'

/** Tolleranza del controllo di compenetrazione, m. */
const CLASH_TOL = 0.002
const CHECK_EVERY = 3

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
  <div class="riga">
    <label class="campo">Ruota <select data-id="ruota"></select></label>
    <button data-id="nuova">Nuova ruota</button>
  </div>
  <div class="riga"><button data-id="carter">Alza / abbassa carter</button></div>
  <canvas data-id="scope" class="scope" aria-label="Segnali dei sensori A e B"></canvas>
  <p class="legenda"><i class="a"></i> sensore A <i class="b"></i> sensore B · forza orizzontale (N)</p>`

const TEXT = `
  <h3>Perché una ruota vibra</h3>
  <p>Se la massa non è distribuita in modo uniforme attorno all'asse, il punto pesante tira verso l'esterno con la forza centrifuga <code>F = m · r · ω²</code>. La forza cresce col quadrato della velocità: 10 g sul bordo di un cerchio da 16" a 100 km/h tirano con circa 17 N, e la direzione gira con la ruota.</p>
  <h3>Statico e dinamico</h3>
  <p>Lo squilibrio statico fa sobbalzare la ruota; quello dinamico (una coppia di masse su lati opposti) la fa sbandierare anche se staticamente è a posto. Per correggerli entrambi servono due pesi, uno per piano.</p>
  <h3>Come misura la macchina</h3>
  <p>L'albero è una trave su due appoggi: i sensori A e B. Con le equazioni di equilibrio di forze e momenti, dalle due forze lette e dalle distanze dei piani (calibro <i>a</i>, larghezza <i>b</i>) si ricavano i due squilibri. L'encoder dà la fase, quindi l'angolo in cui mettere ciascun peso, dalla parte opposta allo squilibrio.</p>`

/** Equilibratrice con gli agganci per la verifica automatica (tools/verifica.ts). */
export interface Balancer extends Machine {
  readonly test: {
    setWheel(id: string): boolean
    measure(): void
    applyWeights(): void
    toggleGuard(): void
    readonly stato: string
    /** Corsa attuale dell'asta del calibro, m. */
    readonly calibro: number
    checkEveryFrame(): void
    readonly clashes: (Hit & { step: string })[]
    /** Prova del controllo: sposta il calibro di dy (m, verso il basso se negativo) e riporta cosa tocca. */
    probeCaliper(dy: number): Hit[]
  }
}

export function createBalancer(section: Section): Balancer {
  const lcd = new ConsoleDisplay()
  const model = new BalancerModel(section, lcd.texture)
  const ctrl = new Controller()
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
      console.warn(`[compenetrazione] Equilibratrice ${spec.label} · ${ctrl.stato} · ${PARTS[h.part]?.name ?? h.part} dentro ${h.solid} di ${num(h.depth * 1000, 1)} mm`)
    }
  }
  const setWheel = (id: string) => {
    const next = WHEELS.find((w) => w.id === id)!
    if (!ctrl.setWheel(next, xInnerOf(next))) return false
    spec = next
    model.buildWheel(spec)
    changed = true
    return true
  }

  return {
    id: 'equilibratrice',
    name: 'Equilibratrice',
    subtitle: 'per ruote auto',
    workTab: 'Misura',
    model,
    parts: PARTS,
    order: ['pneumatico', 'cerchio', 'pesi', 'ghiera', 'cono', 'flangia', 'albero', 'cannotto', 'sensori', 'encoder', 'cinghia', 'motore', 'scheda', 'calibro', 'carter', 'console', 'vaschetta', 'telaio', 'mobile', 'pedale'],
    view: { target: [-0.08, 0.6, 0], halfWidth: 0.85 },
    physicsText: TEXT,
    get busy() { return ctrl.busy },

    test: {
      setWheel,
      measure() { ctrl.measure() },
      applyWeights() { ctrl.applyWeights() },
      toggleGuard() { ctrl.toggleGuard() },
      get stato() { return ctrl.stato },
      get calibro() { return model.calSlide.position.x },
      checkEveryFrame() { checkEvery = 1 },
      clashes,
      probeCaliper(dy) {
        const y = model.calSlide.position.y
        model.calSlide.position.y = y + dy
        const hits = checker.run(model.wheelSolids(), () => CLASH_TOL).filter((h) => h.part === 'calibro')
        model.calSlide.position.y = y
        return hits
      },
    },

    mount(pane) {
      pane.innerHTML = PANE
      el = {}
      pane.querySelectorAll<HTMLElement>('[data-id]').forEach((e) => (el[e.dataset.id!] = e))
      const sel = el.ruota as HTMLSelectElement
      for (const w of WHEELS) sel.append(new Option(w.label, w.id))
      sel.value = spec.id
      sel.addEventListener('change', () => { if (!setWheel(sel.value)) sel.value = spec.id })
      el.misura.addEventListener('click', () => ctrl.measure())
      el.pesi.addEventListener('click', () => ctrl.applyWeights())
      el.nuova.addEventListener('click', () => ctrl.newWheel())
      el.carter.addEventListener('click', () => ctrl.toggleGuard())
      requestAnimationFrame(() => drawScope(el.scope as HTMLCanvasElement, ctrl.scopeA, ctrl.scopeB, ctrl.scopeHead))
    },

    update(dt, now, flows) {
      const moving = ctrl.update(dt)
      const b = ctrl.b
      model.rotor.rotation.x = b.angle
      model.guard.rotation.x = ctrl.guard
      model.calSlide.position.x = ctrl.cal

      // cinghia: la trama scorre alla velocità periferica della puleggia
      model.beltMap.offset.x -= ((b.omega * 0.078 * dt) / beltLen) * model.beltMap.repeat.x

      // forze centrifughe sui due piani e sensori che si illuminano con la forza
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

      // segnali che corrono nei cavi durante la misura
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
        ;(el.pesi as HTMLButtonElement).disabled = ctrl.stato !== 'risultato' || !ctrl.result || (ctrl.result.int.shown === 0 && ctrl.result.est.shown === 0)
        ;(el.nuova as HTMLButtonElement).disabled = ctrl.busy
        ;(el.ruota as HTMLSelectElement).disabled = ctrl.busy
      }
      return { status: ds.status, detail: `${Math.round(ds.rpm)} giri/min` }
    },

    physics() {
      const b = ctrl.b
      const { fa, fb } = b.sensorForces()
      const r = ctrl.result, v = ctrl.vero
      const rows: [string, string][] = [
        ['Velocità', `${num((b.omega * 30) / Math.PI, 0)} giri/min · ${num(b.omega)} rad/s`],
        ['Velocità di misura', `${MACHINE.rpmMeasure} giri/min ${IND}`],
        ['Forza sensore A', `${num(abs(fa), 2)} N`],
        ['Forza sensore B', `${num(abs(fb), 2)} N`],
        ['Coppia alla ruota', `${num(b.torque, 1)} N·m ${IND}`],
        ['Massa ruota', `${num(spec.mass, 0)} kg ${IND}`],
        ['Inerzia rotante', `${num(b.inertia, 2)} kg·m² ${IND}`],
        ['Energia cinetica', `${num(0.5 * b.inertia * b.omega ** 2, 0)} J`],
        ['Distanza a', `${num(b.xInner * 1000, 0)} mm`],
        ['Larghezza b', `${num(b.geo.width * 1000, 0)} mm`],
        ['Raggio dei pesi', `${num(b.rWeight * 1000, 0)} mm`],
        ['Compenetrazioni con la ruota', `${clashes.length}`],
      ]
      if (r && v) {
        rows.push(
          ['Interno: misurato / reale', `${num(r.int.grams)} / ${num(v.int)} g`],
          ['Esterno: misurato / reale', `${num(r.est.grams)} / ${num(v.est)} g`],
          ['Squilibrio statico', `${num(r.staticG)} g`],
        )
      }
      return rows
    },
  }
}
