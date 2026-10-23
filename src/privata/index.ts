import { Vector3 as THREE_V } from 'three'
import { Section } from '../core/section'
import type { PartInfo } from '../core/machine'
import { nav } from '../core/nav'
import { esc } from '../ui'
import { createEqMatch, EqMatch, TEXT } from '../eqmatch'
import { PARTS } from '../eqmatch/parts'
import { MACHINE } from '../eqmatch/physics'
import { PrivateModel, partOf, tagOf } from './model'
import type { MacchinaFile, Ricambio } from './format'

const PANE = `
  <div class="privata">
    <p class="solo-qui"><span aria-hidden="true">📱</span> Macchina privata: è solo su questo dispositivo, non viene inviata né salvata in rete.</p>
    <div class="riga">
      <label class="campo">Tavola <select data-id="p-tavola"></select></label>
    </div>
    <label class="spunta"><input data-id="p-etichette" type="checkbox" checked /> Etichette tavola · posizione</label>
    <label class="campo">Ricambi <input data-id="p-cerca" type="search" placeholder="Cerca per codice o descrizione" autocomplete="off" /></label>
    <p data-id="p-conta" class="legenda"></p>
    <div data-id="p-ricambi" class="ricambi" role="list"></div>
    <div data-id="p-dati" class="tabella"></div>
  </div>`

/** Quanti ricambi mostrare al massimo nell'elenco (la ricerca restringe). */
const MAX_RIGHE = 200

/**
 * Equilibratrice caricata da file: il modello viene dal file, misura e matching sono
 * quelli di EqMatch con i parametri della simulazione del file.
 */
export function createPrivateMachine(section: Section, file: MacchinaFile, key: string): EqMatch & { readonly privata: true; readonly model: PrivateModel } {
  const s = file.simulazione
  let pm!: PrivateModel

  // schede: una per voce di tavola, con i dati del catalogo ricambi
  const parts: Record<string, PartInfo> = { pneumatico: PARTS.pneumatico, cerchio: PARTS.cerchio, pesi: PARTS.pesi }
  const tavole = new Map(file.tavole.map((t) => [t.numero, t.titolo]))
  const catalogo = new Map<string, Ricambio[]>()
  for (const r of file.ricambi) {
    const k = `t${r.tavola}p${r.posizione}`
    catalogo.set(k, [...(catalogo.get(k) ?? []), r])
  }
  const order: string[] = ['pneumatico', 'cerchio', 'pesi']
  const sorted = [...file.pezzi].sort((a, b) => (a.tavola ?? 1e9) - (b.tavola ?? 1e9) || (a.posizione_tavola ?? 0) - (b.posizione_tavola ?? 0))
  for (const p of sorted) {
    const id = partOf(p)
    if (parts[id]) continue
    const rc = catalogo.get(id) ?? []
    const tag = tagOf(p)
    const name = (rc[0]?.descrizione_it || rc[0]?.descrizione || p.nome) + (tag ? ` (${tag})` : '')
    const where = p.tavola !== undefined ? `Tavola ${p.tavola}${tavole.get(p.tavola) ? ' · ' + tavole.get(p.tavola) : ''}, posizione ${p.posizione_tavola}.` : ''
    parts[id] = {
      name,
      text: [p.descrizione ?? '', where].filter(Boolean).join(' ') || p.nome,
      data: [
        ...rc.flatMap((r) => [
          { k: 'Codice', v: r.codice },
          ...(r.descrizione && r.descrizione !== r.descrizione_it ? [{ k: 'Descrizione originale', v: r.descrizione }] : []),
          { k: 'Quantità', v: String(r.quantita) },
        ]),
        { k: 'Gruppo', v: p.gruppo },
      ],
    }
    order.push(id)
  }

  const dati = file.dati_tecnici.map((d) => `<span>${esc(d.voce)}</span><span>${esc(d.valore)}${d.indicativo ? ' <span class="ind">indicativo</span>' : ''}</span>`).join('')
  const text = `<h3>${esc(file.nome)}</h3>
    <p>Macchina caricata da file e salvata solo su questo dispositivo. Il modello viene dal file; la misura e il matching sono quelli di EqMatch con i parametri della simulazione indicati nel file (albero, sensori, encoder, motore). Dove il file non li dà valgono quelli dell'equilibratrice pubblica, indicativi.</p>
    ${dati ? `<div class="tabella">${dati}</div>` : ''}${TEXT}`

  const m = createEqMatch(section, {
    id: key,
    name: file.nome,
    subtitle: 'solo su questo dispositivo',
    model: (screen) => (pm = new PrivateModel(section, screen, file)),
    layout: { sensorA: s.sensori.a, sensorB: s.sensori.b, flangeFace: s.albero.faccia_flangia },
    mc: {
      ...MACHINE,
      rpmMeasure: s.misura.giri_misura,
      measureRevs: s.misura.giri_acquisizione,
      roundTo: s.misura.arrotondamento,
      threshold: s.misura.soglia_ok,
      beltRatio: s.motore.rapporto_cinghia,
      motorStallTorque: s.motore.coppia_spunto,
      motorNoLoadRpm: s.motore.giri_a_vuoto,
      coulomb: s.motore.attrito_coulomb,
      viscous: s.motore.attrito_viscoso,
      rotorInertia: s.albero.inerzia,
      noise: s.sensori.rumore,
      encoderPulses: s.encoder.impulsi_giro,
      calTipX: s.calibro.punta_x,
      guardUp: s.carter.angolo_alzato,
    },
    parts,
    order,
    get view() {
      const b = pm.bounds
      const size = b.getSize(new THREE_V()), c = b.getCenter(new THREE_V())
      return { target: [c.x, c.y, c.z] as [number, number, number], halfWidth: Math.max(size.x, size.y) * 0.55 + 0.05 }
    },
    physicsText: text,
    partView: (id) => pm.viewOf(id),
    mountExtra(pane) {
      const box = document.createElement('div')
      box.innerHTML = PANE
      pane.append(box)
      const el: Record<string, HTMLElement> = {}
      box.querySelectorAll<HTMLElement>('[data-id]').forEach((e) => (el[e.dataset.id!] = e))

      const sel = el['p-tavola'] as HTMLSelectElement
      sel.append(new Option('Tutte le tavole', ''))
      const nums = [...new Set([...file.tavole.map((t) => t.numero), ...file.pezzi.flatMap((p) => (p.tavola !== undefined ? [p.tavola] : []))])].sort((a, b) => a - b)
      for (const n of nums) sel.append(new Option(`T${n}${tavole.get(n) ? ' · ' + tavole.get(n) : ''}`, String(n)))
      sel.value = pm.tavolaShown === null ? '' : String(pm.tavolaShown)
      sel.addEventListener('change', () => {
        pm.showTavola(sel.value === '' ? null : +sel.value)
        nav.select(null)
        const v = sel.value === '' ? null : pm.viewVisible()
        nav.frame(v ?? m.view)
      })

      const lab = el['p-etichette'] as HTMLInputElement
      lab.checked = pm.labelsShown
      lab.addEventListener('change', () => { pm.setLabels(lab.checked); nav.redraw() })

      const cerca = el['p-cerca'] as HTMLInputElement
      const list = el['p-ricambi']
      const draw = () => {
        const q = cerca.value.trim().toLowerCase()
        const t = sel.value === '' ? null : +sel.value
        const hits = file.ricambi.filter((r) => (t === null || r.tavola === t) && (!q || [r.codice, r.descrizione, r.descrizione_it, `t${r.tavola}·${r.posizione}`].some((v) => v.toLowerCase().includes(q))))
        list.replaceChildren()
        for (const r of hits.slice(0, MAX_RIGHE)) {
          const b = document.createElement('button')
          b.className = 'ricambio'
          b.setAttribute('role', 'listitem')
          const tag = document.createElement('b')
          tag.textContent = `T${r.tavola}·${r.posizione}`
          const cod = document.createElement('code')
          cod.textContent = r.codice
          const desc = document.createElement('span')
          desc.textContent = r.descrizione_it || r.descrizione
          const qt = document.createElement('small')
          qt.textContent = `× ${r.quantita}`
          b.append(tag, cod, desc, qt)
          const id = `t${r.tavola}p${r.posizione}`
          if (!pm.parts.has(id)) b.disabled = true
          b.addEventListener('click', () => {
            // il pezzo si vede con la sua tavola: gli altri pezzi non lo coprono
            if (pm.tavolaShown !== r.tavola) { sel.value = String(r.tavola); pm.showTavola(r.tavola); draw() }
            nav.select(id)
          })
          list.append(b)
        }
        el['p-conta'].textContent = file.ricambi.length
          ? `${hits.length} ricambi${hits.length > MAX_RIGHE ? `, i primi ${MAX_RIGHE}: restringi la ricerca` : ''}`
          : 'Il file non ha un catalogo ricambi.'
      }
      cerca.addEventListener('input', draw)
      sel.addEventListener('change', draw)
      draw()
      el['p-dati'].innerHTML = dati
    },
  })
  return Object.assign(m, { privata: true as const }) as EqMatch & { readonly privata: true; readonly model: PrivateModel }
}
