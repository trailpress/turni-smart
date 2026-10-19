import { REST_CODES } from './parserPreconoscenza.js';
import { getDevSegments } from './parserOrari.js';
import { compactTimeToMinutes, formatMinutes, isEveningFallbackByTime, timeToMinutes } from './utils/timeUtils.js';
import { getShiftCategory, isEveningShift } from './constants/shiftClassification.js';

/* Dal pomeriggio al mattino dopo. "Tardo pomeriggio" e "mattino" non hanno un
   numero nell'Accordo: qui sono quattro ore del pomeriggio in poi per chi
   finisce, e prima di mezzogiorno per chi attacca. Sono due soglie di
   evidenza, non una regola sul riposo: quello resta le undici ore. */
const LATE_END_FROM = 16 * 60;
const MORNING_START_BEFORE = 12 * 60;

function formatClock(minutes) {
  const day = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(day / 60)).padStart(2, '0')}:${String(day % 60).padStart(2, '0')}`;
}

function shiftDate(day) {
  return day.date || new Date(`${day.iso}T00:00:00`);
}

function shiftStartMinutes(day, segments) {
  if (segments.length) return timeToMinutes(segments[0].start);
  return compactTimeToMinutes(day.i);
}

function shiftEndAbsoluteMinutes(day, segments) {
  const start = shiftStartMinutes(day, segments);
  const end = segments.length ? timeToMinutes(segments[segments.length - 1].end) : compactTimeToMinutes(day.e);
  return end < start ? end + 1440 : end;
}

function shiftDurationMinutes(day, segments) {
  if (!day || day.t !== 'turno') return 0;
  return shiftEndAbsoluteMinutes(day, segments) - shiftStartMinutes(day, segments);
}

export function enrichShiftDays(days = {}, developments = {}) {
  const entries = Object.keys(days)
    .sort()
    .map((iso) => {
      const day = days[iso];
      if (!day || day.t !== 'turno') return { iso, day, segments: [], isSplit: false, isEvening: false, isShortRest: false, restMinutes: null, previousEnd: '', isAfternoonToMorning: false };

      const segments = Array.isArray(day.manualSegments) && day.manualSegments.length
        ? day.manualSegments
        : getDevSegments(developments, day.l, day.n, shiftDate(day), day);
      const category = getShiftCategory(day.n);
      return {
        iso,
        day,
        segments,
        category,
        /* A dire se un turno e' a due riprese e' l'Accordo, non il numero di
           tratti dello sviluppo. Un 300 e' a ripresa unica anche quando lo
           sviluppo ha due tratti separati da una sosta tecnica di venti
           minuti: contare i tratti faceva chiamare "spezzato" mezzo turno a
           ripresa unica del deposito. */
        isSplit: category.isSplit,
        isEvening: isEveningShift(day.n, isEveningFallbackByTime({ start: day.i, end: day.e, segments })),
        isShortRest: false,
        restMinutes: null,
        previousEnd: '',
        isAfternoonToMorning: false,
      };
    });

  let previousWorked = null;
  entries.forEach((entry) => {
    if (!entry.day || entry.day.t !== 'turno') return;

    if (previousWorked) {
      const previousEnd =
        new Date(`${previousWorked.iso}T00:00:00`).getTime() / 60000 +
        shiftEndAbsoluteMinutes(previousWorked.day, previousWorked.segments);
      const currentStart =
        new Date(`${entry.iso}T00:00:00`).getTime() / 60000 + shiftStartMinutes(entry.day, entry.segments);
      /* Quanto si sta a casa fra la fine del turno prima e l'inizio di
         questo. Il numero serve alla card: "riposo breve" da solo non dice
         niente, "9h 20m dal turno prima" si capisce. */
      const rest = currentStart - previousEnd;
      entry.restMinutes = rest > 0 ? rest : null;
      entry.isShortRest = rest > 0 && rest < 660;

      const previousEndMinutes = shiftEndAbsoluteMinutes(previousWorked.day, previousWorked.segments);
      const startMinutes = shiftStartMinutes(entry.day, entry.segments);
      const dayGap = Math.round(
        (new Date(`${entry.iso}T00:00:00`).getTime() - new Date(`${previousWorked.iso}T00:00:00`).getTime()) / 86400000,
      );
      entry.previousEnd = formatClock(previousEndMinutes);
      /* Un turno che finisce nel pomeriggio avanzato, o dopo mezzanotte, e il
         giorno dopo uno che attacca di mattina: e' il passaggio che si va a
         cercare, anche quando le ore di riposo sono piu' di undici. */
      entry.isAfternoonToMorning = rest > 0 && dayGap === 1 && previousEndMinutes >= LATE_END_FROM && startMinutes < MORNING_START_BEFORE;
    }

    previousWorked = entry;
  });

  return entries.reduce((acc, entry) => {
    acc[entry.iso] = entry;
    return acc;
  }, {});
}

export function calculateShiftStats(days = {}, developments = {}) {
  return computeStats(days, developments);
}

export function computeShortRestMap(days = {}, developments = {}) {
  const enriched = enrichShiftDays(days, developments);
  return Object.values(enriched).reduce((acc, entry) => {
    if (entry.isShortRest) acc[entry.iso] = true;
    return acc;
  }, {});
}

export function getLongestDay(days = {}, developments = {}) {
  const enriched = enrichShiftDays(days, developments);
  return Object.values(enriched)
    .filter((entry) => entry.day?.t === 'turno')
    .map((entry) => ({
      iso: entry.iso,
      day: entry.day,
      minutes: shiftDurationMinutes(entry.day, entry.segments),
      label: formatMinutes(shiftDurationMinutes(entry.day, entry.segments)),
    }))
    .sort((a, b) => b.minutes - a.minutes)[0] || null;
}

export function getAverageShiftDuration(days = {}, developments = {}) {
  const enriched = enrichShiftDays(days, developments);
  const durations = Object.values(enriched)
    .filter((entry) => entry.day?.t === 'turno')
    .map((entry) => shiftDurationMinutes(entry.day, entry.segments));
  if (!durations.length) return { minutes: 0, label: '0min' };
  const minutes = Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);
  return { minutes, label: formatMinutes(minutes) };
}

/**
 * Il primo turno che comincia da qui in avanti.
 *
 * `excludeIso` toglie un giorno dai candidati: serve quando quel turno e' gia'
 * in evidenza altrove. Aprendo la app alle tre e mezza per il turno delle
 * quattro, quel turno non e' ancora cominciato e quindi sarebbe il "prossimo"
 * - ma e' lo stesso che si sta guardando, e chiamarlo prossimo vuol dire non
 * rispondere alla domanda.
 */
export function getNextWorkingShift(days = {}, developments = {}, fromDate = new Date(), { excludeIso = '' } = {}) {
  const from = new Date(fromDate);
  const fromTime = from.getTime();
  const enriched = enrichShiftDays(days, developments);

  return Object.values(enriched)
    .filter((entry) => entry.day?.t === 'turno')
    .filter((entry) => !excludeIso || entry.day?.iso !== excludeIso)
    .map((entry) => {
      const date = shiftDate(entry.day);
      const start = new Date(date);
      const startMinutes = shiftStartMinutes(entry.day, entry.segments);
      start.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
      return { ...entry, startDate: start };
    })
    .filter((entry) => entry.startDate.getTime() >= fromTime)
    .sort((a, b) => a.startDate - b.startDate)[0] || null;
}

export function computeStats(days = {}, developments = {}) {
  const enriched = enrichShiftDays(days, developments);
  const values = Object.values(days || {});
  const average = getAverageShiftDuration(days, developments);
  const longest = getLongestDay(days, developments);

  return {
    totalDays: values.length,
    totalShifts: values.filter((day) => day?.t === 'turno').length,
    restDays: values.filter((day) => day && REST_CODES[day.t]).length,
    ballots: values.filter((day) => day?.t === 'RIS').length,
    splitShifts: Object.values(enriched).filter((entry) => entry.isSplit).length,
    eveningShifts: Object.values(enriched).filter((entry) => entry.isEvening).length,
    shortRests: Object.values(enriched).filter((entry) => entry.isShortRest).length,
    averageShiftDuration: average,
    longestDay: longest,
    categoryDistribution: Object.values(enriched).reduce((acc, entry) => {
      if (!entry.category) return acc;
      acc[entry.category.label] = (acc[entry.category.label] || 0) + 1;
      return acc;
    }, {}),
  };
}
