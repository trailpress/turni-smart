# I dati — da dove viene ognuno, e come si verifica

La regola che governa tutto questo file:

> **Meglio nessun dato che un dato inventato.**
> Un posto cambio sbagliato manda un conducente alla fermata sbagliata alle
> quattro del mattino, e nessuno se ne accorge finche' non e' tardi.

Ogni valore in questo repository deve poter rispondere a una domanda: **da dove
viene?** Se la risposta e' «sembrava giusto», il valore non entra.

---

## Le fonti, in ordine di affidabilita'

| # | Fonte | Chiave | Ci si puo' fidare? |
|---|---|---|---|
| 1 | Numero di palina cercato nel GTFS GTT | esatta | Si', sempre |
| 2 | Legenda del PDF (`CATT = P.ZA CATTANEO`) | esatta | Si', per i nomi |
| 3 | Capolinea di **quella** linea, cercato per nome | ristretta | Si', se non ci sono pareggi |
| 4 | Nome cercato in tutta la rete | ambigua | **No** |
| 5 | Somiglianza, memoria, plausibilita' | nessuna | **Mai** |

Le righe 4 e 5 non sono ipotetiche: sono state provate e hanno prodotto dati
sbagliati. Vedi «Cosa e' gia' andato storto», in fondo.

---

## Il GTFS di GTT

**Dove**: `frontend/public/assets/gtfs-network.json` nel repository pubblico
`trailpress/BusRadar`. Istantanea del **12/07/2026**: 7035 fermate, 894
percorsi, 223 linee.

**Come si legge da qui**: il repository e' pubblico, quindi basta

```bash
git clone --depth 1 https://github.com/trailpress/BusRadar.git
```

Il proxy della sessione serve i repository pubblici senza bisogno di
`add_repo`, che chiede un'approvazione che non arriva. Il sito su
`trailpress.github.io` invece e' **bloccato** dal proxy di rete.

> Attenzione: `frontend/src/data/stops.ts` nello stesso repository sono
> **ventitre luoghi di Torino messi li' per la demo**. Non sono dati veri e non
> vanno usati. Il dato vero e' solo `gtfs-network.json`.

**Ogni fermata porta**: `code` (il numero di palina), `name`, `lat`, `lon`,
`lines`.

**Attenzione all'eta' dell'istantanea.** E' di luglio; gli orari tipo in uso
sono di agosto. Le linee possono essere cambiate. Le **posizioni delle paline**
restano valide (una fermata non si sposta), le **linee servite** possono non
esserlo.

---

## Le coordinate

### Come si ricavano

Dal **numero di palina**, mai dal nome.

```js
// src/constants/gttPaline.js
307: { lat: 45.03614, lng: 7.62627, name: 'CATTANEO' },
```

Il campo `name` non e' decorazione: e' la **prova** che la ricerca e' andata a
segno. Se il nome nel GTFS non somiglia al posto che ci si aspettava, la palina
e' sbagliata.

### Come si verifica una palina nuova

```bash
node -e "
const n = require('./BusRadar/frontend/public/assets/gtfs-network.json');
const s = n.stops.find(x => String(x.code) === '307');
console.log(s.name, s.lat, s.lon, s.lines.join(','));
"
```

Tre controlli prima di accettarla:

1. **Il nome combacia** con il posto atteso.
2. **La posizione cade a Torino o cintura** (lat 44,9-45,2 · lng 7,4-7,8). Un
   test lo verifica per ogni palina in tabella.
3. **Le due paline dello stesso posto sono vicine.** Andata e ritorno sono i due
   lati della stessa fermata: da 10 a 200 metri. Se distano chilometri, una
   delle due e' sbagliata.

### Lo stato attuale

Le paline dei posti cambio, raccolte sul campo dall'utente e **tutte confermate
dal GTFS, nome compreso**:

| Posto | Paline A/R | Nome GTT | Scarto |
|---|---|---|---|
| CATT | 307 / 308 | CATTANEO | 36 m |
| ORSN | 317 / 318 | SANTA RITA | 10 m |
| ORSA | 728 / 729 | ORBASSANO | 127 m |
| LING | 2604 / 2603 | STAZIONE LINGOTTO | 10 m |
| BENS | 3628 / 1023 | BENGASI OVEST | 26 m |
| OSET | 299 / 300 | SETTEMBRINI | 201 m |
| CAIO | 1119 | CAIO MARIO CAP | 0 m |
| BARB | 1169 / 1170 | PORTOFINO | 25 m |
| CLGR | 969 / 968 | GRAMSCI NORD | 27 m |
| CLMA | 853 / 852 | MACEDONIA | 16 m |
| SIRA | 711 / 128 | SIRACUSA / MONFALCONE | 62 m |
| OMRO | 309 / 310 | OMERO | 28 m |
| FILA | 1665 / 1666 | FILADELFIA | 42 m |
| ARBA | 303 | SICCARDI CAP | — |
| OBFR | 2927 | DALLA CHIESA CAP | — |
| GCAS | 3542 | GROSSO CAP | — |

Piu' il deposito: **palina 693, GORINI CAP**, `45.03941, 7.59166`.

> `SIRA` e' l'unico posto in tabella dove le due paline portano **due nomi
> diversi**: sono le due vie che si incrociano li', corso Siracusa e via
> Monfalcone. E' per questo che la seconda era sfuggita.
>
> `GCAS` sta per **Grosso-CASalegno**: e' il capolinea della 58/ in via Grosso
> all'angolo con via Casalegno, palina 3542, e la legenda del grafico lo scrive
> per esteso — «Via Grosso / V. Casalegno».
>
> Per un giorno c'e' stato scritto **Bertola**, che e' l'altro capolinea della
> linea, a tre chilometri di distanza. Era la palina dell'andata (1683, che la
> 58/ divide con la 58), presa per la risposta alla domanda «dov'e' GCAS»
> quando la domanda non era stata fatta cosi'. **Un numero di palina risponde a
> una domanda sola: quella che gli e' stata posta.** La prova che era sbagliato
> e' arrivata da uno screenshot dell'app, dove la scheda del rientro portava
> gia' il nome giusto letto dalla legenda.
>
> `ARBA` e `OBFR` sono i due capolinea della linea 5. Il grafico li chiama
> *P.za Arbarello* e *Orbassano - Strada Torino*, GTT li chiama *Siccardi* e
> *Dalla Chiesa*: sono gli stessi posti, confermati dall'utente e dal fatto che
> il GTFS li dichiara capolinea della 5. **Per nome non si sarebbero mai
> trovati.**

---

## Il controllo che vale per primo

**Ogni vettura che esce dal deposito prima o poi ci rientra.** Quindi, sulla
stessa pagina, il numero dei rientri e quello delle uscite devono somigliarsi.
Quando non si somigliano, una delle due meta' si sta perdendo per strada.

Il referto su `?diag=orari` mette le due colonne una accanto all'altra e lo dice
da solo. Il 24 agosto diceva:

```
58B LUN - VEN · rientri 2 · uscite 13
17  LUN - VEN · rientri 1 · uscite 9
71  LUN - VEN · rientri 0 · uscite 4
```

Li' dentro c'era un difetto che durava da mesi: i rientri cercavano l'`Entra` a
poche parole dall'`U.L.`, mentre nel testo estratto per colonne gli `U.L.` di
tutte le vetture stanno di seguito e gli `Entra` vengono dopo, tutti insieme. Le
uscite quel rimedio ce l'avevano gia' — raccogliere prima tutti gli `I.L.` della
pagina — e i rientri no. Il conto c'era da sempre; mancava chi mettesse le due
colonne vicine.

---

## I capolinea del grafico

I codici come `GORX`, `NEGR`, `FERM` non hanno numero di palina accanto. Si
risolvono con due dati che ci sono gia':

1. la **legenda** della pagina traduce il codice nel nome — `GORX = V. GORINI`;
2. il **GTFS** dice quali sono i capolinea di quella linea: due o quattro, non
   settemila fermate.

Cercare il nome dentro quella lista corta e' affidabile. Cercarlo in tutta la
rete no.

`src/constants/gttTermini.js` contiene i 91 capolinea delle 23 linee del
Gerbido. `findTerminus(linea, nome)` fa la ricerca e **torna `null` sui
pareggi**: se due capolinea rispondono allo stesso nome, nessuno dei due e' la
risposta.

### La controprova

La tabella **TEMPI DI USCITA / RIENTRO** dice quanti minuti separano ogni
capolinea dal deposito. Confrontarla con la distanza in linea d'aria e' una
verifica vera:

| Codice | Linea | Trovato | Palina | km | min | km/h |
|---|---|---|---|---|---|---|
| GORX | 74 | GORINI CAP | 693 | 0,00 | 2 | — |
| NEGR | 63 | NEGARVILLE CAP | 1158 | 2,66 | 11 | 14 |
| FERM | 132 | FERMI CAP | 5001 | 4,11 | 20 | 12 |

Dodici-quattordici km/h: un autobus in citta'. Un accostamento che richiedesse
piu' di **60 km/h** viene buttato, e il rientro resta senza posizione.

Il limite e' solo verso l'alto: il capolinea della 74 e' il deposito stesso, e i
suoi due minuti su zero metri sono il tempo di entrare, non una velocita'
impossibile.

### La stessa tabella, letta al contrario

`findNearbyTermini(posizione)` fa la domanda opposta di `findTerminus`: non
"dov'e' il capolinea di questa linea", ma "quali linee hanno un capolinea qui
vicino". Risponde a "Cosa passa qui vicino" nel pannello Rientri.

Fino al 17 settembre quel bottone apriva una ricerca Google Maps di "fermate
GTT": una mappa di puntini senza scritto sopra quale linea ci passasse, e
serviva un secondo tocco per vederla — da qui sembrava che il bottone "non si
aprisse". Con `gttTermini.js` gia' in casa, verificato palina per palina, non
serve uscire dall'app ne' indovinare niente: si mostra solo cio' che e'
verificato, ed entro due chilometri e mezzo si dice onestamente quando non c'e'
niente, invece di mostrare una fermata a caso.

Copre solo i capolinea, non ogni fermata della rete. Lontano da un capolinea la
risposta e' vuota: non e' un buco da riempire con un altro dato indovinato, e'
l'onesta' di dire cio' che si sa.

---

## I PDF di GTT

### Preconoscenza

Il PDF mensile del singolo conducente. Contiene **nome e matricola**: e' un dato
personale, non va mai committato.

### Orari — pagina TURNI DEL PERSONALE

Una riga per ripresa: `05 302 5 / 2 16.33 CATT R 21.58 GERB 05.25`.

Da qui si ricavano **gli sviluppi turno**. Da qui **non** si ricavano i rientri:
quelle righe sono riprese intere.

### Orari — grafico di servizio

La pagina con lo schema di linea. Contiene:

- la **legenda** dei codici di posto;
- la tabella **TEMPI DI PERCORRENZA** fra fermate;
- la tabella **TEMPI DI USCITA / RIENTRO** fra deposito e capolinea;
- per ogni vettura: `Esce`, `I.L.`, `U.L.`, `Entra`.

**E' l'unica fonte dei rientri.** Un PDF senza questa pagina non permette di
calcolarli, e l'app lo dice invece di arrangiarsi.

### Il PDF non si committa mai

Il repository e' pubblico e serve GitHub Pages: metterci dentro gli orari li
pubblicherebbe. `.gitignore` non copre i PDF, quindi va fatta attenzione a mano.

---

## Il documento sindacale

`Accordo TPL Urbano del 16/07/2025`. Da li' vengono le tipologie di turno, i
ballottaggi e le quote di composizione giornaliera. I dettagli stanno in
`glossario.md` e in `src/constants/shiftClassification.js`.

---

## Cosa e' gia' andato storto

Casi reali, non ipotesi. Servono a riconoscere la forma dell'errore.

**Coordinate inventate.** In una fase iniziale i posti cambio avevano
coordinate scritte a occhio: comparivano nomi come «piazza Tasso» e «Cairoli»,
che per quelle linee non esistono. L'utente le ha smontate. Da li' viene la
regola di questo file.

**Nome cercato in tutta la rete.** Cercando `ORBASSANO - STRADA TORINO` fra le
97 fermate della linea 5 uscivano cinque candidati, fra cui una `ORBASSANO` a
due chilometri di distanza. Indistinguibili. Per questo la ricerca per nome si
fa **solo** fra i capolinea di quella linea.

**Dati finti scambiati per veri.** La demo aveva un tratto Cattaneo → Gerbido da
48 minuti, quando sono nove. Sembrava un difetto di calcolo e non lo era: era un
dato inventato. La demo e' stata rimossa (→ `decisioni/0004`).

**Un limite al posto di una regola.** I rientri venivano filtrati per durata
(«scarta oltre 90 minuti»), il che funzionava finche' le riprese duravano cinque
ore. Una ripresa da 1h21 e' passata, ed e' comparsa come «corsa diretta». Il
filtro giusto e' sulla **provenienza del dato**, non sulla sua misura
(→ `decisioni/0001`).

**Dichiarare che un dato non esiste senza averlo cercato bene.** Il posto cambio
di corso Siracusa risultava assente dal GTFS: esisteva da sempre, ma si chiama
`MONFALCONE`. Prima di scrivere che un dato manca, controllare di averlo cercato
nel modo giusto.
