import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichShiftDays } from '../src/analytics.js';

function giorno(iso, extra) {
  return { iso, date: new Date(`${iso}T00:00:00`), ...extra };
}

/* Il caso vero, dal campo: linea 74 turno 308, inserito a mano.
   10.08.2026  N B 74 308 GE 1226 CATT A 1911 CATT A 0645
   Due tratti con venticinque minuti in mezzo, che sono una sosta tecnica: il
   308 sta in 300-399, cioe' ripresa unica pomeridiana per l'Accordo. */
const TURNO_308 = giorno('2026-08-10', {
  t: 'turno',
  l: '74',
  n: '308',
  i: '1226',
  e: '1911',
  li: 'CATT',
  le: 'CATT',
  manualSegments: [
    { start: '12:26', end: '15:21', loc_s: 'CATT', loc_e: 'GERB', dir: 'A' },
    { start: '15:46', end: '19:11', loc_s: 'GERB', loc_e: 'CATT', dir: 'R' },
  ],
});

test('un turno a ripresa unica non diventa spezzato perche ha due tratti', () => {
  const enriched = enrichShiftDays({ '2026-08-10': TURNO_308 }, {});
  const entry = enriched['2026-08-10'];
  assert.equal(entry.segments.length, 2, 'i tratti restano due');
  assert.equal(entry.category.label, 'Ripresa unica pomeridiana');
  assert.equal(entry.isSplit, false, 'ma il turno non e a due riprese');
});

test('un turno a due riprese lo resta anche con un tratto solo', () => {
  const unTratto = giorno('2026-08-11', {
    t: 'turno',
    l: '05',
    n: '020',
    i: '0500',
    e: '1600',
    li: 'GERB',
    le: 'GERB',
    manualSegments: [{ start: '05:00', end: '16:00', loc_s: 'GERB', loc_e: 'GERB', dir: 'A' }],
  });
  const entry = enrichShiftDays({ '2026-08-11': unTratto }, {})['2026-08-11'];
  assert.equal(entry.category.isSplit, true, 'il 020 sta in 001-049');
  assert.equal(entry.isSplit, true, 'e lo dice la nomenclatura, non i tratti');
});

/* Il conteggio delle statistiche segue la stessa regola: contare i turni con
   piu' di un tratto voleva dire contare mezzo deposito. */
test('le statistiche contano i turni a due riprese, non quelli con piu tratti', async () => {
  const { computeStats } = await import('../src/analytics.js');
  const stats = computeStats({ '2026-08-10': TURNO_308 }, {});
  assert.equal(stats.splitShifts, 0);
});

test('il riposo fra due turni si misura, non solo si segnala', () => {
  const giorni = {
    '2026-08-10': giorno('2026-08-10', {
      t: 'turno',
      l: '74',
      n: '308',
      i: '1226',
      e: '1911',
      li: 'CATT',
      le: 'CATT',
    }),
    '2026-08-11': giorno('2026-08-11', {
      t: 'turno',
      l: '74',
      n: '101',
      i: '0430',
      e: '1100',
      li: 'GERB',
      le: 'GERB',
    }),
  };
  const entry = enrichShiftDays(giorni, {})['2026-08-11'];
  assert.equal(entry.restMinutes, 559, 'dalle 19:11 alle 04:30 del giorno dopo');
  assert.equal(entry.isShortRest, true, 'meno di undici ore');
});

test('un riposo lungo non viene segnalato e non porta un numero fuorviante', () => {
  const giorni = {
    '2026-08-10': giorno('2026-08-10', { t: 'turno', l: '74', n: '101', i: '0430', e: '1100', li: 'GERB', le: 'GERB' }),
    '2026-08-11': giorno('2026-08-11', { t: 'turno', l: '74', n: '308', i: '1226', e: '1911', li: 'CATT', le: 'CATT' }),
  };
  const entry = enrichShiftDays(giorni, {})['2026-08-11'];
  assert.equal(entry.isShortRest, false);
  assert.equal(entry.restMinutes, 1526, 'il numero ce comunque, e la card lo mostra senza segnarlo come breve');
});

test('il primo turno del periodo non ha un riposo da misurare', () => {
  const entry = enrichShiftDays({ '2026-08-10': TURNO_308 }, {})['2026-08-10'];
  assert.equal(entry.restMinutes, null);
  assert.equal(entry.isShortRest, false);
});

test('dal turno del tardo pomeriggio che finisce dopo mezzanotte a quello del mattino', () => {
  const giorni = {
    '2026-08-10': giorno('2026-08-10', { t: 'turno', l: '74', n: '403', i: '1630', e: '0100', li: 'CATT', le: 'GERB' }),
    '2026-08-11': giorno('2026-08-11', { t: 'turno', l: '74', n: '101', i: '0500', e: '1130', li: 'GERB', le: 'GERB' }),
  };
  const entry = enrichShiftDays(giorni, {})['2026-08-11'];
  assert.equal(entry.restMinutes, 240, 'dall\'una di notte alle cinque');
  assert.equal(entry.isShortRest, true);
});

test('fra un turno e il successivo senza riposi in mezzo il numero e quello vero', () => {
  const giorni = {
    '2026-08-10': giorno('2026-08-10', { t: 'turno', l: '74', n: '308', i: '1226', e: '2010', li: 'CATT', le: 'CATT' }),
    '2026-08-11': giorno('2026-08-11', { t: 'turno', l: '74', n: '101', i: '0615', e: '1215', li: 'GERB', le: 'GERB' }),
  };
  const entry = enrichShiftDays(giorni, {})['2026-08-11'];
  assert.equal(entry.restMinutes, 605, 'dalle 20:10 alle 06:15');
  assert.equal(entry.isShortRest, true, 'dieci ore e cinque minuti: meno di undici');
});

test('dal pomeriggio al mattino dopo si segnala anche con piu di undici ore di riposo', () => {
  const giorni = {
    '2026-08-10': giorno('2026-08-10', { t: 'turno', l: '74', n: '308', i: '1226', e: '1700', li: 'CATT', le: 'CATT' }),
    '2026-08-11': giorno('2026-08-11', { t: 'turno', l: '74', n: '101', i: '0615', e: '1215', li: 'GERB', le: 'GERB' }),
  };
  const entry = enrichShiftDays(giorni, {})['2026-08-11'];
  assert.equal(entry.restMinutes, 795, 'dalle 17:00 alle 06:15');
  assert.equal(entry.isShortRest, false, 'oltre le undici ore');
  assert.equal(entry.isAfternoonToMorning, true);
  assert.equal(entry.previousEnd, '17:00');
});

test('un turno che finisce dopo mezzanotte e quello del mattino dopo si segnalano', () => {
  const giorni = {
    '2026-08-10': giorno('2026-08-10', { t: 'turno', l: '74', n: '403', i: '1630', e: '0100', li: 'CATT', le: 'GERB' }),
    '2026-08-11': giorno('2026-08-11', { t: 'turno', l: '74', n: '101', i: '0500', e: '1130', li: 'GERB', le: 'GERB' }),
  };
  const entry = enrichShiftDays(giorni, {})['2026-08-11'];
  assert.equal(entry.isAfternoonToMorning, true);
  assert.equal(entry.previousEnd, '01:00');
});

test('non si segnala se il turno prima finisce presto, se il dopo non e di mattina, o se in mezzo ci sono riposi', () => {
  const base = { t: 'turno', l: '74', li: 'CATT', le: 'CATT' };
  const presto = enrichShiftDays(
    { '2026-08-10': giorno('2026-08-10', { ...base, n: '201', i: '0800', e: '1500' }), '2026-08-11': giorno('2026-08-11', { ...base, n: '101', i: '0500', e: '1100' }) },
    {},
  )['2026-08-11'];
  const dopoPranzo = enrichShiftDays(
    { '2026-08-10': giorno('2026-08-10', { ...base, n: '308', i: '1226', e: '2000' }), '2026-08-11': giorno('2026-08-11', { ...base, n: '308', i: '1226', e: '2000' }) },
    {},
  )['2026-08-11'];
  const riposi = enrichShiftDays(
    { '2026-08-10': giorno('2026-08-10', { ...base, n: '308', i: '1226', e: '2000' }), '2026-08-12': giorno('2026-08-12', { ...base, n: '101', i: '0500', e: '1100' }) },
    {},
  )['2026-08-12'];

  assert.equal(presto.isAfternoonToMorning, false, 'finisce alle 15:00');
  assert.equal(dopoPranzo.isAfternoonToMorning, false, 'attacca alle 12:26');
  assert.equal(riposi.isAfternoonToMorning, false, 'due giorni dopo');
});
