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

// Come esce il testo del PDF vero: l'etichetta del turno sta sulla riga
// dell'ultimo tratto del turno prima (referto del 9 ottobre: il 301 conteneva il
// tratto del 211, il 056 quello del 014).
const PAGINA_ETICHETTE_ALTE = `56 003
56 / 3 05.02 GERB - 09.29 SIRA 07.00 07.00 -----
56 005 56 / 9 12.55 SIRA R 15.28 SIRA
56 / 5 05.19 GERB - 10.15 GERB 06.51 06.51 -----
56 014 56 / 6 13.03 SIRA A 14.58 SIRA
56 / 14 04.26 GERB - 09.25 SIRA 06.52 06.52 -----
56 056 56 / 14 11.56 SIRA A 13.49 SIRA
56 / 13 11.08 SIRA R 13.37 SIRA 05.54 05.54 -----
56 058 56 / 6 14.58 SIRA R 18.23 SIRA
56 / 8 08.08 SIRA A 12.41 SIRA 06.31 06.31 -----
56 / 11 13.45 SIRA A 15.43 SIRA`;

const PAGINA_ETICHETTE_GIUSTE = `56 003 56 / 3 05.02 GERB - 09.29 SIRA 07.00 07.00 -----
56 / 9 12.55 SIRA R 15.28 SIRA
56 005 56 / 5 05.19 GERB - 10.15 GERB 06.51 06.51 -----
56 / 6 13.03 SIRA A 14.58 SIRA
56 014 56 / 14 04.26 GERB - 09.25 SIRA 06.52 06.52 -----
56 / 14 11.56 SIRA A 13.49 SIRA
56 056 56 / 13 11.08 SIRA R 13.37 SIRA 05.54 05.54 -----
56 / 6 14.58 SIRA R 18.23 SIRA
56 058 56 / 8 08.08 SIRA A 12.41 SIRA 06.31 06.31 -----
56 / 11 13.45 SIRA A 15.43 SIRA`;

const orari = (developments, key) => (developments[key] || []).map((segment) => `${segment.start}-${segment.end}`);

test('con le etichette sulla riga prima, ogni tratto torna al suo turno', () => {
  const developments = parseOrari([PAGINA_ETICHETTE_ALTE]);

  assert.deepEqual(orari(developments, '56 3'), ['05:02-09:29', '12:55-15:28']);
  assert.deepEqual(orari(developments, '56 5'), ['05:19-10:15', '13:03-14:58']);
  assert.deepEqual(orari(developments, '56 14'), ['04:26-09:25', '11:56-13:49']);
  assert.deepEqual(orari(developments, '56 56'), ['11:08-13:37', '14:58-18:23']);
  assert.deepEqual(orari(developments, '56 58'), ['08:08-12:41', '13:45-15:43']);
  const turno056 = { l: '56', n: '056', i: '1108', li: 'SIRA', e: '1823', le: 'SIRA' };
  const segments = getDevSegments(developments, '56', '056', VENERDI, turno056);
  assert.deepEqual(
    segments.map((segment) => segment.start),
    ['11:08', '14:58'],
  );
});

test('con le etichette al loro posto il testo non si tocca', () => {
  assert.deepEqual(orari(parseOrari([PAGINA_ETICHETTE_GIUSTE]), '56 56'), ['11:08-13:37', '14:58-18:23']);
  assert.deepEqual(orari(parseOrari([PAGINA_ETICHETTE_GIUSTE]), '56 14'), ['04:26-09:25', '11:56-13:49']);
});

test('se il tempo netto non torna, le etichette non si spostano', () => {
  const storta = PAGINA_ETICHETTE_ALTE.replace('05.54 05.54', '05.00 05.00');
  // Nessuna prova che lo spostamento sia giusto: resta la lettura di prima.
  assert.ok(orari(parseOrari([storta]), '56 56').includes('11:56-13:49'));
});
