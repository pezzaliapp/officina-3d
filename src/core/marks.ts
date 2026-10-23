import * as THREE from 'three'
import { WheelSpec, wheelGeometry, tireHalfWidth } from './wheel'

/**
 * Segni del marcatore per il matching, sul lato esterno della ruota (+x).
 * Angoli nel sistema della ruota: rotazione attorno a X da +y verso +z (vedi core/match).
 */

const dirAt = (a: number) => [Math.cos(a), Math.sin(a)] as const

/**
 * Trattino radiale sul fianco esterno del pneumatico all'angolo a, da r0 a r1, largo w (m).
 * Segue la bombatura del fianco a 1,5 mm dalla gomma; le facce guardano verso +x.
 */
export function tireMarkGeometry(spec: WheelSpec, a: number, r0: number, r1: number, w: number) {
  const N = 10, pos: number[] = [], idx: number[] = []
  for (let i = 0; i <= N; i++) {
    const r = r0 + ((r1 - r0) * i) / N
    const x = tireHalfWidth(spec, r) + 0.0015
    for (const s of [-1, 1]) {
      const [c, sn] = dirAt(a + (s * w) / 2 / r)
      pos.push(x, r * c, r * sn)
    }
  }
  for (let i = 0; i < N; i++) {
    const p = i * 2
    idx.push(p, p + 2, p + 1, p + 1, p + 2, p + 3)
  }
  return indexed(pos, idx)
}

/** Trattino sul labbro della balconata esterna del cerchio all'angolo a. */
export function rimMarkGeometry(spec: WheelSpec, a: number, w = 0.014) {
  const { rimR: R, width } = wheelGeometry(spec)
  const x = width / 2 + 0.0105, pos: number[] = [], idx: number[] = []
  for (const r of [R + 0.0105, R + 0.0195])
    for (const s of [-1, 1]) {
      const [c, sn] = dirAt(a + (s * w) / 2 / r)
      pos.push(x, r * c, r * sn)
    }
  idx.push(0, 2, 1, 1, 2, 3)
  return indexed(pos, idx)
}

/** Arco con freccia sul fianco, dall'angolo from all'angolo to, al raggio r: la rotazione da fare. */
export function arcGeometry(spec: WheelSpec, from: number, to: number, r: number) {
  const x = tireHalfWidth(spec, r) + 0.006
  const span = to - from
  const n = Math.max(2, Math.ceil(Math.abs(span) / 0.05))
  const pts: THREE.Vector3[] = []
  // l'arco si ferma prima della punta della freccia
  const head = Math.min(0.03 / r, Math.abs(span) * 0.5) * Math.sign(span)
  for (let i = 0; i <= n; i++) {
    const [c, s] = dirAt(from + ((span - head) * i) / n)
    pts.push(new THREE.Vector3(x, r * c, r * s))
  }
  const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, 0.0035, 6)
  // punta: cono lungo la tangente nel punto di arrivo
  const [c1, s1] = dirAt(to - head), [c2, s2] = dirAt(to)
  const p1 = new THREE.Vector3(x, r * c1, r * s1), p2 = new THREE.Vector3(x, r * c2, r * s2)
  const len = p1.distanceTo(p2)
  const cone = new THREE.ConeGeometry(0.01, Math.max(len, 0.001), 12).translate(0, len / 2, 0)
  cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), p2.clone().sub(p1).normalize()))
  cone.translate(p1.x, p1.y, p1.z)
  return { tube, cone, tip: p2, mid: dirAt(from + span / 2), x }
}

function indexed(pos: number[], idx: number[]) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Etichetta di testo sempre visibile (sprite disegnato su canvas). */
export class Label {
  readonly sprite: THREE.Sprite
  private cv = document.createElement('canvas')
  private tex: THREE.CanvasTexture
  private text = ''
  /** fixed: dimensione costante sullo schermo invece che nella scena (height in frazioni dello schermo). */
  constructor(height = 0.05, fixed = false) {
    this.cv.width = 256
    this.cv.height = 64
    this.tex = new THREE.CanvasTexture(this.cv)
    this.tex.colorSpace = THREE.SRGBColorSpace
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthTest: false, transparent: true, toneMapped: false, sizeAttenuation: !fixed }))
    this.sprite.scale.set(height * 4, height, 1)
    this.sprite.renderOrder = 10
    this.sprite.userData.noPick = true
  }
  set(text: string) {
    if (text === this.text) return
    this.text = text
    const c = this.cv.getContext('2d')!
    c.clearRect(0, 0, 256, 64)
    c.fillStyle = 'rgba(10, 13, 17, 0.82)'
    c.beginPath()
    c.roundRect?.(40, 6, 176, 52, 12)
    c.fill()
    c.fillStyle = '#ffd21e'
    c.font = '700 34px ui-monospace, Menlo, monospace'
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(text, 128, 33)
    this.tex.needsUpdate = true
  }
}

/** Cosa mostrare: segni (null = non fatto), angolo del pneumatico sul cerchio, rotazione ancora da fare. */
export interface MarkState {
  /** Segno sul cerchio, sistema del cerchio. */
  rim: number | null
  /** Segno di riferimento sul pneumatico (bianco), sistema del pneumatico. */
  ref: number | null
  /** Segno da allineare a quello del cerchio (giallo), sistema del pneumatico. */
  target: number | null
  theta: number
  /** Rotazione del pneumatico che porta il segno giallo su quello del cerchio; null per non disegnarla. */
  turn: number | null
}

/**
 * Segni del marcatore su cerchio e pneumatico, con l'arco della rotazione e l'angolo.
 * I segni del pneumatico stanno nel suo gruppo e girano con lui; arco ed etichetta stanno col cerchio.
 */
export class MarkSet {
  readonly rimG = new THREE.Group()
  readonly tireG = new THREE.Group()
  readonly label = new Label(0.045)
  /** Segni sul pneumatico, per chi deve deformarli insieme alla gomma. */
  tireMeshes: THREE.Mesh[] = []
  private key = ''
  private arcKey = ''
  private arc: THREE.Mesh[] = []

  constructor(private mats: { rim: THREE.Material; ref: THREE.Material; target: THREE.Material; arc: THREE.Material }) {
    for (const g of [this.rimG, this.tireG]) g.userData.noPick = true
    this.label.sprite.visible = false
    this.rimG.add(this.label.sprite)
  }

  /** Aggancia i segni ai gruppi di cerchio e pneumatico (da rifare dopo aver ricostruito la ruota). */
  attach(rimParent: THREE.Object3D, tireParent: THREE.Object3D) {
    rimParent.add(this.rimG)
    tireParent.add(this.tireG)
  }

  set(spec: WheelSpec, s: MarkState, text?: string) {
    const { rimR: R, tireR: Rt } = wheelGeometry(spec)
    const H = Rt - R
    const f = (v: number | null) => (v === null ? '-' : v.toFixed(4))
    const key = [spec.id, f(s.rim), f(s.ref), f(s.target)].join('|')
    if (key !== this.key) {
      this.key = key
      this.arcKey = ''
      for (const g of [this.rimG, this.tireG]) for (const c of [...g.children]) if (c !== this.label.sprite) { g.remove(c); (c as THREE.Mesh).geometry?.dispose() }
      this.arc = []
      this.tireMeshes = []
      const add = (g: THREE.Group, geo: THREE.BufferGeometry, m: THREE.Material) => {
        const mesh = new THREE.Mesh(geo, m)
        mesh.userData.noPick = true
        g.add(mesh)
        return mesh
      }
      if (s.rim !== null) add(this.rimG, rimMarkGeometry(spec, s.rim), this.mats.rim)
      if (s.ref !== null) this.tireMeshes.push(add(this.tireG, tireMarkGeometry(spec, s.ref, R + 0.03, R + 0.03 + 0.4 * H, 0.012), this.mats.ref))
      if (s.target !== null) this.tireMeshes.push(add(this.tireG, tireMarkGeometry(spec, s.target, R + 0.026, R + 0.026 + 0.55 * H, 0.018), this.mats.target))
    }
    // arco dal segno giallo (dov'è adesso sul cerchio) al segno del cerchio
    const show = s.turn !== null && s.target !== null && s.rim !== null && Math.abs(s.turn) > 0.003
    const from = (s.target ?? 0) + s.theta
    const ak = show ? [f(from), f(s.turn)].join('|') : ''
    if (ak !== this.arcKey) {
      this.arcKey = ak
      for (const m of this.arc) { this.rimG.remove(m); m.geometry.dispose() }
      this.arc = []
      if (show) {
        const a = arcGeometry(spec, from, from + s.turn!, R + 0.75 * H)
        for (const geo of [a.tube, a.cone]) {
          const m = new THREE.Mesh(geo, this.mats.arc)
          m.userData.noPick = true
          this.rimG.add(m)
          this.arc.push(m)
        }
        const r = R + 0.75 * H
        this.label.sprite.position.set(a.x + 0.05, r * a.mid[0], r * a.mid[1])
      }
    }
    this.label.sprite.visible = show && !!text
    if (show && text) this.label.set(text)
  }
}
