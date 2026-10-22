import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectRientriLine,
  findGraphicHints,
  findOppositeTerminus,
  isGraphicKey,
  isRientriKey,
  isUsciteKey,
  parseDepotExits,
  parseDepotReturns,
  parseDepotTransferTimes,
  parseLegend,
  rientriKey,
  stripPlaceRole,
  usciteKey,
} from '../src/parserRientri.js';

// I numeri sono quelli del grafico di servizio della linea 5, versione Q01 del
// 03/08/2026, e tornano con la pagina dei turni: la 102 prende la vettura 2 a
// CATT alle 04.57 dopo essere uscita alle 04.48, cioe' i nove minuti che la
// tabella dichiara.
const TRANSFER_TABLE = `
  TEMPI DI USCITA / RIENTRO 5
  GERB - OBFR 25 20
  GERB - OSET 7 7
  GERB - CATT 9 9
  GERB - ARBA 25
`;

// Come esce il testo leggendo il grafico riga per riga.
const BY_ROW = `${TRANSFER_TABLE}
  Linea U.L. 20.14 CATT 5 Entra 20.23
  Linea U.L. 21.02 CATT 5 Entra 21.11
  Linea U.L. 21.30 CATT 5 Entra 21.39
  Linea U.L. 21.51 OSET 5 Entra 21.58
  Linea U.L. 00.25 OBFR 5 Entra 00.45
  Linea U.L. 00.41 ARBA 5 Entra 01.06
  Linea U.L. 00.55 OBFR 5 Entra 01.15
  Linea U.L. 01.25 OBFR 5 Entra 01.45
`;

// Come esce leggendo per colonne, con le etichette delle vetture in mezzo: e'
// il caso che rompe gli accoppiamenti fatti a occhio.
const BY_COLUMN = `${TRANSFER_TABLE}
  8 Esce 04.13 ARBA GER I.L. 04.22 CATT
  Linea 5 U.L. 20.14 CATT Entra 20.23
  3 Esce 04.17 OBFR GER I.L. 04.24 OSET
  Linea 5 U.L. 21.02 CATT Entra 21.11
  2 Esce 04.48 ARBA GER I.L. 04.57 CATT
  Linea 5 U.L. 21.51 OSET Entra 21.58
`;

test('la tabella dice quanto ci vuole dal capolinea al deposito', () => {
  const transfers = parseDepotTransferTimes(TRANSFER_TABLE);
  assert.deepEqual(transfers.CATT, { out: 9, in: 9 });
  assert.deepEqual(transfers.OSET, { out: 7, in: 7 });
  // Sulla 5 uscire per Orbassano costa cinque minuti piu' che rientrarne.
  assert.deepEqual(transfers.OBFR, { out: 25, in: 20 });
  // Una riga con un numero solo vale per entrambi i versi.
  assert.deepEqual(transfers.ARBA, { out: 25, in: 25 });
  assert.equal(transfers.GERB, undefined);
});

test('la linea si riconosce dalle tabelle in fondo alla pagina', () => {
  assert.equal(detectRientriLine(TRANSFER_TABLE), '5');
  assert.equal(detectRientriLine('TEMPI DI PERCORRENZA ANDATA / RITORNO 17'), '17');
  assert.equal(detectRientriLine('LINEA 62 ORBASSANO'), '62');
  assert.equal(detectRientriLine('niente di utile'), '');
});

test('ogni vettura produce l ultima corsa e il suo ingresso in deposito', () => {
  const returns = parseDepotReturns(BY_ROW, { gt: 'LUN - VEN', ver: 'Q01' });
  assert.equal(returns.length, 8);

  const first = returns[0];
  assert.equal(first.loc_s, 'CATT');
  assert.equal(first.start, '20:14');
  assert.equal(first.end, '20:23');
  assert.equal(first.loc_e, 'GERB');
  assert.equal(first.lineaNorm, '5');
  assert.equal(first.gt, 'LUN - VEN');

  // Da Cattaneo al Gerbido sono nove minuti, non le cinque ore della ripresa.
  const fromCattaneo = returns.filter((item) => item.loc_s === 'CATT');
  assert.equal(fromCattaneo.length, 3);
  assert.deepEqual(
    fromCattaneo.map((item) => `${item.start}→${item.end}`),
    ['20:14→20:23', '21:02→21:11', '21:30→21:39'],
  );
});

test('il rientro dopo mezzanotte non diventa un salto all indietro', () => {
  const returns = parseDepotReturns(BY_ROW, {});
  const midnight = returns.find((item) => item.start === '00:55');
  assert.equal(midnight.end, '01:15');
  // 00:25 OBFR → 00:45 sono i venti minuti del rientro da Orbassano.
  assert.ok(returns.some((item) => item.start === '00:25' && item.end === '00:45'));
});

test('le colonne mescolate non fanno accoppiare U.L. ed Entra sbagliati', () => {
  const returns = parseDepotReturns(BY_COLUMN, {});
  assert.equal(returns.length, 3);
  assert.deepEqual(
    returns.map((item) => `${item.loc_s} ${item.start}→${item.end}`),
    ['CATT 20:14→20:23', 'CATT 21:02→21:11', 'OSET 21:51→21:58'],
  );
});

test('gli U.L. da una parte e gli Entra dall altra si trovano lo stesso', () => {
  /* Il caso vero, e per mesi il piu' grave. Nel testo estratto per colonne gli
     U.L. di tutte le vetture stanno di seguito e gli Entra vengono dopo, tutti
     insieme: fra il primo U.L. e il suo Entra ci sono decine di parole.

     Cercandolo li' accanto se ne trovava una minima parte. Il referto del 24
     agosto lo diceva confrontando le due meta' della stessa pagina - sulla 58/
     tredici uscite e due rientri, sulla 17 nove e uno - e ogni vettura che esce
     prima o poi rientra. E' il difetto per cui l'utente ha visto rientrare una
     63 che l'app non gli dava. */
  const perColonne = `${TRANSFER_TABLE}
    Linea 5
    U.L. 20.14 CATT  U.L. 20.44 CATT  U.L. 21.02 CATT
    U.L. 21.30 CATT  U.L. 21.51 OSET  U.L. 22.20 OSET
    GER Entra 20.23  GER Entra 20.53  GER Entra 21.11
    GER Entra 21.39  GER Entra 21.58  GER Entra 22.27
  `;
  const returns = parseDepotReturns(perColonne, {});
  assert.equal(returns.length, 6);
  assert.deepEqual(
    returns.map((item) => `${item.loc_s} ${item.start}→${item.end}`),
    [
      'CATT 20:14→20:23',
      'CATT 20:44→20:53',
      'CATT 21:02→21:11',
      'CATT 21:30→21:39',
      'OSET 21:51→21:58',
      'OSET 22:20→22:27',
    ],
  );
});

test('un Entra preso da una vettura non serve anche alla successiva', () => {
  // Due U.L. alla stessa ora da posti diversi, e un Entra solo: uno dei due
  // resta senza, invece di prendersi lo stesso ingresso in deposito.
  const returns = parseDepotReturns(`${TRANSFER_TABLE} U.L. 21.02 CATT U.L. 21.02 CATT Entra 21.11`, {});
  assert.equal(returns.length, 1);
});

test('senza Entra credibile non si inventa un rientro', () => {
  // Un Entra lontanissimo non e' il rientro di questa corsa.
  assert.deepEqual(parseDepotReturns(`${TRANSFER_TABLE} U.L. 21.02 CATT Entra 23.40`, {}), []);
  // E il deposito non e' il capolinea di partenza di se stesso.
  assert.deepEqual(parseDepotReturns(`${TRANSFER_TABLE} U.L. 21.02 GERB Entra 21.11`, {}), []);
  assert.deepEqual(parseDepotReturns('pagina senza grafico', {}), []);
});

test('la chiave dei rientri non e quella di un turno', () => {
  assert.equal(rientriKey('5', 'LUN - VEN'), 'RIENTRI 5 LUN - VEN');
  assert.ok(isRientriKey(rientriKey('5', 'LUN - VEN')));
  assert.equal(isRientriKey('05 302'), false);
});

test('nemmeno la chiave delle uscite e quella di un turno', () => {
  assert.equal(usciteKey('5', 'LUN - VEN'), 'USCITE 5 LUN - VEN');
  assert.ok(isUsciteKey(usciteKey('5', 'LUN - VEN')));
  assert.equal(isUsciteKey('05 302'), false);
  // Le due chiavi non si confondono fra loro, o le uscite finirebbero fra i
  // rientri e viceversa.
  assert.equal(isUsciteKey(rientriKey('5', 'LUN - VEN')), false);
  assert.equal(isRientriKey(usciteKey('5', 'LUN - VEN')), false);
  // E insieme sono "tutto quello che non e' uno sviluppo turno".
  assert.ok(isGraphicKey(rientriKey('5', '')) && isGraphicKey(usciteKey('5', '')));
  assert.equal(isGraphicKey('05 302'), false);
});

test('ogni vettura produce anche l uscita dal deposito e il suo ingresso in linea', () => {
  const exits = parseDepotExits(BY_COLUMN, { gt: 'LUN - VEN', ver: 'Q01' });
  assert.equal(exits.length, 3);

  const first = exits[0];
  assert.equal(first.loc_s, 'GERB');
  assert.equal(first.start, '04:13');
  assert.equal(first.end, '04:22');
  assert.equal(first.loc_e, 'CATT');
  assert.equal(first.lineaNorm, '5');
  assert.equal(first.gt, 'LUN - VEN');

  // Nove minuti per Cattaneo e sette per Settembrini: sono i minuti della
  // tabella, non le ore di una ripresa.
  assert.deepEqual(
    exits.map((item) => `${item.loc_e} ${item.start}→${item.end}`),
    ['CATT 04:13→04:22', 'OSET 04:17→04:24', 'CATT 04:48→04:57'],
  );
});

/* Il grafico dice dove la vettura entra in linea, non da che parte prosegue:
   una direzione qui sarebbe inventata, e la palina che ne verrebbe fuori
   manderebbe qualcuno dal lato sbagliato della strada. */
test('l uscita non porta una direzione che il grafico non dichiara', () => {
  const [exit] = parseDepotExits(BY_COLUMN, {});
  assert.equal(exit.dir, '');
});

test('senza I.L. credibile non si inventa un uscita', () => {
  // Un I.L. lontanissimo non e' l'ingresso in linea di questa uscita.
  assert.deepEqual(parseDepotExits(`${TRANSFER_TABLE} 8 Esce 04.13 I.L. 06.40 CATT`, {}), []);
  // E il deposito non e' il posto dove una vettura entra in linea.
  assert.deepEqual(parseDepotExits(`${TRANSFER_TABLE} 8 Esce 04.13 I.L. 04.22 GERB`, {}), []);
  assert.deepEqual(parseDepotExits('pagina senza grafico', {}), []);
  // La pagina dei turni non deve produrre uscite: e' tutto il punto.
  assert.deepEqual(parseDepotExits('05 101 5 / 1 04.48 GERB - 10.15 CATT', {}), []);
});

/* Lo stesso rimedio dei rientri: quando la tabella dichiara il tempo, e' quello
   a dire quale I.L. appartiene a quale Esce. */
test('le colonne mescolate non fanno accoppiare Esce e I.L. sbagliati', () => {
  const mescolato = `${TRANSFER_TABLE}
    2 Esce 04.48 ARBA GER I.L. 04.53 OSET I.L. 04.57 CATT
  `;
  const [exit] = parseDepotExits(mescolato, {});
  // 04.53 sarebbe plausibile, ma da Settembrini la tabella dichiara sette
  // minuti e non cinque: i nove di Cattaneo combaciano, e vince quello.
  assert.equal(exit.loc_e, 'CATT');
  assert.equal(exit.end, '04:57');
});

test('l uscita dopo mezzanotte non diventa un salto all indietro', () => {
  const [exit] = parseDepotExits(`${TRANSFER_TABLE} 4 Esce 23.58 I.L. 00.07 CATT`, {});
  assert.equal(exit.start, '23:58');
  assert.equal(exit.end, '00:07');
});

test('le uscite si leggono anche quando il PDF perde separatori e spazi', () => {
  const compact = `
    TEMPI DI USCITA / RIENTRO 5
    GERB-CATT 9 9
    Esce 0448 IL 0457 CATT
  `;
  const [exit] = parseDepotExits(compact, {});
  assert.equal(`${exit.start}→${exit.end} ${exit.loc_e}`, '04:48→04:57 CATT');
});

/* Il numero prima di "Esce" e' la vettura in una forma del testo e la coda
   della tabella dei tempi in un'altra - "GERB - ARBA 25" seguito da "8 Esce" -
   e le due non si distinguono. Meglio nessun numero che quello di un altro
   mezzo: nel piazzale ci si va a colpo sicuro o non ci si va. */
/* Il testo vero della pagina 13 del PDF Orari del deposito, com'e' uscito dal
   referto `?diag=orari`: la 33, feriale. E' la forma che faceva perdere quasi
   tutte le uscite - gli "Esce" tutti in fila e gli "I.L." tutti dopo - e quella
   pagina dava 8 rientri e 0 uscite.

   Fra il primo Esce e il suo I.L. ci sono sedici parole: il vecchio limite di
   quattordici le tagliava fuori tutte tranne le ultime della pagina. */
const PER_COLONNE_INTERE = `
  TEMPI DI USCITA / RIENTRO 33
  GERB - CLST 19 19
  GERB - NUOV 22 22
  1 ESCE 04.31 CLST 2 ESCE 04.56 CLST 3 ESCE 06.48 CLST 4 ESCE 05.47 ADUA
  GER I.L. 04.50 CLST GER I.L. 05.15 CLST GER I.L. 07.09 CLST GER I.L. 06.09 NUOV
`;

test('gli Esce in fila e gli I.L. tutti dopo si accoppiano nell ordine', () => {
  const exits = parseDepotExits(PER_COLONNE_INTERE, { gt: 'LUN - VEN' });
  assert.equal(exits.length, 4, 'nessuna vettura va persa, nemmeno la prima');
  assert.deepEqual(
    exits.map((item) => `${item.start}→${item.end} ${item.loc_e}`),
    ['04:31→04:50 CLST', '04:56→05:15 CLST', '06:48→07:09 CLST', '05:47→06:09 NUOV'],
  );
});

/* Il posto scritto dopo l'Esce non e' dove la vettura entra in linea: la 4
   esce "ADUA" e comincia a NUOV. Chi prende quel mezzo deve leggere NUOV. */
test('la destinazione la dice l I.L., non il posto scritto dopo l Esce', () => {
  const quarta = parseDepotExits(PER_COLONNE_INTERE, {}).find((item) => item.start === '05:47');
  assert.equal(quarta.loc_e, 'NUOV');
});

/* Un ingresso in linea appartiene a una vettura sola: se due Esce potessero
   prendersi lo stesso I.L., una pagina produrrebbe uscite doppie e un mezzo
   inesistente. */
test('due uscite non si prendono lo stesso ingresso in linea', () => {
  const exits = parseDepotExits(PER_COLONNE_INTERE, {});
  const ingressi = exits.map((item) => `${item.end} ${item.loc_e}`);
  assert.equal(new Set(ingressi).size, ingressi.length);
});

test('l uscita non porta un numero di vettura indistinguibile da un tempo', () => {
  assert.equal(parseDepotExits(BY_COLUMN, {})[0].vett, '');
  const dallaTabella = parseDepotExits(`${TRANSFER_TABLE} Esce 04.48 I.L. 04.57 CATT`, {});
  assert.equal(dallaTabella[0].vett, '', 'il 25 di "GERB - ARBA 25" non e una vettura');
});

test('legge le forme che il PDF produce quando perde separatori e spazi', () => {
  // Ora senza separatore e capolinea attaccati: "2151" e "GERB-OSET".
  const compact = `
    TEMPI DI USCITA / RIENTRO 5
    GERB-OSET 7 7
    GERB-CATT 9 9
    Linea 5 UL 2151 OSET Entra 2158
    Linea 5 U.L 2102 CATT Entra 2111
  `;
  const returns = parseDepotReturns(compact, {});
  assert.deepEqual(
    returns.map((item) => `${item.loc_s} ${item.start}→${item.end}`),
    ['OSET 21:51→21:58', 'CATT 21:02→21:11'],
  );
  assert.deepEqual(parseDepotTransferTimes(compact).OSET, { out: 7, in: 7 });
});

test('il referto distingue la pagina assente dalla pagina non riconosciuta', () => {
  assert.deepEqual(findGraphicHints('05 302 5 / 2 16.33 CATT R 21.58 GERB'), { excerpt: '', markers: [] });
  const hints = findGraphicHints('LINEA 5 TEMPI DI USCITA / RIENTRO 5 UL 2151 OSET ENTRA 2158');
  assert.deepEqual(hints.markers, ['ul', 'entra', 'tempi']);
  assert.match(hints.excerpt, /TEMPI DI USCITA/);
  // L'I.L. conta come marcatore solo quando ha la sua ora dietro: "il" da solo
  // e' una parola come un'altra, e un marcatore falso vale meno di niente.
  assert.deepEqual(findGraphicHints('8 ESCE 04.13 I.L. 04.22 CATT').markers, ['esce', 'il']);
  assert.deepEqual(findGraphicHints('IL DEPOSITO DEL GERBIDO').markers, []);
});

test('la legenda del PDF traduce i codici nel posto vero', () => {
  const legenda = `
    Legenda
    OBFR = ORBASSANO - STRADA TORINO - Capolinea andata 5
    BNCE = BEINASCO - CENTRO
    OSET = C. ORBASSANO / C. SETTEMBRINI
    CATT = P.ZA CATTANEO - Posto cambio
    ORBX = L.GO ORBASSANO
    ARBA = P.ZA ARBARELLO - Capolinea ritorno 5
    GERB = DEPOSITO GERBIDO
  `;
  const legend = parseLegend(legenda);

  assert.equal(legend.CATT.label, 'P.za Cattaneo');
  assert.equal(legend.OSET.label, 'C. Orbassano / C. Settembrini');
  assert.equal(legend.OBFR.label, 'Orbassano - Strada Torino');
  assert.equal(legend.ORBX.label, 'L.go Orbassano');
  // Il documento dice anche a cosa serve il posto: sono parole sue.
  assert.equal(legend.CATT.role, 'cambio');
  assert.equal(legend.OBFR.role, 'capolinea');
  assert.equal(legend.BNCE.role, '');
});

test('la legenda regge anche senza spazi intorno all uguale', () => {
  assert.equal(parseLegend('Legenda: GERB=DEPOSITO GERBIDO').GERB.label, 'Deposito Gerbido');
  assert.deepEqual(parseLegend('05 302 5 / 2 16.33 CATT R 21.58 GERB'), {});
});

test('la linea si ricava anche dai codici dell orario tipo', () => {
  // Sul grafico l'intestazione non porta la parola "linea": restano i codici.
  assert.equal(detectRientriLine('CODICI H05Q0101 A05Q0101 W05Q0101'), '5');
  assert.equal(detectRientriLine('CODICI A58BQ0101'), '58B');
});

test('M1S, M1N e CP1 sono linee come la 5, non sigle', () => {
  /* Cercando solo cifre restavano senza linea, e sulla scheda del rientro
     diventavano una pillola gialla vuota - segnalata dall'utente il 22 agosto.
     Non sono abbreviazioni di qualcos'altro: il GTFS le elenca alla pari, con
     nome e percorso, e qui vanno lette alla pari. */
  assert.equal(detectRientriLine('LINEA M1S'), 'M1S');
  assert.equal(detectRientriLine('TEMPI DI USCITA / RIENTRO M1N'), 'M1N');
  assert.equal(detectRientriLine('LINEA CP1'), 'CP1');
  assert.equal(detectRientriLine('CODICI AM1SQ0101'), 'M1S');
  // Anche la legenda basta, quando intestazione e tabelle si perdono.
  assert.equal(detectRientriLine('MARC = C.SO MARONCELLI - CAPOLINEA RITORNO M1S'), 'M1S');
});

test('una linea si legge anche se il Gerbido non la conosce ancora', () => {
  /* L'elenco delle linee del Gerbido e' una fotografia, non una legge: se il
     PDF ne porta una che non c'e' ancora, si legge lo stesso invece di
     lasciare la scheda muta. VE1 e W01 sono linee GTT vere. */
  assert.equal(detectRientriLine('LINEA VE1'), 'VE1');
  assert.equal(detectRientriLine('LINEA W01'), 'W01');
  assert.equal(detectRientriLine('LINEA 58/'), '58B');
});

test('non si scambia per linea la parola che capita li accanto', () => {
  assert.equal(detectRientriLine('LINEA GERBIDO DEPOSITO'), '');
  assert.equal(detectRientriLine('LINEA CATT'), '');
  assert.equal(detectRientriLine('niente di utile'), '');
});

test('il nome del posto non si porta dietro il ruolo', () => {
  /* Sulla scheda serve «C.so Maroncelli», non «C.so Maroncelli - Capolinea
     Ritorno M1s»: il ruolo e la linea li dice gia' il resto della scheda. */
  assert.equal(parseLegend('MARC = C.SO MARONCELLI - CAPOLINEA RITORNO M1S').MARC.label, 'C.so Maroncelli');
  // La stessa pulizia si applica a video, sulle letture gia' salvate.
  assert.equal(stripPlaceRole('C.so Maroncelli - Capolinea Ritorno M1s'), 'C.so Maroncelli');
  assert.equal(stripPlaceRole('P.za Cattaneo - Posto cambio'), 'P.za Cattaneo');
  // Un nome che il ruolo non ce l'ha resta intero.
  assert.equal(stripPlaceRole('C. Orbassano / C. Settembrini'), 'C. Orbassano / C. Settembrini');
  assert.equal(stripPlaceRole(''), '');
});

test('il capolinea del grafico trova la sua palina passando dalla legenda', () => {
  // I tre casi visti sull'app, con i tempi che il grafico dichiara.
  const casi = [
    ['74', 'GORX', 'V. GORINI', 2, '693'],
    ['63', 'NEGR', 'NEGARVILLE', 11, '1158'],
    ['132', 'FERM', 'FERMI', 20, '5001'],
  ];

  casi.forEach(([line, code, nome, minuti, palina]) => {
    const text = `
      LINEA ${line}
      TEMPI DI USCITA / RIENTRO ${line}
      GERB - ${code} ${minuti} ${minuti}
      Legenda ${code} = ${nome} - Capolinea
      GERB = DEPOSITO GERBIDO
      Linea ${line} U.L. 12.53 ${code} Entra 12.55
    `;
    const [rientro] = parseDepotReturns(text, {});
    assert.equal(rientro.palina, palina, `${code} doveva essere la palina ${palina}`);
    assert.ok(Number.isFinite(rientro.position.lat), `${code} senza posizione`);
  });
});

test('un capolinea troppo lontano per il tempo dichiarato viene buttato', () => {
  // Fermi sta a quattro chilometri dal deposito: due minuti vorrebbero dire
  // centoventi all'ora, quindi il nome ha pescato la fermata sbagliata.
  const text = `
    LINEA 132
    TEMPI DI USCITA / RIENTRO 132
    GERB - FERM 2 2
    Legenda FERM = FERMI - Capolinea
    Linea 132 U.L. 13.25 FERM Entra 13.27
  `;
  const [rientro] = parseDepotReturns(text, {});
  assert.equal(rientro.position, null);
  assert.equal(rientro.palina, '');
  // Il rientro resta: e' l'orario a essere certo, non la posizione.
  assert.equal(rientro.start, '13:25');
});

test('senza legenda il rientro resta senza posizione, non con una sbagliata', () => {
  const [rientro] = parseDepotReturns(
    'LINEA 74 TEMPI DI USCITA / RIENTRO 74 GERB - GORX 2 2 Linea 74 U.L. 12.53 GORX Entra 12.55',
    {},
  );
  assert.equal(rientro.position, null);
  assert.equal(rientro.loc_s, 'GORX');
});

/* La legenda della 58/, nella forma in cui compare sul grafico: dice quali
   sono i due capolinea e di che linea sono. Serve a sapere dove va a finire
   una vettura che entra in linea a uno dei due. */
const LEGENDA_58 = `
  Legenda
  GCAS = VIA BERTOLA - Capolinea andata 58/
  GROS = VIA GROSSO - Capolinea ritorno 58/
  FILA = VIA FILADELFIA - Posto cambio
  GERB = DEPOSITO GERBIDO
`;

test('di un capolinea la legenda tiene da che parte sta e di che linea e', () => {
  const legenda = parseLegend(LEGENDA_58);
  assert.deepEqual(legenda.GCAS.terminus, { direction: 'andata', line: '58B' });
  assert.deepEqual(legenda.GROS.terminus, { direction: 'ritorno', line: '58B' });
  // Il nome resta pulito: la coda del ruolo non entra nell'etichetta.
  assert.equal(legenda.GCAS.label, 'Via Bertola');
  // Un posto cambio non e' un capolinea e non ha un opposto.
  assert.equal(legenda.FILA.terminus, undefined);
});

/* Il grafico la direzione non la scrive. Ma da un capolinea si parte verso
   l'altro capo della linea: e' cosa vuol dire capolinea, non una deduzione. */
test('da un capolinea si va verso l altro capolinea della stessa linea', () => {
  const legenda = parseLegend(LEGENDA_58);
  assert.equal(findOppositeTerminus(legenda, { line: '58B', place: 'GCAS' }), 'GROS');
  assert.equal(findOppositeTerminus(legenda, { line: '58B', place: 'GROS' }), 'GCAS');
  // La linea si riconosce anche scritta come sul documento.
  assert.equal(findOppositeTerminus(legenda, { line: '58/', place: 'GCAS' }), 'GROS');
});

test('quando non e certo non si indica nessuna direzione', () => {
  const legenda = parseLegend(LEGENDA_58);
  // Un posto cambio non dice da che parte prosegue il mezzo.
  assert.equal(findOppositeTerminus(legenda, { line: '58B', place: 'FILA' }), '');
  // Il capolinea di un'altra linea non c'entra.
  assert.equal(findOppositeTerminus(legenda, { line: '5', place: 'GCAS' }), '');
  // Un posto che la legenda non conosce nemmeno.
  assert.equal(findOppositeTerminus(legenda, { line: '58B', place: 'ZZZZ' }), '');
  assert.equal(findOppositeTerminus({}, { line: '58B', place: 'GCAS' }), '');
});

/* Con tre capolinea della stessa linea - capita quando una variante ne aggiunge
   uno - non si sa quale sia l'opposto, e allora non si dice niente. */
test('con piu di un capolinea opposto si tace', () => {
  const ambigua = parseLegend(`
    Legenda
    GCAS = VIA BERTOLA - Capolinea andata 58/
    GROS = VIA GROSSO - Capolinea ritorno 58/
    ALLA = VIA ALLASON - Capolinea ritorno 58/
  `);
  assert.equal(findOppositeTerminus(ambigua, { line: '58B', place: 'GCAS' }), '');
});

// La 39 feriale, come esce dal PDF (referto del 22 ottobre): sei "Esce" ma tre
// "I.L." avevano un codice di posto davanti all'ora, e la 06:35 restava senza il
// suo ingresso in linea. La tabella dei tempi dichiarava CAIQ 25/10.
const PAGINA_39_FERIALE = `PROGRAMMAZIONE 1 ESCE 04.35 BABA 2 ESCE 07.25 CAIQ 3 ESCE 06.04 CAIQ
URBANO GER BABA I.L. CAIQ 05.00 CAIQ BABA GER BABA I.L. CAIQ 07.35 CAIQ CAIQ GER BABA I.L. CAIQ 06.14 CAIQ CAIQ
101 002 003 P.ZA BADEN BADEN P.ZA CAIO MARIO 39 AUTOBUS
4 ESCE 12.54 CAIQ 5 ESCE 04.50 CAIQ 6 ESCE 06.35 CAIQ
GER I.L. 13.04 CAIQ GER I.L. 05.00 CAIQ GER I.L. 06.45 CAIQ
TEMPI DI USCITA / RIENTRO 39 GERB - CAIQ 25 10
LEGENDA LINEA ENTRA U.L. 10.22 10.32 CAIQ LINEA ENTRA U.L. 21.40 21.50 CAIQ
LINEA U.L. 21.19 CAIQ ENTRA 21.29`;

test('le uscite con un codice di posto fra I.L. e l\'ora si abbinano tutte, ognuna alla sua', () => {
  const exits = parseDepotExits(PAGINA_39_FERIALE, { gt: 'LUN - VEN', line: '39' });
  const coppie = exits.map((exit) => `${exit.start}>${exit.end}`).sort();

  assert.deepEqual(coppie, ['04:35>05:00', '04:50>05:00', '06:04>06:14', '06:35>06:45', '07:25>07:35', '12:54>13:04']);
});

test('i rientri nella forma "ENTRA U.L. 10.22 10.32 CAIQ" si leggono, senza perdere gli altri', () => {
  const returns = parseDepotReturns(PAGINA_39_FERIALE, { gt: 'LUN - VEN', line: '39' });
  const coppie = returns.map((item) => `${item.start}>${item.end} ${item.loc_s}`).sort();

  assert.deepEqual(coppie, ['10:22>10:32 CAIQ', '21:19>21:29 CAIQ', '21:40>21:50 CAIQ']);
});
