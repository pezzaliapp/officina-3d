/**
 * Navigazione tra le macchine senza passare per l'indirizzo della pagina:
 * main.ts la collega all'apertura delle macchine (le macchine private non
 * finiscono mai nell'hash). Senza main (verifica automatica) cambia solo l'hash.
 */
import type { View } from './machine'

export const nav = {
  open(id: string) { location.hash = id },
  /** Sceglie un pezzo come se lo si toccasse (scheda e inquadratura). */
  select(_id: string | null) {},
  /** Porta la camera su un'inquadratura. */
  frame(_v: View) {},
}
