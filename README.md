# Officina 3D

Macchine da officina da esplorare nel browser, anche dal telefono. Si sceglie la macchina dal menu in alto (o con l'indirizzo `#equilibratrice` / `#smontagomme`):

- **Equilibratrice per ruote auto**: misura davvero lo squilibrio della ruota.
- **Smontagomme con braccio di aiuto**: stallona, smonta, rimonta e gonfia il pneumatico.

Entrambe si possono ruotare, sezionare e smontare pezzo per pezzo.

**Prova l'app:** https://www.alessandropezzali.it/officina-3d/

## Comune a tutte le macchine

- **Ruotare e zoomare** la macchina con il dito o il mouse.
- **Sezionare**: un piano di taglio apre la macchina; le superfici tagliate sono tratteggiate come in un disegno tecnico. I pezzi che nello smontaggio escono verso l'operatore restano interi.
- **Smontare**: la vista esplosa separa tutti i gruppi.
- **Toccare un pezzo** per leggere cos'è e a cosa serve, nasconderlo o evidenziarlo.
- **Installarla come app** (PWA) e usarla offline.

## Equilibratrice

- **Misurare**: il carter si abbassa, il motore porta la ruota a 200 giri/min, la macchina legge i sensori per 8 giri, frena e mostra i grammi da mettere sul piano interno ed esterno. Con *Applica pesi* la ruota si posiziona a ore 12 e i pesi vengono agganciati; rilanciando, il display mostra OK.
- **Flussi animati**: forze centrifughe che girano con la ruota, sensori che si illuminano con la forza, segnali che corrono nei cavi verso la scheda, cinghia in movimento.

### La fisica

- Lo squilibrio di ogni piano è un vettore `U = m · r` che genera la forza centrifuga `F = U · ω²`.
- L'albero è una trave su due appoggi (i sensori piezoelettrici A e B): le forze sui sensori si calcolano con l'equilibrio di forze e momenti.
- La macchina simulata non "conosce" lo squilibrio: campiona i segnali dei sensori con rumore, li demodula in modo sincrono con l'angolo dell'encoder e risolve il sistema inverso per ottenere massa e angolo dei due pesi.
- La rotazione segue l'equazione `I · dω/dt = coppia motore − attriti`, con un motore asincrono semplificato e frenatura a controcorrente.

## Smontagomme

Pezzi: mobile, piatto autocentrante con 4 griffe e i loro due cilindri, palo ribaltabile con cilindro di ribaltamento, braccio orizzontale, asta esagonale con bloccaggio pneumatico, utensile di montaggio, leva alzatallone, stallonatore a paletta con il suo cilindro, tamponi, pedaliera (rotazione, griffe, stallonatore, palo), distributori, gruppo filtro-regolatore-lubrificatore, gruppo di gonfiaggio con manometro e pistola, riduttore a vite senza fine, cinghia e motore.

**Braccio di aiuto (helper)**: colonna propria sul fianco del mobile, bracci girevoli, un cilindro pneumatico per ogni utensile, comando dedicato. Utensili: rullo pressore, disco premitallone e cono di centraggio.

Il ciclo si esegue un passo alla volta o tutto insieme:

1. **Stallonatura** sui due fianchi: la pressione nel cilindro sale, la paletta schiaccia il fianco (il pneumatico si deforma) finché la forza supera la tenuta del tallone.
2. **Bloccaggio**: la ruota va sul piatto, il cono di centraggio la preme dal centro, le griffe chiudono.
3. **Smontaggio**: il disco completa lo stallonamento dall'alto, il rullo tiene il tallone nel canale dal lato opposto all'utensile, la leva porta il tallone sopra la lingua e il piatto gira.
4. **Montaggio**: rullo e disco tengono il tallone superiore nel canale mentre il piatto gira (indispensabile con ribassati e run-flat; si può disattivare l'helper per confronto).
5. **Gonfiaggio**: la pressione sale secondo la legge dei gas, i talloni saltano in sede, si arriva alla pressione finale.

In sezione si vedono i pistoni nei cilindri e tutto il circuito dell'aria, con le particelle che mostrano dove va l'aria a ogni comando.

### La fisica

- Forza dei cilindri `F = p · A`, poi la leva dello stallonatore (equilibrio dei momenti attorno al perno).
- Coppia al piatto `C = η · P / ω` dopo cinghia e vite senza fine.
- Gonfiaggio isotermo a volume costante: `dp = p_atm · dV_aria / V`, con portata che cala avvicinandosi alla pressione di linea.

## Valori indicativi

Le dimensioni delle ruote derivano dalla sigla del pneumatico (es. 205/55 R16). Tutti gli altri dati delle macchine (velocità, coppie, potenze, alesaggi dei cilindri, masse, forze di tenuta dei talloni, pressioni di tallonamento, portate...) **sono valori indicativi** e nell'app sono marcati come tali.

## Sviluppo

Servono Node.js 20 o superiore.

```bash
npm install
npm run dev      # server di sviluppo
npm run build    # controllo dei tipi e build in dist/
npm run preview  # anteprima della build
npm run icons    # rigenera le icone PNG della PWA
```

Tecnologie: TypeScript, [three.js](https://threejs.org/) e [Vite](https://vitejs.dev/). Tutta la geometria è procedurale, senza file 3D. Nessun servizio esterno, nessun tracciamento, solo font di sistema.

## Pubblicazione

A ogni push su `main` il workflow `.github/workflows/deploy.yml` compila l'app e la pubblica su GitHub Pages (base `/officina-3d/`). Nelle impostazioni del repository, alla voce *Pages*, la sorgente deve essere **GitHub Actions**.

## Struttura

```
src/
  main.ts                 avvio, scelta della macchina, pannello comune, ciclo di animazione
  scene.ts                renderer, luci, camera
  ui.ts                   elementi del pannello e oscilloscopio
  core/machine.ts         interfaccia comune delle macchine
  core/model.ts           base dei modelli: parti, sezione, esplosione, selezione
  core/section.ts         sezione con tratteggio delle superfici tagliate
  core/geo.ts             solidi di rivoluzione e altre geometrie
  core/wheel.ts           misure e geometria di cerchio e pneumatico
  equilibratrice/         modello, fisica, ciclo di misura, display, schede delle parti
  smontagomme/            modello con helper, fisica pneumatica, ciclo di lavoro, schede delle parti
public/                   manifest, service worker e icone della PWA
```

## Licenza

[MIT](LICENSE) © 2026 Alessandro Pezzali
