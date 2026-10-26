import { getLineDisplayName, normalizeLineCode } from '../constants/depotGerbido.js';
import { isGraphicKey } from '../parserRientri.js';
import { timeToMinutes } from './timeUtils.js';

/* L'indice di «Linee»: per ogni linea, i suoi turni, divisi per tipo di giorno.
   Sta qui e non nella schermata perche' e' una funzione pura, e perche' decide
   cosa e' un turno - cosa che e' gia' andata storta una volta. */

function sortNumericText(a, b) {
  const numberA = Number.parseInt(a, 10);
  const numberB = Number.parseInt(b, 10);
  if (!Number.isNaN(numberA) && !Number.isNaN(numberB) && numberA !== numberB) return numberA - numberB;
  return String(a).localeCompare(String(b), 'it', { numeric: true });
}

function getShiftParts(key = '') {
  const [line = '', shift = ''] = String(key).split(/\s+/);
  return { line, shift };
}

function getServiceType(value = '') {
  const service = String(value || '').toUpperCase();
  if (service.includes('SAB')) return 'sabato';
  if (service.includes('FEST') || service.includes('DOM')) return 'festivi';
  if (
    service.includes('LUN') ||
    service.includes('VEN') ||
    service.includes('FERIALE') ||
    service.includes('FERIALI')
  ) {
    return 'feriali';
  }
  return 'feriali';
}

function getServiceLabel(value = '') {
  const type = getServiceType(value);
  if (type === 'sabato') return 'Sabato';
  if (type === 'festivi') return 'Festivi';
  return 'Feriali';
}

function getServiceKey(segment = {}) {
  const service = getServiceType(segment.gt);
  const gt = String(segment.gt || service).trim().toUpperCase();
  const version = String(segment.ver || '').trim().toUpperCase();
  return `${service}|${gt}|${version}`;
}

function getSegmentIdentity(segment = {}) {
  return [
    segment.ln,
    segment.vett,
    segment.start,
    segment.loc_s,
    segment.dir,
    segment.end,
    segment.loc_e,
    segment.gt,
    segment.ver,
  ]
    .map((value) => String(value || '').trim().toUpperCase())
    .join('|');
}

function uniqueSegments(segments = []) {
  const seen = new Set();
  return segments.filter((segment) => {
    const key = getSegmentIdentity(segment);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortSegmentsByDuty(segments = []) {
  return segments
    .slice()
    .map((segment, index) => {
      let start = timeToMinutes(segment.start || '00:00');
      let end = timeToMinutes(segment.end || '00:00');
      if (end < start) end += 1440;
      return { segment, index, start, end };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index)
    .map((item) => item.segment);
}

export function buildLineIndex(developments = {}) {
  const byLine = new Map();

  Object.entries(developments).forEach(([key, segments]) => {
    if (!Array.isArray(segments) || !segments.length) return;
    /* Rientri e uscite del grafico di servizio non sono turni: per la 56 la
       chiave «RIENTRI 56 LUN - VEN» si leggeva come «turno 56», e compariva
       con sedici gruppi di righe al posto dello sviluppo. */
    if (isGraphicKey(key)) return;
    const parts = getShiftParts(key);
    const line = segments[0]?.lineaNorm || parts.line;
    if (!line || !parts.shift) return;
    /* Un turno si chiama «<linea> <numero>»: se la prima parola della chiave
       non e' la linea dei suoi tratti (CODICI 55, A55B0101 55...) e' un residuo
       letto dalle pagine del grafico, non un turno. */
    if (normalizeLineCode(parts.line) !== normalizeLineCode(line)) return;

    const current = byLine.get(line) || [];
    const groupedByService = segments.reduce((groups, segment) => {
      const serviceKey = getServiceKey(segment);
      groups[serviceKey] = groups[serviceKey] || [];
      groups[serviceKey].push(segment);
      return groups;
    }, {});

    Object.entries(groupedByService).forEach(([serviceKey, serviceSegments]) => {
      const fullSegments = sortSegmentsByDuty(uniqueSegments(serviceSegments));
      const first = fullSegments[0] || {};
      current.push({
        key: `${key}|${serviceKey}`,
        sourceKey: key,
        line,
        shift: parts.shift,
        service: getServiceType(first.gt),
        serviceLabel: getServiceLabel(first.gt),
        gt: first.gt || '',
        ver: first.ver || '',
        segments: fullSegments,
      });
    });
    byLine.set(line, current);
  });

  return Array.from(byLine.entries())
    .map(([line, shifts]) => ({
      line,
      label: getLineDisplayName(line),
      shifts: shifts.sort((a, b) => sortNumericText(a.shift, b.shift) || a.serviceLabel.localeCompare(b.serviceLabel, 'it')),
    }))
    .sort((a, b) => sortNumericText(a.line, b.line));
}

export { getServiceType, getServiceLabel };
