import { MachineModel } from './model'

/** Scheda di una parte: nome e spiegazione mostrati nel pannello. */
export interface PartInfo {
  name: string
  text: string
  /** Dati tecnici; quelli marcati con indicativo: true non provengono da una fonte. */
  data?: { k: string; v: string; indicativo?: boolean }[]
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
  /** Inquadratura: punto guardato e mezza larghezza da far stare nello schermo, m. */
  readonly view: { target: [number, number, number]; halfWidth: number }
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
