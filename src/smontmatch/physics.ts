/**
 * Fisica dello smontagomme.
 *
 * Tre fenomeni guidano il ciclo:
 *  - pneumatica: la forza di un cilindro è F = p · A, poi moltiplicata o ridotta
 *    dalle leve (equilibrio dei momenti attorno al perno);
 *  - trasmissione: motore → cinghia → riduttore a vite senza fine → piatto;
 *    la coppia disponibile al piatto è C = η · P / ω;
 *  - gonfiaggio: l'aria entra nel pneumatico (volume quasi costante) e, a
 *    temperatura costante, la pressione cresce con la massa d'aria immessa.
 *
 * Tutti i parametri della macchina sono valori indicativi.
 */
import { WheelSpec, wheelGeometry } from '../core/wheel'

export const BAR = 1e5
export const P_ATM = 1.013 // bar assoluti

export const SPEC = {
  linePressure: 10, // bar relativi
  beadCylBore: 0.2, // m
  jawCylBore: 0.07, // m, due cilindri
  motorPower: 1100, // W
  motorRpm: 1400,
  beltRatio: 70 / 25,
  wormTeeth: 72, // vite a un principio
  wormEfficiency: 0.55,
  /** Velocità del piatto nel ciclo: seconda velocità, motore a doppia polarità (2800 giri/min / 201,6). */
  turntableRpm: 14,
  /** Coppia resistente mentre il tallone scorre sull'utensile. */
  peelTorque: 220, // N·m
  /** Portata dell'erogatore: coefficiente della legge di efflusso semplificata. */
  flowCoeff: 0.55e-3, // m³/s per bar (riferita all'aria ambiente)
  workPressure: 2.4, // bar
  safetyLimit: 3.5, // bar
  cylTau: 0.45, // s, riempimento del cilindro
}

/** Resistenza allo stallonamento e pressione di tallonamento per misura (indicative). */
export function tireData(w: WheelSpec) {
  const k = { s: 0.8, m: 1, l: 1.15 }[w.id as 's' | 'm' | 'l'] ?? 1
  const { rimR, tireR, tireW } = wheelGeometry(w)
  // Volume d'aria: anello tra cerchio e battistrada, ridotto per la forma bombata.
  const volume = Math.PI * (tireR ** 2 - rimR ** 2) * tireW * 0.85
  return {
    breakForce: 5200 * k, // N
    breakTravel: 0.022, // m, schiacciamento del fianco prima che il tallone si stacchi
    seatPressure: 1.6 + 0.3 * k, // bar
    volume, // m³
  }
}

export const area = (bore: number) => (Math.PI * bore * bore) / 4

/** Riduzione totale motore → piatto. */
export const reduction = () => SPEC.beltRatio * SPEC.wormTeeth

/** Coppia disponibile al piatto alla velocità di lavoro. */
export function turntableTorque() {
  const omega = (SPEC.turntableRpm * Math.PI) / 30
  return (SPEC.wormEfficiency * SPEC.motorPower) / omega
}

/** Forza totale di serraggio delle griffe (due cilindri) ripartita su quattro griffe. */
export function jawForce(p: number) {
  return (2 * p * BAR * area(SPEC.jawCylBore)) / 4
}

/**
 * Portata d'aria verso il pneumatico, riferita all'aria ambiente (m³/s).
 * Legge di efflusso semplificata per orifizi: Q ∝ √(p1² − p2²) con pressioni assolute.
 */
export function inflowRate(pTire: number) {
  const p1 = SPEC.linePressure + P_ATM, p2 = pTire + P_ATM
  return p1 > p2 ? SPEC.flowCoeff * Math.sqrt(p1 * p1 - p2 * p2) : 0
}

/** Aumento di pressione in un volume chiuso, isoterma: dp = p_atm · dV_amb / V. */
export const pressureRise = (q: number, dt: number, volume: number) => (P_ATM * q * dt) / volume
