/**
 * Stato condiviso tra EqMatch e SmontMatch: la stessa ruota passa dall'equilibratrice
 * allo smontagomme e ritorno.
 *
 * Angoli nel sistema della ruota: rotazione attorno all'asse X da +y verso +z,
 * la stessa convenzione dei vettori di squilibrio (parte reale = +y, immaginaria = +z).
 * Il pneumatico ha un suo sistema, girato di theta rispetto a quello del cerchio:
 * un punto del pneumatico all'angolo a sta all'angolo a + theta sul cerchio.
 */

export interface Vec { re: number; im: number }
export interface Planes { int: Vec; est: Vec }

/** Angolo della valvola nel sistema del cerchio (dove la disegna wheelMeshes). */
export const VALVE = 2.4
const TAU = Math.PI * 2
export const wrapAngle = (a: number) => a - TAU * Math.round(a / TAU)

/** Segni del marcatore: sul cerchio (sistema del cerchio) e sul pneumatico (sistema del pneumatico). */
export interface Marks { rim: number; tire: number }

/** Richiesta di rotazione del pneumatico sul cerchio, da EqMatch a SmontMatch. */
export interface MatchRequest {
  /** 'm2': mezzo giro per la seconda misura; 'ottimale': rotazione calcolata dal matching. */
  reason: 'm2' | 'ottimale'
  marks: Marks
  /** Vero quando lo smontagomme ha allineato i segni e rigonfiato la ruota. */
  done: boolean
}

export const match = {
  /** Misura della ruota (id di WHEELS). */
  wheel: 'm',
  /** Squilibri nascosti di cerchio e pneumatico per piano, kg·m, ciascuno nel proprio sistema. */
  rim: { int: { re: 0, im: 0 }, est: { re: 0, im: 0 } } as Planes,
  tire: { int: { re: 0, im: 0 }, est: { re: 0, im: 0 } } as Planes,
  /** Angolo del pneumatico sul cerchio, rad. */
  theta: 0,
  /** Segno di riferimento fatto sul pneumatico (sistema del pneumatico), allineato alla valvola; null se non c'è. */
  ref: null as number | null,
  /** Segno da allineare alla valvola, se il matching l'ha calcolato. */
  target: null as number | null,
  request: null as MatchRequest | null,
  /** Macchina che ha chiesto la rotazione e a cui torna la ruota dallo smontagomme. */
  owner: 'eqmatch',
  ownerName: 'EqMatch',
  /** Cresce a ogni cambiamento: chi apre la macchina capisce se deve rileggere lo stato. */
  version: 0,
}

/** Angolo di cui ruotare il pneumatico sul cerchio per portare il segno del pneumatico su quello del cerchio. */
export const turnFor = (m: Marks, theta = match.theta) => wrapAngle(m.rim - m.tire - theta)

/** Segni per il mezzo giro quando EqMatch non ha mandato richieste: valvola e punto opposto del pneumatico. */
export const halfTurnMarks = (theta = match.theta): Marks => ({ rim: VALVE, tire: wrapAngle(VALVE - theta + Math.PI) })

export const touch = () => { match.version++ }
