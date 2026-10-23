import { MachineModel } from './model'

/** Scheda di una parte: nome e spiegazione mostrati nel pannello. */
export interface PartInfo {
  name: string
  text: string
  /** Dati tecnici; quelli marcati con indicativo: true non provengono da una fonte. */
  data?: { k: string; v: string; indicativo?: boolean }[]
}

/** Inquadratura: punto guardato, mezza larghezza da far stare nello schermo (m) e direzione da cui si guarda. */
export interface View {
  target: [number, number, number]
  halfWidth: number
  /** Direzione dal punto guardato verso la camera; predefinita da destra, in alto, davanti. */
  dir?: [number, number, number]
}

/** Una macchina dell'officina: modello 3D, ciclo di lavoro, pannello e fisica. */
export interface Machine {
  readonly id: string
  readonly name: string
  readonly subtitle: string
  /** Nome della prima scheda del pannello (es. Misura, Lavoro). */
  readonly workTab: string
  readonly model: MachineModel
  readonly parts: Record<string, PartInfo>
  /** Ordine delle parti nell'elenco. */
  readonly order: string[]
  /** Inquadratura iniziale. */
  readonly view: View
  /** Scena per macchine grandi: distanza massima della camera e nebbia (vicino, lontano), m; facoltativa. */
  readonly stage?: { maxDistance: number; fog: [number, number] }
  /** Inquadratura dedicata a un pezzo, usata quando lo si sceglie dall'elenco; facoltativa. */
  partView?(id: string): View | null
  /** Inquadratura chiesta dal ciclo mentre un pezzo lavora (null = vista libera); facoltativa. */
  cameraView?(): View | null
  /** Spiegazione della fisica (HTML statico). */
  readonly physicsText: string
  /** Vero mentre un ciclo è in corso: la selezione col tocco non cambia scheda. */
  readonly busy: boolean
  /** Costruisce il pannello di lavoro dentro pane. */
  mount(pane: HTMLElement): void
  /** Avanza animazioni e fisica. Restituisce true se la scena va ridisegnata. */
  update(dt: number, now: number, flows: boolean): boolean
  /** Aggiorna i testi del pannello; restituisce stato e dettaglio per l'HUD. */
  refresh(): { status: string; detail: string }
  /** Righe della tabella dei valori in tempo reale. */
  physics(): [string, string][]
  /** HTML aggiuntivo sotto la tabella della fisica (es. un diagramma); facoltativo. */
  physicsExtra?(): string
}

export const IND = '<span class="ind">indicativo</span>'
