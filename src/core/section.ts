import * as THREE from 'three'

/**
 * Sezione (cutaway) con un piano di taglio.
 *
 * Tutti i materiali registrati usano lo stesso piano di clipping. Quando il
 * taglio è attivo diventano a doppia faccia: dove il piano apre un solido si
 * vedono le facce interne, che lo shader colora con un tratteggio come in un
 * disegno tecnico. Nessuna geometria di chiusura da costruire.
 */
export class Section {
  readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 100)
  private readonly mats = new Set<THREE.MeshStandardMaterial>()
  private active = false
  /** 0 = macchina intera, 1 = tagliata a metà sul piano verticale dell'albero. */
  amount = 0

  register<M extends THREE.MeshStandardMaterial>(m: M, hatch = 0xd9482b): M {
    m.clippingPlanes = [this.plane]
    const col = new THREE.Color(hatch)
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uHatch = { value: col }
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', 'uniform vec3 uHatch;\nvoid main() {')
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
          if (!gl_FrontFacing) {
            float s = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 9.0));
            gl_FragColor = vec4(mix(uHatch, uHatch * 0.55, s), 1.0);
          }`,
        )
    }
    m.customProgramCacheKey = () => 'sez' + hatch
    this.mats.add(m)
    return m
  }

  /** Vero se il punto (mondo) non è stato tolto dal taglio. */
  keeps(p: THREE.Vector3) {
    return this.plane.distanceToPoint(p) >= -1e-4
  }

  set(amount: number) {
    this.amount = amount
    const on = amount > 0.001
    // Il piano scorre da davanti (z = 0.45, niente tagliato) fino all'asse (z = 0).
    this.plane.constant = on ? 0.45 * (1 - amount) : 100
    if (on !== this.active) {
      this.active = on
      for (const m of this.mats) m.side = on ? THREE.DoubleSide : THREE.FrontSide
    }
  }
}
