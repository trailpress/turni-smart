import { timeToMinutes } from './utils/timeUtils.js';
import { normalizeLineCode } from './constants/depotGerbido.js';
import {
  detectRientriLine,
  findGraphicHints,
  isGraphicKey,
  parseDepotExits,
  parseDepotReturns,
  parseLegend,
  rientriKey,
  usciteKey,
} from './parserRientri.js';

const TIME_TOKEN_RE = /\d{2}[.:]?\d{2}/;
const SEGMENT_RE =
  /(?:([A-Z0-9/() ]{1,12}\s+\d{1,3})\s+)?([A-Z0-9/() ]{1,12})\s*\/\s*(\d+)\s+(\d{2}[.:]?\d{2})\s+([A-Z]{2,4})(?:\s+([AR-]))?\s+(\d{2}[.:]?\d{2})\s+([A-Z]{2,4})/g;

function normalizeTime(value) {
  const raw = String(value || '').replace(/\D/g, '');
  if (raw.length === 4) return `${raw.slice(0, 2)}:${raw.slice(2)}`;
  return String(value || '').replace('.', ':');
}

function normalizeLine(line, { pad = true } = {}) {
  const raw = normalizeLineCode(line);
  const number = Number.parseInt(raw, 10);
  const suffix = raw.replace(/^\d+/, '');
  if (Number.isNaN(number)) return raw;
  return `${pad ? String(number).padStart(2, '0') : String(number)}${suffix}`;
}

export function normalizeShiftKey(line, shiftNumber, { padLine = true } = {}) {
  const normalizedLine = normalizeLine(line, { pad: padLine });
  const rawShift = String(shiftNumber || '').trim();
  const parsedShift = Number.parseInt(rawShift, 10);
  const normalizedShift = Number.isNaN(parsedShift) ? rawShift.replace(/\s+/g, '') : String(parsedShift);
  if (!normalizedLine || !normalizedShift) return '';
  return `${normalizedLine} ${normalizedShift}`.replace(/\s+/g, ' ').trim();
}

function normalizeCode(code) {
  const parts = String(code || '').trim().split(/\s+/);
  if (parts.length !== 2) return code;
  return normalizeShiftKey(parts[0], parts[1]);
}

function extractCodeFromTokens(tokens, index) {
  if (index < 2) return null;
  const line = tokens[index - 2];
  const shift = tokens[index - 1];
  if (/^[A-Z0-9/()]+\/\d+$/.test(line)) return null;
  if (!/^[A-Z0-9/()]+$/.test(line) || !/^\d{1,3}$/.test(shift)) return null;
  return normalizeCode(`${line} ${shift}`);
}

function normalizeTokens(text) {
  const rawTokens = String(text || '')
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);
  const tokens = [];

  for (let index = 0; index < rawTokens.length; index += 1) {
    const current = rawTokens[index];
    const next = rawTokens[index + 1];
    const afterNext = rawTokens[index + 2];

    if (/^[A-Z0-9/()]+$/.test(current) && next === '/' && /^\d+$/.test(afterNext)) {
      tokens.push(`${current}/${afterNext}`);
      index += 2;
      continue;
    }

    if (/^[A-Z0-9/()]+\/$/.test(current) && /^\d+$/.test(next)) {
      tokens.push(`${current}${next}`);
      index += 1;
      continue;
    }

    if (current === '/' && tokens.length && /^\d+$/.test(next)) {
      tokens[tokens.length - 1] = `${tokens[tokens.length - 1]}/${next}`;
      index += 1;
      continue;
    }

    tokens.push(current);
  }

  return tokens;
}

function extractSegmentsFromTokens(tokens, gt, ver) {
  const segments = [];
  let lastLineCode = '';

  for (let index = 0; index <= tokens.length - 4; index += 1) {
    const explicitLineVehicle = /^[A-Z0-9/()]+\/\d+$/.test(tokens[index]);
    const vehicleOnly = !explicitLineVehicle && lastLineCode && /^\d{1,3}$/.test(tokens[index]);
    const timeOnly = !explicitLineVehicle && !vehicleOnly && lastLineCode && TIME_TOKEN_RE.test(tokens[index]);
    if (!explicitLineVehicle && !vehicleOnly && !timeOnly) continue;
    if (timeOnly && segments[segments.length - 1]?.segment.end === normalizeTime(tokens[index])) continue;

    const startTimeIndex = timeOnly ? index : index + 1;
    const startPlaceIndex = timeOnly ? index + 1 : index + 2;
    const directionIndex = timeOnly ? index + 2 : index + 3;
    if (!TIME_TOKEN_RE.test(tokens[startTimeIndex])) continue;
    if (!/^[A-Z]{2,4}$/.test(tokens[startPlaceIndex])) continue;

    const hasDirection = /^[AR-]$/.test(tokens[directionIndex]);
    const endTimeIndex = hasDirection ? directionIndex + 1 : directionIndex;
    const endPlaceIndex = hasDirection ? directionIndex + 2 : directionIndex + 1;
    if (!TIME_TOKEN_RE.test(tokens[endTimeIndex])) continue;
    if (!/^[A-Z]{2,4}$/.test(tokens[endPlaceIndex])) continue;

    const [lineCode, vehicle] = explicitLineVehicle ? tokens[index].split('/') : [lastLineCode, timeOnly ? '' : tokens[index]];
    if (explicitLineVehicle) lastLineCode = lineCode;
    const code = explicitLineVehicle ? extractCodeFromTokens(tokens, index) : null;
    segments.push({
      code,
      segment: {
        ln: lineCode,
        lineaNorm: normalizeLineCode(lineCode),
        vett: vehicle,
        turnoVettura: vehicle,
        start: normalizeTime(tokens[startTimeIndex]),
        loc_s: tokens[startPlaceIndex],
        dir: hasDirection && tokens[directionIndex] !== '-' ? tokens[directionIndex] : '',
        end: normalizeTime(tokens[endTimeIndex]),
        loc_e: tokens[endPlaceIndex],
        gt,
        ver,
      },
    });
  }

  return segments;
}

function extractSegmentsFromLine(line, gt, ver) {
  const segments = [];
  SEGMENT_RE.lastIndex = 0;
  let match;

  while ((match = SEGMENT_RE.exec(line)) !== null) {
    const code = match[1] ? normalizeCode(match[1]) : null;
    segments.push({
      code,
      segment: {
        ln: match[2],
        lineaNorm: normalizeLineCode(match[2]),
        vett: match[3],
        turnoVettura: match[3],
        start: normalizeTime(match[4]),
        loc_s: match[5],
        dir: match[6] !== '-' ? match[6] : '',
        end: normalizeTime(match[7]),
        loc_e: match[8],
        gt,
        ver,
      },
    });
  }

  return segments.length ? segments : extractSegmentsFromTokens(normalizeTokens(line), gt, ver);
}

function extractContinuationFromLine(line, currentCode, gt, ver) {
  const [lineCode = ''] = String(currentCode || '').split(/\s+/);
  if (!lineCode) return null;
  const tokens = normalizeTokens(line);
  if (tokens.length < 4) return null;

  const vehicleOnly = /^\d{1,3}$/.test(tokens[0]) && TIME_TOKEN_RE.test(tokens[1]);
  const timeOnly = TIME_TOKEN_RE.test(tokens[0]);
  if (!vehicleOnly && !timeOnly) return null;

  const startTimeIndex = vehicleOnly ? 1 : 0;
  const startPlaceIndex = vehicleOnly ? 2 : 1;
  const directionIndex = vehicleOnly ? 3 : 2;
  if (!/^[A-Z]{2,4}$/.test(tokens[startPlaceIndex])) return null;

  const hasDirection = /^[AR-]$/.test(tokens[directionIndex]);
  const endTimeIndex = hasDirection ? directionIndex + 1 : directionIndex;
  const endPlaceIndex = hasDirection ? directionIndex + 2 : directionIndex + 1;
  if (!TIME_TOKEN_RE.test(tokens[endTimeIndex])) return null;
  if (!/^[A-Z]{2,4}$/.test(tokens[endPlaceIndex])) return null;

  return {
    ln: lineCode,
    lineaNorm: normalizeLineCode(lineCode),
    vett: vehicleOnly ? tokens[0] : '',
    turnoVettura: vehicleOnly ? tokens[0] : '',
    start: normalizeTime(tokens[startTimeIndex]),
    loc_s: tokens[startPlaceIndex],
    dir: hasDirection && tokens[directionIndex] !== '-' ? tokens[directionIndex] : '',
    end: normalizeTime(tokens[endTimeIndex]),
    loc_e: tokens[endPlaceIndex],
    gt,
    ver,
  };
}

function gapMinutes(end, start) {
  const gap = timeToMinutes(start) - timeToMinutes(end);
  return gap < 0 ? gap + 1440 : gap;
}

function detectGt(text, previousGt = '') {
  const versionMatch = text.match(/gruppo\s+\S+\s*-\s*(.+?)\s*-\s*Versione\s+(\w+)/i);
  if (versionMatch) return { gt: versionMatch[1].trim(), ver: versionMatch[2].trim() };

  const header = text.slice(0, 1000).toUpperCase();
  let gt = '';
  if (header.includes('FESTIVO')) gt = 'FESTIVO';
  else if (header.includes('SABATO')) gt = 'SABATO';
  else if (header.includes('LUN') && header.includes('VEN')) gt = 'LUN - VEN';

  return { gt: gt || previousGt, ver: '' };
}

/* Due tratti dello stesso conducente non si sovrappongono: se il secondo parte
   mentre il primo e' ancora in corso, uno dei due e' di un altro turno. Un
   tratto che attraversa la mezzanotte (fine prima dell'inizio) non si
   confronta, perche' il testo non dice a quale giorno appartiene. */
function overlapsInTime(first, second) {
  const firstStart = timeToMinutes(first.start);
  const firstEnd = timeToMinutes(first.end);
  const secondStart = timeToMinutes(second.start);
  if (firstEnd < firstStart) return false;
  return secondStart >= firstStart && secondStart < firstEnd;
}

function hasOverlap(sortedSegments) {
  return sortedSegments.some((segment, index) => index > 0 && overlapsInTime(sortedSegments[index - 1], segment));
}

/* Tiene i tratti che possono stare nello stesso turno e scarta quelli che si
   sovrappongono a uno gia' tenuto. Non aggiunge niente: al piu' lo sviluppo
   resta incompleto, mai mescolato con quello di un altro turno. */
function dropOverlaps(sortedSegments) {
  const kept = [];
  sortedSegments.forEach((segment) => {
    const last = kept[kept.length - 1];
    if (last && overlapsInTime(last, segment)) return;
    kept.push(segment);
  });
  return kept;
}

const LABEL_ROW_RE = /^([A-Z0-9()]+)\s+(\d{1,3})\s+(.+)$/i;
const LABEL_ONLY_RE = /^[A-Z0-9()]+\s+\d{1,3}$/i;
const SEGMENT_START_RE = /^[A-Z0-9()]+\s*\/\s*\d+\s+\d{2}[.:]\d{2}\s/i;
const SEGMENT_TIMES_RE = /\/\s*\d+\s+(\d{2})[.:](\d{2})\s+[A-Z]{2,4}\s+(?:[AR-]\s+)?(\d{2})[.:](\d{2})\s+[A-Z]{2,4}/i;
const TOTALS_RE = /(\d{2})[.:](\d{2})\s+\d{2}[.:]\d{2}(?:\s+(?:-+|\d{2}[.:]\d{2}))?\s*$/;

/* Nella pagina dei turni l'etichetta («56 301») puo' essere disegnata piu' in
   alto della sua riga: nel testo estratto finisce sulla riga dell'ultimo tratto
   del turno prima, e quel tratto passa al turno sbagliato. Succede su tutte le
   righe di continuazione, quindi gli sviluppi escono mescolati.
   La pagina porta con se' la prova: in coda alla prima riga di ogni turno c'e'
   il «tempo netto di guida», che e' la somma delle durate dei suoi tratti. Le
   etichette e le prime righe compaiono nello stesso ordine, quindi la n-esima
   etichetta va sulla n-esima prima riga. Si fa solo se la somma torna per ogni
   turno della pagina; altrimenti il testo resta com'e'. */
function realignTurnLabels(text) {
  const rawLines = String(text || '').split('\n');
  const rows = rawLines.map((raw) => {
    const line = raw.trim();
    const labelMatch = line.match(LABEL_ROW_RE);
    const labeled = Boolean(labelMatch && SEGMENT_START_RE.test(labelMatch[3]));
    const labelOnly = !labeled && LABEL_ONLY_RE.test(line);
    const body = labeled ? labelMatch[3] : labelOnly ? '' : line;
    const times = body.match(SEGMENT_TIMES_RE);
    const totals = body.match(TOTALS_RE);
    return {
      raw,
      body,
      label: labeled ? `${labelMatch[1]} ${labelMatch[2]}` : labelOnly ? line : '',
      isSegment: SEGMENT_START_RE.test(body),
      minutes: times ? (Number(times[3]) * 60 + Number(times[4]) - Number(times[1]) * 60 - Number(times[2]) + 1440) % 1440 : 0,
      net: totals ? Number(totals[1]) * 60 + Number(totals[2]) : null,
    };
  });

  const headers = rows.filter((row) => row.isSegment && row.net !== null);
  const labels = rows.filter((row) => row.label).map((row) => row.label);
  if (headers.length < 2 || headers.length !== labels.length) return text;

  /* Ogni turno e' una prima riga con il suo netto e i tratti senza netto che la
     seguono: la somma delle durate deve tornare, per tutti. */
  const sums = new Map();
  let current = null;
  rows.forEach((row) => {
    if (!row.isSegment) return;
    if (row.net !== null) {
      current = { net: row.net, sum: row.minutes };
      sums.set(row, current);
    } else if (current) {
      current.sum += row.minutes;
    }
  });
  if (![...sums.values()].every((group) => Math.abs(group.sum - group.net) <= 1)) return text;

  let changed = false;
  const lines = [];
  let headerIndex = 0;
  rows.forEach((row) => {
    if (row.isSegment && row.net !== null) {
      const label = labels[headerIndex];
      headerIndex += 1;
      if (row.label !== label) changed = true;
      lines.push(`${label} ${row.body}`);
    } else if (row.label) {
      changed = true;
      if (row.body) lines.push(row.body);
    } else {
      lines.push(row.raw);
    }
  });

  return changed ? lines.join('\n') : text;
}

/* Quando il codice del turno non si legge davanti alla riga, il tratto si
   attacca al turno che lo precede nel testo: due turni diversi finiscono nello
   stesso sviluppo. Il segno e' che i tratti si sovrappongono nel tempo. Li si
   separa in riprese distinte, cosi' chi sceglie lo sviluppo non li mescola.
   Si fa a lettura finita perche' i due parser aggiungono in ordini diversi. */
function separateOverlappingRuns(developments) {
  Object.entries(developments).forEach(([key, segments]) => {
    if (isGraphicKey(key)) return;
    const byRun = new Map();
    segments.forEach((segment) => {
      const run = segment.run_id === undefined ? '_' : String(segment.run_id);
      byRun.set(run, [...(byRun.get(run) || []), segment]);
    });
    let nextRun = Math.max(0, ...segments.map((segment) => Number(segment.run_id) || 0)) + 1;
    byRun.forEach((group) => {
      if (!hasOverlap(sortSegments(group))) return;
      const lanes = [];
      sortSegments(group).forEach((segment) => {
        const lane = lanes.find((items) => !overlapsInTime(items[items.length - 1], segment));
        if (lane) lane.push(segment);
        else lanes.push([segment]);
      });
      lanes.slice(1).forEach((lane) => {
        lane.forEach((segment) => {
          segment.run_id = nextRun;
        });
        nextRun += 1;
      });
    });
  });
}

function addSegment(developments, code, segment) {
  developments[code] = developments[code] || [];
  const exists = developments[code].some(
    (existing) =>
      existing.start === segment.start &&
      existing.end === segment.end &&
      existing.loc_s === segment.loc_s &&
      existing.loc_e === segment.loc_e &&
      existing.gt === segment.gt &&
      existing.ln === segment.ln,
  );
  if (!exists) developments[code].push(segment);
}

const TABLE_SEGMENT_RE =
  /([A-Z0-9/()]+)\s*\/\s*(\d+)\s+(\d{2}[.:]\d{2})\s+([A-Z]{2,4})\s+([AR-])\s+(\d{2}[.:]\d{2})\s+([A-Z]{2,4})/i;
const TABLE_CONTINUATION_RE =
  /^([A-Z0-9/()]+)\s+(?:\/\s*)?(\d+)\s+(\d{2}[.:]\d{2})\s+([A-Z]{2,4})\s+([AR-])\s+(\d{2}[.:]\d{2})\s+([A-Z]{2,4})/i;

function parseOrariTableRows(text, gt, ver, developments, tableState) {
  const state = tableState || { currentCode: '', currentRun: 0 };

  String(text || '')
    .split('\n')
    .forEach((rawLine) => {
      const line = rawLine.trim().toUpperCase();
      if (!line) return;

      const rowStart = line.match(/^([A-Z0-9/()]+)\s+(\d{1,3})\s+(.*)$/);
      const rowStartIsContinuation = Boolean(rowStart && TIME_TOKEN_RE.test(rowStart[3]?.split(/\s+/)[0]));
      const segmentSource = rowStart && !rowStartIsContinuation ? rowStart[3] : line;
      const segmentMatch = segmentSource.match(TABLE_SEGMENT_RE) || (rowStartIsContinuation || !rowStart ? segmentSource.match(TABLE_CONTINUATION_RE) : null);
      if (!segmentMatch) return;

      if (rowStart && !rowStartIsContinuation) {
        state.currentCode = normalizeShiftKey(rowStart[1], rowStart[2]);
        state.currentRun += 1;
      }

      if (!state.currentCode) return;

      const segment = {
        ln: segmentMatch[1],
        lineaNorm: normalizeLineCode(segmentMatch[1]),
        vett: segmentMatch[2],
        turnoVettura: segmentMatch[2],
        start: normalizeTime(segmentMatch[3]),
        loc_s: segmentMatch[4],
        dir: segmentMatch[5] !== '-' ? segmentMatch[5] : '',
        end: normalizeTime(segmentMatch[6]),
        loc_e: segmentMatch[7],
        gt,
        ver,
        run_id: state.currentRun || 1,
      };

      addSegment(developments, state.currentCode, segment);
    });

  return state;
}

export function parseOrariPageLines(text, gt, ver, developments, tableState = null) {
  parseOrariTableRows(text, gt, ver, developments, tableState);

  const tokens = normalizeTokens(text);
  const runCounters = {};
  let currentCode = null;
  let currentRunByCode = {};
  let currentIsDutyBlock = false;

  function startExplicitBlock(code) {
    currentCode = normalizeCode(code);
    currentIsDutyBlock = true;
    runCounters[currentCode] = (runCounters[currentCode] || 0) + 1;
    currentRunByCode[currentCode] = runCounters[currentCode];
    return currentCode;
  }

  function addToCode(code, segment, { keepDutyBlock = false } = {}) {
    const normalizedCode = normalizeCode(code);
    if (!currentRunByCode[normalizedCode]) {
      runCounters[normalizedCode] = (runCounters[normalizedCode] || 0) + 1;
      currentRunByCode[normalizedCode] = runCounters[normalizedCode];
    }
    segment.run_id = currentRunByCode[normalizedCode];
    segment.turnoVettura = segment.vett || normalizedCode;
    addSegment(developments, normalizedCode, segment);
    currentCode = normalizedCode;
    currentIsDutyBlock = keepDutyBlock;
  }

  function isBoundaryAt(index) {
    const line = tokens[index];
    const shift = tokens[index + 1];
    const next = tokens[index + 2];
    if (!/^[A-Z0-9/()]+$/.test(line) || !/^\d{1,3}$/.test(shift)) return false;
    if (/^[A-Z0-9/()]+\/\d+$/.test(line)) return false;
    return Boolean(next && (/^[A-Z0-9/()]+\/\d+$/.test(next) || TIME_TOKEN_RE.test(next)));
  }

  function readSegmentAt(index) {
    const explicitLineVehicle = /^[A-Z0-9/()]+\/\d+$/.test(tokens[index]);
    const vehicleOnly = !explicitLineVehicle && currentCode && /^\d{1,3}$/.test(tokens[index]) && TIME_TOKEN_RE.test(tokens[index + 1]);
    const timeOnly = !explicitLineVehicle && !vehicleOnly && currentCode && TIME_TOKEN_RE.test(tokens[index]);
    if (!explicitLineVehicle && !vehicleOnly && !timeOnly) return null;

    const startTimeIndex = timeOnly ? index : index + 1;
    const startPlaceIndex = timeOnly ? index + 1 : index + 2;
    const directionIndex = timeOnly ? index + 2 : index + 3;
    if (!TIME_TOKEN_RE.test(tokens[startTimeIndex])) return null;
    if (!/^[A-Z]{2,4}$/.test(tokens[startPlaceIndex])) return null;

    const hasDirection = /^[AR-]$/.test(tokens[directionIndex]);
    const endTimeIndex = hasDirection ? directionIndex + 1 : directionIndex;
    const endPlaceIndex = hasDirection ? directionIndex + 2 : directionIndex + 1;
    if (!TIME_TOKEN_RE.test(tokens[endTimeIndex])) return null;
    if (!/^[A-Z]{2,4}$/.test(tokens[endPlaceIndex])) return null;

    const [lineCode, vehicle] = explicitLineVehicle ? tokens[index].split('/') : [String(currentCode).split(/\s+/)[0], timeOnly ? '' : tokens[index]];
    const inferredCode = explicitLineVehicle ? extractCodeFromTokens(tokens, index) : null;
    const usesCurrentDutyBlock = Boolean(currentIsDutyBlock && currentCode);
    const code = explicitLineVehicle
      ? inferredCode || (usesCurrentDutyBlock ? currentCode : normalizeShiftKey(lineCode, vehicle))
      : currentCode || normalizeShiftKey(lineCode, vehicle);
    if (!code) return null;

    return {
      code,
      dutyBlock: Boolean(inferredCode || usesCurrentDutyBlock),
      nextIndex: endPlaceIndex + 1,
      segment: {
        ln: lineCode,
        lineaNorm: normalizeLineCode(lineCode),
        vett: vehicle,
        turnoVettura: vehicle,
        start: normalizeTime(tokens[startTimeIndex]),
        loc_s: tokens[startPlaceIndex],
        dir: hasDirection && tokens[directionIndex] !== '-' ? tokens[directionIndex] : '',
        end: normalizeTime(tokens[endTimeIndex]),
        loc_e: tokens[endPlaceIndex],
        gt,
        ver,
      },
    };
  }

  for (let index = 0; index < tokens.length; ) {
    if (isBoundaryAt(index)) {
      startExplicitBlock(`${tokens[index]} ${tokens[index + 1]}`);
      index += 2;
      continue;
    }

    const item = readSegmentAt(index);
    if (item) {
      if (item.code && item.code !== currentCode && item.dutyBlock) startExplicitBlock(item.code);
      addToCode(item.code, item.segment, { keepDutyBlock: item.dutyBlock && currentIsDutyBlock });
      index = item.nextIndex;
      continue;
    }

    index += 1;
  }
}

/**
 * @param pagesText  il testo delle pagine del PDF
 * @param diagnostics  array facoltativo: se passato, riceve una riga per
 *   pagina con il tipo di servizio che la pagina dichiara di suo e quello che
 *   le viene infine assegnato. Serve solo a leggere cosa e' successo: non
 *   cambia niente di quello che il parser produce.
 */
export function parseOrari(pagesText, { diagnostics = null, places = null } = {}) {
  const pages = Array.isArray(pagesText) ? pagesText : [pagesText];
  const developments = {};
  let lastGt = '';
  const tableStateByService = {};

  pages.forEach((rawPageText, index) => {
    const pageText = realignTurnLabels(rawPageText);
    const { gt, ver } = detectGt(pageText, lastGt);
    if (gt) lastGt = gt;
    const resolved = gt || lastGt || 'TUTTI';

    if (diagnostics) {
      /* Cosa la pagina dice di se', senza eredita': quando e' vuoto la pagina
         non e' stata riconosciuta e sta prendendo il tipo da quella prima. */
      const own = detectGt(pageText, '');
      diagnostics.push({ gt: resolved, own: own.gt, page: index + 1, ver: own.ver, realigned: pageText !== rawPageText, text: rawPageText });
    }

    const serviceKey = `${resolved}|${ver || ''}`;
    tableStateByService[serviceKey] = tableStateByService[serviceKey] || { currentCode: '', currentRun: 0 };
    parseOrariPageLines(pageText, resolved, ver, developments, tableStateByService[serviceKey]);

    /* Il grafico di servizio e' un'altra pagina con un'altra forma: da li'
       vengono le ultime corse prima del deposito e i trasferimenti con cui le
       vetture ne escono, che la tabella dei turni non ha. Stanno sotto chiavi
       che nessun turno puo' avere. */
    /* La legenda della pagina traduce i codici di quattro lettere nel posto
       vero, e serve sia a mostrarli sia a trovarne la posizione. Le pagine ne
       portano pezzi diversi, quindi si accumulano. */
    const legend = parseLegend(pageText);
    if (places) Object.assign(places, legend);

    const line = detectRientriLine(pageText);
    const returns = parseDepotReturns(pageText, { gt: resolved, legend, line, ver });
    if (returns.length) {
      const key = rientriKey(line, resolved);
      developments[key] = developments[key] || [];
      returns.forEach((segment) => addSegment(developments, key, segment));
    }

    const exits = parseDepotExits(pageText, { gt: resolved, line, ver });
    if (exits.length) {
      const key = usciteKey(line, resolved);
      developments[key] = developments[key] || [];
      exits.forEach((segment) => addSegment(developments, key, segment));
    }

    if (diagnostics) {
      const entry = diagnostics[diagnostics.length - 1];
      entry.returns = returns.length;
      entry.exits = exits.length;
      /* Una pagina che ha i marcatori del grafico ma non produce rientri o
         uscite e' l'unico caso su cui si puo' intervenire: del suo testo si
         tiene un pezzo, perche' e' li' che il parser sbaglia. */
      const hints = findGraphicHints(pageText);
      if (hints.markers.length) {
        entry.graphicMarkers = hints.markers;
        if (!returns.length || !exits.length) entry.graphicExcerpt = hints.excerpt;
      }
    }
  });

  separateOverlappingRuns(developments);
  return developments;
}

export function buildDevKeyVariants(line, shiftNumber) {
  const rawLine = normalizeLineCode(line);
  const number = Number.parseInt(rawLine, 10);
  const suffix = rawLine.replace(/^\d+/, '');
  const normalizedShift = String(Number.parseInt(shiftNumber, 10));
  if (!rawLine || normalizedShift === 'NaN') return [];

  const lines = Number.isNaN(number)
    ? [rawLine]
    : [
        `${String(number).padStart(2, '0')}${suffix}`,
        `${number}${suffix}`,
        rawLine,
        String(number).padStart(2, '0'),
        String(number),
      ];

  return [...new Set(lines)]
    .flatMap((item) => [normalizeShiftKey(item, shiftNumber), normalizeShiftKey(item, shiftNumber, { padLine: false })])
    .filter(Boolean)
    .filter((item, index, array) => array.indexOf(item) === index);
}

function matchesServiceDay(segmentGt, date) {
  if (!date || !segmentGt) return true;
  const gt = segmentGt.toUpperCase();
  const day = date.getDay();

  if (isItalianHoliday(date)) return gt.includes('FEST') || gt.includes('DOM');

  if (day === 6) return gt.includes('SAB');
  if (day === 0) return gt.includes('FEST') || gt.includes('DOM');

  return (
    gt.includes('LUN') ||
    gt.includes('MAR') ||
    gt.includes('MER') ||
    gt.includes('GIO') ||
    gt.includes('VEN') ||
    gt.includes('FERIALE') ||
    gt.includes('FERIALI')
  );
}

function easterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

function isItalianHoliday(date) {
  if (!date || Number.isNaN(date.getTime())) return false;
  const year = date.getFullYear();
  const monthDay = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const fixed = new Set(['01-01', '01-06', '04-25', '05-01', '06-02', '08-15', '11-01', '12-08', '12-25', '12-26']);
  if (fixed.has(monthDay)) return true;
  const easterMonday = easterDate(year);
  easterMonday.setDate(easterMonday.getDate() + 1);
  return date.getMonth() === easterMonday.getMonth() && date.getDate() === easterMonday.getDate();
}

function pickRun(segments, preShift) {
  const runs = segments.reduce((acc, segment) => {
    const key = segment.run_id === undefined ? '_' : String(segment.run_id);
    acc[key] = acc[key] || [];
    acc[key].push(segment);
    return acc;
  }, {});
  const runKeys = Object.keys(runs);

  if (runKeys.length <= 1) return runs[runKeys[0]] || segments;
  if (!preShift?.i) return runs[runKeys[0]];

  const preStart = timeToMinutes(`${preShift.i.slice(0, 2)}:${preShift.i.slice(2)}`);
  const bestKey = runKeys
    .map((key) => ({
      key,
      diff: Math.abs(timeToMinutes(runs[key].slice().sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))[0].start) - preStart),
    }))
    .sort((a, b) => a.diff - b.diff)[0].key;

  return runs[bestKey];
}

function sortSegments(segments) {
  return segments.slice().sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
}

function compactToMinutes(value) {
  const time = compactTime(value);
  return time ? timeToMinutes(time) : null;
}

function isWithinShiftWindow(segment, preShift) {
  const shiftStart = compactToMinutes(preShift?.i);
  let shiftEnd = compactToMinutes(preShift?.e);
  let segmentStart = timeToMinutes(segment.start);
  let segmentEnd = timeToMinutes(segment.end);
  if (shiftStart === null || shiftEnd === null) return false;
  if (shiftEnd < shiftStart) shiftEnd += 24 * 60;
  if (segmentStart < shiftStart && shiftEnd > 24 * 60) segmentStart += 24 * 60;
  if (segmentEnd < segmentStart) segmentEnd += 24 * 60;

  return segmentStart >= shiftStart && segmentEnd <= shiftEnd;
}

function reachesPreShiftEnd(segment, preShift) {
  const endTime = compactTime(preShift?.e);
  const endPlace = normalizePlace(preShift?.le);
  return Boolean(endTime && segment?.end === endTime && (!endPlace || normalizePlace(segment?.loc_e) === endPlace));
}

function startsAtPreShift(segment, preShift) {
  const startTime = compactTime(preShift?.i);
  const startPlace = normalizePlace(preShift?.li);
  return Boolean(startTime && segment?.start === startTime && (!startPlace || normalizePlace(segment?.loc_s) === startPlace));
}

function coversPreShift(segments, preShift) {
  if (!segments?.length) return false;
  const sorted = sortSegments(segments);
  return startsAtPreShift(sorted[0], preShift) && reachesPreShiftEnd(sorted[sorted.length - 1], preShift);
}

function segmentKey(segment) {
  return `${segment.start}|${segment.end}|${segment.loc_s}|${segment.loc_e}|${segment.vett || ''}`;
}

function segmentStartAbsolute(segment, preShift) {
  const shiftStart = compactToMinutes(preShift?.i) ?? 0;
  let start = timeToMinutes(segment.start);
  if (start < shiftStart) start += 24 * 60;
  return start;
}

function segmentEndAbsolute(segment, preShift) {
  let end = timeToMinutes(segment.end);
  const start = segmentStartAbsolute(segment, preShift);
  if (end < start) end += 24 * 60;
  return end;
}

function pickBestWindowChain(segments, preShift) {
  const endTime = compactTime(preShift?.e);
  const endPlace = normalizePlace(preShift?.le);
  if (!segments.length || !endTime) return [];

  const sorted = segments
    .slice()
    .sort((a, b) => segmentStartAbsolute(a, preShift) - segmentStartAbsolute(b, preShift) || segmentEndAbsolute(a, preShift) - segmentEndAbsolute(b, preShift));
  const chains = sorted.map((segment) => [segment]);

  for (let index = 0; index < sorted.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < sorted.length; nextIndex += 1) {
      const current = sorted[index];
      const next = sorted[nextIndex];
      const gap = segmentStartAbsolute(next, preShift) - segmentEndAbsolute(current, preShift);
      if (gap < 0 || gap > 240) continue;
      const candidate = [...chains[index], next];
      if (candidate.length > chains[nextIndex].length) chains[nextIndex] = candidate;
    }
  }

  return chains
    .filter((chain) => chain.length)
    .map((chain) => {
      const first = chain[0];
      const last = chain[chain.length - 1];
      const reachesEnd = last.end === endTime && (!endPlace || normalizePlace(last.loc_e) === endPlace);
      const covered = chain.reduce((sum, segment) => sum + (segmentEndAbsolute(segment, preShift) - segmentStartAbsolute(segment, preShift)), 0);
      const span = segmentEndAbsolute(last, preShift) - segmentStartAbsolute(first, preShift);
      const gaps = Math.max(0, span - covered);
      return { chain, reachesEnd, covered, gaps, count: chain.length };
    })
    .filter((item) => item.reachesEnd)
    .sort((a, b) => b.covered - a.covered || a.gaps - b.gaps || b.count - a.count)[0]?.chain || [];
}

function findExactShiftPath(developments, line, date, preShift) {
  const lineNorm = normalizeLineCode(line);
  const shiftStart = compactToMinutes(preShift?.i);
  let shiftEnd = compactToMinutes(preShift?.e);
  const startTime = compactTime(preShift?.i);
  const endTime = compactTime(preShift?.e);
  const startPlace = normalizePlace(preShift?.li);
  const endPlace = normalizePlace(preShift?.le);
  if (!lineNorm || shiftStart === null || shiftEnd === null || !startTime || !endTime) return [];
  if (shiftEnd < shiftStart) shiftEnd += 24 * 60;

  const seen = new Set();
  const baseCandidates = Object.values(developments || {})
    .flat()
    .filter((segment) => (segment.lineaNorm || normalizeLineCode(segment.ln)) === lineNorm)
    .filter((segment) => isWithinShiftWindow(segment, preShift))
    .filter((segment) => {
      const key = segmentKey(segment);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => segmentStartAbsolute(a, preShift) - segmentStartAbsolute(b, preShift) || segmentEndAbsolute(a, preShift) - segmentEndAbsolute(b, preShift));
  const dayCandidates = baseCandidates.filter((segment) => matchesServiceDay(segment.gt, date));

  function buildPath(candidates) {
    const starts = candidates.filter((segment) => segment.start === startTime && (!startPlace || normalizePlace(segment.loc_s) === startPlace));
    if (!starts.length) return [];

    const completePaths = [];
    const maxSegments = 6;

    function walk(path) {
      const last = path[path.length - 1];
      if (last.end === endTime && (!endPlace || normalizePlace(last.loc_e) === endPlace)) {
        completePaths.push(path);
        return;
      }
      if (path.length >= maxSegments) return;

      const lastEnd = segmentEndAbsolute(last, preShift);
      candidates.forEach((next) => {
        if (path.some((segment) => segmentKey(segment) === segmentKey(next))) return;
        const nextStart = segmentStartAbsolute(next, preShift);
        const gap = nextStart - lastEnd;
        if (gap < 0 || gap > 240) return;
        if (segmentEndAbsolute(next, preShift) <= lastEnd) return;
        walk([...path, next]);
      });
    }

    starts.forEach((segment) => walk([segment]));
    if (!completePaths.length) return [];

    return completePaths
      .map((path) => {
        const covered = path.reduce((sum, segment) => sum + (segmentEndAbsolute(segment, preShift) - segmentStartAbsolute(segment, preShift)), 0);
        const first = path[0];
        const last = path[path.length - 1];
        const span = segmentEndAbsolute(last, preShift) - segmentStartAbsolute(first, preShift);
        return {
          path,
          covered,
          idle: span - covered,
        };
      })
      .sort((a, b) => a.idle - b.idle || b.covered - a.covered || a.path.length - b.path.length)[0].path;
  }

  const dayPath = buildPath(dayCandidates);
  return dayPath.length ? dayPath : buildPath(baseCandidates);
}

function completeShiftFromWindow(developments, line, date, preShift, baseSegments) {
  const shiftNumber = Number.parseInt(preShift?.n, 10);
  const lineNorm = normalizeLineCode(line);
  const endTime = compactTime(preShift?.e);
  if (!lineNorm || Number.isNaN(shiftNumber) || !baseSegments?.length || !endTime) return baseSegments;

  const sortedBase = sortSegments(baseSegments);
  if (reachesPreShiftEnd(sortedBase[sortedBase.length - 1], preShift)) return sortedBase;

  const basePool = Object.values(developments || {})
    .flat()
    .filter((segment) => (segment.lineaNorm || normalizeLineCode(segment.ln)) === lineNorm)
    .filter((segment) => isWithinShiftWindow(segment, preShift));
  const dayPool = basePool.filter((segment) => matchesServiceDay(segment.gt, date));
  const pool = dayPool.length ? dayPool : basePool;
  const existing = new Set();
  const uniquePool = [...sortedBase, ...pool].filter((segment) => {
    const key = segmentKey(segment);
    if (existing.has(key)) return false;
    existing.add(key);
    return true;
  });
  const chain = pickBestWindowChain(uniquePool, preShift);
  return chain.length > sortedBase.length ? sortSegments(chain) : sortedBase;
}

function shouldKeepFullDevelopment(segments, preShift) {
  if (!segments?.length) return false;
  if (preShift?.communicated) return true;
  if (segments.length <= 1) return false;

  const preStart = compactTime(preShift?.i);
  if (!preStart) return false;
  const sorted = sortSegments(segments);
  return sorted[0]?.start === preStart;
}

function compactTime(value) {
  const raw = String(value || '').replace(/\D/g, '');
  if (raw.length !== 4) return '';
  return `${raw.slice(0, 2)}:${raw.slice(2)}`;
}

function normalizePlace(value) {
  return String(value || '').trim().toUpperCase();
}

function scoreFallbackSegments(key, segments, line, shiftNumber, date, preShift) {
  if (!segments?.length) return 0;

  const candidates = segments.filter((segment) => matchesServiceDay(segment.gt, date));
  const list = candidates.length ? candidates : segments;
  const sorted = list.slice().sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const lineNorm = normalizeLineCode(line);
  const startTime = compactTime(preShift?.i);
  const endTime = compactTime(preShift?.e);
  const startPlace = normalizePlace(preShift?.li);
  const endPlace = normalizePlace(preShift?.le);
  const normalizedShift = String(Number.parseInt(shiftNumber, 10));
  let score = 0;

  if (list.some((segment) => segment.lineaNorm === lineNorm || normalizeLineCode(segment.ln) === lineNorm)) score += 4;
  if (normalizedShift !== 'NaN' && String(key).split(' ')[1] === normalizedShift) score += 5;
  if (first?.start === startTime) score += 3;
  if (last?.end === endTime) score += 3;
  if (normalizePlace(first?.loc_s) === startPlace) score += 2;
  if (normalizePlace(last?.loc_e) === endPlace) score += 2;

  return score;
}

function findFallbackSegments(developments, line, shiftNumber, date, preShift) {
  if (!preShift) return [];

  const best = Object.entries(developments || {})
    .map(([key, segments]) => ({
      key,
      segments,
      score: scoreFallbackSegments(key, segments, line, shiftNumber, date, preShift),
    }))
    .filter((item) => item.score >= 7)
    .sort((a, b) => b.score - a.score || a.segments.length - b.segments.length)[0];

  if (!best) return [];
  const filtered = best.segments.filter((segment) => matchesServiceDay(segment.gt, date));
  return filtered.length ? filtered : best.segments;
}

function buildCommunicatedSegment(preShift) {
  if (!preShift?.communicated || !preShift.i || !preShift.e || !preShift.li || !preShift.le) return [];
  return [
    {
      ln: preShift.l || '',
      lineaNorm: normalizeLineCode(preShift.l),
      vett: '',
      turnoVettura: normalizeShiftKey(preShift.l, preShift.n),
      start: compactTime(preShift.i),
      loc_s: preShift.li,
      dir: preShift.di || '',
      end: compactTime(preShift.e),
      loc_e: preShift.le,
      gt: '',
      ver: '',
      run_id: 1,
      source: 'communicated',
    },
  ];
}

function resolveDevSegments(developments, line, shiftNumber, date, preShift) {
  const keys = buildDevKeyVariants(line, shiftNumber);
  const matchedKey = keys.find((key) => developments?.[key]?.length);
  const allSegments = matchedKey ? developments[matchedKey] : [];
  const filtered = allSegments.filter((segment) => matchesServiceDay(segment.gt, date));
  const candidates = allSegments.length ? pickRun(filtered.length ? filtered : allSegments, preShift) : [];
  const sortedAll = sortSegments(candidates);
  /* Le letture salvate prima della correzione del parser hanno gia' i tratti
     di piu' turni nello stesso sviluppo. Con una sovrapposizione la scorciatoia
     "tieni tutto" non vale: si riparte da quelli compatibili e, se non
     arrivano a fine turno, si ricostruisce dagli estremi della preconoscenza. */
  const mixed = hasOverlap(sortedAll);
  const sortedCandidates = mixed ? dropOverlaps(sortedAll) : sortedAll;
  if (coversPreShift(sortedCandidates, preShift) || (!mixed && shouldKeepFullDevelopment(sortedCandidates, preShift))) return sortedCandidates;

  const exactPath = findExactShiftPath(developments, line, date, preShift);
  if (exactPath.length) return sortSegments(exactPath);

  const crossServiceSameTurn = allSegments.length ? pickRun(allSegments, preShift) : [];
  const sortedCrossServiceSameTurn = sortSegments(crossServiceSameTurn);
  if (coversPreShift(sortedCrossServiceSameTurn, preShift)) return sortedCrossServiceSameTurn;

  const completed = completeShiftFromWindow(developments, line, date, preShift, sortedCandidates);
  if (coversPreShift(completed, preShift) || completed.length > sortedCandidates.length) return sortSegments(completed);

  const fallback = findFallbackSegments(developments, line, shiftNumber, date, preShift);
  if (fallback.length) return sortSegments(fallback);

  if (sortedCandidates.length) return sortedCandidates;
  return buildCommunicatedSegment(preShift);
}

export function getDevSegments(developments, line, shiftNumber, date, preShift = null) {
  const resolved = resolveDevSegments(developments, line, shiftNumber, date, preShift);
  return hasOverlap(resolved) ? dropOverlaps(resolved) : resolved;
}

export function summarizeDevelopments(developments) {
  // Rientri e uscite letti dal grafico di servizio stanno nella stessa mappa ma
  // non sono turni: contarli gonfiava il numero mostrato dopo il caricamento.
  const keys = Object.keys(developments || {}).filter((key) => !isGraphicKey(key));
  return {
    totalTurns: keys.length,
    splitTurns: keys.filter((key) => {
      const runs = (developments[key] || []).reduce((acc, segment) => {
        const run = segment.run_id === undefined ? '_' : String(segment.run_id);
        acc[run] = (acc[run] || 0) + 1;
        return acc;
      }, {});
      return Object.values(runs).some((count) => count > 1);
    }).length,
  };
}
