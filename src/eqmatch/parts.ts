import type { PartInfo } from '../core/machine'

/** Schede delle parti dell'equilibratrice. */
export const PARTS: Record<string, PartInfo> = {
  mobile: {
    name: 'Mobile',
    text: 'La carrozzeria in lamiera piegata e verniciata chiude la meccanica e la protegge dalla polvere dell\'officina. Sul fianco esce l\'albero; sui fianchi sono montati i perni portaconi.',
    data: [
      { k: 'Ingombro mobile (L×P×H)', v: '620 × 600 × 960 mm', indicativo: true },
      { k: 'Lamiera', v: 'acciaio 1,2 mm', indicativo: true },
    ],
  },
  telaio: {
    name: 'Telaio interno',
    text: 'Due piastre verticali reggono il gruppo oscillante. Devono essere molto rigide: ogni loro cedimento falserebbe la forza letta dai sensori.',
  },
  console: {
    name: 'Console e display',
    text: 'Mostra i grammi da applicare sul piano interno ed esterno e guida il posizionamento: quando la ruota è nella posizione giusta l\'indicatore diventa verde e il peso va messo a ore 12.',
  },
  vaschetta: {
    name: 'Vaschetta portapesi',
    text: 'Scomparti per i pesi a molla e adesivi, in genere a passi di 5 g, più pinza e martello.',
  },
  carter: {
    name: 'Carter di protezione',
    text: 'Copre la ruota durante il lancio. Su molte macchine abbassarlo avvia la misura e alzarlo durante la rotazione attiva il freno: è un dispositivo di sicurezza, non solo un riparo.',
  },
  pneumatico: {
    name: 'Pneumatico',
    text: 'La sigla sul fianco dà le dimensioni: in 205/55 R16 la larghezza è 205 mm, l\'altezza del fianco è il 55% della larghezza (112,75 mm) e il cerchio è da 16 pollici. Le disuniformità di massa della gomma sono una delle cause principali dello squilibrio. Nel matching si segna sul fianco esterno: bianco il riferimento allineato alla valvola, giallo il punto da portare sul segno del cerchio.',
  },
  cerchio: {
    name: 'Cerchio',
    text: 'I pesi a molla si agganciano alle balconate interna ed esterna: sono i due piani di correzione. L\'offset ET è la distanza tra il centro del canale e la faccia di appoggio sul mozzo. Per il matching si segna la balconata esterna alla valvola (segno giallo): è il riferimento degli angoli di cerchio e pneumatico.',
  },
  ghiera: {
    name: 'Ghiera rapida',
    text: 'Serra la ruota contro la flangia. Le ghiere rapide hanno una chiocciola a sgancio che evita di avvitarla per tutta la lunghezza del filetto.',
  },
  cono: {
    name: 'Cono di centraggio',
    text: 'Entra nel foro centrale del cerchio e lo centra sull\'albero. Un centraggio sbagliato di pochi decimi produce uno squilibrio falso: è l\'errore più frequente in officina.',
  },
  flangia: {
    name: 'Flangia',
    text: 'Superficie di appoggio della faccia del cerchio. È rettificata e perpendicolare all\'albero, così la ruota gira senza sbandamento.',
  },
  albero: {
    name: 'Albero principale',
    text: 'Porta la ruota ed è filettato in punta per la ghiera. Ruota su cuscinetti dentro il cannotto e trasmette ai sensori le forze centrifughe dello squilibrio.',
    data: [
      { k: 'Diametro albero', v: '40 mm', indicativo: true },
      { k: 'Filetto', v: '36 × 3 mm', indicativo: true },
    ],
  },
  cannotto: {
    name: 'Gruppo oscillante',
    text: 'Il cannotto contiene i cuscinetti dell\'albero ed è appoggiato al telaio solo attraverso i due sensori: così tutta la forza dello squilibrio passa da loro.',
  },
  sensori: {
    name: 'Sensori piezoelettrici A e B',
    text: 'Un cristallo piezoelettrico compresso produce una tensione proporzionale alla forza. I due sensori, a distanza nota lungo l\'albero, leggono due forze sinusoidali: dal loro rapporto e dalla fase la macchina separa lo squilibrio del piano interno da quello esterno.',
    data: [
      { k: 'Distanza tra i sensori', v: '200 mm', indicativo: true },
    ],
  },
  encoder: {
    name: 'Encoder ottico',
    text: 'Un disco forato passa in una forcella ottica: a ogni foro corrisponde un impulso. Così la macchina conosce l\'angolo della ruota in ogni istante e può dire dove mettere il peso.',
    data: [{ k: 'Fori sul disco', v: '48 (nel modello)', indicativo: true }],
  },
  motore: {
    name: 'Motore',
    text: 'Porta la ruota alla velocità di misura in pochi secondi e poi, invertendo la coppia, la frena. Qui è un motore asincrono con caratteristica coppia-velocità semplificata.',
    data: [
      { k: 'Coppia di spunto', v: '3 N·m', indicativo: true },
      { k: 'Velocità a vuoto', v: '1450 giri/min', indicativo: true },
    ],
  },
  cinghia: {
    name: 'Cinghia e pulegge',
    text: 'Riduce la velocità del motore e ne moltiplica la coppia con il rapporto tra i diametri delle pulegge.',
    data: [{ k: 'Rapporto', v: '80 / 30 mm ≈ 2,67', indicativo: true }],
  },
  scheda: {
    name: 'Scheda elettronica',
    text: 'Amplifica i segnali dei sensori, li campiona insieme all\'angolo dell\'encoder e fa la demodulazione sincrona: moltiplica ogni segnale per seno e coseno dell\'angolo e media su più giri. Il rumore si cancella, resta ampiezza e fase della forza.',
  },
  calibro: {
    name: 'Calibro distanza',
    text: 'Asta estraibile che si appoggia al bordo interno del cerchio: misura la distanza "a" dalla macchina e il diametro. Insieme alla larghezza "b" servono a calcolare la posizione dei due piani di correzione.',
  },
  pedale: {
    name: 'Pedale di bloccaggio',
    text: 'Blocca l\'albero mentre si stringe la ghiera o si applica il peso nella posizione indicata.',
  },
  pesi: {
    name: 'Pesi di equilibratura',
    text: 'Pesi a molla agganciati alle balconate, nella posizione opposta allo squilibrio misurato. Il display arrotonda a passi di 5 g e sotto i 5 g mostra OK.',
    data: [
      { k: 'Passo dei pesi', v: '5 g', indicativo: true },
      { k: 'Soglia OK', v: '< 5 g', indicativo: true },
    ],
  },
}
