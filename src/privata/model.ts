import * as THREE from 'three'
import { Section } from '../core/section'
import { MachineModel, LOOK, Look } from '../core/model'
import { wheelMeshes, rimSection, tireShell } from '../core/wheel'
import { MarkSet, MarkState } from '../core/marks'
import type { Solid } from '../core/interference'
import type { View } from '../core/machine'
import { revolveX, RX } from '../core/geo'
import type { BalancerLike, Cable } from '../eqmatch/model'
import { WheelSpec, wheelGeometry, Weight } from '../eqmatch/physics'
import type { MacchinaFile, Pezzo, Forma } from './format'

/** Materiali del formato → aspetto; "schermo" mostra il display della console. */
const BASE: Record<string, Look> = {
  vernice: LOOK.paint, accento: LOOK.accent, acciaio: LOOK.steel, scuro: LOOK.dark, alluminio: LOOK.alu,
  gomma: LOOK.rubber, plastica: LOOK.plastic, grigio: LOOK.grey, scheda: LOOK.board, ottone: LOOK.brass,
  rame: LOOK.copper, ceramica: LOOK.ceramic, giallo: LOOK.yellow, schermo: LOOK.chip,
}

/** Parte (voce di tavola) a cui appartiene un pezzo: i pezzi con la stessa tavola e posizione si scelgono insieme. */
export const partOf = (p: Pezzo) => (p.tavola !== undefined ? `t${p.tavola}p${p.posizione_tavola}` : `pezzo-${p.id}`)
export const tagOf = (p: Pezzo) => (p.tavola !== undefined ? `T${p.tavola}·${p.posizione_tavola}` : '')

/**
 * Modello di un'equilibratrice caricata da file: i pezzi del file più la ruota della
 * simulazione. I gruppi "albero", "carter", "calibro" e "sensori" sono collegati alla
 * misura come nell'equilibratrice pubblica; gli altri pezzi restano fermi.
 */
export class PrivateModel extends MachineModel implements BalancerLike {
  readonly axis = new THREE.Group()
  readonly rotor = new THREE.Group()
  readonly wheel = new THREE.Group()
  readonly guard = new THREE.Group()
  readonly calSlide = new THREE.Group()
  readonly piezo: THREE.MeshStandardMaterial[] = []
  readonly beltMap = new THREE.Texture()
  readonly cables: Cable[] = []
  readonly arrows: THREE.ArrowHelper[] = []
  /** Tavola di ogni parte (undefined per la ruota e i pezzi senza tavola). */
  readonly tavolaOf = new Map<string, number | undefined>()
  /** Ordine di smontaggio di ogni gruppo che si sposta nell'esploso. */
  private readonly orderOf = new Map<THREE.Object3D, number>()
  private levels: number[] = []
  private readonly labels: THREE.Object3D[] = []
  private labelsOn = true
  private tavola: number | null = null
  private tireG!: THREE.Group
  private rimG!: THREE.Group
  private weightG!: THREE.Group
  private marks!: MarkSet
  private spec!: WheelSpec
  private screenMat: THREE.MeshStandardMaterial
  /** Ingombro della macchina, per la vista iniziale e la sezione. */
  readonly bounds = new THREE.Box3()

  constructor(section: Section, screenTex: THREE.Texture, private file: MacchinaFile) {
    super(section)
    const sim = file.simulazione
    this.axis.position.y = sim.albero.altezza_asse
    this.root.add(this.axis, this.calSlide)
    this.axis.add(this.rotor, this.guard)
    this.rotor.add(this.wheel)
    this.guard.position.set(0, sim.carter.cerniera[0], sim.carter.cerniera[1])
    this.screenMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: screenTex, roughness: 0.4 })

    // sensori: due cristalli che si illuminano con la forza letta, A e B
    for (let i = 0; i < 2; i++) this.piezo.push(new THREE.MeshStandardMaterial({ color: LOOK.ceramic.c, roughness: 0.4, emissive: 0x29d3ff, emissiveIntensity: 0 }))

    for (const p of file.pezzi) this.addPiece(p)
    this.wheelParts()
    this.levels = [...new Set(this.orderOf.values())].sort((a, b) => a - b)
    this.root.updateMatrixWorld(true)
    this.bounds.setFromObject(this.root)
    for (const h of this.labels) {
      const box = new THREE.Box3()
      for (const pc of this.parts.get(h.userData.part)!.pieces) pc.obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) box.expandByObject(o) })
      h.userData.size = box.isEmpty() ? 0 : box.getSize(new THREE.Vector3()).length()
    }
  }

  // ---------- pezzi del file ----------

  /** Dove va appeso un pezzo e di quanto spostarlo per riportarlo nel sistema della macchina. */
  private parentOf(p: Pezzo): [THREE.Object3D, THREE.Vector3] {
    const s = this.file.simulazione
    const ay = s.albero.altezza_asse
    switch (p.gruppo) {
      case 'albero': return [this.rotor, new THREE.Vector3(0, ay, 0)]
      case 'carter': return [this.guard, new THREE.Vector3(0, ay + s.carter.cerniera[0], s.carter.cerniera[1])]
      case 'calibro': return [this.calSlide, new THREE.Vector3()]
      default: return [this.root, new THREE.Vector3()]
    }
  }

  private addPiece(p: Pezzo) {
    const id = partOf(p)
    this.tavolaOf.set(id, p.tavola)
    const [parent, origin] = this.parentOf(p)
    const e = p.esploso
    const dir = new THREE.Vector3(...e.direzione)
    if (dir.lengthSq() > 0) dir.normalize()
    const g = this.piece(id, dir.multiplyScalar(e.distanza).toArray() as [number, number, number], parent)
    this.orderOf.set(g, e.ordine)
    const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>(shape(p.forma), this.material(id, p, g.userData.front))
    if (p.materiale === 'schermo' && p.forma.tipo === 'scatola') {
      // scatola con il display sulla faccia verso l'operatore (+z), il resto scuro
      const dark = mesh.material as THREE.Material
      mesh.material = [dark, dark, dark, dark, this.screen(id), dark]
    }
    mesh.position.set(...p.posizione).sub(origin)
    mesh.rotation.set(...(p.rotazione.map((d) => THREE.MathUtils.degToRad(d)) as [number, number, number]))
    g.add(mesh)

    const tag = tagOf(p)
    if (tag && !this.labels.some((l) => l.userData.part === id)) this.label(g, mesh, tag, id)
  }

  private material(id: string, p: Pezzo, front: boolean) {
    if (p.gruppo === 'sensori') {
      const s = this.file.simulazione.sensori
      const m = this.piezo[Math.abs(p.posizione[0] - s.a) <= Math.abs(p.posizione[0] - s.b) ? 0 : 1]
      if (!this.parts.get(id)!.mats.includes(m)) this.custom(id, m, LOOK.ceramic.h, true)
      return m
    }
    if (p.materiale === 'schermo' && p.forma.tipo !== 'scatola') return this.screen(id)
    const own = this.file.materiali[p.materiale]
    const look: Look = own ? { c: parseInt(own.colore.slice(1), 16), m: own.metallo, r: own.ruvidita, h: 0x8a93a0 } : BASE[p.materiale] ?? LOOK.grey
    return this.mat(id, look, front)
  }

  private screen(id: string) {
    if (!this.parts.get(id)!.mats.includes(this.screenMat)) this.custom(id, this.screenMat, 0x3a7bd5, true)
    return this.screenMat
  }

  /**
   * Ancora dell'etichetta "T5·12": centro del pezzo, si sposta con il pezzo nell'esploso.
   * Le etichette vere sono pulsanti sopra la scena (etichette.ts), impaginati sullo schermo.
   */
  private label(g: THREE.Group, mesh: THREE.Mesh, tag: string, id: string) {
    mesh.geometry.computeBoundingBox()
    const c = mesh.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyEuler(mesh.rotation).add(mesh.position)
    const holder = new THREE.Group()
    holder.userData = { noPick: true, part: id, anchor: c, tag }
    g.add(holder)
    this.labels.push(holder)
  }

  // ---------- tavole ed etichette ----------

  get tavolaShown() { return this.tavola }

  /** Mostra una tavola sola (null = tutte): gli altri pezzi e la ruota si nascondono. */
  showTavola(n: number | null) {
    this.tavola = n
    for (const id of this.parts.keys()) this.setHidden(id, n !== null && this.tavolaOf.get(id) !== n)
  }

  setLabels(on: boolean) {
    this.labelsOn = on
  }
  get labelsShown() { return this.labelsOn }

  /** Etichette T·pos: parte, testo, punto del pezzo (mondo) e grandezza della parte (m, per scegliere le più importanti). */
  etichette(): { part: string; tag: string; at: THREE.Vector3; size: number }[] {
    return this.labels.map((h) => ({ part: h.userData.part, tag: h.userData.tag, at: h.localToWorld((h.userData.anchor as THREE.Vector3).clone()), size: h.userData.size ?? 0 }))
  }

  /** Il punto (mondo) dell'etichetta di una parte resta dopo il piano di sezione? */
  keepsAnchor(id: string, at: THREE.Vector3) {
    let plane: THREE.Plane | undefined
    this.parts.get(id)?.pieces[0]?.obj.traverse((o) => {
      const m = (o as THREE.Mesh).material
      plane ??= (Array.isArray(m) ? m[0] : m)?.clippingPlanes?.[0]
    })
    return this.section.keeps(at, plane)
  }

  // ---------- evidenziazione ----------

  /** Parte scelta: tutte le altre diventano grigie e semitrasparenti. */
  private sel: string | null = null
  /** Parte in anteprima (passaggio sull'etichetta): si illumina e basta. */
  private prev: string | null = null
  get selected() { return this.sel }
  get previewed() { return this.prev }

  override highlight(id: string | null) {
    this.sel = id
    this.look()
  }

  preview(id: string | null) {
    if (id === this.prev) return
    this.prev = id
    this.look()
  }

  private look() {
    const grey = new THREE.Color(0x8a9099)
    const keep = new Set<THREE.Material>(this.sel ? this.parts.get(this.sel)?.mats : [])
    for (const p of this.parts.values())
      for (const m of p.mats) {
        const o = (m.userData.orig ??= { color: m.color.clone(), opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite })
        const ghost = !!this.sel && !keep.has(m)
        if (m.transparent !== (ghost || o.transparent)) m.needsUpdate = true
        m.transparent = ghost || o.transparent
        m.opacity = ghost ? 0.14 : o.opacity
        m.depthWrite = ghost ? false : o.depthWrite
        if (this.glowing.has(m)) continue
        m.color.copy(ghost ? grey : o.color)
        const on = p.id === this.sel ? 0xff8a1e : p.id === this.prev ? 0xffd21e : 0
        m.emissive.setHex(on)
        m.emissiveIntensity = on ? 0.55 : 0
      }
  }

  /** Inquadratura di una parte: il suo ingombro, com'è adesso. */
  viewOf(id: string): View | null {
    const p = this.parts.get(id)
    if (!p) return null
    const box = new THREE.Box3()
    this.root.updateMatrixWorld(true)
    for (const pc of p.pieces) pc.obj.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.noPick) box.expandByObject(o) })
    if (box.isEmpty()) return null
    const size = box.getSize(new THREE.Vector3())
    // abbastanza lontano da vedere anche cosa c'è attorno al pezzo
    return { target: box.getCenter(new THREE.Vector3()).toArray() as [number, number, number], halfWidth: Math.max(Math.max(size.x, size.y, size.z) * 0.8 + 0.12, 0.32) }
  }

  /** Inquadratura dei pezzi visibili (per esempio di una tavola sola). */
  viewVisible(): View | null {
    const box = new THREE.Box3()
    this.root.updateMatrixWorld(true)
    for (const p of this.parts.values()) if (!p.hidden) for (const pc of p.pieces) pc.obj.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.userData.noPick) box.expandByObject(o) })
    if (box.isEmpty()) return null
    const size = box.getSize(new THREE.Vector3())
    return { target: box.getCenter(new THREE.Vector3()).toArray() as [number, number, number], halfWidth: Math.max(size.x, size.y) * 0.6 + 0.1 }
  }

  /**
   * Smontaggio in sequenza: il cursore attraversa gli ordini del file uno dopo l'altro;
   * ogni gruppo di pezzi con lo stesso ordine parte quando il precedente è arrivato.
   */
  explode(t: number) {
    this.explodeT = t
    const n = this.levels.length
    for (const p of this.parts.values())
      for (const pc of p.pieces) {
        const k = this.levels.indexOf(this.orderOf.get(pc.obj) ?? 0)
        const u = THREE.MathUtils.clamp(t * n - k, 0, 1)
        pc.obj.position.copy(pc.off).multiplyScalar(u * u * (3 - 2 * u))
      }
  }

  // ---------- ruota (come in EqMatch) ----------

  private wheelParts() {
    this.rimG = this.piece('cerchio', [0.4, 0, 0], this.wheel)
    this.tireG = this.piece('pneumatico', [0.6, 0, 0], this.wheel)
    this.weightG = this.piece('pesi', [0.4, 0, 0], this.wheel)
    // la ruota si toglie per prima, prima di qualsiasi pezzo del file
    const first = Math.min(0, ...this.orderOf.values()) - 1
    for (const g of [this.rimG, this.tireG, this.weightG]) this.orderOf.set(g, first)
    for (let i = 0; i < 2; i++) {
      const a = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.2, 0xffb21e, 0.05, 0.03)
      a.traverse((o) => (o.userData.noPick = true))
      ;(a.line.material as THREE.LineBasicMaterial).toneMapped = false
      ;(a.cone.material as THREE.MeshBasicMaterial).toneMapped = false
      a.visible = false
      this.wheel.add(a)
      this.arrows.push(a)
    }
    const glow = (id: string, c: number) => this.custom(id, new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.6, side: THREE.DoubleSide }), 0x8a93a0, true)
    this.marks = new MarkSet({ rim: glow('cerchio', 0xffd21e), ref: glow('pneumatico', 0xf2f2f2), target: glow('pneumatico', 0xffd21e), arc: glow('cerchio', 0xffb21e) })
  }

  setMarks(s: MarkState, text?: string) {
    this.tireG.rotation.x = s.theta
    this.marks.set(this.spec, s, text)
  }

  wheelSolids(): Solid[] {
    const e = this.spec.et, R = wheelGeometry(this.spec).rimR
    const disc: RX[] = [[0.0285, e], [R - 0.0055, e], [R - 0.0055, e + 0.016], [0.0285, e + 0.016]]
    return [
      { name: 'cerchio', frame: this.rimG, sections: this.sections(() => [rimSection(this.spec), disc]) },
      { name: 'pneumatico', frame: this.tireG, sections: this.sections(() => [tireShell(this.spec)], 1) },
    ]
  }
  private secs: { spec: WheelSpec; s: RX[][] }[] = []
  private sections(make: () => RX[][], i = 0) {
    const c = this.secs[i]
    if (c?.spec === this.spec) return c.s
    this.secs[i] = { spec: this.spec, s: make() }
    return this.secs[i].s
  }

  isWheelOrMarker(o: THREE.Object3D) {
    return o === this.rimG || o === this.tireG || o === this.weightG || !!o.userData.noPick || o.type === 'ArrowHelper'
  }

  buildWheel(spec: WheelSpec) {
    this.spec = spec
    this.wheel.position.x = this.file.simulazione.albero.faccia_flangia - spec.et
    this.clear(this.rimG)
    this.clear(this.tireG)
    this.marks.attach(this.rimG, this.tireG)
    const geo = wheelMeshes(spec)
    for (const r of geo.rim) this.mesh(this.rimG, r.geo, LOOK[r.look])
    this.mesh(this.tireG, geo.tire, LOOK.rubber)
    this.setWeights([], spec)
    this.root.updateMatrixWorld(true)
    this.bounds.setFromObject(this.root)
  }

  setWeights(list: Weight[], spec: WheelSpec) {
    this.clear(this.weightG)
    const { rimR: R, width: w } = wheelGeometry(spec)
    const h = w / 2
    for (const wt of list) {
      const arc = (wt.grams / 6.8 / 100) / (R + 0.01)
      const x0 = wt.plane === 'int' ? -h - 0.017 : h + 0.009
      const g = revolveX([[R + 0.006, x0], [R + 0.014, x0], [R + 0.014, x0 + 0.008], [R + 0.006, x0 + 0.008]], 24, wt.angle - Math.PI / 2 - arc / 2, arc)
      this.mesh(this.weightG, g, LOOK.lead)
    }
  }

  setArrows(on: boolean, list: { x: number; angle: number; force: number }[]) {
    this.arrows.forEach((a, i) => {
      const d = list[i]
      a.visible = on && !!d && d.force > 0.05
      if (!a.visible) return
      a.position.set(d.x - this.wheel.position.x, 0, 0)
      a.setDirection(new THREE.Vector3(0, Math.cos(d.angle), Math.sin(d.angle)))
      a.setLength(Math.min(0.08 + d.force * 0.045, 0.5), 0.05, 0.03)
    })
  }
}

/** Geometria di una forma del formato. */
export function shape(f: Forma): THREE.BufferGeometry {
  switch (f.tipo) {
    case 'cilindro':
      return new THREE.CylinderGeometry(f.raggio_sopra ?? f.raggio, f.raggio, f.altezza, f.segmenti ?? 32)
    case 'scatola':
      return new THREE.BoxGeometry(...f.dimensioni)
    case 'rivoluzione':
      // settore: 0° verso l'operatore (+z), 90° verso il basso, -90° verso l'alto
      return revolveX(f.profilo.map(([r, x]) => [r, x] as RX), f.segmenti ?? 48, THREE.MathUtils.degToRad(f.angolo_inizio ?? 0), THREE.MathUtils.degToRad(f.angolo_ampiezza ?? 360))
    case 'tubo': {
      const pts = f.percorso.map((p) => new THREE.Vector3(...p))
      const curve = new THREE.CatmullRomCurve3(pts, !!f.chiuso, 'centripetal')
      return new THREE.TubeGeometry(curve, Math.min(pts.length * 12, 600), f.raggio, 12, !!f.chiuso)
    }
    case 'estrusione': {
      const s = new THREE.Shape(f.contorno.map(([u, v]) => new THREE.Vector2(u, v)))
      for (const h of f.fori ?? []) s.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, v))))
      return new THREE.ExtrudeGeometry(s, { depth: f.spessore, bevelEnabled: false, curveSegments: 16 })
    }
  }
}
