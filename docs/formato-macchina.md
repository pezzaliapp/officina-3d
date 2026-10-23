# Formato "officina-3d-macchina" · versione 1

Officina 3D può aprire una **macchina privata** da un file sul dispositivo (pulsante **＋ Carica macchina** accanto al menu delle macchine). Il file è un JSON in questo formato. Nel repository c'è solo il lettore e una macchina di prova inventata (`docs/esempi/equilibratrice-di-prova.json`); nessuna macchina privata.

Il file:

- viene letto come testo e interpretato con `JSON.parse`: **non viene mai eseguito**, e non può contenere codice, indirizzi da scaricare o modelli 3D esterni;
- viene controllato campo per campo (tipi, intervalli, lunghezze, campi sconosciuti): se qualcosa non va l'app mostra l'elenco degli errori e non carica nulla;
- viene salvato in IndexedDB del browser, **solo su questo dispositivo**. Non parte nessuna richiesta di rete, non finisce nella cache del service worker, non compare nell'indirizzo della pagina né nel titolo. Nel menu la macchina è segnata con 📱 *Solo su questo dispositivo*; **Rimuovi** la cancella.

Per tenere i propri file accanto al progetto senza rischiare di pubblicarli, mettili in una cartella `macchine-private/` o chiamali `*.macchina.json`: il `.gitignore` del repository li esclude entrambi.

## Struttura

```json
{
  "formato": "officina-3d-macchina",
  "versione": 1,
  "nome": "Equilibratrice di prova",
  "tipo": "equilibratrice",
  "dati_tecnici": [ … ],
  "materiali": { … },
  "tavole": [ … ],
  "pezzi": [ … ],
  "ricambi": [ … ],
  "simulazione": { … }
}
```

| Campo | Obbligatorio | Contenuto |
|---|---|---|
| `formato` | sì | sempre `"officina-3d-macchina"` |
| `versione` | sì | `1` |
| `nome` | sì | nome mostrato nel menu, al massimo 80 caratteri |
| `tipo` | sì | per ora solo `"equilibratrice"` |
| `dati_tecnici` | no | elenco di `{ "voce", "valore", "indicativo" }`; `indicativo` è vero se manca, così un dato senza fonte viene segnato come **indicativo** nell'interfaccia |
| `materiali` | no | materiali propri, oltre a quelli già pronti |
| `tavole` | no | elenco di `{ "numero", "titolo" }` delle tavole del catalogo |
| `pezzi` | sì | i pezzi della macchina |
| `ricambi` | no | catalogo ricambi |
| `simulazione` | no | collegamento alla misura; ogni valore mancante vale come nell'equilibratrice pubblica |

Unità: metri, gradi per le rotazioni dei pezzi, radianti solo per l'angolo del carter.

## Sistema di riferimento

Lo stesso dell'equilibratrice pubblica:

- **y** verso l'alto, pavimento a `y = 0`;
- **x** lungo l'albero, positivo verso la ruota; `x = 0` è il fianco del mobile da cui esce l'albero;
- **z** verso l'operatore.

L'asse dell'albero è la retta `y = altezza_asse`, `z = 0`. La ruota viene montata dalla simulazione con la faccia del cerchio sulla `faccia_flangia`.

## Pezzi

```json
{
  "id": "flangia",
  "nome": "Flangia",
  "forma": { "tipo": "rivoluzione", "profilo": [[0.02, 0.16], [0.085, 0.19], [0.085, 0.219], [0.02, 0.219]] },
  "posizione": [0, 0.78, 0],
  "rotazione": [0, 0, 0],
  "materiale": "alluminio",
  "gruppo": "albero",
  "tavola": 2,
  "posizione_tavola": 2,
  "esploso": { "direzione": [1, 0, 0], "distanza": 0.12, "ordine": 7 },
  "descrizione": "Testo libero per la scheda del pezzo."
}
```

| Campo | Contenuto |
|---|---|
| `id` | unico nel file; lettere, cifre, `.`, `-`, `_` |
| `nome` | nome del pezzo (la scheda usa la `descrizione_it` del ricambio, se c'è) |
| `forma` | una delle forme qui sotto |
| `posizione` | `[x, y, z]` del pezzo, nel sistema della macchina |
| `rotazione` | `[rx, ry, rz]` in gradi, applicate in quest'ordine (facoltativa) |
| `materiale` | un materiale già pronto o uno di `materiali` |
| `gruppo` | nome libero; quattro nomi sono collegati alla simulazione (vedi sotto) |
| `tavola`, `posizione_tavola` | numero della tavola e della posizione nel catalogo: danno l'etichetta **T5·12** con la linea di richiamo. Vanno dati insieme; i pezzi con la stessa tavola e posizione si scelgono insieme e hanno una scheda sola |
| `esploso` | `direzione` (`[x, y, z]`, viene normalizzata), `distanza` (m) e `ordine` (intero) |
| `descrizione` | facoltativa, per la scheda del pezzo |

### Forme

| `tipo` | Campi | Note |
|---|---|---|
| `cilindro` | `raggio`, `altezza`, `raggio_sopra`?, `segmenti`? | asse lungo y, centrato su `posizione`; con `raggio_sopra` diventa un tronco di cono |
| `scatola` | `dimensioni: [lx, ly, lz]` | centrata su `posizione` |
| `rivoluzione` | `profilo: [[r, x], …]`, `segmenti`?, `angolo_inizio`?, `angolo_ampiezza`? | profilo nel piano (raggio, x) fatto ruotare attorno all'asse x; si chiude da solo. Con gli angoli diventa un settore: 0° verso l'operatore (+z), 90° verso il basso, −90° verso l'alto |
| `tubo` | `percorso: [[x, y, z], …]`, `raggio`, `chiuso`? | tubo lungo una curva che passa per i punti (cavi, cinghie, tubi dell'aria) |
| `estrusione` | `contorno: [[u, v], …]`, `fori`?: `[[[u, v], …], …]`, `spessore` | lastra: il contorno sta nel piano xy del pezzo e viene estruso lungo +z dello `spessore`; con `rotazione` si orienta (per esempio `[0, 90, 0]` mette la lastra nel piano yz) |

Limiti: al massimo 4000 pezzi, 4000 punti per forma, 400 000 punti in tutto, coordinate entro ±20 m, file da 8 MB.

### Materiali

Già pronti: `vernice`, `accento`, `acciaio`, `scuro`, `alluminio`, `gomma`, `plastica`, `grigio`, `scheda`, `ottone`, `rame`, `ceramica`, `giallo`, `schermo`.

`schermo` mostra il display della console con i grammi, come nella macchina pubblica. Su una `scatola` il display sta sulla faccia verso l'operatore (+z) e le altre facce sono scure.

Materiali propri, in `materiali`:

```json
"materiali": { "blu-prova": { "colore": "#2d5fa8", "metallo": 0.3, "ruvidita": 0.45 } }
```

### Gruppi collegati alla simulazione

| `gruppo` | Cosa fa |
|---|---|
| `albero` | gira con la ruota: albero, flangia, puleggia, disco dell'encoder |
| `carter` | ruota sulla cerniera del carter: si abbassa per la misura e si alza dopo |
| `calibro` | scorre lungo x durante il rilievo, finché la punta tocca il cerchio da dentro |
| `sensori` | i pezzi si illuminano con la forza letta: quelli più vicini a `sensori.a` col sensore A, gli altri col B |

Tutti gli altri gruppi restano fermi. Il controllo di compenetrazione vale anche qui: se un pezzo entra nella ruota di più di 2 mm, l'app lo segnala in console e nel pannello Fisica.

### Smontaggio

Il cursore **Smontaggio** attraversa gli ordini uno dopo l'altro, dal più piccolo al più grande. I pezzi con lo stesso `ordine` si muovono insieme, ciascuno lungo la sua `direzione` per la sua `distanza`; il gruppo successivo parte quando il precedente è arrivato. La ruota viene tolta per prima. Per i pezzi del gruppo `albero` la direzione gira con l'albero: conviene usare `[1, 0, 0]` o `[-1, 0, 0]`.

## Catalogo ricambi

```json
{ "tavola": 3, "posizione": 1, "codice": "PR-3001", "descrizione": "Driven pulley", "descrizione_it": "Puleggia condotta", "quantita": 1 }
```

`descrizione` è quella originale del catalogo (anche in un'altra lingua), `descrizione_it` quella italiana; una delle due può essere vuota. Nel pannello **Misura** l'elenco ricambi si filtra per tavola e si cerca per codice, descrizione o `T3·1`. Toccando un ricambio si apre la scheda del pezzo e la vista lo inquadra.

## Simulazione

Collega il modello alla misura e al matching di EqMatch, che funzionano come nella macchina pubblica: rilievo col calibro, lancio, misura, pesi, matching con SmontMatch e misura di verifica.

```json
"simulazione": {
  "albero":  { "altezza_asse": 0.78, "faccia_flangia": 0.22, "inerzia": 0.03 },
  "sensori": { "a": -0.3, "b": -0.1, "rumore": 0.015 },
  "encoder": { "impulsi_giro": 512 },
  "motore":  { "coppia_spunto": 3.0, "giri_a_vuoto": 1450, "rapporto_cinghia": 2.79, "attrito_coulomb": 0.15, "attrito_viscoso": 0.02 },
  "misura":  { "giri_misura": 200, "giri_acquisizione": 8, "arrotondamento": 5, "soglia_ok": 5 },
  "calibro": { "punta_x": 0.03 },
  "carter":  { "cerniera": [-0.03, -0.43], "angolo_alzato": -1.7 }
}
```

| Valore | Significato | Pubblica |
|---|---|---|
| `albero.altezza_asse` | altezza dell'asse da terra, m | 0,78 |
| `albero.faccia_flangia` | x della faccia d'appoggio del cerchio, m | 0,22 |
| `albero.inerzia` | inerzia di albero, flangia e puleggia, kg·m² | 0,03 |
| `sensori.a`, `sensori.b` | x dei due sensori di forza (appoggi della trave), m; B più vicino alla ruota | −0,30 / −0,10 |
| `sensori.rumore` | rumore del segnale, N | 0,015 |
| `encoder.impulsi_giro` | impulsi per giro; la fase si legge a gradini di un impulso (0 = senza gradini) | 0 |
| `motore.coppia_spunto` | coppia del motore da fermo, N·m all'albero motore | 3,0 |
| `motore.giri_a_vuoto` | giri/min del motore senza carico | 1450 |
| `motore.rapporto_cinghia` | rapporto tra le pulegge | 2,67 |
| `motore.attrito_coulomb`, `attrito_viscoso` | attriti dei cuscinetti, N·m e N·m·s | 0,15 / 0,02 |
| `misura.giri_misura` | velocità di misura, giri/min | 200 |
| `misura.giri_acquisizione` | giri su cui si mediano i segnali | 8 |
| `misura.arrotondamento` | passo dei pesi mostrati, g | 5 |
| `misura.soglia_ok` | sotto questo valore il display mostra OK, g | 5 |
| `calibro.punta_x` | x della punta del calibro a riposo, m | 0,03 |
| `carter.cerniera` | cerniera del carter rispetto all'asse, `[y, z]`, m | [−0,03, −0,43] |
| `carter.angolo_alzato` | rotazione del carter alzato attorno alla cerniera, rad | −1,7 |

Tutti questi valori, nella macchina pubblica come nell'esempio, sono **indicativi**: non vengono da una scheda tecnica.

## Esempio completo

`docs/esempi/equilibratrice-di-prova.json` è una macchina inventata e generica, senza marchi: 38 pezzi su 5 tavole (mobile, gruppo oscillante, motore e trasmissione, carter e calibro, console) e 31 ricambi. Usa tutte e cinque le forme, i quattro gruppi collegati, un materiale proprio e il display. Un frammento:

```json
{
  "formato": "officina-3d-macchina",
  "versione": 1,
  "nome": "Equilibratrice di prova",
  "tipo": "equilibratrice",
  "dati_tecnici": [{ "voce": "Diametro cerchi", "valore": "14\" … 18\"", "indicativo": true }],
  "tavole": [{ "numero": 3, "titolo": "Motore e trasmissione" }],
  "pezzi": [
    {
      "id": "motore", "nome": "Motore",
      "forma": { "tipo": "rivoluzione", "profilo": [[0, -0.6], [0.065, -0.6], [0.065, -0.4], [0, -0.4]] },
      "posizione": [0, 0.36, 0.12], "materiale": "grigio", "gruppo": "trasmissione",
      "tavola": 3, "posizione_tavola": 3,
      "esploso": { "direzione": [0, 0, 1], "distanza": 0.35, "ordine": 4 }
    }
  ],
  "ricambi": [
    { "tavola": 3, "posizione": 3, "codice": "PR-3003", "descrizione": "Motor", "descrizione_it": "Motore", "quantita": 1 }
  ]
}
```

`npm run verifica` legge l'esempio, prova a caricare dieci file sbagliati (non JSON, formato o versione diversi, campi sconosciuti, numeri fuori scala, forme non previste, id ripetuti, nomi come `__proto__`, troppi punti) e controlla che vengano tutti rifiutati. Poi esegue smontaggio, tavole, misura e matching completo sulla macchina di prova, con ogni accesso alla rete trattato come errore.
