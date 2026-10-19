// Vista d'insieme della Preconoscenza: trasforma i giorni gia' analizzati in
// righe pronte da disegnare, senza toccare il parser. Il modulo e' puro cosi'
// resta verificabile con `node --test`.
import { REST_CODES, SPECIAL_CODES, formatCompactTime } from '../parserPreconoscenza.js';
import { BALLOTTAGGI, getShiftCategory } from '../constants/shiftClassification.js';
import { compactTimeToMinutes, formatMinutes, formatRestBetweenShifts, timeToMinutes } from './timeUtils.js';

// La giornata di un turnista non comincia a mezzanotte: la barra oraria parte
// dalle 04:00 e copre 24 ore, cosi' un serale che sfora resta nella riga.
export const TIMELINE_START_MINUTES = 4 * 60;
export const TIMELINE_MINUTES = 24 * 60;
export const TIMELINE_TICKS = [4, 8, 12, 16, 20, 0];

const MINUTES_IN_DAY = 24 * 60;

const weekdayFormatter = new Intl.DateTimeFormat('it-IT', { weekday: 'short' });
const dayMonthFormatter = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });
const longDayFormatter = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const monthFormatter = new Intl.DateTimeFormat('it-IT', { month: 'long' });

export const OVERVIEW_FILTERS = [
  { key: 'tutto', label: 'Tutto' },
  { key: 'turni', label: 'Turni' },
  { key: 'riposi', label: 'Riposi' },
  { key: 'ballottaggi', label: 'Ballottaggi' },
];

function dayDate(day) {
  if (day?.date instanceof Date && !Number.isNaN(day.date.getTime())) return day.date;
  const parsed = day?.iso ? new Date(`${day.iso}T00:00:00`) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function startOfWeek(date) {
  const copy = startOfDay(date);
  const weekday = copy.getDay();
  copy.setDate(copy.getDate() - (weekday === 0 ? 6 : weekday - 1));
  return copy;
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function getDayKind(day) {
  if (!day) return 'vuoto';
  if (day.t === 'turno') return 'turno';
  if (day.t === 'RIS') return 'ballottaggio';
  if (REST_CODES[day.t]) return 'riposo';
  return 'altro';
}

function minutesFromAnyTime(value) {
  if (!value) return null;
  const text = String(value);
  if (text.includes(':') || text.includes('.')) return timeToMinutes(text);
  if (text.length >= 4) return compactTimeToMinutes(text);
  return null;
}

/**
 * I tratti di lavoro della giornata come coppie di minuti assoluti: il primo
 * tratto fa da riferimento, i successivi vengono spinti avanti di 24 ore se
 * scavalcano la mezzanotte.
 */
export function getWorkIntervals(day, segments = []) {
  const usable = segments.filter((segment) => segment?.start && segment?.end);
  if (!usable.length) {
    const start = minutesFromAnyTime(day?.i);
    const end = minutesFromAnyTime(day?.e);
    if (start === null || end === null) return [];
    return [{ start, end: end < start ? end + MINUTES_IN_DAY : end }];
  }

  let previousEnd = null;
  return usable.map((segment) => {
    let start = timeToMinutes(segment.start);
    let end = timeToMinutes(segment.end);
    while (previousEnd !== null && start < previousEnd) start += MINUTES_IN_DAY;
    while (end < start) end += MINUTES_IN_DAY;
    previousEnd = end;
    return { start, end, place: segment.loc_s || '', endPlace: segment.loc_e || '', line: segment.ln || '' };
  });
}

/**
 * Le posizioni percentuali dei tratti sulla barra oraria che parte dalle 04:00.
 * Quello che esce dalla finestra viene tagliato, non nascosto.
 */
export function buildTimelineBlocks(intervals = []) {
  return intervals
    .map((interval) => {
      const offset = (((interval.start - TIMELINE_START_MINUTES) % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
      const duration = Math.max(interval.end - interval.start, 0);
      const visible = Math.min(duration, TIMELINE_MINUTES - offset);
      if (visible <= 0) return null;
      return {
        left: (offset / TIMELINE_MINUTES) * 100,
        width: Math.max((visible / TIMELINE_MINUTES) * 100, 1.6),
        startLabel: formatMinutesAsClock(interval.start),
        endLabel: formatMinutesAsClock(interval.end),
      };
    })
    .filter(Boolean);
}

export function formatMinutesAsClock(minutes) {
  const normalized = ((Math.round(minutes) % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function buildShiftRow(day, enrichment) {
  const segments = enrichment?.segments || [];
  const intervals = getWorkIntervals(day, segments);
  const category = getShiftCategory(day.n);
  const first = intervals[0];
  const last = intervals[intervals.length - 1];
  const duration = first && last ? last.end - first.start : 0;
  const workedMinutes = intervals.reduce((total, interval) => total + (interval.end - interval.start), 0);
  // Su un turno a due riprese l'arco della giornata e' una cosa, il servizio
  // un'altra: la differenza e' l'intervallo tra le due riprese.
  const breakMinutes = Math.max(duration - workedMinutes, 0);

  return {
    kind: 'turno',
    title: day.l ? `Linea ${day.l}` : 'Linea non indicata',
    subtitle: day.n ? `Turno ${day.n}` : 'Turno',
    line: day.l || '',
    number: day.n || '',
    start: first ? formatMinutesAsClock(first.start) : formatCompactTime(day.i),
    end: last ? formatMinutesAsClock(last.end) : formatCompactTime(day.e),
    startPlace: day.li || '',
    endPlace: day.le || '',
    durationLabel: duration ? formatMinutes(duration) : '',
    workedLabel: workedMinutes ? formatMinutes(workedMinutes) : '',
    breakLabel: breakMinutes ? formatMinutes(breakMinutes) : '',
    categoryLabel: category.label,
    categoryBadge: category.badge,
    color: category.color,
    isSplit: Boolean(enrichment?.isSplit ?? category.isSplit),
    isEvening: Boolean(enrichment?.isEvening ?? category.isEvening),
    isShortRest: Boolean(enrichment?.isShortRest),
    restLabel: formatRestBetweenShifts(enrichment?.restMinutes),
    isAfternoonToMorning: Boolean(enrichment?.isAfternoonToMorning),
    restNote: enrichment?.isAfternoonToMorning && enrichment?.previousEnd ? `Prima finisci alle ${enrichment.previousEnd}` : '',
    hasDevelopment: segments.length > 0,
    blocks: buildTimelineBlocks(intervals),
  };
}

function buildNonShiftRow(day) {
  const kind = getDayKind(day);
  const info = SPECIAL_CODES[day.t] || { label: day.t || 'Giorno', description: '' };

  if (kind === 'ballottaggio') {
    const ballot = day.ball ? BALLOTTAGGI[day.ball] : null;
    return {
      kind,
      title: 'Ballottaggio',
      subtitle: day.ball ? `${day.ball} · ${ballot?.label || 'Turno da assegnare'}` : 'Turno da assegnare',
      note: ballot?.description || day.x || '',
      color: '#c62828',
      blocks: [],
    };
  }

  if (kind === 'riposo') {
    return {
      kind,
      title: info.label === 'RIPOSO' ? 'Riposo' : capitalize(info.label.toLowerCase()),
      subtitle: day.t,
      note: day.projected ? day.x || 'Riposo calcolato' : info.description || '',
      color: '#1b7a3d',
      blocks: [],
    };
  }

  return {
    kind: 'altro',
    title: capitalize(String(info.label || day.t || 'Giorno').toLowerCase()),
    subtitle: day.t || '',
    note: info.description || day.x || '',
    color: '#5a6b80',
    blocks: [],
  };
}

/**
 * Una riga per ogni giorno della Preconoscenza, in ordine di data.
 */
export function buildOverviewRows(days = {}, enrichedDays = {}, options = {}) {
  const today = startOfDay(options.today || new Date());

  return Object.keys(days)
    .sort()
    .map((iso) => {
      const day = days[iso];
      const date = dayDate(day);
      if (!day || !date) return null;

      const base = day.t === 'turno' ? buildShiftRow(day, enrichedDays[iso]) : buildNonShiftRow(day);
      const dayStart = startOfDay(date);

      return {
        iso,
        date,
        day,
        weekday: weekdayFormatter.format(date).replace('.', ''),
        dayNumber: date.getDate(),
        monthShort: dayMonthFormatter.format(date).split(' ')[1]?.replace('.', '') || '',
        longLabel: capitalize(longDayFormatter.format(date)),
        isWeekend: date.getDay() === 0 || date.getDay() === 6,
        isToday: dayStart.getTime() === today.getTime(),
        isPast: dayStart.getTime() < today.getTime(),
        ...base,
      };
    })
    .filter(Boolean);
}

export function filterRows(rows = [], filter = 'tutto') {
  if (filter === 'turni') return rows.filter((row) => row.kind === 'turno');
  if (filter === 'riposi') return rows.filter((row) => row.kind === 'riposo');
  if (filter === 'ballottaggi') return rows.filter((row) => row.kind === 'ballottaggio');
  return rows;
}

/**
 * Righe raggruppate per settimana (lunedi-domenica), con il conteggio di cosa
 * contiene ogni settimana.
 */
export function groupRowsByWeek(rows = []) {
  const weeks = new Map();

  rows.forEach((row) => {
    const weekStart = startOfWeek(row.date);
    const key = weekStart.toISOString().slice(0, 10);
    if (!weeks.has(key)) {
      const weekEnd = addDays(weekStart, 6);
      const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
      weeks.set(key, {
        key,
        start: weekStart,
        end: weekEnd,
        label: sameMonth
          ? `${weekStart.getDate()} - ${weekEnd.getDate()} ${monthFormatter.format(weekEnd)}`
          : `${weekStart.getDate()} ${monthFormatter.format(weekStart)} - ${weekEnd.getDate()} ${monthFormatter.format(weekEnd)}`,
        rows: [],
        shifts: 0,
        rests: 0,
        ballots: 0,
      });
    }

    const week = weeks.get(key);
    week.rows.push(row);
    if (row.kind === 'turno') week.shifts += 1;
    if (row.kind === 'riposo') week.rests += 1;
    if (row.kind === 'ballottaggio') week.ballots += 1;
  });

  return [...weeks.values()].sort((a, b) => a.start - b.start);
}

export function summarizeRows(rows = []) {
  const shifts = rows.filter((row) => row.kind === 'turno');
  const evening = shifts.filter((row) => row.isEvening).length;
  const split = shifts.filter((row) => row.isSplit).length;

  return {
    days: rows.length,
    shifts: shifts.length,
    rests: rows.filter((row) => row.kind === 'riposo').length,
    ballots: rows.filter((row) => row.kind === 'ballottaggio').length,
    split,
    evening,
    lines: [...new Set(shifts.map((row) => row.line).filter(Boolean))].sort(),
  };
}
