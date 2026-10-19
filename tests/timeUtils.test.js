import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMinutes, formatRestBetweenShifts, minutesBetween, segmentCrossesMidnight, timeToMinutes } from '../src/utils/timeUtils.js';

test('converte gli orari in minuti', () => {
  assert.equal(timeToMinutes('05:48'), 348);
  assert.equal(timeToMinutes('14.10'), 850);
});

test('calcola intervalli che superano la mezzanotte', () => {
  assert.equal(minutesBetween('23:45', '00:15'), 30);
  assert.equal(segmentCrossesMidnight({ start: '19:15', end: '01:20' }), true);
});

test('formatta una durata operativa', () => {
  assert.equal(formatMinutes(410), '6h 50m');
});

test('il riposo fra due turni si scrive in ore e minuti, e sparisce quando in mezzo ci sono i riposi', () => {
  assert.equal(formatRestBetweenShifts(240), '4h dal turno prima');
  assert.equal(formatRestBetweenShifts(605), '10h 5m dal turno prima');
  assert.equal(formatRestBetweenShifts(60 * 30), '30h dal turno prima');
  assert.equal(formatRestBetweenShifts(60 * 72), '');
  assert.equal(formatRestBetweenShifts(null), '');
  assert.equal(formatRestBetweenShifts(0), '');
});
