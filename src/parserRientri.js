// La pagina "grafico di servizio" degli Orari e' l'unica che dice come si esce
// dal deposito e come ci si torna davvero. La pagina dei turni da' la ripresa
// intera - "16.33 CATT R 21.58 GERB" sono cinque ore e mezza di linea, non un
// passaggio - mentre qui ogni vettura chiude con due dati soli:
//
//   Linea  U.L. 21.51 OSET
//   5      Entra 21.58
//
// U.L. e' l'ultima corsa di linea, Entra l'ingresso in deposito: fra i due c'e'
// il tragitto vero, sette minuti.
//
// La stessa pagina dice allo stesso modo come si esce, e sono i due dati su cui
// si regge la funzione Uscite:
//
//   8   Esce 04.13   I.L. 04.22 CATT
//
// Esce e' l'ora in cui la vettura lascia il Gerbido, I.L. dove e quando entra in
// linea: nove minuti per Cattaneo, non le cinque ore della ripresa.
//
// E in fondo alla pagina la tabella che conferma entrambi, per ogni capolinea:
//
//   TEMPI DI USCITA / RIENTRO 5
//   GERB - OSET  7 7
//   GERB - CATT  9 9
//
// I dati si controllano a vicenda: un U.L. si accoppia al suo Entra - e un Esce
// al suo I.L. - solo se la differenza e' il tempo che la tabella dichiara per
// quel posto. Cosi' un PDF estratto con le colonne mescolate non produce
// accoppiamenti a caso.

import { findTerminus } from './constants/gttTermini.js';
import { distanceMeters } from './constants/gttPaline.js';
import { isGerbidoLine, normalizeLineCode } from './constants/depotGerbido.js';

const DEPOT = 'GERB';
// Il deposito e' la palina 693, GORINI CAP: e' li' che entrano le vetture.
const DEPOT_POSITION = { lat: 45.03941, lng: 7.59166 };
const PLACE_RE = /^[A-Z]{4}$/;
// L'ora esce dal PDF in tre forme a seconda di come il testo viene estratto:
// "21.51", "21:51" e, quando il separatore si perde, "2151".
const TIME_RE = /^(\d{1,2})[.:](\d{2})$/;
const COMPACT_TIME_RE = /^(\d{2})(\d{2})$/;
// Senza tabella dei tempi resta il buon senso: dal capolinea al deposito non ci
// si mette tre quarti d'ora.
const MAX_TRANSFER_MINUTES = 45;

function tokenize(text) {
  return String(text || '')
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)
    /* "GERB-OSET" e "U.L." attaccati al valore capitano quando il PDF perde gli
       spazi fra le celle: si riaprono qui, una volta, invece di complicare ogni
       confronto piu' avanti. */
    .flatMap((token) => (/^[A-Z]{4}-[A-Z]{4}$/.test(token) ? [token.slice(0, 4), '-', token.slice(5)] : [token]));
}

function toMinutes(token) {
  const raw = String(token || '');
  const match = TIME_RE.exec(raw) || COMPACT_TIME_RE.exec(raw);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatTime(token) {
  const minutes = toMinutes(token);
  if (minutes === null) return '';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// Una corsa che chiude dopo mezzanotte rientra il giorno dopo: la differenza va
// riportata avanti, non letta come un numero negativo enorme.
function transferMinutes(fromMinutes, toMinutes_) {
  const gap = toMinutes_ - fromMinutes;
  return gap < 0 ? gap + 1440 : gap;
}

function isAnchor(token, letter) {
  return new RegExp(`^${letter}\\.?L\\.?$`).test(token);
}

/* Un codice di linea non ha una forma sola, e non c'e' niente da indovinare.
   Sulla rete GTT ci sono la 5, la 58/ e la 132, ma anche M1S, M1N, CP1, VE1,
   LS1, OB1, W01, N04B, e persino MEOR e SPX, che di cifre non ne hanno
   nessuna. Non sono sigle di qualcos'altro: sono linee a tutti gli effetti,
   con il loro nome, il loro percorso e i loro capolinea, esattamente come la 5.
   Il GTFS le elenca alla pari - CP1 e' «via De Amicis (Fermi M1 - Collegno) -
   via Musine' (Pianezza)», M1S e' il bus sostitutivo della metropolitana.

   Quindi qui non si descrive che aspetto ha un codice: si prende il gruppo di
   caratteri che segue l'ancora e lo si accetta se e' una linea del Gerbido,
   oppure - per non restare fermi davanti a una linea che l'elenco non ha
   ancora - se almeno contiene una cifra. E' il minimo che tiene fuori le
   parole che possono capitare li' accanto, senza pretendere di sapere in
   anticipo come GTT chiamera' la prossima. */
const LINE_TOKEN = '([A-Z0-9]{1,6}/?)(?![A-Z0-9])';
/* Dentro un codice dell'orario tipo la linea non finisce con uno spazio ma con
   la Q che segue: li' il confine lo da' il resto del codice, non un a capo. */
const LINE_IN_CODE = '([A-Z0-9]{1,6})';

function acceptLine(raw) {
  // Stessa normalizzazione del resto dell'app: "05" e' la 5, "58/" e' la 58B.
  const code = normalizeLineCode(raw);
  if (!code) return '';
  if (isGerbidoLine(code)) return code;
  return /\d/.test(code) ? code : '';
}

/**
 * La linea a cui appartiene la pagina. Il titolo grande non porta la parola
 * "linea", quindi si parte dalle due tabelle in fondo, che il codice ce l'hanno
 * accanto, e solo dopo si prova con l'intestazione.
 */
export function detectRientriLine(text = '') {
  const source = String(text || '').toUpperCase();
  const patterns = [
    new RegExp(`USCITA\\s*/?\\s*RIENTRO\\s+${LINE_TOKEN}`),
    new RegExp(`ANDATA\\s*/?\\s*RITORNO\\s+${LINE_TOKEN}`),
    new RegExp(`\\bLINEA\\s+${LINE_TOKEN}`),
    /* I codici dell'orario tipo portano dentro la linea: A05Q0101 e' la 5,
       AM1SQ0101 e' la M1S. E' l'unico appiglio quando l'intestazione grande
       non ha la parola "linea" e le due tabelle in fondo non vengono
       estratte. */
    new RegExp(`\\b[AHW]${LINE_IN_CODE}Q\\d`),
    /* Ultima spiaggia: la legenda stessa. "CAPOLINEA RITORNO M1S" dice la
       linea anche quando l'intestazione e le tabelle sono andate perse
       nell'estrazione del testo. */
    new RegExp(`CAPOLINEA\\s+(?:ANDATA|RITORNO)\\s+${LINE_TOKEN}`),
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const line = match ? acceptLine(match[1]) : '';
    if (line) return line;
  }
  return '';
}

/**
 * I tempi fra deposito e capolinea, dalla tabella "TEMPI DI USCITA / RIENTRO".
 * Le righe hanno una o due cifre: quando ce n'e' una sola vale per entrambi i
 * versi, quando sono due la prima e' l'uscita e la seconda il rientro.
 */
export function parseDepotTransferTimes(text = '') {
  const tokens = tokenize(text);
  const transfers = {};

  for (let index = 0; index < tokens.length - 3; index += 1) {
    if (tokens[index] !== DEPOT) continue;
    if (tokens[index + 1] !== '-') continue;
    const place = tokens[index + 2];
    if (!PLACE_RE.test(place) || place === DEPOT) continue;

    const first = Number(tokens[index + 3]);
    if (!Number.isInteger(first) || first <= 0 || first > MAX_TRANSFER_MINUTES) continue;
    const second = Number(tokens[index + 4]);
    const hasSecond = Number.isInteger(second) && second > 0 && second <= MAX_TRANSFER_MINUTES;

    transfers[place] = { out: first, in: hasSecond ? second : first };
  }

  return transfers;
}

/**
 * Le ultime corse prima dell'ingresso in deposito, una per vettura. Torna
 * segmenti nella stessa forma di quelli degli Orari, cosi' la ricerca dei
 * rientri li tratta come qualsiasi altra corsa.
 */
/* Un autobus in citta' non supera i sessanta all'ora. Serve a controllare un
   capolinea trovato per nome: se la distanza in linea d'aria dal deposito e il
   tempo di rientro dichiarato dalla tabella richiedono piu' di cosi', il nome
   ha pescato una fermata troppo lontana e la posizione si butta.
   Il limite e' solo verso l'alto: il capolinea della 74 e' Gorini, cioe' il
   deposito stesso, e i suoi due minuti su zero metri sono il tempo di entrare,
   non una velocita' impossibile. */
const MAX_KMH = 60;

function plausiblePosition(position, minutes) {
  if (!position || !Number.isFinite(minutes) || minutes <= 0) return position || null;
  const meters = distanceMeters(DEPOT_POSITION, position);
  if (meters === null) return position;
  return meters / 1000 / (minutes / 60) <= MAX_KMH ? position : null;
}

/* Tutti gli ingressi in deposito della pagina, nell'ordine in cui compaiono.
 *
 * Vanno raccolti prima e tutti insieme, per la stessa ragione degli I.L.: nel
 * testo estratto per colonne gli "U.L." stanno da una parte e gli "Entra"
 * dall'altra, e fra un U.L. e il suo Entra ci sono decine di parole.
 *
 * Cercare l'Entra a poca distanza dall'U.L. ne pescava una minima parte. Il
 * conto lo diceva chiaro nel referto del 24 agosto, confrontando le due meta'
 * della stessa pagina: sulla 58/ tredici uscite e due rientri, sulla 17 nove e
 * uno, sulla 63 sette e cinque. Ogni vettura che esce prima o poi rientra,
 * quindi i due numeri devono somigliarsi. Le uscite quel rimedio ce l'avevano
 * gia'; i rientri no, ed e' il difetto che ha fatto dire all'utente «ho visto
 * rientrare una 63 e l'app non me la dava».
 */
function collectDepotEntries(tokens) {
  const entries = [];

  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index] !== 'ENTRA') continue;
    const minutes = toMinutes(tokens[index + 1]);
    if (minutes === null) continue;
    entries.push({ minutes, token: tokens[index + 1] });
  }

  return entries;
}

/* Un rientro nella forma degli altri tratti: dove si sale, a che ora, e dove
   sta il capolinea quando la legenda e il tempo di rientro lo confermano. */
function buildReturn({ end, gt, lineCode, place, places, returnsCount, start, transfers, ver }) {
  /* Il codice da solo non dice dove sta il capolinea: lo dice il nome che la
     legenda gli da', cercato fra i capolinea di quella linea, e poi controllato
     contro il tempo di rientro dichiarato. */
  const terminus = findTerminus(lineCode, places[place]?.label || '');
  const position = plausiblePosition(
    terminus ? { lat: terminus.lat, lng: terminus.lng } : null,
    transfers[place]?.in ?? null,
  );

  return {
    ln: lineCode,
    lineaNorm: lineCode,
    palina: terminus && position ? terminus.code : '',
    position,
    vett: '',
    turnoVettura: '',
    start,
    loc_s: place,
    dir: '',
    end,
    loc_e: DEPOT,
    gt,
    ver,
    run_id: returnsCount + 1,
  };
}

export function parseDepotReturns(text = '', { gt = '', ver = '', legend = null, line = '' } = {}) {
  const tokens = tokenize(text);
  const transfers = parseDepotTransferTimes(text);
  const places = legend || parseLegend(text);
  const lineCode = line || detectRientriLine(text);
  const entries = collectDepotEntries(tokens);
  /* Un ingresso in deposito appartiene a una vettura sola: quando e' stato
     preso non puo' servire anche alla successiva. */
  const taken = new Set();
  const returns = [];
  const seen = new Set();

  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (!isAnchor(tokens[index], 'U')) continue;
    const departure = toMinutes(tokens[index + 1]);
    /* Due forme. "U.L. 21.51 OSET", con l'Entra lontano da un'altra parte; e
       "ENTRA U.L. 10.22 10.32 CAIQ", con l'ora di ingresso gia' accanto
       all'U.L. e il posto in fondo - e' cosi' che escono le pagine con piu'
       vetture, e sulla 39 feriale tre U.L. su sei andavano persi. */
    const adjacent = toMinutes(tokens[index + 2]);
    const combined = adjacent !== null && PLACE_RE.test(tokens[index + 3] || '');
    const place = combined ? tokens[index + 3] : tokens[index + 2];
    if (departure === null || !PLACE_RE.test(place || '') || place === DEPOT) continue;

    const expected = transfers[place]?.in ?? null;
    let chosen = -1;

    if (combined) {
      const gap = transferMinutes(departure, adjacent);
      if (gap > 0 && gap <= MAX_TRANSFER_MINUTES) {
        const start = formatTime(tokens[index + 1]);
        const end = formatTime(tokens[index + 2]);
        const identity = `${lineCode}|${place}|${start}|${end}`;
        if (!seen.has(identity)) {
          seen.add(identity);
          returns.push(buildReturn({ end, gt, lineCode, place, places, returnsCount: returns.length, start, transfers, ver }));
        }
        continue;
      }
    }

    for (let candidate = 0; candidate < entries.length; candidate += 1) {
      if (taken.has(candidate)) continue;
      const gap = transferMinutes(departure, entries[candidate].minutes);
      if (gap <= 0 || gap > MAX_TRANSFER_MINUTES) continue;
      // Il tempo dichiarato dalla tabella e' la prova: se combacia si chiude
      // qui, altrimenti si tiene da parte il primo plausibile e si continua a
      // cercare quello giusto.
      if (expected !== null && gap === expected) {
        chosen = candidate;
        break;
      }
      if (chosen < 0) chosen = candidate;
    }

    if (chosen < 0) continue;
    taken.add(chosen);

    const start = formatTime(tokens[index + 1]);
    const end = formatTime(entries[chosen].token);
    const identity = `${lineCode}|${place}|${start}|${end}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    returns.push(buildReturn({ end, gt, lineCode, place, places, returnsCount: returns.length, start, transfers, ver }));
  }

  return returns;
}

/**
 * Le uscite dal deposito, una per vettura, lette dalla stessa pagina.
 *
 * Sono lo specchio dei rientri: "Esce" e' l'ora in cui la vettura lascia il
 * Gerbido, "I.L." dove e quando entra in linea. Fra i due c'e' il
 * trasferimento, che dura quanto dichiara la tabella - nove minuti per
 * Cattaneo - e non e' la ripresa di cinque ore che sta sulla pagina dei turni.
 *
 * Torna segmenti nella stessa forma degli altri, con il deposito come partenza.
 */
/* Tutti gli ingressi in linea della pagina, nell'ordine in cui compaiono.
 *
 * Vanno raccolti prima e tutti insieme, perche' nel testo estratto per colonne
 * gli "Esce" stanno da una parte e gli "I.L." dall'altra:
 *
 *   1 ESCE 04.31 CLST  2 ESCE 04.56 CLST  3 ESCE 06.48 CLST  4 ESCE 05.47 ADUA
 *   GER I.L. 04.50 CLST  GER I.L. 05.15 CLST  GER I.L. 07.09 CLST  GER I.L. 06.09 NUOV
 *
 * Fra il primo Esce e il suo I.L. ci sono sedici parole, e con dieci vetture
 * sulla pagina ce ne sono quaranta: cercare l'I.L. a poca distanza dall'Esce
 * pescava solo le ultime vetture di ogni pagina e perdeva sempre le prime.
 */
function collectLineStarts(tokens) {
  const starts = [];

  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (!isAnchor(tokens[index], 'I')) continue;
    /* Sulle pagine con piu' vetture, fra "I.L." e l'ora capita un codice di
       posto - "I.L. CAIQ 07.35 CAIQ" - che e' l'etichetta di una colonna dello
       schema e non appartiene al dato. Dal 22 ottobre il referto della 39
       feriale diceva sei "Esce" e tre "I.L.": gli altri tre avevano quella
       forma. Se ne scavalcano al piu' due. */
    let timeIndex = index + 1;
    while (timeIndex < index + 3 && PLACE_RE.test(tokens[timeIndex] || '') && tokens[timeIndex] !== DEPOT) timeIndex += 1;
    const minutes = toMinutes(tokens[timeIndex]);
    const place = tokens[timeIndex + 1];
    if (minutes === null || !PLACE_RE.test(place || '') || place === DEPOT) continue;
    starts.push({ minutes, place, token: tokens[timeIndex] });
  }

  return starts;
}

export function parseDepotExits(text = '', { gt = '', ver = '', line = '' } = {}) {
  const tokens = tokenize(text);
  const transfers = parseDepotTransferTimes(text);
  const lineCode = line || detectRientriLine(text);
  const lineStarts = collectLineStarts(tokens);
  /* Un ingresso in linea appartiene a una vettura sola: quando e' stato preso
     non puo' servire anche alla successiva. */
  const taken = new Set();
  const exits = [];
  const seen = new Set();

  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index] !== 'ESCE') continue;
    const departure = toMinutes(tokens[index + 1]);
    if (departure === null) continue;

    let chosen = -1;

    for (let candidate = 0; candidate < lineStarts.length; candidate += 1) {
      if (taken.has(candidate)) continue;
      const { minutes, place } = lineStarts[candidate];
      const gap = transferMinutes(departure, minutes);
      if (gap <= 0 || gap > MAX_TRANSFER_MINUTES) continue;
      /* Il tempo dichiarato dalla tabella e' la prova: se combacia si chiude
         qui, altrimenti si tiene il primo plausibile e si continua a cercare
         quello giusto. E' la stessa regola dell'Entra: senza, l'ordine delle
         colonne basterebbe da solo a decidere, e non e' un dato certo. */
      if (transfers[place]?.out === gap) {
        chosen = candidate;
        break;
      }
      if (chosen < 0) chosen = candidate;
    }

    if (chosen < 0) continue;
    taken.add(chosen);
    const lineStart = lineStarts[chosen];

    const start = formatTime(tokens[index + 1]);
    const end = formatTime(lineStart.token);
    const identity = `${lineCode}|${lineStart.place}|${start}|${end}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    exits.push({
      ln: lineCode,
      lineaNorm: lineCode,
      /* Il numero di vettura sembra stare subito prima di "Esce", e nel testo
         estratto per colonne davvero c'e'. Ma in quella stessa posizione
         finisce la coda della tabella dei tempi - "GERB - ARBA 25" seguito da
         "8 Esce" - e le due cose sono indistinguibili: un 25 letto come vettura
         manda qualcuno al mezzo sbagliato nel piazzale. Resta vuoto finche' il
         grafico non lo dira' in un posto che non si confonde con altro. */
      vett: '',
      turnoVettura: '',
      start,
      loc_s: DEPOT,
      /* Il posto scritto dopo l'Esce non e' la destinazione: sulla 33 la
         vettura 4 esce "ADUA" ed entra in linea a NUOV. Dove il mezzo entra in
         servizio lo dice l'I.L., ed e' quello che serve a chi lo prende. */
      dir: '',
      end,
      loc_e: lineStart.place,
      gt,
      ver,
      run_id: exits.length + 1,
    });
  }

  return exits;
}

// I rientri stanno nella stessa mappa degli sviluppi turno, sotto una chiave
// che nessun turno puo' avere: la ricerca li legge senza sapere che vengono da
// un'altra pagina, e la scheda di un turno non li pesca per sbaglio.
export const RIENTRI_KEY_PREFIX = 'RIENTRI';

/* Quale versione del parser ha prodotto una lettura. Gli Orari restano salvati
   fra un avvio e l'altro, quindi una lettura fatta prima che il grafico di
   servizio venisse letto sopravvive all'aggiornamento e non ha ne' rientri ne'
   uscite: senza questo numero l'app non puo' distinguerla da un PDF che il
   grafico non ce l'ha, e finisce per dare la colpa al PDF. Va alzato quando
   cambia cio' che il parser ricava dalla stessa pagina - la 2 e' quella che ha
   aggiunto le uscite, la 3 quella che ha riletto gli I.L. con un codice di posto
   davanti all'ora e i rientri nella forma «ENTRA U.L. 10.22 10.32 CAIQ». */
export const RIENTRI_PARSER_VERSION = 3;

export function rientriKey(line = '', gt = '') {
  return [RIENTRI_KEY_PREFIX, line || '?', gt].filter(Boolean).join(' ');
}

export function isRientriKey(key = '') {
  return String(key).startsWith(`${RIENTRI_KEY_PREFIX} `);
}

// Le uscite seguono la stessa regola dei rientri e per la stessa ragione: la
// pagina dei turni non deve poterle produrre, e la scheda di un turno non deve
// pescarle credendole uno sviluppo.
export const USCITE_KEY_PREFIX = 'USCITE';

export function usciteKey(line = '', gt = '') {
  return [USCITE_KEY_PREFIX, line || '?', gt].filter(Boolean).join(' ');
}

export function isUsciteKey(key = '') {
  return String(key).startsWith(`${USCITE_KEY_PREFIX} `);
}

// Le due pagine speciali insieme: quello che non e' uno sviluppo turno.
export function isGraphicKey(key = '') {
  return isRientriKey(key) || isUsciteKey(key);
}

/* Marcatori del grafico di servizio nel testo grezzo di una pagina. Servono a
   distinguere due esiti che nel referto si somigliano ma vogliono cose
   opposte: il PDF quella pagina non ce l'ha, oppure ce l'ha e il testo esce in
   una forma che il parser non riconosce. Nel secondo caso il pezzo di testo
   qui sotto e' quello su cui aggiustare il parser. */
const GRAPHIC_MARKERS = [
  ['ul', /\bU\.?\s?L\.?\s/],
  ['entra', /\bENTRA\b/],
  ['esce', /\bESCE\b/],
  /* L'I.L. si cerca seguito dalla sua ora: "IL" da solo e' una parola come
     un'altra, e nel referto un marcatore falso vale meno di niente. */
  ['il', /\bI\.?\s?L\.?\s+\d{1,2}[.:]?\d{2}\b/],
  ['tempi', /TEMPI\s+DI\s+USCITA/],
];

const EXCERPT_LENGTH = 320;

/* Da dove tagliare l'estratto. Si parte da "Esce", perche' e' li' che il
   parser delle uscite si perde e quindi e' quel pezzo che serve leggere; se la
   pagina non ce l'ha si ripiega sugli altri ancoraggi. */
const EXCERPT_ANCHORS = [/\bESCE\b/, /\bU\.?\s?L\.?\s/, /TEMPI\s+DI\s+USCITA/];

export function findGraphicHints(text = '') {
  const source = String(text || '').toUpperCase();
  const found = GRAPHIC_MARKERS.filter(([, pattern]) => pattern.test(source)).map(([name]) => name);
  if (!found.length) return { excerpt: '', markers: [] };

  const anchor = EXCERPT_ANCHORS.reduce((found_, pattern) => (found_ >= 0 ? found_ : source.search(pattern)), -1);
  const from = Math.max(0, anchor - 40);
  return {
    excerpt: source.slice(from, from + EXCERPT_LENGTH).replace(/\s+/g, ' ').trim(),
    markers: found,
  };
}

/* La legenda della pagina, che dei codici a quattro lettere dice il posto vero:
 *
 *   OBFR = ORBASSANO - STRADA TORINO - Capolinea andata 5
 *   CATT = P.ZA CATTANEO - Posto cambio
 *   OSET = C. ORBASSANO / C. SETTEMBRINI
 *
 * Senza questa l'app mostra "GORX" e "NEGR", che chi guida non ha motivo di
 * riconoscere. Con questa mostra il nome che c'e' scritto sul documento, e non
 * uno inventato da noi.
 */
const LEGEND_ENTRY_RE = /\b([A-Z]{4})\s*=\s*([^=]{2,80}?)(?=\s+[A-Z]{4}\s*=|$)/g;
// Oltre questa lunghezza non e' piu' una voce di legenda ma il testo che segue.
const MAX_LEGEND_NAME = 60;

/* Il PDF scrive tutto maiuscolo. Su una scheda "P.ZA CATTANEO" urla e si legge
   peggio di "P.za Cattaneo": le parole restano quelle, cambia solo la forma. */
function titleCase(value = '') {
  // Dopo il punto no: "P.ZA" e' "P.za", non "P.Za".
  return String(value).toLowerCase().replace(/(^|[\s/-])([a-zà-ù])/g, (_, before, letter) => before + letter.toUpperCase());
}

function tidyLegendName(value = '') {
  return String(value)
    .replace(/\s+/g, ' ')
    .replace(/[\s\-–,;.]+$/, '')
    .trim();
}

/* Che ruolo ha quel posto, se la legenda lo dice. Il posto cambio e' dove si
   da' il cambio, il capolinea dove la vettura inverte: sono parole loro, non
   nostre, e servono a non chiamare le due cose allo stesso modo. */
const ROLE_SUFFIX_RE = /-?\s*(POSTO\s+CAMBIO|CAPOLINEA(?:\s+[\w./]+)*)\s*$/i;

/**
 * Il solo nome del posto, senza la coda che ne dice il ruolo.
 *
 * Sulla scheda di un rientro serve «C.so Maroncelli», non «C.so Maroncelli -
 * Capolinea Ritorno M1s»: il ruolo e la linea li dice gia' il resto della
 * scheda, e ripeterli li' dentro rende la riga illeggibile su un telefono.
 *
 * Si applica sia in lettura sia a video: le letture salvate prima di questa
 * correzione hanno la coda dentro l'etichetta, e ricaricare il PDF per togliere
 * tre parole non e' una cosa da chiedere a nessuno.
 */
export function stripPlaceRole(value = '') {
  return tidyLegendName(String(value || '').replace(ROLE_SUFFIX_RE, ''));
}

export function parseLegend(text = '') {
  const source = String(text || '').toUpperCase().replace(/\s+/g, ' ');
  const legend = {};

  for (const match of source.matchAll(LEGEND_ENTRY_RE)) {
    const code = match[1];
    const name = tidyLegendName(match[2]);
    if (!name || name.length > MAX_LEGEND_NAME) continue;
    const role = /POSTO\s+CAMBIO/.test(name) ? 'cambio' : /CAPOLINEA/.test(name) ? 'capolinea' : '';
    const label = stripPlaceRole(name);
    if (!label) continue;
    const entry = { label: titleCase(label), role };

    /* Di un capolinea la legenda dice anche da che parte sta e di quale linea
       e': "Capolinea andata 58/". Il nome lo si toglie dall'etichetta, ma il
       dato serve, perche' e' l'unico modo per sapere dove va a finire una
       vettura che entra in linea li'. */
    if (role === 'capolinea') {
      const parts = name.match(/CAPOLINEA\s+(ANDATA|RITORNO)?\s*([\d]{1,3}[A-Z]?\/?)?/);
      const direction = (parts?.[1] || '').toLowerCase();
      const terminusLine = normalizeLineCode(parts?.[2] || '');
      if (direction || terminusLine) entry.terminus = { direction, line: terminusLine };
    }

    legend[code] = entry;
  }

  return legend;
}

/**
 * L'altro capolinea della stessa linea: dove va a finire una vettura che entra
 * in linea qui.
 *
 * Il grafico la direzione non la scrive, e infatti le Uscite non la mostrano.
 * Ma se una vettura comincia il servizio a un capolinea, da li' parte verso
 * l'altro capo della linea - e' cosa vuol dire capolinea, non una deduzione - e
 * la legenda dichiara quali sono e di che linea: il dato resta del documento.
 *
 * Torna una stringa vuota in ogni caso in cui non e' certo: il posto non e' un
 * capolinea, la legenda non dice di che linea sia, oppure di capolinea opposti
 * ne trova piu' d'uno. Indicare la parte sbagliata e' peggio che tacere
 * (-> decisioni/0003).
 */
export function findOppositeTerminus(legend = {}, { line = '', place = '' } = {}) {
  const wanted = String(place || '').trim().toUpperCase();
  const here = legend?.[wanted];
  if (here?.role !== 'capolinea' || !here.terminus?.line) return '';

  const lineCode = normalizeLineCode(line);
  if (!lineCode || here.terminus.line !== lineCode) return '';

  const others = Object.entries(legend).filter(
    ([code, entry]) => code !== wanted && entry?.role === 'capolinea' && entry.terminus?.line === lineCode,
  );

  return others.length === 1 ? others[0][0] : '';
}
