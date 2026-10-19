export function minutesToHours(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function timeToMinutes(value) {
  if (!value) return 0;
  const [hours, minutes] = String(value).replace('.', ':').split(':').map(Number);
  return hours * 60 + minutes;
}

export function compactTimeToMinutes(value) {
  if (!value || String(value).length < 4) return 0;
  return Number(String(value).slice(0, 2)) * 60 + Number(String(value).slice(2, 4));
}

export function minutesBetween(end, start) {
  const gap = timeToMinutes(start) - timeToMinutes(end);
  return gap < 0 ? gap + 1440 : gap;
}

export function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (!hours) return `${remaining}min`;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}

/* Quanto passa fra due turni, per la card. Oltre due giorni si conta a giorni:
   «72h» si legge peggio di «3g». */
export function formatRestValue(minutes) {
  if (!minutes || minutes <= 0) return '';
  if (minutes < 48 * 60) return formatMinutes(minutes);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return hours ? `${days}g ${hours}h` : `${days}g`;
}

/** Quanto passa dalla fine di un turno all'inizio del successivo, per la card. */
export function formatRestBetweenShifts(minutes) {
  const value = formatRestValue(minutes);
  return value ? `${value} dal turno prima` : '';
}

export function segmentCrossesMidnight(segment) {
  return timeToMinutes(segment.end) < timeToMinutes(segment.start);
}

export function isEveningFallbackByTime({ start, end, segments = [] }) {
  if (segments.some(segmentCrossesMidnight)) return true;
  if (segments.some((segment) => timeToMinutes(segment.start) >= 1200 || timeToMinutes(segment.end) <= 360)) return true;
  if (!start || !end) return false;
  const startMinutes = start.includes(':') ? timeToMinutes(start) : compactTimeToMinutes(start);
  const endMinutes = end.includes(':') ? timeToMinutes(end) : compactTimeToMinutes(end);
  return startMinutes >= 1200 || endMinutes <= 360 || endMinutes < startMinutes;
}
