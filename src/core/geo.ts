import * as THREE from 'three'

/** Punto di un profilo di rivoluzione: r = raggio, x = posizione lungo l'asse. */
export type RX = [r: number, x: number]

/** Solido di rivoluzione attorno all'asse X a partire da un profilo (r, x), che viene chiuso. */
export function revolveX(profile: RX[], segments = 64, phiStart = 0, phiLength = Math.PI * 2) {
  // Lathe collega solo punti consecutivi: il profilo va chiuso esplicitamente.
  const [f, l] = [profile[0], profile[profile.length - 1]]
  if (f[0] !== l[0] || f[1] !== l[1]) profile = [...profile, f]
  // Il profilo deve girare in senso antiorario nel piano (r, x), altrimenti le facce guardano dentro.
  let area = 0
  for (let i = 0; i < profile.length; i++) {
    const [r0, x0] = profile[i], [r1, x1] = profile[(i + 1) % profile.length]
    area += r0 * x1 - r1 * x0
  }
  if (area < 0) profile = [...profile].reverse()
  // Spigoli vivi: il punto viene duplicato così le normali non si mediano attraverso lo spigolo.
  const sharp: RX[] = []
  for (let i = 0; i < profile.length; i++) {
    const p = profile[i], a = profile[i - 1], b = profile[i + 1]
    sharp.push(p)
    if (!a || !b) continue
    const ax = p[0] - a[0], ay = p[1] - a[1], bx = b[0] - p[0], by = b[1] - p[1]
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by)
    if (la < 1e-9 || lb < 1e-9) continue
    if ((ax * bx + ay * by) / (la * lb) < 0.8) sharp.push(p)
  }
  const pts = sharp.map(([r, x]) => new THREE.Vector2(Math.max(r, 0), x))
  const g = new THREE.LatheGeometry(pts, segments, phiStart, phiLength)
  // Lathe gira attorno a Y: ruotando di -90° su Z l'asse diventa X.
  g.rotateZ(-Math.PI / 2)
  g.computeVertexNormals()
  return g
}

/** Profilo chiuso a spessore costante: percorso esterno + lo stesso spostato verso l'asse. */
export function shell(outer: RX[], t: number): RX[] {
  const inner = outer.map(([r, x]) => [r - t, x] as RX).reverse()
  return [...outer, ...inner, outer[0]]
}

/** Cilindro pieno coassiale all'asse X, da x0 a x1. */
export function cylX(r: number, x0: number, x1: number, seg = 40) {
  const g = new THREE.CylinderGeometry(r, r, x1 - x0, seg)
  g.rotateZ(-Math.PI / 2)
  g.translate((x0 + x1) / 2, 0, 0)
  return g
}

/** Tubo (cilindro cavo) coassiale all'asse X. */
export function tubeX(r0: number, r1: number, x0: number, x1: number, seg = 40) {
  return revolveX([[r0, x0], [r1, x0], [r1, x1], [r0, x1], [r0, x0]], seg)
}

/** Parallelepipedo con il centro in (x, y, z). */
export function box(w: number, h: number, d: number, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}

/** Percorso chiuso di una cinghia attorno a due pulegge nel piano YZ (tangenti esterne). */
export function beltPath(c1: THREE.Vector2, r1: number, c2: THREE.Vector2, r2: number, x: number) {
  const d = c2.clone().sub(c1)
  const L = d.length()
  const base = Math.atan2(d.y, d.x)
  const beta = Math.acos((r1 - r2) / L)
  const pts: THREE.Vector3[] = []
  const arc = (c: THREE.Vector2, r: number, a0: number, a1: number, n: number) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n
      pts.push(new THREE.Vector3(x, c.x + Math.cos(a) * r, c.y + Math.sin(a) * r))
    }
  }
  // Arco grande sulla puleggia 1, poi arco piccolo sulla puleggia 2.
  arc(c1, r1, base + beta, base + Math.PI * 2 - beta, 40)
  arc(c2, r2, base - beta, base + beta, 24)
  return new THREE.CatmullRomCurve3(pts, true, 'centripetal')
}
