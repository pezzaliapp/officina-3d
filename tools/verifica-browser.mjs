/**
 * Verifica nel browser: la macchina di esempio caricata da file, in Chromium e in WebKit (Safari).
 *
 * Avvia Vite in locale, apre l'app e carica docs/esempi/equilibratrice-di-prova.json con
 * "＋ Carica macchina". Poi, in ogni browser:
 * - misura: preme "Avvia misura" con il carter alzato, tenendo premuto il tasto come una
 *   persona (Safari perdeva il click se il testo del pulsante cambiava nel frattempo), e
 *   aspetta il risultato; controlla che le righe dei ricambi contengano il loro testo;
 * - etichette T·pos col mouse: nessuna sovrapposizione, il passaggio illumina il pezzo senza
 *   aprire la scheda, il click lo sceglie (etichetta in evidenza, linea spessa col pallino,
 *   altre attenuate, scheda nel pannello Parti), Esc torna alla vista normale;
 * - etichette su un telefono: aree di tocco di almeno 32 px, il primo tocco illumina,
 *   il secondo sceglie.
 * Ogni messaggio d'errore in console e ogni richiesta che esce dal server locale è un errore.
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

/** Nuova pagina con la macchina di esempio caricata dal pulsante; raccoglie errori e richieste esterne. */
async function apri(browser, opzioni, errori, fuori) {
  const ctx = await browser.newContext(opzioni)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errori.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errori.push(m.text()))
  // ogni richiesta che esce dal server locale è un errore, e non parte
  await page.route('**/*', (r) => (r.request().url().startsWith(origin) ? r.continue() : (fuori.push(r.request().url()), r.abort())))
  await page.goto(base)
  await page.waitForSelector('#btn-carica')
  const [scelta] = await Promise.all([page.waitForEvent('filechooser'), page.click('#btn-carica')])
  await scelta.setFiles(ESEMPIO)
  await page.waitForFunction(() => document.getElementById('sel-macchina').selectedOptions[0]?.textContent.includes('📱'), null, { timeout: 15000 })
  await page.waitForTimeout(800)
  return page
}

/** Stato delle etichette T·pos visibili. */
const etichette = (page) => page.evaluate(() => {
  const vis = [...document.querySelectorAll('.etq')].filter((e) => getComputedStyle(e).visibility !== 'hidden')
  const r = vis.map((e) => e.getBoundingClientRect())
  let sovrapposte = 0
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) if (r[i].left < r[j].right - 0.5 && r[i].right > r[j].left + 0.5 && r[i].top < r[j].bottom - 0.5 && r[i].bottom > r[j].top + 0.5) sovrapposte++
  const tocco = vis.flatMap((e) => [...e.querySelectorAll('button')].map((b) => { const q = b.getBoundingClientRect(); return Math.min(q.width, q.height) }))
  return {
    visibili: vis.length, sovrapposte, tocco: Math.min(...tocco),
    sel: document.querySelectorAll('.etq.sel').length, prev: document.querySelectorAll('.etq.prev').length, dim: document.querySelectorAll('.etq.dim').length,
    linea: !!document.querySelector('.richiami line.sel'), pallino: !!document.querySelector('.richiami circle.sel'),
    scheda: document.querySelector('[data-pane="parti"].attiva #scheda-parte h3')?.textContent ?? null,
  }
})
/** Prima etichetta visibile: il suo primo pezzo. */
const primaEtichetta = (page) => page.evaluate(() => [...document.querySelectorAll('.etq')].find((e) => getComputedStyle(e).visibility !== 'hidden')?.querySelector('button')?.dataset.part ?? null)

for (const [nome, tipo] of [['Chromium', chromium], ['WebKit', webkit]]) {
  console.log(`Browser: ${nome}, macchina di esempio da file`)
  let browser
  try {
    browser = await tipo.launch()
  } catch (e) {
    ok(false, `${nome} non si avvia (${e.message.split('\n')[0]}): installalo con npx playwright install chromium webkit`)
    continue
  }
  const errori = [], fuori = []
  try {
    // ---------- misura ----------
    let page = await apri(browser, { viewport: { width: 1400, height: 900 } }, errori, fuori)
    const hud = () => page.evaluate(() => document.getElementById('hud-stato').textContent)
    ok((await hud()) === 'PRONTO', 'macchina caricata, pronta')
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
    await page.context().close()

    // ---------- etichette col mouse ----------
    page = await apri(browser, { viewport: { width: 1400, height: 900 } }, errori, fuori)
    let e = await etichette(page)
    ok(e.visibili > 3 && e.sovrapposte === 0, `etichette: ${e.visibili} visibili, nessuna sovrapposta`)
    const part = await primaEtichetta(page)
    const btn = page.locator(`.etq button[data-part="${part}"]`)
    await btn.hover()
    await page.waitForTimeout(300)
    e = await etichette(page)
    ok(e.prev === 1 && e.sel === 0 && !e.scheda, 'passaggio del mouse: il pezzo si illumina, la scheda non si apre')
    await btn.click()
    await page.mouse.move(5, 600)
    await page.waitForTimeout(1200)
    e = await etichette(page)
    ok(e.sel === 1 && e.linea && e.pallino && e.dim > 0 && !!e.scheda && e.sovrapposte === 0, `click sull'etichetta: pezzo scelto, linea spessa col pallino, altre attenuate, scheda «${e.scheda}»`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    e = await etichette(page)
    ok(e.sel === 0 && e.dim === 0 && !e.scheda, 'Esc: di nuovo la vista normale')
    // al contrario: il pezzo scelto dall'elenco ricambi accende la sua etichetta
    const tag = await btn.textContent()
    await page.click('[data-tab="lavoro"]')
    await page.locator('.ricambio', { hasText: tag }).first().click()
    await page.waitForTimeout(1200)
    e = await etichette(page)
    ok(e.sel === 1 && (await page.locator('.etq.sel').textContent()).includes(tag.split('·')[1]), `ricambio ${tag} scelto dall'elenco: la sua etichetta si accende`)
    await page.keyboard.press('Escape')
    // sezione: le etichette dei pezzi tolti dal taglio spariscono (il pannello frontale sta davanti al piano)
    await page.click('[data-tab="vista"]')
    await page.evaluate(() => { const s = document.getElementById('in-sez'); s.value = '100'; s.dispatchEvent(new Event('input')) })
    await page.waitForTimeout(800)
    const tagliata = await page.evaluate(() => [...document.querySelectorAll('.etq')].filter((x) => getComputedStyle(x).visibility !== 'hidden').some((x) => x.querySelector('button[data-part="t1p5"]')))
    ok(!tagliata, 'sezione: l\'etichetta del pannello frontale, tolto dal taglio, non si vede')
    await page.context().close()

    // ---------- etichette su un telefono ----------
    page = await apri(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, errori, fuori)
    await page.click('#maniglia')
    await page.waitForTimeout(800)
    e = await etichette(page)
    ok(e.visibili > 3 && e.sovrapposte === 0 && e.tocco >= 32, `telefono: ${e.visibili} etichette, nessuna sovrapposta, aree di tocco di ${Math.round(e.tocco)} px`)
    const parteT = await primaEtichetta(page)
    await page.locator(`.etq button[data-part="${parteT}"]`).tap()
    await page.waitForTimeout(400)
    e = await etichette(page)
    ok(e.prev === 1 && e.sel === 0 && !e.scheda, 'primo tocco: il pezzo si illumina')
    await page.locator(`.etq button[data-part="${parteT}"]`).tap()
    await page.waitForTimeout(1200)
    e = await etichette(page)
    ok(e.sel === 1 && !!e.scheda, `secondo tocco: pezzo scelto, scheda «${e.scheda}»`)
    await page.context().close()
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
