import * as THREE from 'three'

export interface DisplayState {
  status: string
  int: string
  est: string
  /** -1..1 scarto dalla posizione corretta per ciascun piano, null se non serve. */
  posInt: number | null
  posEst: number | null
  rpm: number
  a: number // mm
  b: number // pollici
  d: number // pollici
}

/** Display della console disegnato su una texture canvas. */
export class ConsoleDisplay {
  readonly canvas = document.createElement('canvas')
  readonly texture: THREE.CanvasTexture
  private ctx: CanvasRenderingContext2D
  private last = ''

  constructor() {
    this.canvas.width = 1024
    this.canvas.height = 550
    this.ctx = this.canvas.getContext('2d')!
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 4
  }

  draw(s: DisplayState) {
    const key = JSON.stringify(s)
    if (key === this.last) return false
    this.last = key
    const c = this.ctx, W = 1024, H = 550
    c.fillStyle = '#05080c'
    c.fillRect(0, 0, W, H)
    c.font = '600 34px system-ui, sans-serif'
    c.fillStyle = '#7fd4ff'
    c.textAlign = 'left'
    c.fillText(s.status, 36, 58)
    c.textAlign = 'right'
    c.fillStyle = '#5b6b7a'
    c.fillText(`${Math.round(s.rpm)} giri/min`, W - 36, 58)

    const win = (x: number, label: string, val: string, pos: number | null) => {
      c.strokeStyle = '#1d2b38'
      c.lineWidth = 4
      c.strokeRect(x, 90, 440, 300)
      c.textAlign = 'center'
      c.fillStyle = '#5b6b7a'
      c.font = '600 30px system-ui, sans-serif'
      c.fillText(label, x + 220, 132)
      c.fillStyle = val === 'OK' ? '#4ee38a' : '#ff5a3c'
      c.font = '700 150px ui-monospace, Menlo, monospace'
      const unit = val !== 'OK' && val !== '---'
      c.fillText(val, x + (unit ? 200 : 220), 300)
      if (unit) {
        c.font = '600 56px system-ui, sans-serif'
        c.textAlign = 'left'
        c.fillText('g', x + 200 + val.length * 46 + 10, 300)
      }
      // indicatore di posizione: barra che si chiude al centro quando il peso è a ore 12
      if (pos !== null) {
        const ok = Math.abs(pos) < 0.03
        c.fillStyle = ok ? '#4ee38a' : '#ffb21e'
        // segmento centrale = posizione giusta; i laterali dicono da che parte girare
        const lit = Math.min(3, Math.ceil(Math.abs(pos) * 3))
        for (let i = -3; i <= 3; i++) {
          const on = ok ? i === 0 : Math.sign(i) === Math.sign(pos) && Math.abs(i) <= lit
          c.globalAlpha = on ? 1 : 0.15
          c.fillRect(x + 40 + (i + 3) * 54, 340, 44, 26)
        }
        c.globalAlpha = 1
      }
    }
    win(36, 'INTERNO', s.int, s.posInt)
    win(W - 476, 'ESTERNO', s.est, s.posEst)

    c.textAlign = 'left'
    c.fillStyle = '#9fb3c4'
    c.font = '500 32px ui-monospace, Menlo, monospace'
    c.fillText(`a ${s.a.toFixed(0)} mm   b ${s.b.toFixed(1)}"   d ${s.d.toFixed(0)}"`, 36, 470)
    c.fillStyle = '#5b6b7a'
    c.font = '500 26px system-ui, sans-serif'
    c.fillText('DINAMICA · 2 piani · pesi a molla', 36, 515)
    this.texture.needsUpdate = true
    return true
  }
}
