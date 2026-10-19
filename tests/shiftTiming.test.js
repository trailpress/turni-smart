import test from 'node:test';
import assert from 'node:assert/strict';
import { describeShiftTiming, formatCountdown, formatLiveCountdown, shiftStartDate } from '../src/utils/shiftTiming.js';

function turno(iso, compactStart) {
  return { t: 'turno', iso, date: new Date(`${iso}T00:00:00`), i: compactStart };
}

test('costruisce la data di attacco dal giorno e dall orario compatto', () => {
  const start = shiftStartDate(turno('2026-04-02', '0407'));
  assert.equal(start.getHours(), 4);
  assert.equal(start.getMinutes(), 7);
  assert.equal(start.getDate(), 2);
});

test('non calcola l attacco per riposi e giorni senza orario', () => {
  assert.equal(shiftStartDate({ t: 'RP', iso: '2026-04-04' }), null);
  assert.equal(shiftStartDate(turno('2026-04-02', '')), null);
});

test('formatta il conto alla rovescia', () => {
  assert.equal(formatCountdown(45), '45 min');
  assert.equal(formatCountdown(120), '2h');
  assert.equal(formatCountdown(560), '9h 20m');
  assert.equal(formatCountdown(-5), '');
});

test('conta quanto manca all attacco entro le 48 ore', () => {
  const day = turno('2026-04-02', '0407');
  const now = new Date('2026-04-01T18:47:00');
  assert.equal(describeShiftTiming(day, now).countdown, '9h 20m');
});

test('oltre le 48 ore il conto alla rovescia non serve', () => {
  const day = turno('2026-04-10', '0407');
  const now = new Date('2026-04-01T18:47:00');
  assert.equal(describeShiftTiming(day, now).countdown, '');
});

test('un turno gia passato non produce conto alla rovescia', () => {
  const day = turno('2026-04-02', '0407');
  const now = new Date('2026-04-02T09:00:00');
  const timing = describeShiftTiming(day, now);
  assert.equal(timing.countdown, '');
  assert.equal(timing.wakeUp, '');
});

test('suggerisce la sveglia solo per gli attacchi prima delle 6', () => {
  const now = new Date('2026-04-01T18:00:00');
  assert.equal(describeShiftTiming(turno('2026-04-02', '0407'), now, 75).wakeUp, '02:52');
  assert.equal(describeShiftTiming(turno('2026-04-02', '0835'), now, 75).wakeUp, '');
});

test('segnala i turni imminenti entro tre ore', () => {
  const day = turno('2026-04-02', '0407');
  assert.equal(describeShiftTiming(day, new Date('2026-04-02T02:30:00')).isImminent, true);
  assert.equal(describeShiftTiming(day, new Date('2026-04-01T18:00:00')).isImminent, false);
});

test('nell ultima ora il conto scende al secondo in mm:ss', () => {
  const live = formatLiveCountdown(754);
  assert.equal(live.head, '12');
  assert.equal(live.separator, ':');
  assert.equal(live.tail, '34');
  assert.equal(live.ticksBySecond, true);
});

test('sopra l ora restano ore e minuti, senza secondi', () => {
  const live = formatLiveCountdown(9 * 3600 + 20 * 60 + 45);
  assert.equal(live.head, '9h 20m');
  assert.equal(live.separator, '');
  assert.equal(live.ticksBySecond, false);
});

test('i secondi si azzerano con lo zero davanti', () => {
  assert.equal(formatLiveCountdown(65).tail, '05');
  assert.equal(formatLiveCountdown(65).head, '01');
});

test('a conto esaurito non resta niente da mostrare', () => {
  assert.equal(formatLiveCountdown(0), null);
  assert.equal(formatLiveCountdown(-30), null);
});

test('il timer si accende solo dentro l orizzonte e prima dell attacco', () => {
  const day = turno('2026-04-02', '0407');
  assert.equal(describeShiftTiming(day, new Date('2026-04-01T18:47:00')).isLive, true);
  assert.equal(describeShiftTiming(day, new Date('2026-04-02T09:00:00')).isLive, false);
  assert.equal(describeShiftTiming(turno('2026-04-30', '0407'), new Date('2026-04-01T18:47:00')).isLive, false);
});

test('il conto vivo e quello statico raccontano lo stesso minuto', () => {
  const t = describeShiftTiming(turno('2026-04-02', '0407'), new Date('2026-04-01T18:47:00'));
  assert.equal(t.countdown, '9h 20m');
  assert.equal(t.live.head, '9h 20m');
});

import { formatDistantCountdown, shiftEndDate, shiftSpanMinutes } from '../src/utils/shiftTiming.js';

test('la durata dagli orari, anche quando il turno finisce dopo mezzanotte', () => {
  assert.equal(shiftSpanMinutes({ t: 'turno', iso: '2026-10-19', i: '1226', e: '1700' }), 274);
  assert.equal(shiftSpanMinutes({ t: 'turno', iso: '2026-10-19', i: '1630', e: '0100' }), 510);
  assert.equal(shiftEndDate({ t: 'turno', iso: '2026-10-19', i: '1630', e: '0100' }).getDate(), 20);
  assert.equal(shiftSpanMinutes({ t: 'RP', iso: '2026-10-19' }), null);
});

test('«attacchi tra» a ore e minuti, e a giorni oltre le 48 ore', () => {
  assert.equal(formatDistantCountdown(195), '3h 15m');
  assert.equal(formatDistantCountdown(47 * 60), '47h');
  assert.equal(formatDistantCountdown(50 * 60), '2g 2h');
  assert.equal(formatDistantCountdown(72 * 60), '3g');
});
