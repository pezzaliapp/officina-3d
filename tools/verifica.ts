/**
 * Verifica automatica delle macchine, senza browser.
 *
 * Smontagomme: esegue il ciclo completo (due volte, per provare anche "Nuovo ciclo")
 * su tutte le misure di ruota, con e senza braccio di aiuto, e raccoglie le
 * compenetrazioni tra pezzi della macchina e ruota segnalate dal controllo.
 * Equilibratrice: esegue una misura e confronta il risultato con lo squilibrio reale.
 * Equilibratrice ed EqMatch: rilievo col calibro, misura, pesi e carter su tutte le ruote
 * con il controllo di compenetrazione; una prova col calibro spostato dentro il cerchio
 * controlla che il controllo lo veda davvero.
 * EqMatch e SmontMatch: ciclo di SmontMatch senza matching, poi il giro completo del
 * matching (M1, mezzo giro allo smontagomme, M2, rotazione ottimale, misura di verifica)
 * confrontando cerchio e pneumatico calcolati con quelli reali e il residuo con la previsione.
 * Macchina privata: legge la macchina di esempio (docs/esempi), rifiuta i file sbagliati,
 * controlla smontaggio, tavole ed etichette, poi misura e matching senza nessuna richiesta di rete.
 *
 * Uso: npm run verifica
 */
import './dom-stub'
import { Section } from '../src/core/section'
import { WHEELS } from '../src/core/wheel'
import { createTireChanger, Clash } from '../src/smontagomme'
import { createBalancer, Balancer } from '../src/equilibratrice'
import { Controller } from '../src/equilibratrice/controller'
import { WHEELS as BAL_WHEELS, LAYOUT, wheelGeometry } from '../src/equilibratrice/physics'
import { createEqMatch, EqMatch } from '../src/eqmatch'
import { createSmontMatch } from '../src/smontmatch'
import { match } from '../src/core/match'
import { leggiMacchina, ErroreFormato } from '../src/privata/format'
import { createPrivateMachine } from '../src/privata'
import esempio from '../docs/esempi/equilibratrice-di-prova.json?raw'

const DT = 1 / 60
const warn = console.warn
console.warn = () => {}
let failed = false
const fail = (m: string) => { failed = true; console.log('  ✗ ' + m) }

// ---------- smontagomme ----------

console.log('Smontagomme: ciclo completo, controllo di compenetrazione')
const argv = (globalThis as unknown as { process: { argv: string[] } }).process.argv
// --rapida: solo la ruota media con helper, un ciclo; --ruota=s|m|l: solo quella misura
const quick = argv.includes('--rapida')
const only = argv.find((a) => a.startsWith('--ruota='))?.slice(8)
const maxT = +(argv.find((a) => a.startsWith('--secondi='))?.slice(10) ?? 600)
for (const w of only ? WHEELS.filter((x) => x.id === only) : quick ? WHEELS.slice(1, 2) : WHEELS) {
  for (const helper of quick ? [true] : [true, false]) {
    const tc = createTireChanger(new Section())
    tc.test.setWheel(w.id)
    tc.test.setHelper(helper)
    tc.test.checkEveryFrame()
    let t = 0, frames = 0, ms = 0
    for (let round = 0; round < (quick ? 1 : 2); round++) {
      tc.test.run('ciclo')
      while (tc.busy && t < maxT) {
        const t0 = performance.now()
        tc.update(DT, t * 1000, true)
        ms += performance.now() - t0
        frames++
        t += DT
      }
    }
    const label = `${w.label} ${helper ? 'con helper' : 'senza helper'}`
    const st = tc.refresh().status
    if (tc.busy || st !== 'GONFIA') fail(`${label}: il ciclo non arriva in fondo (stato ${st})`)
    const cl: Clash[] = tc.test.clashes
    if (cl.length) {
      fail(`${label}: ${cl.length} compenetrazioni`)
      for (const c of cl) console.log(`      ${c.step.padEnd(9)} ${c.part.padEnd(22)} in ${c.solid.padEnd(10)} ${(c.depth * 1000).toFixed(1).padStart(6)} mm  (${c.at.toArray().map((v) => v.toFixed(3)).join(', ')}) r=${c.r.toFixed(3)} x=${c.x.toFixed(3)}  ${c.msg}`)
    } else console.log(`  ✓ ${label}: nessuna compenetrazione · ${(t / (quick ? 1 : 2)).toFixed(0)} s per ciclo · ${(ms / frames).toFixed(2)} ms/frame`)
    if (cl.length) console.log(`      (${(ms / frames).toFixed(2)} ms/frame)`)
  }
}

// ---------- pulsantiera: arresto e ritorno a metà ciclo ----------

console.log('Smontagomme: pulsantiera dello stallonatore (STALLONA, ARRESTO, RITORNO)')
{
  const tc = createTireChanger(new Section())
  tc.test.checkEveryFrame()
  const row = (k: string) => tc.physics().find((r) => r[0] === k)?.[1] ?? ''
  const runFor = (s: number) => { for (let t = 0; t < s; t += DT) tc.update(DT, t * 1000, true) }
  const runIdle = () => { for (let t = 0; t < 60 && tc.busy; t += DT) tc.update(DT, t * 1000, true) }
  const checks: [string, boolean][] = []
  tc.test.button('stallona')
  runFor(0.9)
  checks.push(['dopo STALLONA il braccio si muove', tc.busy && /avvicinamento|spinta/.test(row('Stallonatore'))])
  checks.push(['bobina di spinta eccitata', row('Elettrovalvola 5/3').includes('spinta')])
  tc.test.button('arresto')
  runIdle()
  checks.push(['ARRESTO ferma lo stallonatore', !tc.busy && row('Stallonatore').startsWith('fermo')])
  checks.push(['ARRESTO scarica le camere', row('Elettrovalvola 5/3').includes('scarico')])
  tc.test.button('ritorno')
  runFor(0.3)
  checks.push(['RITORNO eccita la bobina di ritorno', row('Elettrovalvola 5/3').includes('ritorno')])
  runIdle()
  checks.push(['dopo RITORNO il braccio è a riposo', row('Stallonatore') === 'a riposo'])
  tc.test.button('stallona')
  runIdle()
  checks.push(['un fianco stallonato, ruota ancora da girare', tc.refresh().status === 'PRONTA'])
  tc.test.button('stallona')
  runIdle()
  checks.push(['secondo STALLONA: ruota girata, fase STALLONATA', tc.refresh().status === 'STALLONATA'])
  for (const [k, ok] of checks) if (ok) console.log('  ✓ ' + k); else fail(k)
  for (const c of tc.test.clashes) fail(`compenetrazione: ${c.part} in ${c.solid} di ${(c.depth * 1000).toFixed(1)} mm (${c.msg})`)
}

// ---------- equilibratrice ----------

console.log('Equilibratrice: misura e confronto con lo squilibrio reale')
{
  const m = createBalancer(new Section())
  for (let i = 0; i < 60; i++) m.update(DT, i * 16, true)
  for (const spec of BAL_WHEELS) {
    const c = new Controller()
    c.setWheel(spec, LAYOUT.flangeFace - spec.et - wheelGeometry(spec).width / 2)
    let t = 0
    while (c.busy && t < 10) { c.update(DT); t += DT }
    c.measure()
    t = 0
    while (c.stato !== 'risultato' && t < 60) { c.update(DT); t += DT }
    const r = c.result, v = c.vero
    if (!r || !v || c.stato !== 'risultato') { fail(`${spec.label}: nessun risultato (stato ${c.stato})`); continue }
    const ok = Math.abs(r.int.grams - v.int) < 5 && Math.abs(r.est.grams - v.est) < 5
    const line = `${spec.label}: interno ${r.int.grams.toFixed(1)} / ${v.int.toFixed(1)} g, esterno ${r.est.grams.toFixed(1)} / ${v.est.toFixed(1)} g in ${t.toFixed(1)} s`
    if (ok) console.log('  ✓ ' + line); else fail(line)
  }
}

// ---------- equilibratrice ed EqMatch: compenetrazioni, calibro compreso ----------

console.log('Equilibratrice ed EqMatch: controllo di compenetrazione, calibro compreso')
for (const [name, create] of [['Equilibratrice', createBalancer], ['EqMatch', createEqMatch]] as [string, (s: Section) => Balancer | EqMatch][]) {
  for (const w of only ? BAL_WHEELS.filter((x) => x.id === only) : quick ? BAL_WHEELS.slice(0, 1) : BAL_WHEELS) {
    const m = create(new Section())
    m.test.checkEveryFrame()
    let t = 0
    const step = () => { m.update(DT, t * 1000, true); t += DT }
    const runUntil = (until: () => boolean, s = 60) => { for (let k = 0; k < s / DT && !until(); k++) step(); return until() }
    runUntil(() => !m.busy, 10)
    const label = `${name} ${w.label}`
    const checks: [string, boolean][] = []
    m.test.setWheel(w.id)
    // rilievo: si aspetta il calibro fermo contro il cerchio, poi la prova
    let cal = 0, still = 0
    runUntil(() => {
      const c = m.test.calibro
      still = c > 0.01 && Math.abs(c - cal) < 1e-6 ? still + 1 : 0
      cal = c
      return still > 3 || m.test.stato !== 'rilievo'
    }, 10)
    checks.push([`calibro contro il cerchio a ${(cal * 1000).toFixed(0)} mm di corsa, nessun contatto`, still > 3 && m.test.probeCaliper(0).length === 0])
    const probe = m.test.probeCaliper(-0.012)
    checks.push([`prova: calibro abbassato di 12 mm, il controllo lo trova (${probe.map((h) => `${h.solid} ${(h.depth * 1000).toFixed(1)} mm`).join(', ') || 'niente'})`, probe.length > 0])
    checks.push(['rilievo concluso', runUntil(() => m.test.stato === 'pronto', 10)])
    m.test.measure()
    checks.push(['misura', runUntil(() => m.test.stato === 'risultato')])
    if ('applyWeights' in m.test) {
      m.test.applyWeights()
      checks.push(['pesi applicati', runUntil(() => !m.busy)])
      m.test.toggleGuard()
      runUntil(() => !m.busy, 5)
      runUntil(() => false, 2)
      m.test.toggleGuard()
      runUntil(() => false, 2)
    }
    for (const [k, ok] of checks) if (ok) console.log(`  ✓ ${label}: ${k}`); else fail(`${label}: ${k} (stato ${m.test.stato})`)
    for (const c of m.test.clashes) fail(`${label}: compenetrazione ${c.part} in ${c.solid} di ${(c.depth * 1000).toFixed(1)} mm (${c.step})`)
    if (!m.test.clashes.length) console.log(`  ✓ ${label}: nessuna compenetrazione (rilievo, misura${'applyWeights' in m.test ? ', pesi, carter' : ''})`)
  }
}

// ---------- SmontMatch: ciclo di smontaggio con il fermo per matching a riposo ----------

console.log('SmontMatch: ciclo di smontaggio senza matching, controllo di compenetrazione')
for (const w of quick ? WHEELS.slice(1, 2) : WHEELS) {
  for (const helper of quick ? [true] : [true, false]) {
    const tc = createSmontMatch(new Section())
    tc.test.setMatching(false)
    tc.test.setWheel(w.id)
    tc.test.setHelper(helper)
    tc.test.checkEveryFrame()
    let t = 0
    tc.test.run('ciclo')
    while (tc.busy && t < maxT) { tc.update(DT, t * 1000, true); t += DT }
    const label = `${w.label} ${helper ? 'con helper' : 'senza helper'}`
    const st = tc.refresh().status
    if (tc.busy || st !== 'GONFIA') fail(`${label}: il ciclo non arriva in fondo (stato ${st})`)
    if (tc.test.clashes.length) {
      fail(`${label}: ${tc.test.clashes.length} compenetrazioni`)
      for (const c of tc.test.clashes) console.log(`      ${c.step.padEnd(9)} ${c.part.padEnd(22)} in ${c.solid.padEnd(10)} ${(c.depth * 1000).toFixed(1).padStart(6)} mm  ${c.msg}`)
    } else console.log(`  ✓ ${label}: nessuna compenetrazione · ${t.toFixed(0)} s`)
  }
}

// ---------- matching: EqMatch → SmontMatch → EqMatch ----------

/** Giro completo del matching su una macchina con il motore di EqMatch (pubblica o caricata da file). */
let matchingFlow: (eq: EqMatch, w: (typeof WHEELS)[number], label: string) => boolean

console.log('EqMatch e SmontMatch: matching completo, calcolo confrontato con lo squilibrio reale')
{
  const deg = (a: number) => (a * 180) / Math.PI
  const wrapDeg = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180
  type V = { re: number; im: number }
  const addV = (a: V, b: V): V => ({ re: a.re + b.re, im: a.im + b.im })
  const rotV = (v: V, a: number): V => ({ re: v.re * Math.cos(a) - v.im * Math.sin(a), im: v.re * Math.sin(a) + v.im * Math.cos(a) })
  const absV = (v: V) => Math.hypot(v.re, v.im)
  matchingFlow = (eq: EqMatch, w: (typeof WHEELS)[number], label: string) => {
    const sm = createSmontMatch(new Section())
    eq.test.checkEveryFrame()
    sm.test.checkEveryFrame()
    eq.test.setSoglia(1)
    eq.test.setWheel(w.id)
    const rW = wheelGeometry(w).rimR + 0.012
    const g = (v: V) => (absV(v) / rW) * 1000
    let t = 0
    const runEq = (until: () => boolean, s = 120) => { for (let k = 0; k < s / DT && !until(); k++) { eq.update(DT, t * 1000, true); t += DT } return until() }
    const runSm = () => {
      sm.update(DT, t * 1000, true)
      sm.test.run('ciclo')
      let k = 0
      while (sm.busy && k++ < maxT / DT) { sm.update(DT, t * 1000, true); t += DT }
      return !sm.busy
    }
    const steps: [string, boolean][] = []
    runEq(() => !eq.busy, 10)
    eq.refresh()
    // misura iniziale: con la soglia a 1 g il matching viene sempre proposto
    eq.test.measure()
    steps.push(['misura iniziale e proposta', runEq(() => eq.test.step === 'proposta')])
    eq.test.next() // avvia
    eq.test.next() // gira e segna
    steps.push(['segni alla valvola', runEq(() => eq.test.step === 'm1', 10) && match.ref !== null])
    const theta0 = match.theta
    eq.test.next()
    steps.push(['misura M1', runEq(() => eq.test.step === 'giro')])
    steps.push(['SmontMatch: mezzo giro', runSm() && Math.abs(Math.abs(deg(sm.test.turned)) - 180) < 0.5 && !!match.request?.done])
    steps.push(['pneumatico girato di 180° sul cerchio', Math.abs(wrapDeg(deg(match.theta - theta0))) > 179.5])
    runEq(() => eq.test.step === 'm2', 1)
    eq.test.next()
    steps.push(['misura M2 e calcolo', runEq(() => eq.test.step === 'ottimale')])
    const r = eq.test.result
    const rimTrue = addV(match.rim.int, match.rim.est)
    const tireTrue = rotV(addV(match.tire.int, match.tire.est), r.theta1)
    const angErr = (a: V, b: V) => Math.abs(wrapDeg(deg(Math.atan2(a.im, a.re) - Math.atan2(b.im, b.re))))
    const okRim = Math.abs(g(r.rim!) - g(rimTrue)) < 3 && (g(rimTrue) < 5 || angErr(r.rim!, rimTrue) < 8)
    const okTire = Math.abs(g(r.tire!) - g(tireTrue)) < 3 && angErr(r.tire!, tireTrue) < 8
    steps.push([`cerchio ${g(r.rim!).toFixed(1)} g (reale ${g(rimTrue).toFixed(1)}), pneumatico ${g(r.tire!).toFixed(1)} g (reale ${g(tireTrue).toFixed(1)})`, okRim && okTire])
    const predicted = r.residual
    const turnReq = match.request ? wrapDeg(deg(match.request.marks.rim - match.request.marks.tire - match.theta)) : NaN
    steps.push([`SmontMatch: rotazione ottimale di ${turnReq.toFixed(0)}°`, runSm() && Math.abs(deg(sm.test.turned) - turnReq) < 0.5])
    runEq(() => eq.test.step === 'verifica', 1)
    eq.test.next()
    steps.push(['misura di verifica', runEq(() => eq.test.step === 'fine')])
    const fin = r.final ?? NaN
    steps.push([`residuo misurato ${fin.toFixed(1)} g, previsto ${predicted.toFixed(1)} g, partenza ${g(r.M1!).toFixed(1)} g`, Math.abs(fin - predicted) < 3])
    for (const [k, ok] of steps) if (ok) console.log(`  ✓ ${label}: ${k}`); else fail(`${label}: ${k} (passo ${eq.test.step})`)
    for (const c of [...eq.test.clashes.map((c) => ({ ...c, msg: eq.name })), ...sm.test.clashes]) fail(`${label}: compenetrazione ${c.part} in ${c.solid} di ${(c.depth * 1000).toFixed(1)} mm (${c.step} · ${c.msg})`)
    return steps.every(([, ok]) => ok)
  }
  for (const w of quick ? WHEELS.slice(1, 2) : WHEELS) matchingFlow(createEqMatch(new Section()), w, w.label)
}

// ---------- macchina privata caricata da file ----------

console.log('Macchina privata: lettura del file, smontaggio, tavole, misura e matching')
{
  // ogni tentativo di andare in rete durante la prova è un errore
  const net: string[] = []
  const g = globalThis as Record<string, unknown>
  const saved = { fetch: g.fetch, XMLHttpRequest: g.XMLHttpRequest, WebSocket: g.WebSocket }
  g.fetch = (u: unknown) => { net.push(String(u)); return Promise.reject(new Error('rete vietata')) }
  g.XMLHttpRequest = class { open(_m: string, u: string) { net.push(u) } send() {} }
  g.WebSocket = class { constructor(u: string) { net.push(u) } }

  const checks: [string, boolean][] = []
  let file: ReturnType<typeof leggiMacchina> | null = null
  try { file = leggiMacchina(esempio) } catch (e) { fail('macchina di esempio non valida: ' + (e as Error).message) }
  checks.push([`macchina di esempio letta: ${file?.pezzi.length ?? 0} pezzi, ${file?.ricambi.length ?? 0} ricambi, ${file?.tavole.length ?? 0} tavole`, !!file])

  // file sbagliati: devono essere rifiutati con un messaggio, senza eccezioni d'altro tipo
  const base = JSON.parse(esempio)
  const bad: [string, unknown][] = [
    ['non JSON', 'function(){ alert(1) }'],
    ['formato diverso', { ...base, formato: 'altro' }],
    ['versione futura', { ...base, versione: 2 }],
    ['tipo non supportato', { ...base, tipo: 'smontagomme' }],
    ['campo sconosciuto', { ...base, script: 'x' }],
    ['numero fuori scala', { ...base, pezzi: [{ ...base.pezzi[0], posizione: [1e9, 0, 0] }] }],
    ['forma sconosciuta', { ...base, pezzi: [{ ...base.pezzi[0], forma: { tipo: 'mesh', url: 'http://esempio.invalid/a.glb' } }] }],
    ['id ripetuto', { ...base, pezzi: [base.pezzi[0], base.pezzi[0]] }],
    ['materiale __proto__', { ...base, materiali: JSON.parse('{"__proto__": {"colore": "#000000", "metallo": 0, "ruvidita": 0}}') }],
    ['troppi punti', { ...base, pezzi: [{ ...base.pezzi[0], forma: { tipo: 'tubo', raggio: 0.01, percorso: Array.from({ length: 5000 }, (_, i) => [i / 1e4, 0, 0]) } }] }],
  ]
  for (const [k, v] of bad) {
    let ok = false
    try { leggiMacchina(typeof v === 'string' ? v : JSON.stringify(v)) } catch (e) { ok = e instanceof ErroreFormato }
    checks.push([`rifiutato: ${k}`, ok])
  }

  if (file) {
    const pm = createPrivateMachine(new Section(), file, 'privata-prova')
    const model = pm.model
    for (let i = 0; i < 30; i++) pm.update(DT, i * 16, true)
    const ids = new Set(file.pezzi.map((p) => (p.tavola !== undefined ? `t${p.tavola}p${p.posizione_tavola}` : `pezzo-${p.id}`)))
    checks.push([`una scheda per voce di tavola (${ids.size})`, [...ids].every((id) => !!pm.parts[id] && model.parts.has(id))])
    checks.push(['ogni voce ha la sua etichetta T·pos', [...ids].every((id) => { let n = 0; model.root.traverse((o) => { if (o.userData.noPick && o.userData.part === id && o.userData.anchor) n++ }); return n === 1 })])

    // smontaggio: a metà corsa i pezzi del primo ordine sono fuori, quelli dell'ultimo ancora al loro posto
    const orders = [...new Set(file.pezzi.map((p) => p.esploso.ordine))].sort((a, b) => a - b)
    const posOf = (id: string) => model.parts.get(id)!.pieces.map((pc) => pc.obj.position.length())
    const first = file.pezzi.find((p) => p.esploso.ordine === orders[0] && p.esploso.distanza > 0)!
    const last = file.pezzi.find((p) => p.esploso.ordine === orders[orders.length - 1])!
    const idOf = (p: (typeof file.pezzi)[number]) => (p.tavola !== undefined ? `t${p.tavola}p${p.posizione_tavola}` : `pezzo-${p.id}`)
    model.explode(0.5)
    const ruotaFuori = model.parts.get('pneumatico')!.pieces[0].obj.position.length() > 0.59
    checks.push([`smontaggio in ordine: a metà corsa ruota e ordine ${orders[0]} fuori, ordine ${orders[orders.length - 1]} ancora montato`, ruotaFuori && Math.max(...posOf(idOf(first))) > first.esploso.distanza * 0.99 && Math.max(...posOf(idOf(last))) < 1e-9])
    model.explode(1)
    checks.push(['smontaggio completo: ogni pezzo alla sua distanza', file.pezzi.every((p) => Math.abs(Math.max(...posOf(idOf(p))) - p.esploso.distanza) < 1e-6 || model.parts.get(idOf(p))!.pieces.some((pc) => Math.abs(pc.obj.position.length() - p.esploso.distanza) < 1e-6))])
    model.explode(0)

    // una tavola alla volta
    model.showTavola(3)
    const vis = [...model.parts.values()].filter((p) => !p.hidden).map((p) => p.id)
    checks.push([`tavola 3: si vedono solo i suoi ${vis.length} pezzi`, vis.length > 0 && vis.every((id) => model.tavolaOf.get(id) === 3)])
    model.showTavola(null)
    checks.push(['tutte le tavole di nuovo visibili', [...model.parts.values()].every((p) => !p.hidden)])

    // misura e matching come nella macchina pubblica, con la ruota che torna a questa macchina
    pm.test.checkEveryFrame()
    const okFlow = matchingFlow(pm, WHEELS[0], `${file.nome} ${WHEELS[0].label}`)
    checks.push(['matching completo sulla macchina privata', okFlow])
    checks.push(['lo smontagomme rimanda la ruota alla macchina privata', match.owner === 'privata-prova' && match.ownerName === file.nome])
  }
  checks.push([`nessuna richiesta di rete${net.length ? ': ' + net.join(', ') : ''}`, net.length === 0])
  Object.assign(g, saved)
  for (const [k, ok] of checks) if (ok) console.log('  ✓ ' + k); else fail(k)
}

console.warn = warn
if (failed) {
  console.log('Verifica NON superata')
  ;(globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1
} else console.log('Verifica superata')
