import './style.css'
import * as THREE from 'three'
import { createStage, homeView, viewPose } from './scene'
import { Section } from './core/section'
import { Machine, View } from './core/machine'
import { createBalancer } from './equilibratrice'
import { createTireChanger } from './smontagomme'
import { createEqMatch } from './eqmatch'
import { createSmontMatch } from './smontmatch'
import { ui, setupTabs, esc, setText } from './ui'
import { nav } from './core/nav'
import { leggiMacchina, ErroreFormato } from './privata/format'
import { createPrivateMachine } from './privata'
import * as archivio from './privata/store'
import { Etichette } from './privata/etichette'
import type { PrivateModel } from './privata/model'

const host = document.getElementById('scena')!
const { renderer, scene, camera, controls } = createStage(host)
const section = new Section()

/** Etichette tavola·posizione delle macchine caricate da file: pulsanti sopra la scena. */
const etichette = new Etichette(
  host,
  camera,
  (id) => nav.select(id),
  () => [ui.pannello, document.querySelector<HTMLElement>('.marchio'), ui.btnInfo, document.getElementById('hud'), ui.etichetta]
    .filter((e): e is HTMLElement => !!e && !e.hidden)
    .map((e) => e.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0),
  () => (dirty = true),
)

/** Macchine disponibili: create solo la prima volta che vengono aperte. */
const FACTORIES: Record<string, (s: Section) => Machine> = {
  equilibratrice: createBalancer,
  smontagomme: createTireChanger,
  eqmatch: createEqMatch,
  smontmatch: createSmontMatch,
}
const built = new Map<string, Machine>()
let m!: Machine
/**
 * Macchine private caricate da file: stanno in IndexedDB, solo su questo dispositivo.
 * Non passano mai dall'indirizzo della pagina né dalla rete.
 */
const privates = new Map<string, archivio.Salvata>()
const isPrivate = (id: string) => privates.has(id)

let dirty = true
let tab = 'lavoro'
let selected: string | null = null
let flows = true
let explode = 0

// ---------- inquadratura: il pannello copre parte dello schermo ----------

function layout() {
  const w = window.innerWidth, h = window.innerHeight
  renderer.setSize(w, h)
  camera.aspect = w / h
  const desk = w >= 900
  const closed = ui.pannello.classList.contains('chiuso')
  if (desk) camera.setViewOffset(w, h, 198, 0, w, h)
  else camera.setViewOffset(w, h, 0, closed ? 30 : ui.pannello.offsetHeight / 2 - 20, w, h)
  camera.updateProjectionMatrix()
  dirty = true
}
window.addEventListener('resize', layout)
controls.addEventListener('change', () => (dirty = true))

// ---------- volo della camera verso un'inquadratura dedicata ----------

type Pose = { position: THREE.Vector3; target: THREE.Vector3 }
let fly: { from: Pose; to: Pose; t: number } | null = null
/** Vista da ritrovare quando il ciclo non chiede più la sua inquadratura. */
let back: Pose | null = null
let cycleView = false
const pose = (): Pose => ({ position: camera.position.clone(), target: controls.target.clone() })
function flyTo(to: Pose) {
  fly = { from: pose(), to, t: 0 }
  dirty = true
}
function stepFly(dt: number) {
  if (!fly) return
  fly.t = Math.min(fly.t + dt / 0.9, 1)
  const k = fly.t * fly.t * (3 - 2 * fly.t)
  camera.position.lerpVectors(fly.from.position, fly.to.position, k)
  controls.target.lerpVectors(fly.from.target, fly.to.target, k)
  if (fly.t >= 1) fly = null
  dirty = true
}
/** Inquadratura chiesta dal ciclo: ci si va e poi si torna alla vista di prima. */
function followCycle() {
  const v: View | null = m.cameraView?.() ?? null
  if (v && !cycleView) {
    cycleView = true
    back = pose()
    flyTo(viewPose(camera, v))
  } else if (!v && cycleView) {
    cycleView = false
    if (back) flyTo(back)
    back = null
  }
}
// chi gira la vista a mano la tiene: niente ritorno automatico
controls.addEventListener('start', () => { fly = null; back = null })

// ---------- cambio macchina ----------

function open(id: string) {
  if (!FACTORIES[id] && !isPrivate(id)) id = 'equilibratrice'
  if (m?.id === id) return
  if (m) {
    m.model.highlight(null)
    m.model.root.visible = false
  }
  let next = built.get(id)
  if (!next) {
    try {
      next = isPrivate(id) ? createPrivateMachine(section, leggiMacchina(privates.get(id)!.testo), id) : FACTORIES[id](section)
    } catch (e) {
      // un file salvato che non si legge più (formato cambiato, dati rovinati): resta nel menu, si può rimuovere
      notice('Macchina non leggibile', e instanceof ErroreFormato ? e.errori : [(e as Error).message])
      if (m) { m.model.root.visible = true; ui.macchina.value = m.id; return }
      id = 'equilibratrice'
      next = FACTORIES[id](section)
    }
    built.set(id, next)
    scene.add(next.model.root)
  }
  m = next
  m.model.root.visible = true
  m.model.explode(explode)
  ui.macchina.value = id
  ui.tabLavoro.textContent = m.workTab
  m.mount(ui.lavoro)
  ui.fisicaTesto.innerHTML = m.physicsText
  // la macchina privata non va nell'indirizzo, nel titolo (cronologia) né altrove fuori da qui
  document.title = isPrivate(id) ? 'Officina 3D · macchina privata' : `Officina 3D · ${m.name}`
  history.replaceState(null, '', isPrivate(id) ? location.pathname + location.search : '#' + id)
  ui.rimuovi.hidden = !isPrivate(id)
  etichette.setModel(isPrivate(id) ? (m.model as PrivateModel) : null)
  buildPartList()
  select(null)
  layout()
  fly = null
  back = null
  cycleView = false
  homeView(camera, controls, m.view)
  dirty = true
}

ui.macchina.addEventListener('change', () => open(ui.macchina.value))
window.addEventListener('hashchange', () => open(location.hash.slice(1)))
nav.open = (id) => { if (isPrivate(id)) open(id); else location.hash = id }

// ---------- macchine private da file ----------

/** Avviso nel pannello di dialogo; con onYes diventa una conferma. */
function notice(title: string, lines: string[], onYes?: () => void, yes = 'Chiudi') {
  ui.avvisoTitolo.textContent = title
  ui.avvisoTesto.replaceChildren(...lines.map((l) => Object.assign(document.createElement('p'), { textContent: l })))
  ui.avvisoOk.textContent = yes
  ui.avvisoNo.hidden = !onYes
  ui.avviso.onclose = () => { if (onYes && ui.avviso.returnValue === 'ok') onYes() }
  ui.avviso.returnValue = ''
  ui.avviso.showModal()
}

function privateMenu() {
  ui.macchina.querySelector('optgroup[data-private]')?.remove()
  if (!privates.size) return
  const g = document.createElement('optgroup')
  g.dataset.private = ''
  g.label = '📱 Solo su questo dispositivo'
  for (const p of privates.values()) g.append(new Option(`📱 ${p.nome}`, p.id))
  ui.macchina.append(g)
  if (m) ui.macchina.value = m.id
}

ui.carica.addEventListener('click', () => { ui.file.value = ''; ui.file.click() })
ui.file.addEventListener('change', async () => {
  const f = ui.file.files?.[0]
  if (!f) return
  try {
    // il file si legge come testo e si interpreta come JSON: non viene mai eseguito
    const testo = await f.text()
    const def = leggiMacchina(testo)
    const rec = await archivio.salva({ id: archivio.nuovaChiave(), nome: def.nome, testo, caricata: Date.now() })
    privates.set(rec.id, rec)
    privateMenu()
    open(rec.id)
  } catch (e) {
    notice('File non caricato', e instanceof ErroreFormato ? e.errori : [(e as Error).message])
  }
})
ui.rimuovi.addEventListener('click', () => {
  const p = privates.get(m.id)
  if (!p) return
  notice('Rimuovere la macchina?', [`«${p.nome}» verrà cancellata da questo dispositivo. Per riaverla serve di nuovo il file.`], async () => {
    try {
      await archivio.rimuovi(p.id)
    } catch (e) {
      notice('Rimozione non riuscita', [(e as Error).message])
      return
    }
    const mc = built.get(p.id)
    privates.delete(p.id)
    open('equilibratrice')
    if (mc) { scene.remove(mc.model.root); built.delete(p.id) }
    privateMenu()
  }, 'Rimuovi')
})

// ---------- pannello ----------

const openTab = setupTabs((t) => {
  tab = t
  setTimeout(layout, 260)
})
ui.maniglia.addEventListener('click', () => {
  ui.pannello.classList.toggle('chiuso')
  setTimeout(layout, 260)
})
ui.btnInfo.addEventListener('click', () => ui.info.showModal())
ui.vista.addEventListener('click', () => { fly = null; back = null; homeView(camera, controls, m.view); dirty = true })
ui.flussi.addEventListener('change', () => { flows = ui.flussi.checked; dirty = true })
ui.giro.addEventListener('change', () => { controls.autoRotate = ui.giro.checked })
ui.sez.addEventListener('input', () => {
  section.set(+ui.sez.value / 100)
  ui.oSez.textContent = ui.sez.value + '%'
  dirty = true
})
ui.esp.addEventListener('input', () => {
  // dolce all'inizio e alla fine
  const t = +ui.esp.value / 100
  explode = t * t * (3 - 2 * t)
  m.model.explode(explode)
  section.setExplode(explode)
  ui.oEsp.textContent = ui.esp.value + '%'
  dirty = true
})

// ---------- parti ----------

function buildPartList() {
  ui.elenco.innerHTML = ''
  for (const id of m.order) {
    const b = document.createElement('button')
    b.textContent = m.parts[id].name
    b.dataset.id = id
    b.addEventListener('click', () => {
      select(selected === id ? null : id)
      const v = selected && m.partView?.(selected)
      if (v) flyTo(viewPose(camera, v))
    })
    ui.elenco.append(b)
  }
}

function select(id: string | null) {
  selected = id
  m.model.highlight(id)
  ui.elenco.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('attiva', b.dataset.id === id))
  ui.etichetta.hidden = !id
  if (!id) {
    ui.scheda.innerHTML = '<p class="vuoto">Tocca un pezzo della macchina o sceglilo dall\'elenco.</p>'
  } else {
    const p = m.parts[id]
    ui.etichetta.textContent = p.name
    const hidden = m.model.parts.get(id)?.hidden
    const dati = p.data?.length
      ? `<div class="dati">${p.data.map((d) => `<span>${esc(d.k)}</span><span>${esc(d.v)}${d.indicativo ? '<span class="ind">indicativo</span>' : ''}</span>`).join('')}</div>`
      : ''
    ui.scheda.innerHTML = `<h3>${esc(p.name)}</h3><p>${esc(p.text)}</p>${dati}
      <div class="azioni"><button data-a="nascondi">${hidden ? 'Mostra' : 'Nascondi'}</button><button data-a="tutto">Mostra tutto</button></div>`
    ui.scheda.querySelector('[data-a="nascondi"]')!.addEventListener('click', () => { m.model.setHidden(id, !hidden); select(id) })
  }
  ui.scheda.querySelector('[data-a="tutto"]')?.addEventListener('click', () => {
    for (const k of m.model.parts.keys()) m.model.setHidden(k, false)
    select(selected)
  })
  dirty = true
}

// tocco breve = selezione, trascinamento = rotazione della vista
const ray = new THREE.Raycaster()
let down: { x: number; y: number; t: number } | null = null
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() } })
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down) return
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
  const quick = performance.now() - down.t < 450
  down = null
  if (moved > 8 || !quick) return
  const r = renderer.domElement.getBoundingClientRect()
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera)
  const id = m.model.pick(ray)
  select(id)
  if (id && tab !== 'parti' && !m.busy) openTab('parti')
})

// ---------- aggiornamento interfaccia ----------

let lastUi = 0
function updateUi(now: number) {
  if (now - lastUi < 120) return
  lastUi = now
  const s = m.refresh()
  setText(ui.hudStato, s.status)
  setText(ui.hudRpm, s.detail)
  if (tab === 'fisica') {
    ui.fisica.innerHTML = m.physics().map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('')
    const extra = m.physicsExtra?.() ?? ''
    if (ui.fisicaExtra.dataset.html !== extra) { ui.fisicaExtra.innerHTML = extra; ui.fisicaExtra.dataset.html = extra }
  }
}

// ---------- animazione ----------

const timer = new THREE.Timer()

function frame(now: number) {
  requestAnimationFrame(frame)
  timer.update(now)
  const dt = Math.max(0, Math.min(timer.getDelta(), 0.05))
  if (m.update(dt, now, flows)) dirty = true
  followCycle()
  stepFly(dt)
  updateUi(now)
  if (controls.autoRotate) dirty = true
  controls.update()
  if (dirty || etichette.needsUpdate) etichette.update(now)
  if (dirty) {
    renderer.render(scene, camera)
    dirty = false
  }
}

// Esc: si torna alla vista normale, senza pezzo scelto
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && selected && !document.querySelector('dialog[open]')) select(null)
})
nav.redraw = () => (dirty = true)

nav.frame = (v) => flyTo(viewPose(camera, v))
// scelta di un pezzo da un controllo della macchina (es. l'elenco ricambi): scheda e inquadratura
nav.select = (id) => {
  select(id)
  if (!id) return
  openTab('parti')
  const v = m.partView?.(id)
  if (v) flyTo(viewPose(camera, v))
}

open(location.hash.slice(1) || 'equilibratrice')
archivio.elenco().then((l) => { for (const p of l) privates.set(p.id, p); privateMenu() }).catch(() => {})
requestAnimationFrame(frame)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js'))
}
