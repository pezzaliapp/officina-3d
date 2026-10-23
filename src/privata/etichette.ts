import * as THREE from 'three'
import type { PrivateModel } from './model'

/**
 * Etichette tavola·posizione (T5·12) delle macchine caricate da file.
 *
 * Sono pulsanti sopra la scena, non disegni nella scena: si toccano, si leggono a
 * qualsiasi distanza e si impaginano sullo schermo. A ogni aggiornamento:
 * - si tengono solo le etichette dei pezzi che si vedono davvero (tavola mostrata,
 *   non tolti dalla sezione, non coperti da altri pezzi: un raggio dalla camera);
 * - le etichette che cadono nello stesso punto diventano una sola ("T2·8, 9");
 * - ognuna si mette lungo la sua linea di richiamo, verso l'esterno della macchina,
 *   nella prima posizione libera; se non ce n'è, la meno importante (il pezzo più
 *   piccolo sullo schermo) resta nascosta finché non si avvicina la vista.
 * Il pezzo scelto ha la sua etichetta sempre visibile, più grande, con la linea
 * spessa che finisce con un pallino sul pezzo; le altre si attenuano.
 */

interface Voce { part: string; tag: string; at: THREE.Vector3; size: number }
interface Gruppo {
  key: string
  voci: Voce[]
  el: HTMLDivElement
  w: number
  h: number
}

/** Etichette che cadono a meno di così (m) si uniscono. */
const UNISCI = 0.015
/** Distanze (px) e scarti d'angolo (rad) provati lungo la linea di richiamo. */
const DIST = [30, 54, 82, 116, 156, 200]
const ANG = [0, 0.38, -0.38, 0.76, -0.76, 1.15, -1.15]
/** Ogni quanto (ms) si rifà il controllo dei pezzi coperti mentre la vista cambia. */
const OCC_MS = 250

export class Etichette {
  private readonly box = document.createElement('div')
  private readonly svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  private model: PrivateModel | null = null
  private gruppi = new Map<string, Gruppo>()
  private visibili: Gruppo[] = []
  private lastOcc = -1e9
  private stale = true
  private readonly ray = new THREE.Raycaster()
  private touch = false
  private touchTimer = 0

  constructor(
    host: HTMLElement,
    private camera: THREE.PerspectiveCamera,
    /** Scelta di un pezzo come se lo si toccasse: scheda e inquadratura. */
    private onSelect: (id: string) => void,
    /** Zone dello schermo coperte dall'interfaccia, da lasciare libere. */
    private avoid: () => DOMRect[],
    /** Chiede di ridisegnare la scena (anteprima di un pezzo). */
    private redraw: () => void,
  ) {
    this.box.className = 'etichette'
    this.svg.classList.add('richiami')
    this.box.append(this.svg)
    host.append(this.box)

    // passaggio del mouse: anteprima del pezzo; tocco: il primo illumina, il secondo sceglie
    this.box.addEventListener('pointerdown', (e) => { this.touch = e.pointerType !== 'mouse' })
    this.box.addEventListener('pointerover', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-part]')
      if (b && e.pointerType === 'mouse') this.anteprima(b.dataset.part!)
    })
    this.box.addEventListener('pointerout', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-part]')
      if (b && e.pointerType === 'mouse') this.anteprima(null)
    })
    this.box.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-part]')
      if (!b || !this.model) return
      const id = b.dataset.part!
      // col puntatore il focus non serve e terrebbe acceso il pulsante; da tastiera resta
      if (e.detail > 0) b.blur()
      if (this.touch && this.model.previewed !== id && this.model.selected !== id) {
        this.anteprima(id)
        clearTimeout(this.touchTimer)
        this.touchTimer = window.setTimeout(() => this.anteprima(null), 2500)
        return
      }
      clearTimeout(this.touchTimer)
      this.anteprima(null)
      this.onSelect(id)
    })
  }

  /** Macchina di cui mostrare le etichette (null = nessuna). */
  setModel(m: PrivateModel | null) {
    if (m === this.model) return
    this.model?.preview(null)
    this.model = m
    for (const g of this.gruppi.values()) g.el.remove()
    this.gruppi.clear()
    this.visibili = []
    this.stale = true
    this.lastOcc = -1e9
    this.box.hidden = !m
  }

  /** Vero finché il controllo dei pezzi coperti non ha visto l'ultima vista. */
  get needsUpdate() { return this.stale && !!this.model }

  private anteprima(id: string | null) {
    if (!this.model) return
    this.model.preview(id)
    this.stale = true
    this.redraw()
  }

  /** Da chiamare quando la scena cambia (vista, smontaggio, sezione, tavola, scelta). */
  update(now: number) {
    const m = this.model
    if (!m) return
    if (!m.labelsShown) { this.box.hidden = true; this.stale = false; return }
    this.box.hidden = false
    if (now - this.lastOcc >= OCC_MS) {
      this.lastOcc = now
      this.stale = false
      this.raggruppa(m)
    } else this.stale = true
    this.impagina(m)
  }

  // ---------- quali etichette si vedono e quali si uniscono ----------

  private raggruppa(m: PrivateModel) {
    m.root.updateMatrixWorld(true)
    const cam = this.camera.position
    const voci: Voce[] = []
    /** Pezzi coperti da un pezzo attaccato (rondelle in pila, viti nel loro pezzo): vanno nella sua etichetta. */
    const attaccati: [Voce, string][] = []
    for (const v of m.etichette()) {
      if (m.parts.get(v.part)?.hidden) continue
      if (v.part === m.selected) { voci.push(v); continue }
      if (!m.keepsAnchor(v.part, v.at)) continue
      const r = this.libera(m, v, cam)
      if (r === true) voci.push(v)
      else if (r) attaccati.push([v, r])
    }
    // il pezzo scelto per primo, poi i più grandi: sono loro a dare il nome al gruppo
    voci.sort((a, b) => Number(b.part === m.selected) - Number(a.part === m.selected) || b.size - a.size)
    const gruppi: Voce[][] = []
    for (const v of voci) {
      const g = gruppi.find((x) => x[0].at.distanceTo(v.at) < UNISCI)
      if (g) g.push(v)
      else gruppi.push([v])
    }
    for (const [v, davanti] of attaccati) gruppi.find((x) => x.some((y) => y.part === davanti))?.push(v)
    const keep = new Set<string>()
    this.visibili = gruppi.map((vs) => {
      vs.sort((a, b) => ordine(a.tag) - ordine(b.tag))
      const key = vs.map((v) => v.part).join('|')
      keep.add(key)
      let g = this.gruppi.get(key)
      if (!g) {
        g = { key, voci: vs, el: this.crea(vs), w: 0, h: 0 }
        this.gruppi.set(key, g)
      }
      g.voci = vs
      return g
    })
    for (const [k, g] of this.gruppi) if (!keep.has(k)) { g.el.remove(); this.gruppi.delete(k) }
  }

  /**
   * Il pezzo si vede dalla camera? Il primo pezzo lungo il raggio verso la sua etichetta deve essere lui.
   * Se lo copre un pezzo attaccato (a meno di 3 cm) restituisce quel pezzo, altrimenti false.
   */
  private libera(m: PrivateModel, v: Voce, cam: THREE.Vector3): boolean | string {
    const d = v.at.distanceTo(cam)
    this.ray.set(cam, v.at.clone().sub(cam).normalize())
    this.ray.camera = this.camera
    this.ray.far = d + 0.01
    for (const h of this.ray.intersectObject(m.root, true)) {
      if (h.object.userData.noPick || !visibile(h.object)) continue
      const mat = (h.object as THREE.Mesh).material as THREE.Material | THREE.Material[]
      const plane = (Array.isArray(mat) ? mat[0] : mat)?.clippingPlanes?.[0]
      if (plane && plane.distanceToPoint(h.point) < -1e-4) continue
      let o: THREE.Object3D | null = h.object
      while (o && !o.userData.part) o = o.parent
      if (o?.userData.part === v.part) return true
      // davanti c'è un altro pezzo (le parti scelte rendono gli altri trasparenti: contano lo stesso)
      if (h.distance >= d - 0.004) return true
      return d - h.distance < 0.03 && o ? o.userData.part : false
    }
    return true
  }

  private crea(vs: Voce[]) {
    const el = document.createElement('div')
    el.className = 'etq'
    let tav = ''
    vs.forEach((v, i) => {
      const [t, p] = v.tag.split('·')
      if (i) el.append(t === tav ? ', ' : ' · ')
      const b = document.createElement('button')
      b.type = 'button'
      b.dataset.part = v.part
      b.textContent = t === tav ? p : v.tag
      b.setAttribute('aria-label', `Pezzo ${v.tag}`)
      el.append(b)
      tav = t
    })
    this.box.append(el)
    return el
  }

  // ---------- impaginazione ----------

  private impagina(m: PrivateModel) {
    const W = this.box.clientWidth, H = this.box.clientHeight
    const scr = (p: THREE.Vector3) => {
      const q = p.clone().project(this.camera)
      return { x: ((q.x + 1) / 2) * W, y: ((1 - q.y) / 2) * H, front: q.z < 1 }
    }
    const c = scr(m.bounds.getCenter(new THREE.Vector3()))
    const occupate = this.avoid().map((r) => ({ l: r.left - 4, t: r.top - 4, r: r.right + 4, b: r.bottom + 4 }))
    const sel = m.selected, prev = m.previewed
    const cam = this.camera.position

    // dal più importante: scelto, in anteprima, poi i pezzi più grandi sullo schermo
    const peso = (g: Gruppo) => {
      if (sel && g.voci.some((v) => v.part === sel)) return 1e9
      if (prev && g.voci.some((v) => v.part === prev)) return 1e8
      return Math.max(...g.voci.map((v) => v.size / Math.max(v.at.distanceTo(cam), 0.1)))
    }
    const lista = this.visibili.map((g) => {
      // il punto del pezzo scelto (o in anteprima) è quello a cui arriva la linea
      const v = g.voci.find((x) => x.part === sel) ?? g.voci.find((x) => x.part === prev) ?? g.voci[0]
      return { g, a: scr(v.at), peso: peso(g) }
    }).sort((x, y) => y.peso - x.peso)

    let linee = ''
    for (const g of this.gruppi.values()) g.el.style.visibility = 'hidden'
    for (const { g, a, peso: w } of lista) {
      const scelta = w >= 1e9, vista = w >= 1e8
      g.el.classList.toggle('sel', scelta)
      g.el.classList.toggle('prev', vista && !scelta)
      g.el.classList.toggle('dim', !!sel && !scelta)
      for (const b of g.el.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('attivo', b.dataset.part === sel || b.dataset.part === prev)
      if (!a.front || a.x < 0 || a.y < 0 || a.x > W || a.y > H) continue
      if (!g.w) { g.w = g.el.offsetWidth; g.h = g.el.offsetHeight }
      const k = scelta ? 1.25 : 1
      const bw = g.w * k, bh = g.h * k
      let dx = a.x - c.x, dy = a.y - c.y
      const n = Math.hypot(dx, dy)
      if (n < 1) { dx = -0.7; dy = -0.7 } else { dx /= n; dy /= n }
      let pos: { x: number; y: number } | null = null
      cerca: for (const d of DIST)
        for (const t of ANG) {
          const ux = dx * Math.cos(t) - dy * Math.sin(t), uy = dx * Math.sin(t) + dy * Math.cos(t)
          const x = a.x + ux * (d + bw / 2), y = a.y + uy * (d + bh / 2)
          const r = { l: x - bw / 2 - 3, t: y - bh / 2 - 3, r: x + bw / 2 + 3, b: y + bh / 2 + 3 }
          if (r.l < 4 || r.t < 4 || r.r > W - 4 || r.b > H - 4) continue
          if (occupate.some((o) => o.l < r.r && o.r > r.l && o.t < r.b && o.b > r.t)) continue
          pos = { x, y }
          occupate.push(r)
          break cerca
        }
      if (!pos) continue
      g.el.style.visibility = ''
      g.el.style.transform = `translate(${(pos.x - g.w / 2).toFixed(1)}px, ${(pos.y - g.h / 2).toFixed(1)}px) scale(${k})`
      // la linea arriva al bordo dell'etichetta
      const ex = pos.x - a.x, ey = pos.y - a.y
      const s = Math.min(Math.abs(ex) > 1e-3 ? bw / 2 / Math.abs(ex) : 1e9, Math.abs(ey) > 1e-3 ? bh / 2 / Math.abs(ey) : 1e9, 1)
      const bx = pos.x - ex * s, by = pos.y - ey * s
      const cls = scelta ? 'sel' : vista ? 'prev' : sel ? 'dim' : ''
      linee += `<line class="${cls}" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}"/>`
      linee += `<circle class="${cls}" cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="${scelta ? 5 : vista ? 4 : 2}"/>`
    }
    this.svg.innerHTML = linee
  }
}

/** Ordine delle etichette dentro un gruppo: per tavola, poi per posizione. */
function ordine(tag: string) {
  const [t, p] = tag.slice(1).split('·').map(Number)
  return t * 1e5 + p
}

function visibile(o: THREE.Object3D | null): boolean {
  for (; o; o = o.parent) if (!o.visible) return false
  return true
}
