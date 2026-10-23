/**
 * Verifica nel browser: la macchina di esempio caricata da file, misurata in Chromium e in WebKit (Safari).
 *
 * Avvia Vite in locale, apre l'app, carica docs/esempi/equilibratrice-di-prova.json con
 * "＋ Carica macchina" e preme "Avvia misura" con il carter alzato, tenendo premuto il tasto
 * come una persona (Safari perdeva il click se il testo del pulsante cambiava nel frattempo).
 * Controlla che la misura arrivi al risultato, che le righe dei ricambi contengano il loro
 * testo, che non ci siano errori in console e che nessuna richiesta esca dal server locale.
 *
 * I browser si installano una volta con: npx playwright install chromium webkit
 */
import { createServer } from 'vite'
import { chromium, webkit } from 'playwright'
import { fileURLToPath } from 'node:url'

const ESEMPIO = fileURLToPath(new URL('../docs/esempi/equilibratrice-di-prova.json', import.meta.url))
let failed = false
const ok = (cond, msg) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) failed = true }

const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const base = server.resolvedUrls.local[0]
const origin = new URL(base).origin

for (const [nome, tipo] of [['Chromium', chromium], ['WebKit', webkit]]) {
  console.log(`Browser: ${nome}, macchina di esempio da file`)
  let browser
  try {
    browser = await tipo.launch()
  } catch (e) {
    ok(false, `${nome} non si avvia (${e.message.split('\n')[0]}): installalo con npx playwright install chromium webkit`)
    continue
  }
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errori = [], fuori = []
  page.on('pageerror', (e) => errori.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errori.push(m.text()))
  // ogni richiesta che esce dal server locale è un errore, e non parte
  await page.route('**/*', (r) => (r.request().url().startsWith(origin) ? r.continue() : (fuori.push(r.request().url()), r.abort())))

  try {
    await page.goto(base)
    await page.waitForSelector('#btn-carica')
    const [scelta] = await Promise.all([page.waitForEvent('filechooser'), page.click('#btn-carica')])
    await scelta.setFiles(ESEMPIO)
    await page.waitForFunction(() => document.getElementById('sel-macchina').selectedOptions[0]?.textContent.includes('📱'), null, { timeout: 15000 })
    const hud = () => page.evaluate(() => document.getElementById('hud-stato').textContent)
    ok((await hud()) === 'PRONTO', 'macchina caricata, pronta')

    // clic lungo su "Avvia misura" con il carter alzato
    const box = await page.locator('[data-id="misura"]').boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(400)
    await page.mouse.up()
    let partita = false
    try { await page.waitForFunction(() => document.getElementById('hud-stato').textContent !== 'PRONTO', null, { timeout: 3000 }); partita = true } catch {}
    ok(partita, 'Avvia misura con il tasto tenuto premuto 400 ms: la misura parte (abbassa da sola il carter)')
    let risultato = false
    if (partita) try { await page.waitForFunction(() => document.getElementById('hud-stato').textContent === 'RISULTATO', null, { timeout: 120000 }); risultato = true } catch {}
    const pesi = await page.evaluate(() => [...document.querySelectorAll('[data-id="r-int"], [data-id="r-est"]')].map((e) => e.textContent).join(' / '))
    ok(risultato, `misura completa: ${pesi}`)

    // elenco ricambi: ogni riga contiene il suo testo e non copre la successiva
    const geo = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.ricambio')]
      let male = 0
      rows.forEach((b, i) => {
        const r = b.getBoundingClientRect()
        for (const c of b.children) { const q = c.getBoundingClientRect(); if (q.bottom > r.bottom + 0.5 || q.right > r.right + 0.5) male++ }
        if (i && r.top < rows[i - 1].getBoundingClientRect().bottom - 0.5) male++
      })
      return { righe: rows.length, male }
    })
    ok(geo.righe > 0 && geo.male === 0, `elenco ricambi: ${geo.righe} righe, nessun testo fuori dalla sua riga`)
  } catch (e) {
    ok(false, `prova interrotta: ${e.message.split('\n')[0]}`)
  }
  ok(errori.length === 0, `nessun errore in console${errori.length ? ': ' + errori.slice(0, 3).join(' | ') : ''}`)
  ok(fuori.length === 0, `nessuna richiesta fuori dal server locale${fuori.length ? ': ' + fuori.slice(0, 3).join(', ') : ''}`)
  await browser.close()
}

await server.close()
if (failed) {
  console.log('Verifica nel browser NON superata')
  process.exitCode = 1
} else console.log('Verifica nel browser superata')
