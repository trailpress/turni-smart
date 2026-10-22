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
