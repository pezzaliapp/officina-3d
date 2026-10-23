/**
 * Formato "officina-3d-macchina", versione 1: una macchina descritta in JSON.
 *
 * Il file viene solo interpretato, mai eseguito: si legge con JSON.parse e ogni
 * campo viene controllato (tipo, intervallo, lunghezza) prima di costruire la
 * macchina. Quello che non è previsto dal formato viene scartato con un errore.
 * La documentazione per chi scrive i file è in docs/formato-macchina.md.
 */

export const FORMATO = 'officina-3d-macchina'
export const VERSIONE = 1

export type Vec3 = [number, number, number]
export type Vec2 = [number, number]

export type Forma =
  | { tipo: 'cilindro'; raggio: number; raggio_sopra?: number; altezza: number; segmenti?: number }
  | { tipo: 'scatola'; dimensioni: Vec3 }
  | { tipo: 'rivoluzione'; profilo: Vec2[]; segmenti?: number; angolo_inizio?: number; angolo_ampiezza?: number }
  | { tipo: 'tubo'; percorso: Vec3[]; raggio: number; chiuso?: boolean }
  | { tipo: 'estrusione'; contorno: Vec2[]; fori?: Vec2[][]; spessore: number }

export interface Pezzo {
  id: string
  nome: string
  forma: Forma
  /** m, nel sistema della macchina: y in alto, x lungo l'albero, z verso l'operatore. */
  posizione: Vec3
  /** Gradi, attorno a x, y e z in quest'ordine. */
  rotazione: Vec3
  materiale: string
  gruppo: string
  tavola?: number
  posizione_tavola?: number
  esploso: { direzione: Vec3; distanza: number; ordine: number }
  descrizione?: string
}

export interface Ricambio {
  tavola: number
  posizione: number
  codice: string
  descrizione: string
  descrizione_it: string
  quantita: number
}

export interface Materiale { colore: string; metallo: number; ruvidita: number }

export interface Simulazione {
  albero: { altezza_asse: number; faccia_flangia: number; inerzia: number }
  sensori: { a: number; b: number; rumore: number }
  encoder: { impulsi_giro: number }
  motore: { coppia_spunto: number; giri_a_vuoto: number; rapporto_cinghia: number; attrito_coulomb: number; attrito_viscoso: number }
  misura: { giri_misura: number; giri_acquisizione: number; arrotondamento: number; soglia_ok: number }
  calibro: { punta_x: number }
  carter: { cerniera: Vec2; angolo_alzato: number }
}

export interface MacchinaFile {
  formato: typeof FORMATO
  versione: typeof VERSIONE
  nome: string
  tipo: 'equilibratrice'
  dati_tecnici: { voce: string; valore: string; indicativo: boolean }[]
  materiali: Record<string, Materiale>
  tavole: { numero: number; titolo: string }[]
  pezzi: Pezzo[]
  ricambi: Ricambio[]
  simulazione: Simulazione
}

/** Gruppi con un significato per la simulazione; gli altri nomi sono liberi e restano fermi. */
export const GRUPPI_SPECIALI = ['albero', 'carter', 'calibro', 'sensori'] as const

/** Materiali già pronti; il file può aggiungerne altri in "materiali". */
export const MATERIALI_BASE = ['vernice', 'accento', 'acciaio', 'scuro', 'alluminio', 'gomma', 'plastica', 'grigio', 'scheda', 'ottone', 'rame', 'ceramica', 'giallo', 'schermo'] as const

/** Valori della simulazione quando il file non li dà: gli stessi dell'equilibratrice pubblica. */
export const SIMULAZIONE_BASE: Simulazione = {
  albero: { altezza_asse: 0.78, faccia_flangia: 0.22, inerzia: 0.03 },
  sensori: { a: -0.3, b: -0.1, rumore: 0.015 },
  encoder: { impulsi_giro: 0 },
  motore: { coppia_spunto: 3.0, giri_a_vuoto: 1450, rapporto_cinghia: 0.08 / 0.03, attrito_coulomb: 0.15, attrito_viscoso: 0.02 },
  misura: { giri_misura: 200, giri_acquisizione: 8, arrotondamento: 5, soglia_ok: 5 },
  calibro: { punta_x: 0.03 },
  carter: { cerniera: [-0.03, -0.43], angolo_alzato: -1.7 },
}

/** Limiti: un file più grande di così non è una macchina, è un errore (o un tentativo di bloccare l'app). */
export const LIMITI = {
  byte: 8 * 1024 * 1024,
  pezzi: 4000,
  ricambi: 10000,
  tavole: 500,
  puntiPerForma: 4000,
  puntiTotali: 400000,
  testo: 400,
  descrizione: 4000,
  coordinata: 20,
}

export class ErroreFormato extends Error {
  constructor(readonly errori: string[]) {
    super(errori.slice(0, 8).join('\n') + (errori.length > 8 ? `\n… e altri ${errori.length - 8} errori` : ''))
  }
}

type Obj = Record<string, unknown>

/**
 * Legge e controlla il testo di un file. Restituisce la macchina pronta da costruire
 * o lancia ErroreFormato con l'elenco dei problemi, in italiano.
 */
export function leggiMacchina(testo: string): MacchinaFile {
  if (testo.length > LIMITI.byte) throw new ErroreFormato([`File troppo grande: ${(testo.length / 1048576).toFixed(1)} MB, al massimo ${LIMITI.byte / 1048576} MB`])
  let dati: unknown
  try {
    dati = JSON.parse(testo)
  } catch (e) {
    throw new ErroreFormato([`Non è un file JSON valido: ${(e as Error).message}`])
  }
  return controlla(dati)
}

export function controlla(dati: unknown): MacchinaFile {
  const err: string[] = []
  let punti = 0
  const fail = (dove: string, cosa: string) => { if (err.length < 200) err.push(`${dove}: ${cosa}`) }

  const obj = (v: unknown, dove: string): Obj | null => {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Obj
    fail(dove, 'serve un oggetto'); return null
  }
  const arr = (v: unknown, dove: string, max: number): unknown[] => {
    if (!Array.isArray(v)) { fail(dove, 'serve un elenco'); return [] }
    if (v.length > max) { fail(dove, `troppi elementi (${v.length}, al massimo ${max})`); return [] }
    return v
  }
  const str = (v: unknown, dove: string, max = LIMITI.testo, vuota = false): string => {
    if (typeof v !== 'string') { fail(dove, 'serve un testo'); return '' }
    if (v.length > max) { fail(dove, `testo troppo lungo (al massimo ${max} caratteri)`); return '' }
    if (!vuota && !v.trim()) { fail(dove, 'testo vuoto'); return '' }
    return v
  }
  const num = (v: unknown, dove: string, min: number, max: number): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) { fail(dove, 'serve un numero'); return min }
    if (v < min || v > max) { fail(dove, `fuori intervallo (${min} … ${max})`); return Math.min(Math.max(v, min), max) }
    return v
  }
  const int = (v: unknown, dove: string, min: number, max: number) => {
    const n = num(v, dove, min, max)
    if (!Number.isInteger(n)) fail(dove, 'serve un numero intero')
    return Math.round(n)
  }
  const vec = <N extends 2 | 3>(v: unknown, dove: string, n: N, lim = LIMITI.coordinata): N extends 3 ? Vec3 : Vec2 => {
    const a = Array.isArray(v) && v.length === n ? v : (fail(dove, `servono ${n} numeri`), new Array(n).fill(0))
    return a.map((x: unknown, i: number) => num(x, `${dove}[${i}]`, -lim, lim)) as N extends 3 ? Vec3 : Vec2
  }
  const pts = <N extends 2 | 3>(v: unknown, dove: string, n: N, min: number) => {
    const a = arr(v, dove, LIMITI.puntiPerForma)
    if (a.length < min) fail(dove, `servono almeno ${min} punti`)
    punti += a.length
    return a.map((p, i) => vec(p, `${dove}[${i}]`, n))
  }
  const solo = (o: Obj, dove: string, chiavi: string[]) => {
    for (const k of Object.keys(o)) if (!chiavi.includes(k)) fail(dove, `campo sconosciuto "${k}"`)
  }
  const opz = <T>(o: Obj, k: string, f: (v: unknown) => T, def: T): T => (o[k] === undefined ? def : f(o[k]))

  const r = obj(dati, 'file')
  if (!r) throw new ErroreFormato(err)
  solo(r, 'file', ['formato', 'versione', 'nome', 'tipo', 'dati_tecnici', 'materiali', 'tavole', 'pezzi', 'ricambi', 'simulazione'])
  if (r.formato !== FORMATO) fail('formato', `deve essere "${FORMATO}"`)
  if (r.versione !== VERSIONE) fail('versione', `versione ${JSON.stringify(r.versione)} non supportata (questa app legge la ${VERSIONE})`)
  if (err.length) throw new ErroreFormato(err)

  const nome = str(r.nome, 'nome', 80)
  if (r.tipo !== 'equilibratrice') fail('tipo', 'per ora è supportato solo "equilibratrice"')

  const dati_tecnici = arr(r.dati_tecnici ?? [], 'dati_tecnici', 200).map((d, i) => {
    const o = obj(d, `dati_tecnici[${i}]`) ?? {}
    solo(o, `dati_tecnici[${i}]`, ['voce', 'valore', 'indicativo'])
    return { voce: str(o.voce, `dati_tecnici[${i}].voce`), valore: str(o.valore, `dati_tecnici[${i}].valore`), indicativo: opz(o, 'indicativo', (v) => v === true, true) }
  })

  // senza prototipo: un nome come "constructor" resta un nome qualsiasi
  const materiali: Record<string, Materiale> = Object.create(null)
  const mo = r.materiali === undefined ? {} : obj(r.materiali, 'materiali') ?? {}
  if (Object.keys(mo).length > 100) fail('materiali', 'troppi materiali (al massimo 100)')
  for (const [k, v] of Object.keys(mo).length <= 100 ? Object.entries(mo) : []) {
    const dove = `materiali.${k}`
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(k)) { fail(dove, 'nome non valido (lettere minuscole, cifre, - e _, senza _ iniziale)'); continue }
    const o = obj(v, dove) ?? {}
    solo(o, dove, ['colore', 'metallo', 'ruvidita'])
    const colore = str(o.colore, `${dove}.colore`, 7)
    if (colore && !/^#[0-9a-fA-F]{6}$/.test(colore)) fail(`${dove}.colore`, 'serve un colore come "#2f343c"')
    materiali[k] = { colore, metallo: num(o.metallo, `${dove}.metallo`, 0, 1), ruvidita: num(o.ruvidita, `${dove}.ruvidita`, 0, 1) }
  }

  const tavole = arr(r.tavole ?? [], 'tavole', LIMITI.tavole).map((t, i) => {
    const o = obj(t, `tavole[${i}]`) ?? {}
    solo(o, `tavole[${i}]`, ['numero', 'titolo'])
    return { numero: int(o.numero, `tavole[${i}].numero`, 0, 9999), titolo: str(o.titolo, `tavole[${i}].titolo`) }
  })

  const ids = new Set<string>()
  const pezzi = arr(r.pezzi, 'pezzi', LIMITI.pezzi).map((p, i): Pezzo => {
    const dove = `pezzi[${i}]`
    const o = obj(p, dove) ?? {}
    solo(o, dove, ['id', 'nome', 'forma', 'posizione', 'rotazione', 'materiale', 'gruppo', 'tavola', 'posizione_tavola', 'esploso', 'descrizione'])
    const id = str(o.id, `${dove}.id`, 60)
    if (id && !/^[A-Za-z0-9_.-]+$/.test(id)) fail(`${dove}.id`, 'solo lettere, cifre, punto, - e _')
    if (ids.has(id)) fail(`${dove}.id`, `"${id}" è già usato`)
    ids.add(id)
    const materiale = str(o.materiale, `${dove}.materiale`, 40)
    if (materiale && !(MATERIALI_BASE as readonly string[]).includes(materiale) && !materiali[materiale]) fail(`${dove}.materiale`, `materiale "${materiale}" non definito`)
    const gruppo = str(o.gruppo, `${dove}.gruppo`, 60)
    const eo = obj(o.esploso, `${dove}.esploso`) ?? {}
    solo(eo, `${dove}.esploso`, ['direzione', 'distanza', 'ordine'])
    const direzione = vec(eo.direzione, `${dove}.esploso.direzione`, 3, 1)
    if (Math.hypot(...direzione) < 1e-6 && eo.distanza !== 0) fail(`${dove}.esploso.direzione`, 'direzione nulla')
    const tav = o.tavola === undefined ? undefined : int(o.tavola, `${dove}.tavola`, 0, 9999)
    const pos = o.posizione_tavola === undefined ? undefined : int(o.posizione_tavola, `${dove}.posizione_tavola`, 0, 99999)
    if ((tav === undefined) !== (pos === undefined)) fail(dove, 'tavola e posizione_tavola vanno date insieme')
    return {
      id, nome: str(o.nome, `${dove}.nome`), forma: forma(o.forma, `${dove}.forma`),
      posizione: vec(o.posizione, `${dove}.posizione`, 3), rotazione: vec(opz(o, 'rotazione', (v) => v, [0, 0, 0]), `${dove}.rotazione`, 3, 3600),
      materiale, gruppo, tavola: tav, posizione_tavola: pos,
      esploso: { direzione, distanza: num(eo.distanza, `${dove}.esploso.distanza`, 0, 10), ordine: int(eo.ordine, `${dove}.esploso.ordine`, 0, 9999) },
      descrizione: o.descrizione === undefined ? undefined : str(o.descrizione, `${dove}.descrizione`, LIMITI.descrizione),
    }
  })
  if (!pezzi.length && !err.length) fail('pezzi', 'la macchina non ha pezzi')
  if (punti > LIMITI.puntiTotali) fail('pezzi', `troppi punti in tutto (${punti}, al massimo ${LIMITI.puntiTotali})`)

  function forma(v: unknown, dove: string): Forma {
    const o = obj(v, dove) ?? {}
    const lim = (x: unknown, d: string) => num(x, d, 0.0001, LIMITI.coordinata)
    switch (o.tipo) {
      case 'cilindro':
        solo(o, dove, ['tipo', 'raggio', 'raggio_sopra', 'altezza', 'segmenti'])
        return { tipo: 'cilindro', raggio: lim(o.raggio, `${dove}.raggio`), raggio_sopra: opz(o, 'raggio_sopra', (x) => num(x, `${dove}.raggio_sopra`, 0, LIMITI.coordinata), undefined), altezza: lim(o.altezza, `${dove}.altezza`), segmenti: opz(o, 'segmenti', (x) => int(x, `${dove}.segmenti`, 3, 128), undefined) }
      case 'scatola': {
        solo(o, dove, ['tipo', 'dimensioni'])
        const d = vec(o.dimensioni, `${dove}.dimensioni`, 3)
        d.forEach((x, i) => { if (x <= 0) fail(`${dove}.dimensioni[${i}]`, 'deve essere positiva') })
        return { tipo: 'scatola', dimensioni: d }
      }
      case 'rivoluzione': {
        solo(o, dove, ['tipo', 'profilo', 'segmenti', 'angolo_inizio', 'angolo_ampiezza'])
        const profilo = pts(o.profilo, `${dove}.profilo`, 2, 3)
        profilo.forEach(([rr], i) => { if (rr < 0) fail(`${dove}.profilo[${i}]`, 'il raggio non può essere negativo') })
        return {
          tipo: 'rivoluzione', profilo, segmenti: opz(o, 'segmenti', (x) => int(x, `${dove}.segmenti`, 3, 128), undefined),
          angolo_inizio: opz(o, 'angolo_inizio', (x) => num(x, `${dove}.angolo_inizio`, -360, 360), undefined),
          angolo_ampiezza: opz(o, 'angolo_ampiezza', (x) => num(x, `${dove}.angolo_ampiezza`, 1, 360), undefined),
        }
      }
      case 'tubo':
        solo(o, dove, ['tipo', 'percorso', 'raggio', 'chiuso'])
        return { tipo: 'tubo', percorso: pts(o.percorso, `${dove}.percorso`, 3, 2), raggio: lim(o.raggio, `${dove}.raggio`), chiuso: opz(o, 'chiuso', (x) => x === true, false) }
      case 'estrusione': {
        solo(o, dove, ['tipo', 'contorno', 'fori', 'spessore'])
        const fori = arr(o.fori ?? [], `${dove}.fori`, 200).map((f, i) => pts(f, `${dove}.fori[${i}]`, 2, 3))
        return { tipo: 'estrusione', contorno: pts(o.contorno, `${dove}.contorno`, 2, 3), fori, spessore: lim(o.spessore, `${dove}.spessore`) }
      }
      default:
        fail(`${dove}.tipo`, 'forma sconosciuta (cilindro, scatola, rivoluzione, tubo, estrusione)')
        return { tipo: 'scatola', dimensioni: [0.01, 0.01, 0.01] }
    }
  }

  const ricambi = arr(r.ricambi ?? [], 'ricambi', LIMITI.ricambi).map((x, i): Ricambio => {
    const dove = `ricambi[${i}]`
    const o = obj(x, dove) ?? {}
    solo(o, dove, ['tavola', 'posizione', 'codice', 'descrizione', 'descrizione_it', 'quantita'])
    return {
      tavola: int(o.tavola, `${dove}.tavola`, 0, 9999), posizione: int(o.posizione, `${dove}.posizione`, 0, 99999),
      codice: str(o.codice, `${dove}.codice`, 60), descrizione: str(o.descrizione, `${dove}.descrizione`, LIMITI.testo, true),
      descrizione_it: str(o.descrizione_it, `${dove}.descrizione_it`, LIMITI.testo, true), quantita: num(o.quantita, `${dove}.quantita`, 0, 100000),
    }
  })

  // simulazione: ogni valore mancante prende quello dell'equilibratrice pubblica
  const so = r.simulazione === undefined ? {} : obj(r.simulazione, 'simulazione') ?? {}
  solo(so, 'simulazione', Object.keys(SIMULAZIONE_BASE))
  const sez = <K extends keyof Simulazione>(k: K, campi: Record<keyof Simulazione[K], [number, number]>): Simulazione[K] => {
    const base = SIMULAZIONE_BASE[k] as Record<string, unknown>
    const o = so[k] === undefined ? {} : obj(so[k], `simulazione.${k}`) ?? {}
    solo(o, `simulazione.${k}`, Object.keys(campi))
    const out: Record<string, unknown> = {}
    for (const [c, [min, max]] of Object.entries(campi) as [string, [number, number]][]) {
      const d = `simulazione.${k}.${c}`
      out[c] = o[c] === undefined ? base[c] : Array.isArray(base[c]) ? vec(o[c], d, 2, max) : num(o[c], d, min, max)
    }
    return out as Simulazione[K]
  }
  const simulazione: Simulazione = {
    albero: sez('albero', { altezza_asse: [0.3, 2], faccia_flangia: [-1, 1], inerzia: [0.001, 5] }),
    sensori: sez('sensori', { a: [-2, 2], b: [-2, 2], rumore: [0, 1] }),
    encoder: sez('encoder', { impulsi_giro: [0, 100000] }),
    motore: sez('motore', { coppia_spunto: [0.1, 100], giri_a_vuoto: [100, 10000], rapporto_cinghia: [0.1, 50], attrito_coulomb: [0, 10], attrito_viscoso: [0, 5] }),
    misura: sez('misura', { giri_misura: [50, 1000], giri_acquisizione: [1, 100], arrotondamento: [1, 50], soglia_ok: [0, 50] }),
    calibro: sez('calibro', { punta_x: [-2, 2] }),
    carter: sez('carter', { cerniera: [-2, 2], angolo_alzato: [-3.2, 3.2] }),
  }
  if (simulazione.sensori.b - simulazione.sensori.a < 0.02) fail('simulazione.sensori', 'il sensore B deve stare almeno 2 cm verso la ruota rispetto ad A')
  if (simulazione.albero.faccia_flangia <= simulazione.sensori.b) fail('simulazione.albero.faccia_flangia', 'la flangia deve stare oltre il sensore B, verso la ruota')

  if (err.length) throw new ErroreFormato(err)
  return { formato: FORMATO, versione: VERSIONE, nome, tipo: 'equilibratrice', dati_tecnici, materiali, tavole, pezzi, ricambi, simulazione }
}
