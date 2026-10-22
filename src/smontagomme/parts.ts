import type { PartInfo } from '../core/machine'

/** Schede delle parti dello smontagomme. */
export const PARTS: Record<string, PartInfo> = {
  mobile: {
    name: 'Mobile',
    text: 'Carrozzeria in lamiera che contiene motore, riduttore, cilindri e valvole. Sul piano superiore gira il piatto; sul fianco destro sono montati lo stallonatore e i tamponi.',
    data: [{ k: 'Ingombro mobile (L×P×H)', v: '760 × 780 × 725 mm', indicativo: true }],
  },
  piatto: {
    name: 'Piatto autocentrante',
    text: 'Disco girevole con quattro guide radiali in cui scorrono le griffe. Le griffe si muovono insieme, quindi il cerchio si centra da solo sull\'asse del piatto.',
    data: [{ k: 'Bloccaggio dall\'esterno', v: '10" – 20"', indicativo: true }],
  },
  griffe: {
    name: 'Griffe',
    text: 'Afferrano la balconata del cerchio dall\'esterno (o il canale dall\'interno). Hanno denti per non far slittare il cerchio quando il piatto trasmette la coppia; sui cerchi in lega si usano protezioni in plastica.',
  },
  'cilindri-griffe': {
    name: 'Cilindri delle griffe',
    text: 'Due cilindri pneumatici sotto il piatto spingono le griffe attraverso un sistema di leve. La forza di serraggio è F = p · A per ciascun cilindro, divisa tra le quattro griffe.',
    data: [{ k: 'Alesaggio', v: '70 mm', indicativo: true }],
  },
  riduttore: {
    name: 'Riduttore a vite senza fine',
    text: 'La vite fa avanzare di un dente la ruota elicoidale a ogni giro: con 72 denti la velocità si divide per 72 e la coppia cresce in proporzione, meno l\'attrito. È irreversibile: il piatto non può trascinare il motore.',
    data: [
      { k: 'Denti della ruota', v: '72', indicativo: true },
      { k: 'Rendimento', v: '55%', indicativo: true },
    ],
  },
  motore: {
    name: 'Motore',
    text: 'Motore elettrico che, tramite cinghia e riduttore, fa girare il piatto nei due sensi. Il pedale di rotazione sceglie il verso.',
    data: [
      { k: 'Potenza', v: '1,1 kW', indicativo: true },
      { k: 'Velocità', v: '1400 giri/min', indicativo: true },
    ],
  },
  cinghia: {
    name: 'Cinghia e pulegge',
    text: 'Prima riduzione tra motore e vite senza fine, con rapporto pari al rapporto tra i diametri delle pulegge.',
    data: [{ k: 'Rapporto', v: '70 / 25 mm = 2,8', indicativo: true }],
  },
  palo: {
    name: 'Palo ribaltabile',
    text: 'Sostiene i bracci e l\'utensile. Si ribalta all\'indietro per liberare il piatto e caricare la ruota, poi torna in posizione mantenendo la regolazione: così l\'utensile ritrova sempre la stessa distanza dal cerchio.',
  },
  'cilindro-palo': {
    name: 'Cilindro di ribaltamento',
    text: 'Cilindro pneumatico che inclina il palo all\'indietro e lo riporta in verticale.',
  },
  braccio: {
    name: 'Braccio orizzontale',
    text: 'Scorre nella testa del palo e porta l\'asta verticale alla distanza giusta dal centro del piatto, in base al diametro del cerchio.',
  },
  asta: {
    name: 'Asta esagonale',
    text: 'Scorre in verticale e viene bloccata pneumaticamente: la sezione esagonale impedisce che l\'utensile ruoti sotto sforzo.',
  },
  bloccaggio: {
    name: 'Bloccaggio dell\'asta',
    text: 'Un pistoncino pneumatico stringe l\'asta esagonale nel suo manicotto e la blocca alla quota regolata, con l\'utensile a un paio di millimetri dalla balconata. Si sblocca per alzare l\'asta e togliere la ruota.',
  },
  utensile: {
    name: 'Utensile di montaggio',
    text: 'La "testina" appoggia sulla balconata del cerchio con un piccolo gioco. In smontaggio il tallone viene sollevato con la leva sopra la lingua dell\'utensile e, girando il piatto, scivola fuori dal cerchio; in montaggio il tallone scorre sotto la lingua ed entra nel canale.',
  },
  leva: {
    name: 'Leva alzatallone',
    text: 'Si infila tra cerchio e tallone, facendo leva sull\'utensile, per portare il tallone sopra la lingua prima di far girare il piatto.',
  },
  stallonatore: {
    name: 'Stallonatore',
    text: 'Braccio con la paletta che spinge il fianco del pneumatico verso il centro, finché il tallone si stacca dalla sede del cerchio. Si fa su entrambi i lati, girando la ruota.',
  },
  'cilindro-stallonatore': {
    name: 'Cilindro dello stallonatore',
    text: 'Il cilindro più grande della macchina. Spinge una leva corta dietro il perno del braccio: la forza alla paletta è la forza del cilindro moltiplicata per il rapporto tra i due bracci di leva.',
    data: [{ k: 'Alesaggio', v: '200 mm', indicativo: true }],
  },
  tamponi: {
    name: 'Tamponi in gomma',
    text: 'La ruota appoggia qui durante la stallonatura: reggono la spinta della paletta senza rovinare il fianco.',
  },
  pedaliera: {
    name: 'Pedaliera',
    text: 'Quattro pedali comandano, da sinistra: rotazione del piatto (nei due sensi), apertura e chiusura delle griffe, stallonatore e ribaltamento del palo. Le mani restano libere per guidare il pneumatico.',
  },
  valvole: {
    name: 'Distributori pneumatici',
    text: 'Valvole comandate dai pedali che mandano l\'aria compressa all\'una o all\'altra camera dei cilindri.',
  },
  frl: {
    name: 'Filtro, regolatore, lubrificatore',
    text: 'All\'ingresso dell\'aria: il filtro trattiene acqua e impurità, il regolatore fissa la pressione di lavoro, il lubrificatore aggiunge una nebbia d\'olio per le guarnizioni dei cilindri.',
    data: [{ k: 'Pressione di alimentazione', v: '8 – 10 bar', indicativo: true }],
  },
  gonfiaggio: {
    name: 'Gruppo di gonfiaggio',
    text: 'Manometro e tubo con attacco alla valvola. Il tallonamento (il tallone che "salta" in sede) avviene a bassa pressione; oltre il limite indicato dal costruttore non si va mai, perché un pneumatico che scoppia durante il tallonamento è pericoloso.',
    data: [
      { k: 'Limite di tallonamento', v: '3,5 bar', indicativo: true },
      { k: 'Pressione finale', v: '2,4 bar', indicativo: true },
    ],
  },
  helper: {
    name: 'Braccio di aiuto',
    text: 'Colonna propria montata sul fianco del mobile, con bracci girevoli che portano tre utensili pneumatici sopra la ruota. Fa da "terza mano": tiene il tallone nel canale del cerchio mentre il piatto gira, cosa indispensabile con i pneumatici ribassati e run-flat, che hanno fianchi rigidi e talloni che risalgono da soli.',
    data: [{ k: 'Altezza colonna', v: '1,5 m', indicativo: true }],
  },
  'helper-rullo': {
    name: 'Rullo pressore',
    text: 'Ruota di gomma folle che spinge il fianco verso il basso, dal lato opposto all\'utensile, tenendo il tallone nel canale: il diametro utile del tallone si riduce e la parte sull\'utensile può superare la balconata. Rotola sul fianco mentre il piatto gira.',
  },
  'helper-disco': {
    name: 'Disco premitallone',
    text: 'Disco largo che preme il tallone superiore vicino alla balconata. Completa lo stallonamento dall\'alto girando il piatto e, in montaggio, tiene il tallone superiore sotto la balconata finché non è entrato tutto.',
  },
  'helper-cono': {
    name: 'Cono di centraggio',
    text: 'Scende al centro del cerchio e lo preme contro il piatto. Serve per i cerchi che le griffe non possono afferrare bene o che non hanno un foro centrale passante: il cono appoggia sul mozzo e tiene il cerchio centrato mentre le griffe chiudono.',
  },
  'helper-cilindri': {
    name: 'Cilindri del braccio di aiuto',
    text: 'Un cilindro verticale per ogni utensile: la spinta è F = p · A. A 10 bar un cilindro da 50 mm spinge con circa 2 kN, abbastanza per piegare il fianco di un ribassato.',
    data: [{ k: 'Alesaggio', v: '50 mm', indicativo: true }],
  },
  'helper-comando': {
    name: 'Comando del braccio di aiuto',
    text: 'Leva a croce con i suoi distributori: avanti e indietro fa scendere o salire l\'utensile scelto. È separata dalla pedaliera perché il braccio di aiuto si usa mentre il piede comanda la rotazione.',
  },
  pneumatico: {
    name: 'Pneumatico',
    text: 'I talloni sono anelli con un cerchietto d\'acciaio inestensibile: non si allungano, quindi per passare sopra la balconata devono prima cadere nel canale del cerchio, che ha un diametro più piccolo.',
  },
  cerchio: {
    name: 'Cerchio',
    text: 'Il canale centrale, più stretto e profondo, è ciò che rende possibile montare e smontare il pneumatico: con il tallone nel canale, la parte opposta può superare la balconata.',
  },
}
