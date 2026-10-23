import type { PartInfo } from '../core/machine'
import { SPEC, vite } from './physics'

const v = vite()
const deg = (r: number) => ((r * 180) / Math.PI).toLocaleString('it-IT', { maximumFractionDigits: 1 })

/** Schede delle parti del sollevatore a due colonne. */
export const PARTS: Record<string, PartInfo> = {
  auto: {
    name: 'Auto',
    text: 'Un\'auto generica: si sceglie se è una berlina a motore anteriore, una coupé a motore posteriore o un SUV. Cambiano massa, passo, altezza da terra e soprattutto la posizione del baricentro, che decide come si ripartisce il peso sui quattro bracci.',
  },
  colonna: {
    name: 'Colonne',
    text: 'Due profilati d\'acciaio piegato, ognuno con la sua vite e il suo motore. Sulla faccia interna c\'è la feritoia dove passa la staffa della madrevite: il carrello corre fuori dalla colonna, la vite lavora dentro, al riparo.',
    data: [
      { k: 'Altezza colonne', v: '3500 mm (3900 mm con la trave)', indicativo: true },
      { k: 'Interasse colonne', v: '2960 mm, passaggio libero 2660 mm', indicativo: true },
      { k: 'Profilo', v: '300 × 280 mm, lamiera 6 mm', indicativo: true },
    ],
  },
  basamento: {
    name: 'Basamento',
    text: 'La piastra di base saldata alla colonna distribuisce sul pavimento il peso e soprattutto il momento ribaltante: il carico sta sui bracci, a sbalzo rispetto alla colonna.',
  },
  tasselli: {
    name: 'Tasselli di ancoraggio',
    text: 'Sei tasselli chimici o meccanici per colonna, in un pavimento di calcestruzzo armato di spessore adeguato. Lavorano a trazione dal lato opposto al carico.',
    data: [{ k: 'Tasselli', v: '6 × M16 per colonna, calcestruzzo ≥ 20 cm', indicativo: true }],
  },
  carrello: {
    name: 'Carrelli',
    text: 'Abbracciano la colonna e salgono guidati dai pattini. Portano in basso i perni dei bracci e in mezzo la staffa della madrevite, che passa nella feritoia della colonna.',
    data: [{ k: 'Massa carrello con i due bracci', v: `${SPEC.massaCarrello} kg`, indicativo: true }],
  },
  pattini: {
    name: 'Pattini di scorrimento',
    text: 'Blocchetti di poliammide tra carrello e colonna: il carico sui bracci è a sbalzo, quindi il carrello tende a ruotare e appoggia sulla colonna in alto da una parte e in basso dall\'altra. I pattini prendono queste forze e si consumano al posto della colonna.',
  },
  'braccio-ant': {
    name: 'Bracci anteriori (corti)',
    text: 'Telescopici e girevoli sul perno del carrello. Sono più corti dei posteriori: il baricentro di un\'auto sta più vicino all\'asse anteriore, quindi i punti di sollevamento davanti sono più vicini alle colonne (sollevatore asimmetrico).',
    data: [{ k: 'Lunghezza dal perno al tampone', v: '600 – 1050 mm', indicativo: true }],
  },
  'braccio-post': {
    name: 'Bracci posteriori (lunghi)',
    text: 'Telescopici e girevoli, più lunghi per arrivare ai punti di sollevamento dietro, oltre il baricentro.',
    data: [{ k: 'Lunghezza dal perno al tampone', v: '750 – 1400 mm', indicativo: true }],
  },
  tampone: {
    name: 'Tamponi regolabili',
    text: 'Dischi di gomma su una vite: si alzano o si abbassano finché toccano il sottoscocca nei punti di sollevamento indicati dal costruttore dell\'auto, così i quattro appoggi sono alla stessa quota e l\'auto sale in piano.',
    data: [{ k: 'Regolazione', v: '0 – 120 mm', indicativo: true }],
  },
  blocco: {
    name: 'Blocchi anti-rotazione',
    text: 'Un settore dentato sul braccio e un nottolino sul carrello. A carrello in basso il nottolino è libero e il braccio si gira; appena il carrello sale, il nottolino entra tra i denti e il braccio non può più ruotare e scappare da sotto l\'auto.',
  },
  protezioni: {
    name: 'Protezioni piedi',
    text: 'Paracolpi gialli in testa ai bracci e sotto i carrelli: in discesa tengono lontani i piedi dalla zona dove braccio e carrello arrivano a terra.',
  },
  vite: {
    name: 'Viti trapezie',
    text: `Ogni colonna ha una vite Tr ${SPEC.viteD * 1000} × ${SPEC.passo * 1000}: a ogni giro il carrello sale di ${SPEC.passo * 1000} mm. La vite è appesa al cuscinetto in cima e lavora a trazione, così non rischia di inflettersi sotto carico.`,
    data: [
      { k: 'Filetto', v: `Tr ${SPEC.viteD * 1000} × ${SPEC.passo * 1000}, un principio`, indicativo: true },
      { k: 'Angolo d\'elica', v: `${deg(v.lambda)}°` },
      { k: 'Angolo d\'attrito (μ = 0,10)', v: `${deg(v.phi)}°`, indicativo: true },
      { k: 'Rendimento in salita', v: `${Math.round(v.rendimento * 100)} %` },
    ],
  },
  cuscinetto: {
    name: 'Cuscinetto reggispinta',
    text: 'In cima alla colonna regge tutto il peso che la vite porta e la lascia girare con poco attrito.',
  },
  madrevite: {
    name: 'Madreviti portanti',
    text: 'Chiocciole di bronzo fissate al carrello: la vite gira, la madrevite non può girare e quindi sale. Il bronzo su acciaio ha poco attrito e si consuma prima della vite, che costa di più.',
  },
  sicurezza: {
    name: 'Madreviti di sicurezza',
    text: `Una seconda chiocciola sotto la portante, a ${SPEC.giocoSicurezza * 1000} mm: sale insieme senza portare niente. Se il filetto della portante si consuma o si strappa, il carrello cala di quei pochi millimetri e si appoggia alla madrevite di sicurezza, un microinterruttore apre il circuito e il sollevatore si ferma.`,
  },
  ingranaggi: {
    name: 'Riduttore a ingranaggi',
    text: `Nella testata della colonna il pignone da 12 denti fa girare l'ingranaggio da 30 sulla vite: rapporto ${SPEC.rapportoIngranaggi}, rendimento circa ${Math.round(SPEC.rendIngranaggi * 100)} %.`,
    data: [{ k: 'Denti pignone / ingranaggio', v: '12 / 30', indicativo: true }],
  },
  motore: {
    name: 'Motori',
    text: 'Un motore asincrono trifase per colonna. Sotto carico rallenta un poco (scorrimento): la colonna più carica va leggermente più piano, ed è il quadro a tenerle allineate.',
    data: [
      { k: 'Potenza', v: `${SPEC.motoreP / 1000} kW per colonna`, indicativo: true },
      { k: 'Giri nominali', v: `${SPEC.motoreN} giri/min (4 poli, 50 Hz)`, indicativo: true },
    ],
  },
  cinghia: {
    name: 'Cinghia e pulegge',
    text: `Dal motore al pignone del riduttore, puleggia da 35 a 70 mm: rapporto ${SPEC.rapportoCinghia}. Insieme agli ingranaggi la vite gira ${SPEC.rapportoCinghia * SPEC.rapportoIngranaggi} volte più piano del motore.`,
  },
  trave: {
    name: 'Trave superiore',
    text: 'Collega le teste delle colonne: porta i cavi elettrici del secondo motore e i cavi di sincronizzazione, e lascia il pavimento libero tra le colonne.',
  },
  cavi: {
    name: 'Cavi di sincronizzazione',
    text: 'Due funi d\'acciaio incrociate: ognuna va dalla cima di un carrello, sale nella colonna, passa nella trave e scende nell\'altra colonna fino alla base dell\'altro carrello. Se un carrello resta indietro la fune si tende e lo trascina: è il rinforzo meccanico del sincronismo elettrico fatto dal quadro.',
  },
  barra: {
    name: 'Barra di sicurezza del tetto',
    text: 'Una barra imbottita sotto la trave, appesa a un microinterruttore: se il tetto dell\'auto la tocca, la barra si sposta, il circuito si apre e la salita si ferma. Con un\'auto alta è lei a fermare la salita prima del fine corsa.',
  },
  finecorsa: {
    name: 'Finecorsa',
    text: 'Interruttori sulla colonna: quello in alto ferma la salita a fine corsa, quello in basso la discesa. Sul carrello c\'è anche il microinterruttore della madrevite di sicurezza.',
    data: [{ k: 'Corsa del carrello', v: `${SPEC.corsa * 1000} mm`, indicativo: true }],
  },
  quadro: {
    name: 'Quadro comandi',
    text: 'Sulla colonna comandi: SALITA e DISCESA a uomo presente (il sollevatore si muove solo finché il pulsante è premuto), STOP di emergenza a fungo che resta premuto finché non lo si riarma, interruttore generale.',
  },
}

export const ORDER = ['auto', 'tampone', 'braccio-ant', 'braccio-post', 'blocco', 'protezioni', 'carrello', 'pattini', 'madrevite', 'sicurezza', 'vite', 'cuscinetto', 'ingranaggi', 'cinghia', 'motore', 'colonna', 'basamento', 'tasselli', 'trave', 'cavi', 'barra', 'finecorsa', 'quadro']
