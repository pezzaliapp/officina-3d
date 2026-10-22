import './style.css'
import * as THREE from 'three'
import { createStage, homeView } from './scene'
import { Section } from './core/section'
import { BalancerModel } from './machine/model'
import { ConsoleDisplay } from './machine/display'
import { Controller } from './machine/controller'
import { PARTS } from './machine/parts'
import { WHEELS, LAYOUT, MACHINE, wheelGeometry, abs, arg } from './machine/physics'
import { ui, setupTabs, num, esc, drawScope } from './ui'

const host = document.getElementById('scena')!
const { renderer, scene, camera, controls } = createStage(host)
const section = new Section()
const lcd = new ConsoleDisplay()
const model = new BalancerModel(section, lcd.texture)
scene.add(model.root)
const ctrl = new Controller()

let spec = WHEELS[1]
const xInnerOf = (s = spec) => LAYOUT.flangeFace - s.et - wheelGeometry(s).width / 2
ctrl.b.setWheel(spec, xInnerOf())
model.buildWheel(spec)
ctrl.onWeights = () => model.setWeights(ctrl.b.weights, spec)

let dirty = true
let tab = 'misura'
let selected: string | null = null
let flows = true

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
layout()
homeView(camera, controls)
controls.addEventListener('change', () => (dirty = true))

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

for (const w of WHEELS) {
  const o = document.createElement('option')
  o.value = w.id
  o.textContent = w.label
  ui.ruota.append(o)
}
ui.ruota.value = spec.id
ui.ruota.addEventListener('change', () => {
  const next = WHEELS.find((w) => w.id === ui.ruota.value)!
  if (!ctrl.setWheel(next, xInnerOf(next))) { ui.ruota.value = spec.id; return }
  spec = next
  model.buildWheel(spec)
  dirty = true
})
ui.misura.addEventListener('click', () => ctrl.measure())
ui.pesi.addEventListener('click', () => ctrl.applyWeights())
ui.nuova.addEventListener('click', () => ctrl.newWheel())
ui.carter.addEventListener('click', () => ctrl.toggleGuard())
ui.vista.addEventListener('click', () => { homeView(camera, controls); dirty = true })
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
  model.explode(t * t * (3 - 2 * t))
  ui.oEsp.textContent = ui.esp.value + '%'
  dirty = true
})

// ---------- parti ----------

const order = ['pneumatico', 'cerchio', 'pesi', 'ghiera', 'cono', 'flangia', 'albero', 'cannotto', 'sensori', 'encoder', 'cinghia', 'motore', 'scheda', 'calibro', 'carter', 'console', 'vaschetta', 'telaio', 'mobile', 'pedale']
for (const id of order) {
  const b = document.createElement('button')
  b.textContent = PARTS[id].name
  b.dataset.id = id
  b.addEventListener('click', () => select(selected === id ? null : id))
  ui.elenco.append(b)
}

function select(id: string | null) {
  selected = id
  model.highlight(id)
  ui.elenco.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('attiva', b.dataset.id === id))
  ui.etichetta.hidden = !id
  if (!id) {
    ui.scheda.innerHTML = '<p class="vuoto">Tocca un pezzo della macchina o sceglilo dall\'elenco.</p>'
  } else {
    const p = PARTS[id]
    ui.etichetta.textContent = p.name
    const hidden = model.parts.get(id)?.hidden
    const dati = p.data?.length
      ? `<div class="dati">${p.data.map((d) => `<span>${esc(d.k)}</span><span>${esc(d.v)}${d.indicativo ? '<span class="ind">indicativo</span>' : ''}</span>`).join('')}</div>`
      : ''
    ui.scheda.innerHTML = `<h3>${esc(p.name)}</h3><p>${esc(p.text)}</p>${dati}
      <div class="azioni"><button data-a="nascondi">${hidden ? 'Mostra' : 'Nascondi'}</button><button data-a="tutto">Mostra tutto</button></div>`
    ui.scheda.querySelector('[data-a="nascondi"]')!.addEventListener('click', () => { model.setHidden(id, !hidden); select(id) })
  }
  ui.scheda.querySelector('[data-a="tutto"]')?.addEventListener('click', () => {
    for (const k of model.parts.keys()) model.setHidden(k, false)
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
  const id = model.pick(ray)
  select(id)
  if (id && tab !== 'parti' && !ctrl.busy) openTab('parti')
})

// ---------- aggiornamento interfaccia ----------

let lastUi = 0
function updateUi(now: number) {
  if (now - lastUi < 120) return
  lastUi = now
  const ds = ctrl.display(spec.rimInch, spec.rimWidthInch)
  ui.messaggio.textContent = ctrl.messaggio
  ui.hudStato.textContent = ds.status
  ui.hudRpm.textContent = `${Math.round(ds.rpm)} giri/min`
  for (const [el, v] of [[ui.rInt, ds.int], [ui.rEst, ds.est]] as const) {
    el.textContent = v === 'OK' || v === '---' ? v : v + ' g'
    el.classList.toggle('ok', v === 'OK')
  }
  const apart = model.exploded > 0.01
  ui.misura.disabled = ctrl.busy || apart
  ui.misura.textContent = apart ? 'Rimonta per misurare' : '▶ Avvia misura'
  ui.pesi.disabled = ctrl.stato !== 'risultato' || !ctrl.result || (ctrl.result.int.shown === 0 && ctrl.result.est.shown === 0)
  ui.nuova.disabled = ctrl.busy
  ui.ruota.disabled = ctrl.busy
  if (tab === 'fisica') updatePhysics()
}

function updatePhysics() {
  const b = ctrl.b
  const ind = '<span class="ind">indicativo</span>'
  const { fa, fb } = b.sensorForces()
  const r = ctrl.result, v = ctrl.vero
  const rows: [string, string][] = [
    ['Velocità', `${num((b.omega * 30) / Math.PI, 0)} giri/min · ${num(b.omega)} rad/s`],
    ['Velocità di misura', `${MACHINE.rpmMeasure} giri/min ${ind}`],
    ['Forza sensore A', `${num(abs(fa), 2)} N`],
    ['Forza sensore B', `${num(abs(fb), 2)} N`],
    ['Coppia alla ruota', `${num(b.torque, 1)} N·m ${ind}`],
    ['Massa ruota', `${num(spec.mass, 0)} kg ${ind}`],
    ['Inerzia rotante', `${num(b.inertia, 2)} kg·m² ${ind}`],
    ['Energia cinetica', `${num(0.5 * b.inertia * b.omega ** 2, 0)} J`],
    ['Distanza a', `${num(b.xInner * 1000, 0)} mm`],
    ['Larghezza b', `${num(b.geo.width * 1000, 0)} mm`],
    ['Raggio dei pesi', `${num(b.rWeight * 1000, 0)} mm`],
  ]
  if (r && v) {
    rows.push(
      ['Interno: misurato / reale', `${num(r.int.grams)} / ${num(v.int)} g`],
      ['Esterno: misurato / reale', `${num(r.est.grams)} / ${num(v.est)} g`],
      ['Squilibrio statico', `${num(r.staticG)} g`],
    )
  }
  ui.fisica.innerHTML = rows.map(([k, val]) => `<span>${k}</span><span>${val}</span>`).join('')
}

// ---------- animazione ----------

const timer = new THREE.Timer()
let beltLen = 1
model.root.traverse((o) => { if (o.userData.length) beltLen = o.userData.length })
let pulse = 0
let lastLcd = 0

function frame(now: number) {
  requestAnimationFrame(frame)
  timer.update(now)
  const dt = Math.max(0, Math.min(timer.getDelta(), 0.05))
  const moving = ctrl.update(dt)
  const b = ctrl.b

  model.rotor.rotation.x = b.angle
  model.guard.rotation.x = ctrl.guard
  model.calSlide.position.x = ctrl.cal

  // cinghia: la trama scorre alla velocità periferica della puleggia
  model.beltMap.offset.x -= ((b.omega * 0.078 * dt) / beltLen) * model.beltMap.repeat.x

  // forze centrifughe sui due piani e sensori che si illuminano con la forza
  const spin = b.omega > 1
  const w2 = b.omega ** 2
  const ui_ = b.total('int'), uo = b.total('est')
  model.setArrows(flows && spin, [
    { x: b.xInner, angle: arg(ui_), force: abs(ui_) * w2 },
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

  if (moving && now - lastLcd > 66) {
    lastLcd = now
    if (lcd.draw(ctrl.display(spec.rimInch, spec.rimWidthInch))) dirty = true
    if (ctrl.spinning) drawScope(ui.scope, ctrl.scopeA, ctrl.scopeB, ctrl.scopeHead)
  } else if (!moving && lcd.draw(ctrl.display(spec.rimInch, spec.rimWidthInch))) dirty = true

  updateUi(now)
  if (controls.autoRotate) dirty = true
  controls.update()
  if (moving || dirty || live) {
    renderer.render(scene, camera)
    dirty = false
  }
}
drawScope(ui.scope, ctrl.scopeA, ctrl.scopeB, ctrl.scopeHead)
requestAnimationFrame(frame)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js'))
}
