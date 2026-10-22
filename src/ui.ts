const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

export const ui = {
  pannello: $('pannello'),
  maniglia: $('maniglia'),
  sez: $<HTMLInputElement>('in-sez'),
  oSez: $('o-sez'),
  esp: $<HTMLInputElement>('in-esp'),
  oEsp: $('o-esp'),
  vista: $<HTMLButtonElement>('btn-vista'),
  flussi: $<HTMLInputElement>('in-flussi'),
  giro: $<HTMLInputElement>('in-giro'),
  scheda: $('scheda-parte'),
  elenco: $('elenco-parti'),
  fisica: $('fisica-live'),
  fisicaTesto: $('fisica-testo'),
  lavoro: $('pane-lavoro'),
  tabLavoro: $('tab-lavoro'),
  macchina: $<HTMLSelectElement>('sel-macchina'),
  hudStato: $('hud-stato'),
  hudRpm: $('hud-rpm'),
  etichetta: $('etichetta'),
  info: $<HTMLDialogElement>('info'),
  btnInfo: $('btn-info'),
}

export function setupTabs(onChange: (tab: string) => void) {
  const tabs = document.querySelectorAll<HTMLButtonElement>('.schede button')
  const open = (name: string) => {
    tabs.forEach((t) => t.classList.toggle('attiva', t.dataset.tab === name))
    document.querySelectorAll<HTMLElement>('.pane').forEach((p) => p.classList.toggle('attiva', p.dataset.pane === name))
    ui.pannello.classList.remove('chiuso')
    onChange(name)
  }
  tabs.forEach((t) => t.addEventListener('click', () => open(t.dataset.tab!)))
  return open
}

/** Formato numerico italiano. */
export const num = (v: number, d = 1) => v.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d })

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Oscilloscopio dei due sensori, scorrimento continuo. */
export function drawScope(cv: HTMLCanvasElement, a: Float32Array, b: Float32Array, head: number) {
  const dpr = Math.min(window.devicePixelRatio, 2)
  const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr)
  if (!w || !h) return
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
  const c = cv.getContext('2d')!
  c.clearRect(0, 0, w, h)
  let max = 0.5
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i]), Math.abs(b[i]))
  c.strokeStyle = '#1d2b38'
  c.lineWidth = 1
  c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke()
  const n = a.length
  const trace = (arr: Float32Array, col: string) => {
    c.strokeStyle = col
    c.lineWidth = 1.6 * dpr
    c.beginPath()
    for (let i = 0; i < n; i++) {
      const v = arr[(head + i) % n]
      const x = (i / (n - 1)) * w, y = h / 2 - (v / max) * (h / 2 - 4 * dpr)
      if (i) c.lineTo(x, y); else c.moveTo(x, y)
    }
    c.stroke()
  }
  trace(a, '#3fe0ff')
  trace(b, '#ffb21e')
  c.fillStyle = '#5b6b7a'
  c.font = `${11 * dpr}px ui-monospace, Menlo, monospace`
  c.fillText(`±${num(max, 2)} N`, 6 * dpr, 13 * dpr)
}
