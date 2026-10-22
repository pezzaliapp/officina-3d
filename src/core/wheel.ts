import * as THREE from 'three'
import { revolveX, shell, cylX, RX } from './geo'

export interface WheelSpec {
  id: string
  /** Misura come scritta sul fianco, es. 205/55 R16. */
  label: string
  tireWidth: number // mm
  aspect: number // %
  rimInch: number
  rimWidthInch: number
  /** Massa ruota completa, kg (indicativa). */
  mass: number
  /** Raggio d'inerzia, m (indicativo). */
  gyration: number
  /** Offset del cerchio ET, m. */
  et: number
}

export const WHEELS: WheelSpec[] = [
  { id: 's', label: '175/65 R14', tireWidth: 175, aspect: 65, rimInch: 14, rimWidthInch: 5.5, mass: 14, gyration: 0.21, et: 0.035 },
  { id: 'm', label: '205/55 R16', tireWidth: 205, aspect: 55, rimInch: 16, rimWidthInch: 6.5, mass: 19, gyration: 0.23, et: 0.045 },
  { id: 'l', label: '225/40 R18', tireWidth: 225, aspect: 40, rimInch: 18, rimWidthInch: 8, mass: 22, gyration: 0.25, et: 0.045 },
]

/** Dimensioni geometriche ricavate dalla sigla del pneumatico (norma ETRTO). */
export function wheelGeometry(w: WheelSpec) {
  const rimR = (w.rimInch * 0.0254) / 2
  const width = w.rimWidthInch * 0.0254
  const tireR = rimR + (w.tireWidth / 1000) * (w.aspect / 100)
  return { rimR, width, tireR, tireW: w.tireWidth / 1000 }
}

type RimLook = 'alu' | 'steel' | 'dark'

/**
 * Geometrie di cerchio e pneumatico, asse lungo X, centro del canale nell'origine,
 * faccia esterna (disco) verso +x.
 */
export function wheelMeshes(spec: WheelSpec) {
  const { rimR: R, width: w, tireR: Rt, tireW: Wt } = wheelGeometry(spec)
  const h = w / 2
  const rim: { geo: THREE.BufferGeometry; look: RimLook }[] = []
  let tire!: THREE.BufferGeometry
  // Cerchio: profilo del canale a spessore costante, simmetrico sulle due balconate.
  const fl: RX[] = [[R + 0.016, -h - 0.009], [R + 0.019, -h - 0.004], [R + 0.015, -h + 0.001], [R + 0.004, -h + 0.003], [R, -h + 0.01]]
  const mid: RX[] = [[R, -h + 0.18 * w], [R - 0.024, -h + 0.26 * w], [R - 0.024, -h + 0.55 * w], [R, -h + 0.65 * w]]
  const mir = fl.map(([r, x]) => [r, -x] as RX).reverse()
  rim.push({ geo: revolveX(shell([...fl, ...mid, ...mir], 0.0045), 96), look: 'alu' })

  // Disco a 5 razze con foro centrale e fori bulloni.
  const ds = new THREE.Shape()
  ds.absarc(0, 0, R - 0.0055, 0, Math.PI * 2, false)
  const cb = new THREE.Path(); cb.absarc(0, 0, 0.0285, 0, Math.PI * 2, true); ds.holes.push(cb)
  const ri = 0.07, ro = R - 0.032, half = Math.PI / 5 - 0.2
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 5
    const p = new THREE.Path()
    p.absarc(0, 0, ro, a - half, a + half, false)
    p.absarc(0, 0, ri, a + half * 0.75, a - half * 0.75, true)
    p.closePath()
    ds.holes.push(p)
    const b = new THREE.Path()
    const ab = (i / 5) * Math.PI * 2
    b.absarc(Math.cos(ab) * 0.056, Math.sin(ab) * 0.056, 0.007, 0, Math.PI * 2, true)
    ds.holes.push(b)
  }
  const dg = new THREE.ExtrudeGeometry(ds, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 40 })
  dg.rotateY(Math.PI / 2).translate(spec.et + 0.002, 0, 0)
  rim.push({ geo: dg, look: 'alu' })
  for (let i = 0; i < 5; i++) {
    const ab = (i / 5) * Math.PI * 2
    rim.push({ geo: cylX(0.0095, spec.et + 0.014, spec.et + 0.03, 6).translate(0, Math.sin(ab) * 0.056, -Math.cos(ab) * 0.056), look: 'steel' })
  }
  rim.push({ geo: new THREE.CylinderGeometry(0.004, 0.005, 0.03, 10).translate(0, R - 0.01, 0).rotateX(2.4).translate(h - 0.02, 0, 0), look: 'dark' })

  // Pneumatico: sezione cava con fianchi bombati, spalla arrotondata e scanalature.
  const side: RX[] = []
  const rs0 = R + 0.022, rs1 = Rt - 0.025
  for (let i = 0; i <= 14; i++) {
    const t = i / 14
    const x = t <= 0.55
      ? h + 0.006 + (Wt / 2 - h - 0.006) * Math.sin((Math.PI / 2) * (t / 0.55))
      : Wt / 2 - 0.015 * ((t - 0.55) / 0.45) ** 2
    side.push([rs0 + t * (rs1 - rs0), x])
  }
  for (let i = 1; i <= 8; i++) {
    const th = (i / 8) * (Math.PI / 2)
    side.push([Rt - 0.025 + 0.025 * Math.sin(th), Wt / 2 - 0.04 + 0.025 * Math.cos(th)])
  }
  const bead: RX[] = [[R + 0.001, h - 0.012], [R + 0.001, h - 0.002], [R + 0.012, h - 0.001]]
  const outSide = [...bead, ...side]
  const tread: RX[] = []
  const xt = Wt / 2 - 0.04
  for (let i = 1; i < 60; i++) {
    const x = xt - (2 * xt * i) / 60
    tread.push([Rt - 0.003 * (x / xt) ** 2, x])
  }
  const smooth: RX[] = [...outSide.map(([r, x]) => [r, -x] as RX), ...tread.reverse(), ...[...outSide].reverse()]
  // percorso dalla tallonatura esterna (+x) verso quella interna: lo ordiniamo da -x a +x
  smooth.reverse()
  const inner = offset(smooth, 0.011, [(R + Rt) / 2, 0])
  inner[0] = [R + 0.001, smooth[0][1] + (smooth[0][1] > 0 ? -0.012 : 0.012)]
  const L = inner.length - 1
  inner[L] = [R + 0.001, smooth[L][1] + (smooth[L][1] > 0 ? -0.012 : 0.012)]
  const grooves = [-0.32, -0.11, 0.11, 0.32].map((k) => k * Wt)
  const outerP = smooth.map(([r, x]) => {
    if (r < Rt - 0.004) return [r, x] as RX
    const g = grooves.some((gx) => Math.abs(x - gx) < 0.005)
    return [g ? r - 0.008 : r, x] as RX
  })
  tire = revolveX([...outerP, ...inner.reverse(), outerP[0]], 120)
  return { rim, tire }
}

/** Sposta una polilinea (r, x) di t verso il punto interno indicato. */
function offset(p: RX[], t: number, inside: RX): RX[] {
  return p.map((pt, i) => {
    const a = p[Math.max(i - 1, 0)], b = p[Math.min(i + 1, p.length - 1)]
    let tr = b[0] - a[0], tx = b[1] - a[1]
    const l = Math.hypot(tr, tx) || 1
    tr /= l; tx /= l
    let nr = -tx, nx = tr
    if (nr * (inside[0] - pt[0]) + nx * (inside[1] - pt[1]) < 0) { nr = -nr; nx = -nx }
    return [pt[0] + nr * t, pt[1] + nx * t]
  })
}
