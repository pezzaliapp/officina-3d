import './style.css'
import * as THREE from 'three'
import { createStage, homeView } from './scene'
import { Section } from './core/section'
import { Machine } from './core/machine'
import { createBalancer } from './equilibratrice'
import { createTireChanger } from './smontagomme'
import { ui, setupTabs, esc } from './ui'

const host = document.getElementById('scena')!
const { renderer, scene, camera, controls } = createStage(host)
const section = new Section()

/** Macchine disponibili: create solo la prima volta che vengono aperte. */
const FACTORIES: Record<string, (s: Section) => Machine> = {
  equilibratrice: createBalancer,
  smontagomme: createTireChanger,
}
const built = new Map<string, Machine>()
let m!: Machine

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

// ---------- cambio macchina ----------

function open(id: string) {
  if (!FACTORIES[id]) id = 'equilibratrice'
  if (m?.id === id) return
  if (m) {
    m.model.highlight(null)
    m.model.root.visible = false
  }
  let next = built.get(id)
  if (!next) {
    next = FACTORIES[id](section)
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
  document.title = `Officina 3D · ${m.name}`
  history.replaceState(null, '', '#' + id)
  buildPartList()
  select(null)
  layout()
  homeView(camera, controls, m.view)
  dirty = true
}

ui.macchina.addEventListener('change', () => open(ui.macchina.value))
window.addEventListener('hashchange', () => open(location.hash.slice(1)))

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
ui.vista.addEventListener('click', () => { homeView(camera, controls, m.view); dirty = true })
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
    b.addEventListener('click', () => select(selected === id ? null : id))
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
  ui.hudStato.textContent = s.status
  ui.hudRpm.textContent = s.detail
  if (tab === 'fisica') ui.fisica.innerHTML = m.physics().map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('')
}

// ---------- animazione ----------

const timer = new THREE.Timer()

function frame(now: number) {
  requestAnimationFrame(frame)
  timer.update(now)
  const dt = Math.max(0, Math.min(timer.getDelta(), 0.05))
  if (m.update(dt, now, flows)) dirty = true
  updateUi(now)
  if (controls.autoRotate) dirty = true
  controls.update()
  if (dirty) {
    renderer.render(scene, camera)
    dirty = false
  }
}

open(location.hash.slice(1) || 'equilibratrice')
requestAnimationFrame(frame)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js'))
}
