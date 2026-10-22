import * as THREE from 'three'
import { Section } from './section'

/** Aspetto di un materiale: colore, metallicità, ruvidità e colore del tratteggio in sezione. */
export interface Look { c: number; m: number; r: number; h: number }

export const LOOK = {
  paint: { c: 0x2f343c, m: 0.35, r: 0.45, h: 0x8a93a0 },
  accent: { c: 0xd23a2a, m: 0.3, r: 0.4, h: 0x8a93a0 },
  steel: { c: 0xc3c8cf, m: 1, r: 0.28, h: 0xd9482b },
  dark: { c: 0x5d636c, m: 0.9, r: 0.4, h: 0xd9482b },
  alu: { c: 0xd5d9de, m: 1, r: 0.22, h: 0xe0892b },
  rubber: { c: 0x1d1e21, m: 0, r: 0.88, h: 0x4a4d55 },
  plastic: { c: 0x2a2d33, m: 0, r: 0.55, h: 0x3a7bd5 },
  grey: { c: 0x8d939b, m: 0.1, r: 0.6, h: 0x3a7bd5 },
  board: { c: 0x1d6b3c, m: 0.1, r: 0.55, h: 0x3a7bd5 },
  chip: { c: 0x15161a, m: 0.2, r: 0.5, h: 0x3a7bd5 },
  copper: { c: 0xc4753a, m: 1, r: 0.35, h: 0xe0892b },
  brass: { c: 0xd8ad45, m: 0.9, r: 0.3, h: 0xe0892b },
  ceramic: { c: 0xece6da, m: 0, r: 0.4, h: 0xe0892b },
  lead: { c: 0x9aa0a8, m: 0.7, r: 0.5, h: 0xe0892b },
  air: { c: 0x2b6fd6, m: 0.1, r: 0.45, h: 0x3a7bd5 },
  yellow: { c: 0xe8b21e, m: 0.3, r: 0.45, h: 0x8a93a0 },
} satisfies Record<string, Look>

export interface Part {
  id: string
  pieces: { obj: THREE.Object3D; off: THREE.Vector3 }[]
  mats: THREE.MeshStandardMaterial[]
  hidden: boolean
}

/**
 * Base comune dei modelli: registro delle parti, materiali che seguono la
 * sezione, vista esplosa, parti nascoste, evidenziazione e selezione col tocco.
 */
export class MachineModel {
  readonly root = new THREE.Group()
  readonly parts = new Map<string, Part>()
  /** Materiali che hanno un'emissione propria e non vanno toccati dall'evidenziazione. */
  protected readonly glowing = new Set<THREE.Material>()
  private readonly matCache = new Map<string, THREE.MeshStandardMaterial>()
  protected explodeT = 0

  constructor(protected section: Section) {}

  protected part(id: string) {
    let p = this.parts.get(id)
    if (!p) this.parts.set(id, (p = { id, pieces: [], mats: [], hidden: false }))
    return p
  }

  /** Gruppo di una parte che nella vista esplosa si sposta di off. */
  protected piece(id: string, off: [number, number, number], parent: THREE.Object3D = this.root) {
    const g = new THREE.Group()
    g.userData.part = id
    g.userData.front = off[2] > 0
    parent.add(g)
    this.part(id).pieces.push({ obj: g, off: new THREE.Vector3(...off) })
    return g
  }

  protected mat(id: string, look: Look, front = false) {
    const key = id + ':' + look.c + (front ? ':f' : '')
    let m = this.matCache.get(key)
    if (!m) {
      m = this.section.register(new THREE.MeshStandardMaterial({ color: look.c, metalness: look.m, roughness: look.r }), look.h, front ? this.section.front : this.section.plane)
      this.matCache.set(key, m)
      this.part(id).mats.push(m)
    }
    return m
  }

  /** Materiale speciale (mappa, emissione) registrato nella sezione e associato a una parte. */
  protected custom<M extends THREE.MeshStandardMaterial>(id: string, m: M, hatch: number, glow = false) {
    this.section.register(m, hatch)
    this.part(id).mats.push(m)
    if (glow) this.glowing.add(m)
    return m
  }

  protected mesh(g: THREE.Object3D, geo: THREE.BufferGeometry, look: Look) {
    const m = new THREE.Mesh(geo, this.mat(g.userData.part, look, g.userData.front))
    g.add(m)
    return m
  }

  protected clear(g: THREE.Group) {
    for (const c of [...g.children]) {
      g.remove(c)
      ;(c as THREE.Mesh).geometry?.dispose()
    }
  }

  explode(t: number) {
    this.explodeT = t
    for (const p of this.parts.values())
      for (const pc of p.pieces) pc.obj.position.copy(pc.off).multiplyScalar(t)
    this.afterExplode(t)
  }
  get exploded() { return this.explodeT }
  protected afterExplode(_t: number) {}

  setHidden(id: string, hidden: boolean) {
    const p = this.parts.get(id)
    if (!p) return
    p.hidden = hidden
    for (const pc of p.pieces) pc.obj.visible = !hidden
    this.afterHidden(id, hidden)
  }
  protected afterHidden(_id: string, _hidden: boolean) {}

  highlight(id: string | null) {
    for (const p of this.parts.values())
      for (const m of p.mats) {
        if (this.glowing.has(m)) continue
        m.emissive.setHex(p.id === id ? 0x2f6bff : 0x000000)
        m.emissiveIntensity = p.id === id ? 0.45 : 0
      }
  }

  /** Parte sotto il raggio, risalendo la gerarchia fino a un gruppo con userData.part. */
  pick(ray: THREE.Raycaster): string | null {
    const hits = ray.intersectObject(this.root, true)
    for (const h of hits) {
      if (h.object.userData.noPick || !visibleChain(h.object)) continue
      // scarta ciò che il piano di sezione ha tolto
      const plane = ((h.object as THREE.Mesh).material as THREE.Material).clippingPlanes?.[0]
      if (!this.section.keeps(h.point, plane)) continue
      let o: THREE.Object3D | null = h.object
      while (o && !o.userData.part) o = o.parent
      if (o) return o.userData.part
    }
    return null
  }
}

function visibleChain(o: THREE.Object3D | null): boolean {
  for (; o; o = o.parent) if (!o.visible) return false
  return true
}
