import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/** Renderer, camera, luci e pavimento. */
export function createStage(host: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.localClippingEnabled = true
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.outputColorSpace = THREE.SRGBColorSpace
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0f1216)
  scene.fog = new THREE.Fog(0x0f1216, 4, 9)
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.75
  pmrem.dispose()

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1c20, 0.5))
  const key = new THREE.DirectionalLight(0xffffff, 1.6)
  key.position.set(2, 3, 2.5)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x9fc4ff, 0.6)
  rim.position.set(-2.5, 1.5, -2)
  scene.add(rim)

  // Pavimento con ombra morbida finta: costa niente anche sui telefoni.
  const grad = (inner: string, outer: string, size = 256) => {
    const c = document.createElement('canvas')
    c.width = c.height = size
    const g = c.getContext('2d')!
    const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    r.addColorStop(0, inner)
    r.addColorStop(1, outer)
    g.fillStyle = r
    g.fillRect(0, 0, size, size)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(6, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: grad('#232932', '#0f1216') }),
  )
  scene.add(floor)
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 1.3).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: grad('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }),
  )
  shadow.position.set(-0.12, 0.002, 0)
  scene.add(shadow)

  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 30)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.09
  controls.minDistance = 0.6
  controls.maxDistance = 7
  controls.maxPolarAngle = 1.53
  controls.autoRotateSpeed = 0.8

  return { renderer, scene, camera, controls }
}

/** Inquadratura iniziale: la distanza si adatta alla larghezza dello schermo. */
export function homeView(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
  const aspect = window.innerWidth / window.innerHeight
  camera.fov = aspect < 1 ? 50 : 38
  camera.updateProjectionMatrix()
  const halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect
  const target = new THREE.Vector3(-0.08, 0.6, 0)
  const dir = new THREE.Vector3(1.0, 0.5, 1.2).normalize()
  camera.position.copy(target).addScaledVector(dir, Math.max(2.5, 0.85 / halfW))
  controls.target.copy(target)
  controls.update()
}
