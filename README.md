# Officina 3D

Macchine da officina da esplorare nel browser, anche dal telefono.
La prima è un'**equilibratrice per ruote auto**: si può ruotare, sezionare e smontare, e misura davvero lo squilibrio della ruota.

**Prova l'app:** https://pezzaliapp.github.io/officina-3d/

## Cosa si può fare

- **Ruotare e zoomare** la macchina con il dito o il mouse.
- **Sezionare**: un piano di taglio apre mobile, gruppo albero, cerchio e pneumatico; le superfici tagliate sono tratteggiate come in un disegno tecnico.
- **Smontare**: la vista esplosa separa ruota, ghiera, cono, flangia, albero, cannotto, sensori, encoder, motore, cinghia, scheda e carrozzeria.
- **Toccare un pezzo** per leggere cos'è e a cosa serve.
- **Misurare**: il carter si abbassa, il motore porta la ruota a 200 giri/min, la macchina legge i sensori per 8 giri, frena e mostra i grammi da mettere sul piano interno ed esterno. Con *Applica pesi* la ruota si posiziona a ore 12 e i pesi vengono agganciati; rilanciando, il display mostra OK.
- **Flussi animati**: forze centrifughe che girano con la ruota, sensori che si illuminano con la forza, segnali che corrono nei cavi verso la scheda, cinghia in movimento.
- **Installarla come app** (PWA) e usarla offline.

## La fisica

- Lo squilibrio di ogni piano è un vettore `U = m · r` che genera la forza centrifuga `F = U · ω²`.
- L'albero è una trave su due appoggi (i sensori piezoelettrici A e B): le forze sui sensori si calcolano con l'equilibrio di forze e momenti.
- La macchina simulata non "conosce" lo squilibrio: campiona i segnali dei sensori con rumore, li demodula in modo sincrono con l'angolo dell'encoder e risolve il sistema inverso per ottenere massa e angolo dei due pesi.
- La rotazione segue l'equazione `I · dω/dt = coppia motore − attriti`, con un motore asincrono semplificato e frenatura a controcorrente.

Le dimensioni della ruota derivano dalla sigla del pneumatico (es. 205/55 R16). Gli altri dati della macchina (velocità di misura, coppia del motore, masse, distanza tra i sensori...) **sono valori indicativi** e nell'app sono marcati come tali.

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
  main.ts              avvio, ciclo di animazione, collegamento con l'interfaccia
  scene.ts             renderer, luci, camera
  ui.ts                pannello e oscilloscopio
  core/section.ts      sezione con tratteggio delle superfici tagliate
  core/geo.ts          solidi di rivoluzione e altre geometrie
  machine/model.ts     modello 3D dell'equilibratrice
  machine/physics.ts   squilibrio, sensori, motore, demodulazione, calcolo dei pesi
  machine/controller.ts ciclo di lavoro della macchina
  machine/display.ts   display della console
  machine/parts.ts     schede descrittive delle parti
public/                manifest, service worker e icone della PWA
```

## Licenza

[MIT](LICENSE) © 2026 Alessandro Pezzali
