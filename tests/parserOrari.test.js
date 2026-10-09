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
