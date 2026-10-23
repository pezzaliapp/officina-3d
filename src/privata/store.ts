/**
 * Archivio delle macchine private: IndexedDB del browser, solo su questo dispositivo.
 * Il testo del file resta com'è stato caricato e viene riletto (e ricontrollato) a ogni avvio.
 */

export interface Salvata {
  /** Chiave locale, mai mostrata nell'indirizzo della pagina. */
  id: string
  nome: string
  testo: string
  caricata: number
}

const DB = 'officina-3d-private'
const STORE = 'macchine'

function apri(): Promise<IDBDatabase> {
  return new Promise((ok, ko) => {
    if (typeof indexedDB === 'undefined') return ko(new Error('Questo browser non ha IndexedDB: le macchine private non si possono salvare'))
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }) }
    req.onsuccess = () => ok(req.result)
    req.onerror = () => ko(req.error ?? new Error('IndexedDB non disponibile'))
  })
}

async function op<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await apri()
  try {
    return await new Promise<T>((ok, ko) => {
      const tx = db.transaction(STORE, mode)
      const req = f(tx.objectStore(STORE))
      tx.oncomplete = () => ok(req.result)
      tx.onerror = tx.onabort = () => ko(tx.error ?? req.error ?? new Error('Operazione su IndexedDB non riuscita'))
    })
  } finally {
    db.close()
  }
}

export const elenco = () => op<Salvata[]>('readonly', (s) => s.getAll() as IDBRequest<Salvata[]>).then((l) => l.sort((a, b) => a.caricata - b.caricata))
export const salva = (m: Salvata) => op('readwrite', (s) => s.put(m)).then(() => m)
export const rimuovi = (id: string) => op('readwrite', (s) => s.delete(id)).then(() => undefined)

/** Chiave nuova: casuale, così non dice nulla della macchina. */
export function nuovaChiave() {
  const b = new Uint8Array(8)
  crypto.getRandomValues(b)
  return 'privata-' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}
