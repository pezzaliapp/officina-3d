/**
 * Fisica del sollevatore a due colonne elettromeccanico.
 *
 * Ogni colonna ha una vite trapezia verticale che gira e una madrevite portante,
 * fissata al carrello, che sale lungo la vite. Sotto la portante, a pochi millimetri,
 * corre una madrevite di sicurezza: non porta niente finché la portante è sana.
 * Il motore muove la vite attraverso una cinghia e una coppia di ingranaggi.
 *
 * Tutti i valori sono indicativi: dati plausibili di un sollevatore da 3,5 t, non presi
 * da una scheda tecnica.
 */

export const G = 9.81

/** Dati della macchina (indicativi). */
export const SPEC = {
  /** Portata, kg. */
  portata: 3500,
  /** Carico massimo per braccio, kg (ripartizione 3:2 sulla portata). */
  braccioMax: 1050,
  /** Vite trapezia Tr 36 × 6, un principio. */
  viteD: 0.036,
  passo: 0.006,
  /** Coefficiente d'attrito acciaio su bronzo lubrificato. */
  mu: 0.1,
  /** Mezzo angolo del filetto trapezio, rad. */
  semiAngolo: (15 * Math.PI) / 180,
  /** Cuscinetto reggispinta: coppia d'attrito per newton di carico, N·m/N. */
  reggispinta: 0.00004,
  /** Motore asincrono 4 poli: potenza e giri nominali, giri di sincronismo. */
  motoreP: 2200,
  motoreN: 1420,
  motoreN0: 1500,
  rendMotore: 0.82,
  /** Trasmissione: cinghia (puleggia 70/35 mm) e ingranaggi (30/12 denti). */
  rapportoCinghia: 2,
  rapportoIngranaggi: 2.5,
  rendCinghia: 0.96,
  rendIngranaggi: 0.97,
  /** Massa di carrello e due bracci per colonna, kg. */
  massaCarrello: 180,
  /** Corsa del carrello, m, e distanza tra madrevite portante e di sicurezza, m. */
  corsa: 1.83,
  giocoSicurezza: 0.008,
  /** Dislivello ammesso tra i carrelli prima che il quadro fermi il più veloce, m. */
  dislivelloMax: 0.003,
}

/** Diametro medio, angolo d'elica e angolo d'attrito apparente della vite. */
export function vite() {
  const d2 = SPEC.viteD - SPEC.passo / 2
  const lambda = Math.atan(SPEC.passo / (Math.PI * d2))
  const phi = Math.atan(SPEC.mu / Math.cos(SPEC.semiAngolo))
  return { d2, lambda, phi, rendimento: Math.tan(lambda) / Math.tan(lambda + phi), autobloccante: lambda < phi }
}

/** Coppia sulla vite per sollevare (o, in discesa, per trascinare) il carico F, N·m. */
export function coppiaVite(F: number, salita: boolean) {
  const { d2, lambda, phi } = vite()
  const filetto = (F * d2) / 2 * Math.tan(salita ? lambda + phi : phi - lambda)
  return filetto + F * SPEC.reggispinta
}

export const RAPPORTO = SPEC.rapportoCinghia * SPEC.rapportoIngranaggi
export const REND_TRASM = SPEC.rendCinghia * SPEC.rendIngranaggi
/** Coppia nominale del motore, N·m. */
export const COPPIA_NOM = SPEC.motoreP / ((SPEC.motoreN * Math.PI) / 30)

/** Motore asincrono nel tratto lineare: lo scorrimento cresce con la coppia. */
export function motore(coppiaVite: number) {
  const T = coppiaVite / (RAPPORTO * REND_TRASM)
  const s0 = (SPEC.motoreN0 - SPEC.motoreN) / SPEC.motoreN0
  const n = SPEC.motoreN0 * (1 - (s0 * T) / COPPIA_NOM)
  const omega = (n * Math.PI) / 30
  return { T, n, potenza: T * omega, assorbita: (T * omega) / SPEC.rendMotore }
}

/** Velocità del carrello con il motore al numero di giri n, m/s. */
export const velocita = (n: number) => (n / 60 / RAPPORTO) * SPEC.passo

/** Un'auto generica: dimensioni, masse e punti di sollevamento (sistema dell'auto: origine a terra sotto il baricentro, davanti verso −z). */
export interface Auto {
  id: string
  label: string
  massa: number
  lunghezza: number
  larghezza: number
  altezza: number
  passo: number
  carreggiata: number
  ruotaR: number
  ruotaL: number
  /** Altezza da terra del sottoscocca (dove appoggiano i tamponi), m. */
  sottoscocca: number
  /** Distanza del baricentro dall'asse anteriore, m. */
  a: number
  /** Baricentro: spostamento laterale e altezza, m. */
  xcg: number
  ycg: number
  /** Sbalzo anteriore, m. */
  sbalzo: number
  /** Il vano di carico è davanti (motore posteriore) o dietro. */
  bagagliaioDavanti: boolean
}

const auto = (o: Omit<Auto, 'a'> & { quotaAnt: number }): Auto => ({ ...o, a: o.passo * (1 - o.quotaAnt) })

export const AUTO: Auto[] = [
  auto({ id: 'anteriore', label: 'Berlina, motore anteriore', massa: 1450, lunghezza: 4.5, larghezza: 1.8, altezza: 1.45, passo: 2.7, carreggiata: 1.55, ruotaR: 0.315, ruotaL: 0.205, sottoscocca: 0.15, quotaAnt: 0.6, xcg: 0.02, ycg: 0.55, sbalzo: 0.9, bagagliaioDavanti: false }),
  auto({ id: 'posteriore', label: 'Coupé, motore posteriore', massa: 1400, lunghezza: 4.2, larghezza: 1.78, altezza: 1.35, passo: 2.45, carreggiata: 1.5, ruotaR: 0.32, ruotaL: 0.225, sottoscocca: 0.14, quotaAnt: 0.4, xcg: 0, ycg: 0.5, sbalzo: 0.85, bagagliaioDavanti: true }),
  auto({ id: 'suv', label: 'SUV', massa: 2300, lunghezza: 4.7, larghezza: 1.9, altezza: 1.75, passo: 2.82, carreggiata: 1.62, ruotaR: 0.37, ruotaL: 0.235, sottoscocca: 0.21, quotaAnt: 0.53, xcg: -0.03, ycg: 0.72, sbalzo: 0.95, bagagliaioDavanti: false }),
]

/** Punti di sollevamento dell'auto nel suo sistema: dietro le ruote anteriori e davanti alle posteriori, sotto i longheroni. */
export function puntiAuto(c: Auto) {
  const dz = c.ruotaR + 0.15
  return { zAnt: -c.a + dz, zPost: c.passo - c.a - dz, x: c.larghezza / 2 - 0.18 }
}

/** Baricentro e peso con il carico aggiunto nel vano (sistema dell'auto). */
export function baricentro(c: Auto, carico: number) {
  const zc = c.bagagliaioDavanti ? -c.a - 0.25 : c.passo - c.a + 0.45
  const m = c.massa + carico
  return { m, z: (carico * zc) / m, x: (c.massa * c.xcg) / m, y: (c.massa * c.ycg + carico * 0.6) / m }
}

/**
 * Ripartizione del peso sui quattro tamponi: equilibrio di forze e momenti con la regola
 * della leva, avanti–dietro e poi sinistra–destra (auto rigida, appoggi alla stessa quota).
 */
export function carichi(m: number, zcg: number, xcg: number, zAnt: number, zPost: number, xp: number) {
  const W = m * G
  const ant = (W * (zPost - zcg)) / (zPost - zAnt)
  const post = W - ant
  const sx = (xp - xcg) / (2 * xp)
  return { as: ant * sx, ad: ant * (1 - sx), ps: post * sx, pd: post * (1 - sx), ant, post }
}
