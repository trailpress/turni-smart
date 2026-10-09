import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrari } from '../src/parserOrari.js';
import {
  buildOrariReport,
  compareReturnsAndExits,
  countExits,
  summarizeByGt,
  summarizePages,
} from '../src/utils/orariDiagnostics.js';

/* Tre pagine: la prima dichiara il festivo, le due dopo non dichiarano niente
   e se lo prendono da lei. E' il meccanismo che va reso visibile. */
const PAGINE = [
  'Gruppo 05 - FESTIVO - Versione 2\n05 / 1 05:10 GERB A 05:32 CATT',
  '05 / 2 06:10 GERB A 06:32 CATT',
  '05 / 3 07:10 GERB A 07:32 CATT',
];

test('la diagnostica non cambia quello che il parser produce', () => {
  const senza = parseOrari(PAGINE);
  const diagnostics = [];
  const con = parseOrari(PAGINE, { diagnostics });
  assert.deepEqual(con, senza, 'gli sviluppi devono essere identici');
  assert.equal(diagnostics.length, 3, 'e il referto si riempie a parte');
});

test('si vede quale pagina ha dichiarato il servizio e quale lo ha ereditato', () => {
  const diagnostics = [];
  parseOrari(PAGINE, { diagnostics });

  assert.equal(diagnostics[0].own, 'FESTIVO', 'la prima lo dichiara');
  assert.equal(diagnostics[1].own, '', 'la seconda no');
  assert.equal(diagnostics[2].own, '', 'la terza nemmeno');
  assert.equal(diagnostics[1].gt, 'FESTIVO', 'ma il tipo assegnato e quello ereditato');
});

test('le pagine si leggono come tratte, con quante si sono dichiarate', () => {
  const diagnostics = [];
  parseOrari(PAGINE, { diagnostics });
  const summary = summarizePages(diagnostics);

  assert.equal(summary.total, 3);
  assert.equal(summary.recognized, 1);
  assert.equal(summary.inherited, 2);
  assert.deepEqual(
    summary.runs.map((run) => `${run.from}-${run.to} ${run.gt} ${run.recognized}/${run.pages}`),
    ['1-3 FESTIVO 1/3'],
    'una tratta sola con una pagina riconosciuta su tre',
  );
});

test('una tratta nuova comincia quando il tipo cambia', () => {
  const summary = summarizePages([
    { gt: 'LUN - VEN', own: 'LUN - VEN', page: 1 },
    { gt: 'LUN - VEN', own: '', page: 2 },
    { gt: 'SABATO', own: 'SABATO', page: 3 },
  ]);
  assert.deepEqual(
    summary.runs.map((run) => `${run.from}-${run.to} ${run.service}`),
    ['1-2 feriali', '3-3 sabato'],
  );
});

/* Righe lette contro mezzi distinti: la distanza fra i due numeri e' quanto
   il parser sta duplicando, e senza vederla non si sa se un totale alto sia
   il deposito o l'archiviazione. */
test('le uscite si contano sia per riga sia per mezzo', () => {
  const segments = [
    { start: '05:10', loc_s: 'GERB', end: '05:32', loc_e: 'CATT', ln: '05', gt: 'LUN - VEN' },
    { start: '05:10', loc_s: 'GERB', end: '05:32', loc_e: 'CATT', ln: '05', gt: 'LUN - VEN' },
    { start: '05:20', loc_s: 'GERB', end: '05:42', loc_e: 'CATT', ln: '05', gt: 'LUN - VEN' },
  ];
  assert.deepEqual(countExits(segments), { rows: 3, unique: 2 });
});

test('i rientri e i giri interni al deposito non sono uscite', () => {
  const segments = [
    { start: '05:32', loc_s: 'CATT', end: '06:15', loc_e: 'GERB', ln: '05', gt: 'LUN - VEN' },
    { start: '04:00', loc_s: 'GERB', end: '10:15', loc_e: 'GERB', ln: '05', gt: 'LUN - VEN' },
  ];
  assert.deepEqual(countExits(segments), { rows: 0, unique: 0 });
});

test('il riepilogo raggruppa per intestazione e dice a che servizio finisce', () => {
  const developments = {
    '05 101': [
      { start: '05:10', loc_s: 'GERB', end: '05:32', loc_e: 'CATT', ln: '05', gt: 'LUN - VEN' },
      { start: '05:10', loc_s: 'GERB', end: '05:32', loc_e: 'CATT', ln: '05', gt: 'FESTIVO' },
    ],
  };
  const summary = summarizeByGt(developments);
  assert.deepEqual(
    summary.map((item) => `${item.gt}=${item.service}`),
    ['LUN - VEN=feriali', 'FESTIVO=festivi'],
  );
});

test('il referto sta in piedi anche senza le pagine', () => {
  const report = buildOrariReport({ developments: {}, pages: null });
  assert.match(report, /pagine: non disponibili/);
  assert.match(report, /nessuno sviluppo caricato/);
});

test('il referto dice le tratte e i conti per intestazione', () => {
  const diagnostics = [];
  const developments = parseOrari(PAGINE, { diagnostics });
  const report = buildOrariReport({ developments, pages: diagnostics });

  assert.match(report, /pagine 3 · riconosciute 1 · ereditate 2/);
  assert.match(report, /p1-3 "FESTIVO" \[festivi\] ric 1\/3/);
  assert.match(report, /"FESTIVO" \[festivi\] segm \d+ · usc \d+ → \d+/);
});

/* Il caso vero visto sul PDF del deposito: le uscite si leggono su qualche
   pagina e si perdono su molte altre. Il totale non e' zero, e prima di questo
   il referto restava muto proprio li' - cioe' nel caso in cui serviva. */
const GRAFICO_COMPLETO = `GTT gruppo torinese trasporti - SABATO - Versione Q01
LINEA 5
8 Esce 04.13 ARBA GER I.L. 04.22 CATT
Linea 5 U.L. 21.51 OSET Entra 21.58
TEMPI DI USCITA / RIENTRO 5
GERB - OSET 7 7
GERB - CATT 9 9`;

/* La stessa pagina di un'altra linea, con l'ingresso in linea scritto in una
   forma che il parser non riconosce: i rientri escono, le uscite no. */
const GRAFICO_SENZA_USCITE = `GTT gruppo torinese trasporti - SABATO - Versione Q01
LINEA 63
7 Esce 05.40 IN LINEA 05.51 NEGR
Linea 63 U.L. 22.10 NEGR Entra 22.21
TEMPI DI USCITA / RIENTRO 63
GERB - NEGR 11 11`;

test('il referto mostra le pagine incomplete anche quando altrove le uscite si leggono', () => {
  const diagnostics = [];
  const developments = parseOrari([GRAFICO_COMPLETO, GRAFICO_SENZA_USCITE], { diagnostics });
  const report = buildOrariReport({ developments, pages: diagnostics });

  // Le uscite in tutto il documento non sono zero: la 5 le ha.
  assert.match(report, /USCITE 5 SABATO/);
  // Ma la pagina della 63 va segnalata lo stesso, con il suo testo.
  assert.match(report, /pagine col grafico 2, incomplete 1/);
  assert.match(report, /p2 rientri 1 uscite 0 marcatori/);
  assert.match(report, /IN LINEA 05\.51 NEGR/, 'l estratto parte da Esce, dove il parser si perde');
});

test('quando ogni pagina col grafico e completa il referto lo dice', () => {
  const diagnostics = [];
  const developments = parseOrari([GRAFICO_COMPLETO], { diagnostics });
  const report = buildOrariReport({ developments, pages: diagnostics });
  assert.match(report, /pagine col grafico 1, tutte lette per intero/);
});

/* Senza i dati delle pagine il referto non puo' sapere se il PDF il grafico ce
   l'abbia: prima diceva "nessuna pagina col grafico", che e' un'affermazione
   sul documento, e ha mandato fuori strada chi la leggeva. */
test('senza le pagine il referto non dice cosa non puo sapere', () => {
  const report = buildOrariReport({ developments: {}, pages: null });
  assert.match(report, /pagine col grafico: non si sa/);
  assert.doesNotMatch(report, /nessuna pagina col grafico/);
});

test('un PDF senza il grafico resta distinguibile da uno non letto', () => {
  const diagnostics = [];
  const developments = parseOrari(['GTT gruppo torinese trasporti - SABATO - Versione Q01\n05 101 5 / 1 04.48 GERB - 10.15 CATT'], {
    diagnostics,
  });
  const report = buildOrariReport({ developments, pages: diagnostics });
  assert.match(report, /nessuna pagina col grafico in questo PDF/);
});

test('il referto mette rientri e uscite della stessa linea uno accanto all altro', () => {
  /* Ogni vettura che esce dal deposito prima o poi ci rientra: due conti molto
     diversi sulla stessa pagina vogliono dire che una delle due meta' si perde
     per strada. E' il confronto che il 24 agosto ha fatto trovare il difetto
     dei rientri - «58B: rientri 2, uscite 13» - dopo mesi che era li'. */
  const developments = {
    'RIENTRI 58B LUN - VEN': new Array(2).fill({}),
    'USCITE 58B LUN - VEN': new Array(13).fill({}),
    'RIENTRI 5 LUN - VEN': new Array(8).fill({}),
    'USCITE 5 LUN - VEN': new Array(7).fill({}),
    'RIENTRI 71 LUN - VEN': [],
    'USCITE 71 LUN - VEN': new Array(4).fill({}),
  };

  const squilibri = compareReturnsAndExits(developments);
  assert.deepEqual(
    squilibri.map((item) => `${item.name} ${item.returns}/${item.exits}`),
    ['58B LUN - VEN 2/13', '71 LUN - VEN 0/4'],
  );
  // La 5, con otto e sette, non e' uno squilibrio: e' come devono essere.
  assert.ok(!squilibri.some((item) => item.name.startsWith('5 ')));

  const report = buildOrariReport({ developments });
  assert.match(report, /squilibrio rientri\/uscite su 2/);
  assert.match(report, /58B LUN - VEN · rientri 2 · uscite 13/);
});

test('quando i conti tornano il referto lo dice, invece di tacere', () => {
  const report = buildOrariReport({
    developments: {
      'RIENTRI 5 LUN - VEN': new Array(8).fill({}),
      'USCITE 5 LUN - VEN': new Array(7).fill({}),
    },
  });
  assert.match(report, /conti confrontabili su tutte le linee/);
});

test('il referto elenca gli sviluppi con tratti sovrapposti, con vettura e ripresa', () => {
  const seg = (start, end, vett, run_id) => ({ start, end, loc_s: 'SIRA', loc_e: 'SIRA', vett, run_id, gt: 'LUN - VEN' });
  const developments = {
    '56 56': [seg('11:08', '13:37', '13', 4), seg('11:56', '13:49', '14', 9), seg('14:58', '18:23', '6', 4)],
    '56 58': [seg('08:08', '12:41', '8', 5), seg('13:45', '15:43', '11', 5)],
  };
  const report = buildOrariReport({ developments });

  assert.match(report, /sviluppi con tratti sovrapposti: 1/);
  assert.match(report, /56 56 "LUN - VEN": 11:08-13:37 SIRA>SIRA v13 #4 \| 11:56-13:49 SIRA>SIRA v14 #9/);
  assert.doesNotMatch(report, /56 58 "LUN - VEN"/);
});

test('senza sovrapposizioni il referto lo dice', () => {
  const developments = { '56 58': [{ start: '08:08', end: '12:41', loc_s: 'SIRA', loc_e: 'SIRA', gt: 'LUN - VEN' }] };
  assert.match(buildOrariReport({ developments }), /sviluppi con tratti sovrapposti: nessuno/);
});
