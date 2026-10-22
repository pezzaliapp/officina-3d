/**
 * Verifica automatica delle macchine, senza browser.
 *
 * Smontagomme: esegue il ciclo completo (due volte, per provare anche "Nuovo ciclo")
 * su tutte le misure di ruota, con e senza braccio di aiuto, e raccoglie le
 * compenetrazioni tra pezzi della macchina e ruota segnalate dal controllo.
 * Equilibratrice: esegue una misura e confronta il risultato con lo squilibrio reale.
 *
 * Uso: npm run verifica
 */
import './dom-stub'
import { Section } from '../src/core/section'
import { WHEELS } from '../src/core/wheel'
import { createTireChanger, Clash } from '../src/smontagomme'
import { createBalancer } from '../src/equilibratrice'
import { Controller } from '../src/equilibratrice/controller'
import { WHEELS as BAL_WHEELS, LAYOUT, wheelGeometry } from '../src/equilibratrice/physics'

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

console.warn = warn
if (failed) {
  console.log('Verifica NON superata')
  ;(globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1
} else console.log('Verifica superata')
