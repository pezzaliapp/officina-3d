import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { Section } from '../core/section'
import { MachineModel, LOOK } from '../core/model'
import { wheelMeshes, rimSection, tireShell } from '../core/wheel'
import { MarkSet, MarkState } from '../core/marks'
import type { Solid } from '../core/interference'
import { revolveX, cylX, tubeX, box, beltPath, RX } from '../core/geo'
import { LAYOUT, WheelSpec, wheelGeometry, Weight } from './physics'

/** Altezza dell'asse dell'albero da terra, m. */
export const AXIS_Y = 0.78
/** Cerniera del carter rispetto all'asse dell'albero (y, z). */
const GUARD_PIVOT = [-0.03, -0.43] as const

interface Cable { curve: THREE.CatmullRomCurve3; dots: THREE.Mesh[]; kind: 'sensore' | 'encoder' | 'display' }

export class BalancerModel extends MachineModel {
  /** Gruppo fisso centrato sull'asse dell'albero. */
  readonly axis = new THREE.Group()
  /** Tutto ciò che gira con la ruota (rotazione attorno a X). */
  readonly rotor = new THREE.Group()
  readonly wheel = new THREE.Group()
  readonly guard = new THREE.Group()
  readonly calSlide = new THREE.Group()
  readonly screen: THREE.Mesh
  readonly piezo: THREE.MeshStandardMaterial[] = []
  readonly beltMap: THREE.CanvasTexture
  readonly cables: Cable[] = []
  readonly arrows: THREE.ArrowHelper[] = []
  private tireG!: THREE.Group
  private rimG!: THREE.Group
  private weightG!: THREE.Group
  private cablesG = new THREE.Group()
  private marks!: MarkSet
  private calStem!: THREE.Mesh
  private calTip!: THREE.Mesh
  private spec!: WheelSpec

  constructor(section: Section, screenTex: THREE.Texture) {
    super(section)
    this.axis.position.y = AXIS_Y
    this.root.add(this.axis)
    this.axis.add(this.rotor, this.guard)
    this.rotor.add(this.wheel)

    this.cabinet()
    this.frame()
    this.screen = this.console(screenTex)
    this.tray()
    this.shaftGroup()
    this.beltMap = this.drive()
    this.electronics()
    this.gauge()
    this.cover()
    this.wheelParts()
  }

  // ---------- mobile ----------

  private cabinet() {
    const t = 0.012, y0 = 0.11, y1 = 0.97, yc = (y0 + y1) / 2, H = y1 - y0
    const base = this.piece('mobile', [0, 0, 0])
    this.mesh(base, new RoundedBoxGeometry(0.64, 0.03, 0.62, 2, 0.008).translate(-0.31, 0.095, 0), LOOK.paint)
    for (const [x, z] of [[-0.58, 0.27], [-0.04, 0.27], [-0.58, -0.27], [-0.04, -0.27]])
      this.mesh(base, new THREE.CylinderGeometry(0.026, 0.03, 0.08, 20).translate(x, 0.04, z), LOOK.dark)
    // perni portaconi sul fianco sinistro
    for (const z of [-0.12, 0.12]) {
      this.mesh(base, cylX(0.012, -0.72, -0.62).translate(0, 0.62, z), LOOK.steel)
      this.mesh(base, revolveX([[0.012, -0.71], [0.022, -0.71], [0.042, -0.665], [0.013, -0.665]]).translate(0, 0.62, z), LOOK.dark)
    }

    const left = this.piece('mobile', [-0.45, 0, 0])
    this.mesh(left, box(t, H, 0.6, -0.62 + t / 2, yc, 0), LOOK.paint)

    // Fianco destro con i fori per l'albero e per l'asta del calibro.
    const right = this.piece('mobile', [0.16, 0, 0])
    const s = new THREE.Shape()
    s.moveTo(-0.3, y0); s.lineTo(0.3, y0); s.lineTo(0.3, y1); s.lineTo(-0.3, y1); s.closePath()
    const hole = (u: number, v: number, r: number) => { const p = new THREE.Path(); p.absarc(u, v, r, 0, Math.PI * 2, true); s.holes.push(p) }
    hole(0, AXIS_Y, 0.058)
    hole(0, 0.62, 0.014)
    const rg = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 32 })
    rg.rotateY(Math.PI / 2).translate(-t, 0, 0)
    this.mesh(right, rg, LOOK.paint)

    const front = this.piece('mobile', [0, 0, 0.45])
    this.mesh(front, box(0.62 - 2 * t, H, t, -0.31, yc, 0.3 - t / 2), LOOK.paint)
    this.mesh(front, box(0.5, 0.035, 0.006, -0.31, 0.86, 0.302), LOOK.accent)
    this.mesh(front, box(0.5, 0.008, 0.006, -0.31, 0.83, 0.302), LOOK.accent)

    const back = this.piece('mobile', [0, 0, -0.45])
    this.mesh(back, box(0.62 - 2 * t, H, t, -0.31, yc, -0.3 + t / 2), LOOK.paint)

    const top = this.piece('mobile', [0, 0.42, 0])
    this.mesh(top, new RoundedBoxGeometry(0.64, 0.024, 0.62, 2, 0.008).translate(-0.31, y1 + 0.012, 0), LOOK.paint)

    const pedal = this.piece('pedale', [0, 0, 0.25])
    this.mesh(pedal, new RoundedBoxGeometry(0.13, 0.022, 0.09, 2, 0.006).translate(-0.18, 0.07, 0.37), LOOK.dark)
    this.mesh(pedal, box(0.03, 0.02, 0.1, -0.18, 0.07, 0.29), LOOK.dark)
  }

  private frame() {
    const g = this.piece('telaio', [0, 0, 0])
    this.mesh(g, box(0.36, 0.03, 0.22, -0.2, 0.125, 0), LOOK.dark)
    for (const x of [LAYOUT.sensorA, LAYOUT.sensorB]) {
      this.mesh(g, box(0.014, 0.6, 0.22, x, 0.44, 0), LOOK.dark)
      this.mesh(g, box(0.03, 0.2, 0.03, x, AXIS_Y - 0.01, -0.125), LOOK.dark)
    }
    // Sensori: due dischi di ottone con il cristallo in mezzo, tra montante e cannotto.
    const sg = this.piece('sensori', [0, 0.1, -0.14], this.axis)
    for (const x of [LAYOUT.sensorA, LAYOUT.sensorB]) {
      const disc = (z0: number, z1: number, r: number) => new THREE.CylinderGeometry(r, r, z1 - z0, 28).rotateX(Math.PI / 2).translate(x, 0, (z0 + z1) / 2)
      this.mesh(sg, disc(-0.11, -0.092, 0.017), LOOK.brass)
      this.mesh(sg, disc(-0.068, -0.05, 0.017), LOOK.brass)
      const cer = new THREE.Mesh(disc(-0.092, -0.068, 0.014), this.custom('sensori',
        new THREE.MeshStandardMaterial({ color: LOOK.ceramic.c, roughness: 0.4, emissive: 0x29d3ff, emissiveIntensity: 0 }), LOOK.ceramic.h, true))
      this.piezo.push(cer.material as THREE.MeshStandardMaterial)
      sg.add(cer)
    }
  }

  private console(tex: THREE.Texture) {
    const g = this.piece('console', [0, 0.72, -0.05])
    this.mesh(g, box(0.08, 0.1, 0.06, -0.31, 1.03, -0.24), LOOK.paint)
    const head = new THREE.Group()
    head.position.set(-0.31, 1.2, -0.22)
    head.rotation.x = -0.38
    g.add(head)
    head.userData.part = 'console'
    this.mesh(head, new RoundedBoxGeometry(0.54, 0.34, 0.07, 3, 0.02), LOOK.paint)
    this.mesh(head, box(0.47, 0.255, 0.004, 0, 0.025, 0.036), LOOK.chip)
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.2414), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }))
    scr.position.set(0, 0.025, 0.0385)
    scr.userData.part = 'console'
    head.add(scr)
    for (let i = 0; i < 5; i++) {
      const b = this.mesh(head, new THREE.CylinderGeometry(0.012, 0.012, 0.008, 20).rotateX(Math.PI / 2), i === 2 ? LOOK.accent : LOOK.grey)
      b.position.set(-0.16 + i * 0.08, -0.135, 0.037)
    }
    return scr
  }

  private tray() {
    const g = this.piece('vaschetta', [0, 0.56, 0.18])
    const y = 0.985, x0 = -0.6, x1 = -0.02, z0 = 0.02, z1 = 0.28
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0
    this.mesh(g, box(w, 0.006, d, cx, y + 0.003, cz), LOOK.grey)
    this.mesh(g, box(w, 0.035, 0.006, cx, y + 0.0175, z0), LOOK.grey)
    this.mesh(g, box(w, 0.035, 0.006, cx, y + 0.0175, z1), LOOK.grey)
    this.mesh(g, box(0.006, 0.035, d, x0, y + 0.0175, cz), LOOK.grey)
    this.mesh(g, box(0.006, 0.035, d, x1, y + 0.0175, cz), LOOK.grey)
    const n = 6
    for (let i = 1; i < n; i++) this.mesh(g, box(0.004, 0.03, d * 0.55, x0 + (w * i) / n, y + 0.015, z0 + d * 0.275), LOOK.grey)
    this.mesh(g, box(w, 0.03, 0.004, cx, y + 0.015, z0 + d * 0.55), LOOK.grey)
    for (let i = 0; i < n; i++) {
      const len = 0.016 + i * 0.008
      for (let k = 0; k < 3; k++) this.mesh(g, box(len, 0.008, 0.012, x0 + (w * (i + 0.5)) / n, y + 0.01 + k * 0.009, z0 + 0.04 + k * 0.025), LOOK.lead)
    }
    // pinza-martello
    this.mesh(g, box(0.16, 0.012, 0.02, cx - 0.05, y + 0.012, z0 + d * 0.78), LOOK.accent)
    this.mesh(g, box(0.02, 0.03, 0.05, cx + 0.04, y + 0.016, z0 + d * 0.78), LOOK.dark)
  }

  // ---------- gruppo albero ----------

  private shaftGroup() {
    const sh = this.piece('albero', [0.22, 0, 0], this.rotor)
    const p: RX[] = [[0, -0.52], [0.018, -0.52], [0.02, -0.517], [0.02, 0.222], [0.018, 0.224]]
    let up = false
    for (let x = 0.228; x < 0.495; x += 0.0025) { p.push([up ? 0.018 : 0.0155, x]); up = !up }
    p.push([0.015, 0.5], [0, 0.5])
    this.mesh(sh, revolveX(p, 40), LOOK.steel)

    const fl = this.piece('flangia', [0.08, 0, 0], this.rotor)
    this.mesh(fl, revolveX([[0.0201, 0.13], [0.05, 0.13], [0.05, 0.188], [0.094, 0.19], [0.096, 0.2], [0.096, 0.212], [0.062, 0.214], [0.06, 0.22], [0.0201, 0.22]], 64), LOOK.steel)
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2
      this.mesh(fl, cylX(0.006, 0.212, 0.218, 6).translate(0, Math.cos(a) * 0.08, Math.sin(a) * 0.08), LOOK.dark)
    }

    const cn = this.piece('cono', [0.75, 0, 0], this.rotor)
    this.mesh(cn, revolveX([[0.0185, 0.222], [0.024, 0.222], [0.04, 0.25], [0.04, 0.266], [0.0185, 0.266]], 48), LOOK.steel)

    const nt = this.piece('ghiera', [0.88, 0, 0], this.rotor)
    this.mesh(nt, revolveX([[0.0185, 0.266], [0.05, 0.266], [0.053, 0.272], [0.053, 0.29], [0.046, 0.295], [0.046, 0.31], [0.0185, 0.31]], 48), LOOK.dark)
    for (const s of [1, -1]) this.mesh(nt, new THREE.CylinderGeometry(0.011, 0.013, 0.1, 16).translate(0, s * 0.095, 0).translate(0.285, 0, 0), LOOK.accent)

    const hs = this.piece('cannotto', [0, 0.26, 0], this.axis)
    this.mesh(hs, tubeX(0.035, 0.05, -0.34, 0.12), LOOK.dark)
    for (const x of [LAYOUT.sensorA, LAYOUT.sensorB]) this.mesh(hs, tubeX(0.05, 0.058, x - 0.016, x + 0.016), LOOK.dark)
    // cuscinetti alle estremità, visibili in sezione
    for (const [a, b] of [[-0.34, -0.312], [0.092, 0.12]]) {
      this.mesh(hs, tubeX(0.0202, 0.025, a, b), LOOK.steel)
      this.mesh(hs, tubeX(0.031, 0.0349, a, b), LOOK.steel)
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2
        this.mesh(hs, new THREE.SphereGeometry(0.0034, 10, 8).translate((a + b) / 2, Math.cos(ang) * 0.028, Math.sin(ang) * 0.028), LOOK.steel)
      }
    }

    const enc = this.piece('encoder', [-0.1, 0.12, 0], this.rotor)
    const es = new THREE.Shape()
    es.absarc(0, 0, 0.056, 0, Math.PI * 2, false)
    const hub = new THREE.Path(); hub.absarc(0, 0, 0.0201, 0, Math.PI * 2, true); es.holes.push(hub)
    for (let i = 0; i < 48; i++) {
      const a0 = (i / 48) * Math.PI * 2, a1 = a0 + Math.PI / 48
      const h = new THREE.Path()
      h.moveTo(Math.cos(a0) * 0.044, Math.sin(a0) * 0.044)
      h.lineTo(Math.cos(a0) * 0.052, Math.sin(a0) * 0.052)
      h.lineTo(Math.cos(a1) * 0.052, Math.sin(a1) * 0.052)
      h.lineTo(Math.cos(a1) * 0.044, Math.sin(a1) * 0.044)
      h.closePath()
      es.holes.push(h)
    }
    const eg = new THREE.ExtrudeGeometry(es, { depth: 0.002, bevelEnabled: false, curveSegments: 48 })
    eg.rotateY(Math.PI / 2).translate(-0.401, 0, 0)
    this.mesh(enc, eg, LOOK.dark)
    this.mesh(enc, tubeX(0.0201, 0.03, -0.41, -0.398), LOOK.steel)
    const fork = this.piece('encoder', [-0.1, 0.12, 0], this.axis)
    this.mesh(fork, box(0.008, 0.03, 0.022, -0.411, 0.05, 0), LOOK.chip)
    this.mesh(fork, box(0.008, 0.03, 0.022, -0.389, 0.05, 0), LOOK.chip)
    this.mesh(fork, box(0.03, 0.012, 0.022, -0.4, 0.068, 0), LOOK.chip)
    this.mesh(fork, box(0.05, 0.004, 0.03, -0.4, 0.076, 0), LOOK.board)
  }

  private drive() {
    const xp = -0.47
    const pul = this.piece('cinghia', [-0.14, 0, 0], this.rotor)
    this.mesh(pul, revolveX([[0.0201, xp - 0.016], [0.082, xp - 0.016], [0.082, xp - 0.011], [0.072, xp], [0.082, xp + 0.011], [0.082, xp + 0.016], [0.035, xp + 0.016], [0.035, xp + 0.04], [0.0201, xp + 0.04]], 64), LOOK.alu)

    const my = 0.3, mz = 0.08
    const mot = this.piece('motore', [0, -0.02, 0.38])
    const body: RX[] = [[0, -0.44], [0.052, -0.44], [0.058, -0.435]]
    for (let x = -0.42; x < -0.23; x += 0.016) body.push([0.058, x], [0.067, x + 0.002], [0.067, x + 0.006], [0.058, x + 0.008])
    body.push([0.058, -0.205], [0.052, -0.2], [0, -0.2])
    // carcassa cava: statore in rame e rotore visibili in sezione
    const outer = revolveX(body, 48)
    this.mesh(mot, outer.translate(0, my, mz), LOOK.paint)
    this.mesh(mot, tubeX(0.03, 0.05, -0.42, -0.22).translate(0, my, mz + 0.0001), LOOK.copper)
    this.mesh(mot, cylX(0.028, -0.42, -0.22).translate(0, my, mz), LOOK.steel)
    this.mesh(mot, cylX(0.008, -0.49, -0.44).translate(0, my, mz), LOOK.steel)
    this.mesh(mot, revolveX([[0.008, xp - 0.014], [0.032, xp - 0.014], [0.032, xp - 0.009], [0.024, xp], [0.032, xp + 0.009], [0.032, xp + 0.014], [0.008, xp + 0.014]], 40).translate(0, my, mz), LOOK.alu)
    this.mesh(mot, box(0.2, 0.06, 0.12, -0.32, 0.2, mz), LOOK.dark)

    // Cinghia con una trama che scorre: velocità = ω · raggio della puleggia.
    const cv = document.createElement('canvas')
    cv.width = 64; cv.height = 8
    const c = cv.getContext('2d')!
    c.fillStyle = '#1a1b1e'; c.fillRect(0, 0, 64, 8)
    c.fillStyle = '#4a4e57'; c.fillRect(0, 0, 10, 8)
    const map = new THREE.CanvasTexture(cv)
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.repeat.set(70, 1)
    map.colorSpace = THREE.SRGBColorSpace
    const curve = beltPath(new THREE.Vector2(AXIS_Y, 0), 0.078, new THREE.Vector2(my, mz), 0.028, xp)
    const belt = this.piece('cinghia', [-0.14, 0, 0])
    const bm = this.custom('cinghia', new THREE.MeshStandardMaterial({ map, roughness: 0.85 }), LOOK.rubber.h)
    belt.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 240, 0.006, 6, true), bm))
    belt.userData.length = curve.getLength()
    return map
  }

  private electronics() {
    const g = this.piece('scheda', [0, 0.02, -0.32])
    const z = -0.284
    this.mesh(g, box(0.24, 0.16, 0.004, -0.33, 0.44, z), LOOK.board)
    for (const [x, y, w, h] of [[-0.38, 0.47, 0.04, 0.04], [-0.31, 0.47, 0.03, 0.02], [-0.27, 0.42, 0.05, 0.03], [-0.37, 0.4, 0.025, 0.015], [-0.32, 0.4, 0.02, 0.02]])
      this.mesh(g, box(w, h, 0.004, x, y, z + 0.004), LOOK.chip)
    for (let i = 0; i < 3; i++) this.mesh(g, new THREE.CylinderGeometry(0.007, 0.007, 0.02, 14).rotateX(Math.PI / 2).translate(-0.26 + i * 0.018, 0.49, z + 0.012), LOOK.dark)
    this.mesh(g, box(0.06, 0.012, 0.012, -0.33, 0.512, z + 0.008), LOOK.grey)
    // alimentatore
    this.mesh(g, box(0.12, 0.08, 0.06, -0.5, 0.2, -0.22), LOOK.grey)

    // Cavi: sensori → scheda, encoder → scheda, scheda → display.
    this.root.add(this.cablesG)
    const cm = this.custom('scheda', new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.6 }), 0x3a7bd5)
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    const paths: [THREE.Vector3[], Cable['kind']][] = [
      [[V(LAYOUT.sensorA, AXIS_Y + 0.09, -0.125), V(LAYOUT.sensorA, AXIS_Y + 0.12, -0.2), V(-0.32, 0.62, -0.27), V(-0.34, 0.512, -0.275)], 'sensore'],
      [[V(LAYOUT.sensorB, AXIS_Y + 0.09, -0.125), V(LAYOUT.sensorB, AXIS_Y + 0.1, -0.22), V(-0.22, 0.6, -0.27), V(-0.32, 0.512, -0.275)], 'sensore'],
      [[V(-0.4, AXIS_Y + 0.078, 0), V(-0.42, AXIS_Y + 0.1, -0.12), V(-0.42, 0.62, -0.26), V(-0.35, 0.512, -0.275)], 'encoder'],
      [[V(-0.31, 0.515, -0.276), V(-0.3, 0.7, -0.27), V(-0.31, 0.92, -0.25), V(-0.31, 1.06, -0.24)], 'display'],
    ]
    const dotM = new THREE.MeshBasicMaterial({ color: 0x3fe0ff, toneMapped: false })
    const dotG = new THREE.SphereGeometry(0.0065, 10, 8)
    for (const [pts, kind] of paths) {
      const curve = new THREE.CatmullRomCurve3(pts)
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.0035, 6), cm)
      m.userData.part = 'scheda'
      this.cablesG.add(m)
      const dots: THREE.Mesh[] = []
      for (let i = 0; i < 4; i++) {
        const d = new THREE.Mesh(dotG, dotM)
        d.userData.noPick = true
        d.visible = false
        this.cablesG.add(d)
        dots.push(d)
      }
      this.cables.push({ curve, dots, kind })
    }
  }

  private gauge() {
    const g = this.piece('calibro', [0, -0.14, 0.26])
    g.add(this.calSlide)
    this.calSlide.userData.part = 'calibro'
    this.calSlide.userData.front = true
    this.mesh(this.calSlide, cylX(0.008, -0.36, 0.03).translate(0, 0.62, 0), LOOK.steel)
    // puntale: stelo che sale dall'asta fino alla sfera, regolato sulla misura del cerchio (buildWheel)
    this.calStem = this.mesh(this.calSlide, new THREE.CylinderGeometry(0.005, 0.004, 1, 12).translate(0.03, -0.5, 0), LOOK.steel)
    this.calStem.position.y = 0.62
    this.calTip = this.mesh(this.calSlide, new THREE.SphereGeometry(0.009, 14, 10).translate(0.03, 0, 0), LOOK.accent)
    this.mesh(g, box(0.05, 0.03, 0.03, -0.36, 0.62, 0), LOOK.chip)
    this.mesh(g, tubeX(0.0085, 0.013, -0.3, -0.02).translate(0, 0.62, 0), LOOK.dark)
  }

  private cover() {
    // Il carter è una mezza calotta centrata sull'albero, incernierata dietro la ruota.
    this.guard.position.set(0, GUARD_PIVOT[0], GUARD_PIVOT[1])
    const g = this.piece('carter', [0.15, 0.12, 0], this.guard)
    const a0 = -Math.PI - 0.15, al = Math.PI + 0.3
    const toAxis = (geo: THREE.BufferGeometry) => geo.translate(0, -GUARD_PIVOT[0], -GUARD_PIVOT[1])
    this.mesh(g, toAxis(revolveX([[0.4, 0.03], [0.41, 0.03], [0.41, 0.45], [0.4, 0.45]], 56, a0, al)), LOOK.plastic)
    this.mesh(g, toAxis(revolveX([[0.33, 0.44], [0.41, 0.44], [0.41, 0.45], [0.33, 0.45]], 56, a0, al)), LOOK.plastic)
    this.mesh(g, toAxis(revolveX([[0.38, 0.12], [0.412, 0.12], [0.412, 0.15], [0.38, 0.15]], 56, a0, al)), LOOK.accent)
    this.mesh(g, cylX(0.018, 0.0, 0.06), LOOK.dark)
    this.mesh(g, box(0.03, 0.03, 0.05, 0.045, 0, 0.02), LOOK.dark)
    // staffa fissa sul retro del mobile
    const st = this.piece('carter', [0.15, 0.12, 0], this.axis)
    this.mesh(st, box(0.04, 0.05, 0.14, 0.0, GUARD_PIVOT[0], -0.36), LOOK.dark)
  }

  // ---------- ruota ----------

  private wheelParts() {
    this.rimG = this.piece('cerchio', [0.4, 0, 0], this.wheel)
    this.tireG = this.piece('pneumatico', [0.6, 0, 0], this.wheel)
    this.weightG = this.piece('pesi', [0.4, 0, 0], this.wheel)
    for (let i = 0; i < 2; i++) {
      const a = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.2, 0xffb21e, 0.05, 0.03)
      a.traverse((o) => (o.userData.noPick = true))
      ;(a.line.material as THREE.LineBasicMaterial).toneMapped = false
      ;(a.cone.material as THREE.MeshBasicMaterial).toneMapped = false
      a.visible = false
      this.wheel.add(a)
      this.arrows.push(a)
    }
    // segni del marcatore: giallo sul cerchio e sul pneumatico (da allineare), bianco il riferimento
    const glow = (id: string, c: number) => this.custom(id, new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.6, side: THREE.DoubleSide }), 0x8a93a0, true)
    this.marks = new MarkSet({ rim: glow('cerchio', 0xffd21e), ref: glow('pneumatico', 0xf2f2f2), target: glow('pneumatico', 0xffd21e), arc: glow('cerchio', 0xffb21e) })
  }

  /** Segni del marcatore e rotazione da fare; text è l'angolo scritto accanto all'arco. */
  setMarks(s: MarkState, text?: string) {
    this.tireG.rotation.x = s.theta
    this.marks.set(this.spec, s, text)
  }

  /** Cerchio e pneumatico come solidi per il controllo di compenetrazione. */
  wheelSolids(): Solid[] {
    const e = this.spec.et, R = wheelGeometry(this.spec).rimR
    const disc: RX[] = [[0.0285, e], [R - 0.0055, e], [R - 0.0055, e + 0.016], [0.0285, e + 0.016]]
    return [
      { name: 'cerchio', frame: this.rimG, sections: this.sections(() => [rimSection(this.spec), disc]) },
      { name: 'pneumatico', frame: this.tireG, sections: this.sections(() => [tireShell(this.spec)], 1) },
    ]
  }
  private secs: { spec: WheelSpec; s: RX[][] }[] = []
  /** Sezioni in cache: la griglia delle distanze si calcola una volta per misura di ruota. */
  private sections(make: () => RX[][], i = 0) {
    const c = this.secs[i]
    if (c?.spec === this.spec) return c.s
    this.secs[i] = { spec: this.spec, s: make() }
    return this.secs[i].s
  }

  /** La ruota, i pesi e gli indicatori non si controllano contro la ruota. */
  isWheelOrMarker(o: THREE.Object3D) {
    return o === this.rimG || o === this.tireG || o === this.weightG || !!o.userData.noPick || o.type === 'ArrowHelper'
  }

  /** Ricostruisce cerchio e pneumatico per la misura scelta. */
  buildWheel(spec: WheelSpec) {
    this.spec = spec
    this.wheel.position.x = LAYOUT.flangeFace - spec.et
    this.clear(this.rimG)
    this.clear(this.tireG)
    this.marks.attach(this.rimG, this.tireG)
    // la sfera del calibro tocca il cerchio da dentro, appena sotto la sede del tallone interno
    const y = AXIS_Y - (wheelGeometry(spec).rimR - 0.0145)
    this.calTip.position.y = y
    this.calStem.scale.y = Math.max(0.62 - y, 0.005)

    const geo = wheelMeshes(spec)
    for (const r of geo.rim) this.mesh(this.rimG, r.geo, LOOK[r.look])
    this.mesh(this.tireG, geo.tire, LOOK.rubber)
    this.setWeights([], spec)
  }

  /** Disegna i pesi applicati sulle balconate. */
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

  /** Frecce delle forze centrifughe sui due piani (nel sistema della ruota). */
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

  protected afterExplode(t: number) {
    this.cablesG.visible = t < 0.02 && !this.parts.get('scheda')?.hidden
  }

  protected afterHidden(id: string, hidden: boolean) {
    if (id === 'scheda') this.cablesG.visible = !hidden && this.explodeT < 0.02
  }
}
