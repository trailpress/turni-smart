import test from 'node:test';
import assert from 'node:assert/strict';
import { getDevSegments, parseOrari } from '../src/parserOrari.js';

const HEADER = 'GTT gruppo torinese trasporti - LUN - VEN - Versione Q01\n';
const VENERDI = new Date(2026, 9, 9);
const TURNO_56 = { l: '56', n: '056', i: '0426', li: 'GERB', e: '1528', le: 'SIRA' };

function seg(start, end, vett, extra = {}) {
  return { ln: '56', lineaNorm: '56', vett, start, loc_s: 'SIRA', end, loc_e: 'SIRA', gt: 'LUN - VEN', run_id: 1, ...extra };
}

function sovrapposti(segments) {
  return segments.some((segment, index) => index > 0 && segment.start < segments[index - 1].end);
}

// Lo sviluppo mostrato il 9 ottobre: quattro tratti con vetture 14, 13, 14 e 9,
// di cui tre si accavallano. Una sola persona non guida due tratti insieme.
test('i tratti di turni diversi finiti sotto lo stesso codice non fanno uno sviluppo', () => {
  const pagina =
    HEADER +
    '56 056 56/14 04:26 GERB A 09:25 SIRA 56/13 11:08 SIRA R 13:37 SIRA\n' +
    '56/14 11:56 SIRA A 13:49 SIRA\n' +
    '56/9 12:55 SIRA R 15:28 SIRA';
  const developments = parseOrari([pagina]);
  const segments = getDevSegments(developments, '56', '056', VENERDI, TURNO_56);

  assert.equal(sovrapposti(segments), false);
  assert.ok(segments.every((segment) => segment.start === '04:26' || segment.start >= '09:25'));
});

test('una lettura gia' + "' salvata con i turni mescolati non mostra tratti sovrapposti", () => {
  const developments = {
    '56 56': [
      seg('04:26', '09:25', '14', { loc_s: 'GERB' }),
      seg('11:08', '13:37', '13'),
      seg('11:56', '13:49', '14'),
      seg('12:55', '15:28', '9'),
    ],
  };
  const segments = getDevSegments(developments, '56', '056', VENERDI, TURNO_56);

  assert.equal(sovrapposti(segments), false);
  assert.equal(segments[0].start, '04:26');
});

test('con la fine del turno nota, lo sviluppo si ricostruisce fino a li', () => {
  const developments = {
    '56 56': [
      seg('04:26', '09:25', '14', { loc_s: 'GERB' }),
      seg('11:08', '13:37', '13'),
      seg('11:56', '13:49', '14'),
      seg('12:55', '15:28', '9'),
    ],
  };
  const segments = getDevSegments(developments, '56', '056', VENERDI, TURNO_56);

  assert.equal(segments[segments.length - 1].end, '15:28');
});

test('uno sviluppo coerente resta com\'e\'', () => {
  const developments = {
    '56 56': [
      seg('04:26', '09:25', '14', { loc_s: 'GERB' }),
      seg('11:08', '13:37', '13'),
      seg('13:49', '15:28', '9'),
    ],
  };
  const segments = getDevSegments(developments, '56', '056', VENERDI, TURNO_56);

  assert.deepEqual(
    segments.map((segment) => segment.start),
    ['04:26', '11:08', '13:49'],
  );
});

test('un tratto che passa la mezzanotte non si prende per una sovrapposizione', () => {
  const developments = {
    '56 56': [
      seg('21:10', '23:50', '4', { loc_s: 'GERB' }),
      seg('00:05', '00:40', '4', { loc_e: 'GERB' }),
    ],
  };
  const segments = getDevSegments(developments, '56', '056', VENERDI, {
    ...TURNO_56,
    i: '2110',
    e: '0040',
    le: 'GERB',
  });

  assert.equal(segments.length, 2);
});

// La pagina dei turni cosi' com'esce sull'iPhone (referto del 22 ottobre): dal
// basso in alto, con le righe di continuazione PRIMA di quella che ha
// l'etichetta, e con la tabella di San Paolo e quella del Gerbido sulle stesse
// righe. Il parser attaccava le continuazioni al turno letto per ultimo: il
// tratto delle 14:58 della 056 finiva sotto il 058.
const PAGINA_DAL_BASSO = `56 703 56 / 3 09.29 SIRA R 12.36 SIRA 03.07 03.07 -----
56 509 56 / 9 07.52 GERB - 11.02 SIRA 03.10 03.10 -----
56 414 56 / 14 19.20 SIRA R 01.51 GERB 06.31 06.31 -----
56 408 56 / 8 18.52 SIRA A 01.17 GERB 06.25 06.25 -----
56 406 56 / 6 20.22 SIRA R 01.18 GERB 04.56 04.56 -----
56 / 3 20.40 SIRA A 00.45 GERB
56 403 56 / 6 18.23 SIRA A 20.22 SIRA 06.04 06.22 -----
56 / 1 16.54 SIRA R 20.12 GERB
56 321 56 / 13 13.37 SIRA R 16.11 SIRA 05.52 06.35 -----
56 / 4 17.26 SIRA R 20.35 GERB
56 314 56 / 14 13.49 SIRA R 17.09 SIRA 06.29 06.46 -----
56 313 56 / 13 16.11 SIRA R 21.47 GERB 05.36 05.36 -----
56 311 56 / 11 15.43 SIRA R 21.37 GERB 05.54 05.54 -----
56 309 56 / 9 15.28 SIRA R 21.17 GERB 05.49 05.49 -----
56 308 56 / 8 12.41 SIRA R 18.52 SIRA 06.11 06.11 -----
56 307 56 / 7 15.22 GERB - 21.03 GERB 05.41 05.41 -----
56 304 56 / 4 12.13 SIRA R 17.26 SIRA 05.13 05.13 -----
56 303 56 / 3 14.31 SIRA R 20.40 SIRA 06.09 06.09 -----
56 / 14 17.09 SIRA A 19.20 SIRA
56 / 1 14.53 SIRA A 16.54 SIRA
56 301 56 / 3 12.36 SIRA A 14.31 SIRA 06.07 06.44 -----
56 / 1 09.07 SIRA R 14.53 SIRA
56 211 56 / 11 08.03 GERB - 08.44 SIRA 06.27 06.50 -----
56 / 14 11.20 SIRA R 11.56 SIRA
56 113 56 / 13 06.19 GERB - 11.08 SIRA 05.25 05.37 -----
56 / 11 08.44 SIRA A 10.40 SIRA
56 112 56 / 12 04.05 GERB - 08.22 SIRA 06.13 06.35 -----
56 110 56 / 10 05.46 GERB - 10.54 GERB 05.08 05.08 -----
56 532 56 / 32 07.01 SPAO - 09.50 SABN 02.49 02.49 ----- 56 / 12 08.22 SIRA R 11.20 GERB
56 332 56 / 32 16.25 SABN R 21.47 SPAO 05.22 05.22 ----- 56 108 56 / 8 05.28 GERB - 08.08 SIRA 05.38 05.52 -----
56 331 56 / 31 15.45 SABN R 21.13 SPAO 05.28 05.28 ----- 56 106 56 / 6 07.30 GERB - 13.03 SIRA 05.33 05.33 -----
56 232 56 / 32 11.22 SABN R 16.25 SABN 05.03 05.03 ----- 56 104 56 / 4 07.06 GERB - 12.13 SIRA 05.07 05.07 -----
56 / 31 11.41 SABN A 15.45 SABN 56 / 9 11.02 SIRA A 12.55 SIRA
56 231 56 / 32 09.50 SABN A 11.22 SABN 05.36 05.55 ----- 56 102 56 / 2 06.44 GERB - 09.47 GERB 04.56 06.11 -----
56 131 56 / 31 06.26 SPAO - 11.41 SABN 05.15 05.15 ----- 56 / 14 09.25 SIRA A 11.20 SIRA
Linea / vett. ora Luogo Dir ora Luogo guida Ord. Stra. 56 101 56 / 1 04.44 GERB - 09.07 SIRA 06.18 06.36 -----
Linea Turno Note netto di Ore di servizio 56 / 11 13.45 SIRA A 15.43 SIRA
Servizio su Inizio Fine Tempo 56 058 56 / 8 08.08 SIRA A 12.41 SIRA 06.31 06.31 -----
Deposito DEPOSITO S.PAOLO 56 / 6 14.58 SIRA R 18.23 SIRA
56 056 56 / 13 11.08 SIRA R 13.37 SIRA 05.54 05.54 -----`;

const orari = (developments, key) => (developments[key] || []).map((segment) => `${segment.start}-${segment.end}`);
const TURNO_056 = { l: '56', n: '056', i: '1108', li: 'SIRA', e: '1823', le: 'SIRA' };

function controlla(developments) {
  assert.deepEqual(orari(developments, '56 56'), ['11:08-13:37', '14:58-18:23']);
  assert.deepEqual(orari(developments, '56 58'), ['08:08-12:41', '13:45-15:43']);
  assert.deepEqual(orari(developments, '56 101'), ['04:44-09:07', '09:25-11:20']);
  assert.deepEqual(orari(developments, '56 102'), ['06:44-09:47', '11:02-12:55']);
  assert.deepEqual(orari(developments, '56 108'), ['05:28-08:08', '08:22-11:20']);
  assert.deepEqual(orari(developments, '56 112'), ['04:05-08:22', '08:44-10:40']);
  assert.deepEqual(orari(developments, '56 113'), ['06:19-11:08', '11:20-11:56']);
  assert.deepEqual(orari(developments, '56 211'), ['08:03-08:44', '09:07-14:53']);
  assert.deepEqual(orari(developments, '56 301'), ['12:36-14:31', '14:53-16:54', '17:09-19:20']);
  assert.deepEqual(orari(developments, '56 303'), ['14:31-20:40']);
  assert.deepEqual(orari(developments, '56 314'), ['13:49-17:09', '17:26-20:35']);
  assert.deepEqual(orari(developments, '56 321'), ['13:37-16:11', '16:54-20:12']);
  assert.deepEqual(orari(developments, '56 403'), ['18:23-20:22', '20:40-00:45']);
  assert.deepEqual(orari(developments, '56 406'), ['20:22-01:18']);
  // San Paolo, sulle stesse righe.
  assert.deepEqual(orari(developments, '56 231'), ['09:50-11:22', '11:41-15:45']);
  assert.deepEqual(orari(developments, '56 232'), ['11:22-16:25']);
  assert.deepEqual(orari(developments, '56 131'), ['06:26-11:41']);
}

test('la pagina dei turni letta dal basso in alto, con San Paolo accanto, torna turno per turno', () => {
  const developments = parseOrari([`GTT gruppo 56 - LUN - VEN - Versione B06\n${PAGINA_DAL_BASSO}`]);
  controlla(developments);

  const segments = getDevSegments(developments, '56', '056', VENERDI, TURNO_056);
  assert.deepEqual(
    segments.map((segment) => `${segment.start}-${segment.end} v${segment.vett}`),
    ['11:08-13:37 v13', '14:58-18:23 v6'],
  );
});

test('la stessa pagina letta dall alto in basso, come sul Mac, da lo stesso risultato', () => {
  const dallAlto = PAGINA_DAL_BASSO.split('\n').reverse().join('\n');
  controlla(parseOrari([`GTT gruppo 56 - LUN - VEN - Versione B06\n${dallAlto}`]));
});

test('un turno senza il tempo netto che torna non butta la pagina e non prende righe altrui', () => {
  const storta = PAGINA_DAL_BASSO.replace('11.08 SIRA R 13.37 SIRA 05.54 05.54', '11.08 SIRA R 13.37 SIRA 03.00 03.00');
  const developments = parseOrari([`GTT gruppo 56 - LUN - VEN - Versione B06\n${storta}`]);

  // Gli altri turni restano giusti...
  assert.deepEqual(orari(developments, '56 58'), ['08:08-12:41', '13:45-15:43']);
  assert.deepEqual(orari(developments, '56 101'), ['04:44-09:07', '09:25-11:20']);
  // ...e la 056 non porta tratti del 058: al peggio resta con la sola prima riga.
  assert.deepEqual(orari(developments, '56 56'), ['11:08-13:37']);
});

test('se la maggior parte dei turni non ha la prova, il testo non si tocca', () => {
  const tutta = PAGINA_DAL_BASSO.replace(/(\d{2}\.\d{2}) (\d{2}\.\d{2}) -----/g, '01.00 01.00 -----');
  const developments = parseOrari([`GTT gruppo 56 - LUN - VEN - Versione B06\n${tutta}`]);

  // Lettura di prima: la riga del 056 c'e', senza che sia stato rimesso niente a posto.
  assert.ok(orari(developments, '56 56').includes('11:08-13:37'));
});
