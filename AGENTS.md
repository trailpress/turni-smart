# Turni Smart — istruzioni operative

App per chi guida al deposito GTT del Gerbido: legge i PDF della preconoscenza
e degli orari e risponde alle domande che ci si fa in servizio — che turno
faccio, cosa esce dal deposito, come ci rientro.

React 18 con Vite 6, statica e mobile-first. Tutto avviene nel browser: nessuna
API esterna, nessuna chiave, i dati restano sul telefono. `main` e' la
produzione.

---

## Sei nel posto giusto?

Questo file e' di **`trailpress/turni-smart`**: l'app dei turni GTT del deposito
Gerbido. Se il lavoro che ti hanno chiesto parla di mappe, mezzi in tempo reale,
`frontend/`, `handoff.md` o file `.tsx`, sei su **BusRadar**, che e' un altro
repository — fermati e dillo, invece di cercare qui qualcosa che sta altrove.

## Come si apre una sessione

Ogni sessione e' **un ramo e una PR**. Puo' chiudere piu' di una issue, se
stanno nella stessa area e toccano gli stessi file: ricominciare da capo per
ognuna butterebbe via un contesto che serve ancora.

Si chiude e se ne apre una nuova quando si cambia area, quando la sessione e'
gia' stata riassunta, o quando si ricomincia a rileggere file gia' letti — da
li' in poi si paga ricostruzione invece di lavoro. Il dettaglio in
[`docs/procedura.md`](docs/procedura.md).

**Leggi solo cio' che ti serve.** Ogni pagina dichiara quanto costa:

| Pagina | Costo | Quando |
|---|---|---|
| questa | ~750 tk | sempre |
| [`docs/stato.md`](docs/stato.md) | ~950 tk | sempre, prima di toccare il codice |
| [`docs/glossario.md`](docs/glossario.md) | ~1350 tk | parser, rientri, uscite, turni |
| [`docs/dati.md`](docs/dati.md) | ~2100 tk | aggiungi o verifichi un dato |
| [`docs/architettura.md`](docs/architettura.md) | ~1400 tk | non sai dove sta una cosa |
| [`docs/procedura.md`](docs/procedura.md) | ~1200 tk | rami, merge, browser, piu' chat |
| [`docs/decisioni/`](docs/decisioni/README.md) | ~320 tk l'indice | «perche' e' fatto cosi'» |
| [`docs/registro-progetto.md`](docs/registro-progetto.md) | **~12000 tk** | **una sezione per volta**, mai tutto |

Il registro e' la **memoria**, non il riferimento: si apre su una sezione
precisa quando serve il come ci siamo arrivati.

---

## Le cinque cose che non si fanno

1. **Non inventare un dato.** Se non lo puoi verificare, lascialo vuoto e fai in
   modo che l'app funzioni senza. → `decisioni/0003`
2. **Non committare PDF, `.env`, chiavi, token, `dist`.** Il repository e'
   pubblico e serve GitHub Pages.
3. **Non modificare i parser senza test mirati**, ne' cambiare classificazioni
   GTT, sviluppo turni o calendario per lavori infrastrutturali.
4. **Non introdurre API esterne o chiavi nel frontend**, e niente `VITE_*` per
   segreti: finiscono nel sito pubblico.
5. **Non toccare** la base Vite `/turni-smart/`, il percorso di `sw.js`, il
   prefisso cache `turni-smart-`, il ricambio comandato dall'utente
   (`decisioni/0007`) e `WAKE_EVENT_PREFIX` (`decisioni/0008`).

---

## Il ciclo

```bash
npm ci
npm run dev
npm run check     # lint, test, anti-segreti, build — deve passare prima di ogni commit
```

Ramo `claude/<descrizione>` → implementa con test → verifica in un browser vero
→ `npm run check` → PR → merge in squash. Il deploy Pages parte da solo sul push
a `main`.

**Dopo l'ok dell'utente, tutto in automatico.** L'utente prova la modifica e
quando dice che va bene — o chiede di unire — **commit, push, PR, attesa del CI
e merge in squash si fanno da soli, senza altre conferme**: l'utente non fa
niente a mano. Vale per qualunque agente, Codex compreso. Il merge si fa solo
con il CI verde e senza conflitti; se e' rosso si corregge, non si salta.
Prima dell'ok non si apre nessuna PR. A fine lavoro ramo locale, ramo remoto e
`main` coincidono, con `docs/stato.md` aggiornato. Non si segue la PR con una
sottoscrizione agli eventi: ogni risveglio costa token.

I dettagli — conflitti di merge, Playwright, coordinamento fra piu'
conversazioni — stanno in [`docs/procedura.md`](docs/procedura.md).

---

## Quando hai finito

1. Aggiorna [`docs/stato.md`](docs/stato.md): la tua riga in «Chi tiene cosa»,
   e cosa si e' chiuso o aperto.
2. Se hai preso una decisione che chi viene dopo non deve ridiscutere, scrivi un
   file in [`docs/decisioni/`](docs/decisioni/README.md).
3. Riferisci cosa **non** hai fatto e perche'.

Costa due minuti ed e' la ragione per cui questa pagina e' corta.
