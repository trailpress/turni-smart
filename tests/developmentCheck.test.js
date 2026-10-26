import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDevelopment } from '../src/utils/developmentCheck.js';
import { parseOrari } from '../src/parserOrari.js';

const seg = (start, end, extra = {}) => ({ start, end, loc_s: 'SIRA', loc_e: 'SIRA', run_id: 1, ...extra });

test('un turno con il tempo netto del PDF che torna e\' verificato', () => {
  const [block] = checkDevelopment([seg('11:08', '13:37', { netMinutes: 354 }), seg('14:58', '18:23')]);

  assert.equal(block.status, 'ok');
  assert.equal(block.workedMinutes, 354);
  assert.equal(block.netMinutes, 354);
});

test('se il tempo netto non torna, o i tratti si accavallano, lo dice', () => {
  const [sbagliato] = checkDevelopment([seg('11:08', '13:37', { netMinutes: 354 }), seg('14:58', '16:00')]);
  const [accavallati] = checkDevelopment([seg('11:08', '13:37', { netMinutes: 149 }), seg('12:00', '13:00')]);

  assert.equal(sbagliato.status, 'mismatch');
  assert.equal(accavallati.status, 'mismatch');
  assert.equal(accavallati.overlaps, 1);
});

test('senza tempo netto letto il controllo non c\'e e lo dice', () => {
  const [block] = checkDevelopment([seg('11:08', '13:37'), seg('14:58', '18:23')]);
  assert.equal(block.status, 'unverified');
});

test('le righe di letture diverse restano in gruppi separati, in ordine di orario', () => {
  const blocks = checkDevelopment([
    seg('14:00', '15:00', { run_id: 2, netMinutes: 60 }),
    seg('04:26', '09:25', { run_id: 1, netMinutes: 299 }),
  ]);

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].segments[0].start, '04:26');
  assert.deepEqual(blocks.map((block) => block.status), ['ok', 'ok']);
});

test('il parser conserva il tempo netto in coda alla prima riga del turno', () => {
  const developments = parseOrari([
    'GTT gruppo 56 - LUN - VEN - Versione B06\n56 056 56 / 13 11.08 SIRA R 13.37 SIRA 05.54 05.54 -----\n56 / 6 14.58 SIRA R 18.23 SIRA',
  ]);
  const segments = developments['56 56'];

  assert.equal(segments[0].netMinutes, 354);
  assert.equal(segments[1].netMinutes, undefined);
  const [block] = checkDevelopment(segments);
  assert.equal(block.status, 'ok');
});

import { buildLineIndex } from '../src/utils/lineIndex.js';
import { getDevSegments } from '../src/parserOrari.js';

test('in Linee i rientri, le uscite e i residui del grafico non compaiono come turni', () => {
  const ritorno = { ln: '56', lineaNorm: '56', start: '00:35', loc_s: 'GRTI', end: '00:45', loc_e: 'GERB', gt: 'LUN - VEN', run_id: 1 };
  const turno = (start, end, run_id) => ({ ln: '56', lineaNorm: '56', vett: '13', start, loc_s: 'SIRA', end, loc_e: 'SIRA', gt: 'LUN - VEN', run_id });
  const developments = {
    '56 56': [turno('11:08', '13:37', 4), turno('14:58', '18:23', 4)],
    'RIENTRI 56 LUN - VEN': [ritorno, { ...ritorno, start: '01:08', end: '01:18', run_id: 2 }],
    'USCITE 56 LUN - VEN': [{ ...ritorno, start: '07:52', loc_s: 'GERB', end: '08:02', loc_e: 'GRTI', run_id: 3 }],
    'CODICI 55': [{ ...ritorno, ln: '55', lineaNorm: '55', run_id: 4 }],
  };
  const lines = buildLineIndex(developments);

  assert.deepEqual(lines.map((item) => item.line), ['56']);
  assert.deepEqual(lines[0].shifts.map((item) => item.shift), ['56']);
  assert.equal(lines[0].shifts[0].segments.length, 2);
});

test('un rientro o un uscita con orario e posto che combaciano non entra nello sviluppo di un turno', () => {
  const developments = {
    'RIENTRI 56 LUN - VEN': [{ ln: '56', lineaNorm: '56', start: '14:58', loc_s: 'SIRA', end: '18:23', loc_e: 'SIRA', gt: 'LUN - VEN', run_id: 1 }],
    '56 56': [{ ln: '56', lineaNorm: '56', vett: '13', start: '11:08', loc_s: 'SIRA', dir: 'R', end: '13:37', loc_e: 'SIRA', gt: 'LUN - VEN', run_id: 4 }],
  };
  const segments = getDevSegments(developments, '56', '056', new Date(2026, 9, 9), { l: '56', n: '056', i: '1108', li: 'SIRA', e: '1823', le: 'SIRA' });

  assert.deepEqual(segments.map((segment) => `${segment.start}-${segment.end}`), ['11:08-13:37']);
});
