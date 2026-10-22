# Officina 3D — regole permanenti

- **Autore unico: Alessandro Pezzali.** Mai aggiungere co-autori, firme, trailer `Co-Authored-By` o riferimenti a Claude in commit, PR, README o codice.
- **Costo zero sempre.** Solo librerie gratuite e open source (three.js, Vite, TypeScript). Nessun servizio a pagamento, nessuna API key, nessun analytics o tracciamento, nessun font a pagamento (si usano i font di sistema). Hosting solo su GitHub Pages.
- **Interfaccia e testi in italiano.**
- Geometria procedurale: nessun file 3D esterno.
- I dati tecnici non presi da una fonte vanno indicati nell'interfaccia come **valori indicativi**.

## Comandi

- `npm run dev` — server di sviluppo
- `npm run build` — typecheck + build in `dist/`
- Deploy automatico su GitHub Pages a ogni push su `main` (`.github/workflows/deploy.yml`), base `/officina-3d/`.
