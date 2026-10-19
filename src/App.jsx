import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import {
  REST_CODES,
  SPECIAL_CODES,
  formatCompactTime,
  parseCommunicatedShift,
  parsePreconoscenza,
  toIso,
} from './parserPreconoscenza.js';
import { computeStats, enrichShiftDays, getNextWorkingShift } from './analytics.js';
import { buildBallotICS, buildICS, buildWakeAlarmsICS, openCalendarICS } from './calendarExport.js';
import { collectWakeAlarms } from './utils/wakeAlarms.js';
import {
  buildBackup,
  clearStoredAppData,
  getHistory,
  getStorageReport,
  loadOrariByKey,
  loadOrariParserVersion,
  loadOrariPlaces,
  loadPreferences,
  loadPreconoscenzaByKey,
  orariKey,
  restoreBackup,
  saveOrari,
  savePreferences,
  savePreconoscenza,
} from './storage.js';
import { buildCsv, buildPreconoscenzaInfographicBlob, downloadBlobFile, downloadTextFile } from './exportUtils.js';
import { getDevSegments, normalizeShiftKey, parseOrari, summarizeDevelopments } from './parserOrari.js';
import { buildOrariReport } from './utils/orariDiagnostics.js';
import { RIENTRI_PARSER_VERSION } from './parserRientri.js';
import { parseNaturalDate, toIsoDate } from './utils/dateUtils.js';
import { isGerbidoLine as checkGerbidoLine } from './constants/depotGerbido.js';
import { DEFAULT_REST_CODE, getOfficialRestEntries } from './constants/restCodes2026.js';
import { BALLOTTAGGI, getShiftCategory } from './constants/shiftClassification.js';
import { Header } from './components/Header.jsx';
import { UploadPanel } from './components/UploadPanel.jsx';
import { ShiftCard } from './components/ShiftCard.jsx';
import { MonthView } from './components/MonthView.jsx';
import { MonthDayList } from './components/MonthDayList.jsx';
import { StatsPanel } from './components/StatsPanel.jsx';
import { AdvancedTools } from './components/AdvancedTools.jsx';
import { LineConsultation } from './components/LineConsultation.jsx';
import { DepotReturnsPanel } from './components/DepotReturnsPanel.jsx';
import { DepotDeparturesPanel } from './components/DepotDeparturesPanel.jsx';
import { OnboardingHome, SuspendedShiftEntry } from './components/OnboardingHome.jsx';
import { PreconoscenzaOverview } from './components/PreconoscenzaOverview.jsx';
import { Icon } from './components/Icon.jsx';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/* Cinque destinazioni - oggi, calendario, periodo, linee, altro - una sola
   visibile per volta. Ogni sezione sostituisce la precedente: il dock e'
   navigazione, non un salto di scroll. La app si apre sempre su "oggi", quindi
   non c'e' piu' una sezione salvata da validare ne' vecchi nomi da tradurre. */
const DEFAULT_MONTH_FILTERS = {
  turni: false,
  riposi: false,
  ballottaggi: false,
};
const MONTH_NAMES = [
  'Gennaio',
  'Febbraio',
  'Marzo',
  'Aprile',
  'Maggio',
  'Giugno',
  'Luglio',
  'Agosto',
  'Settembre',
  'Ottobre',
  'Novembre',
  'Dicembre',
];

const dateFormatter = new Intl.DateTimeFormat('it-IT', {
  weekday: 'short',
  day: 'numeric',
  month: 'long',
});

const periodFormatter = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function daysBetween(from, to) {
  const start = new Date(from);
  const end = new Date(to);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.round((end - start) / 86400000);
}

function weekdayShort(date) {
  return new Intl.DateTimeFormat('it-IT', { weekday: 'short' }).format(date);
}

function normalizeDateOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function positiveModulo(value, modulo) {
  return ((value % modulo) + modulo) % modulo;
}

function restCodeForDay(day) {
  return day?.t && REST_CODES[day.t] && day.t !== 'RIS' ? day.t : '';
}

function buildProjectedRest(date, code, note = 'Riposo calcolato dalla sequenza caricata') {
  const iso = toIsoDate(date);
  return {
    iso,
    date: new Date(date),
    g: weekdayShort(date),
    t: code || 'RP',
    c: 'RP',
    x: note,
    projected: true,
  };
}

function buildOfficialRestDays(monthDate, restCode = DEFAULT_REST_CODE) {
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const projected = {};

  getOfficialRestEntries(monthDate.getFullYear(), restCode).forEach(([iso, code]) => {
    if (!REST_CODES[code]) return;
    const date = normalizeDateOnly(`${iso}T00:00:00`);
    if (!date || date < monthStart || date > monthEnd) return;
    projected[iso] = buildProjectedRest(date, code, `Riposo da Cod. Rip. ${restCode}`);
  });

  return projected;
}

function inferRestRotation(sourceDays) {
  const entries = Object.values(sourceDays)
    .map((day) => {
      const date = day?.date ? normalizeDateOnly(day.date) : null;
      if (!date) return null;
      return { date, code: restCodeForDay(day) };
    })
    .filter(Boolean)
    .sort((a, b) => a.date - b.date);

  const restEntries = entries.filter((entry) => entry.code);
  if (entries.length < 20 || restEntries.length < 3) return null;

  const start = entries[0].date;
  const scoredCycles = [35, 42, 28, 30, 36, 40].map((cycle) => {
    const residues = new Map();
    restEntries.forEach((entry) => {
      const residue = positiveModulo(daysBetween(start, entry.date), cycle);
      if (!residues.has(residue)) residues.set(residue, entry.code);
    });

    let falseRests = 0;
    entries.forEach((entry) => {
      const residue = positiveModulo(daysBetween(start, entry.date), cycle);
      if (residues.has(residue) && !entry.code) falseRests += 1;
    });

    const expectedRestRatio = residues.size / cycle;
    const observedRestRatio = restEntries.length / entries.length;
    const densityPenalty = Math.abs(expectedRestRatio - observedRestRatio);

    return { cycle, residues, falseRests, densityPenalty };
  });

  const [best] = scoredCycles.sort((a, b) => {
    if (a.falseRests !== b.falseRests) return a.falseRests - b.falseRests;
    if (a.densityPenalty !== b.densityPenalty) return a.densityPenalty - b.densityPenalty;
    if (a.cycle === 35) return -1;
    if (b.cycle === 35) return 1;
    return a.cycle - b.cycle;
  });

  if (!best || best.falseRests > Math.max(1, Math.floor(entries.length * 0.08))) return null;

  return {
    start,
    codeForDate(date) {
      const residue = positiveModulo(daysBetween(start, date), best.cycle);
      return best.residues.get(residue) || '';
    },
  };
}

function buildIntervalProjectedRestDays(sourceDays, monthStart, monthEnd) {
  const restDays = Object.values(sourceDays)
    .map((day) => {
      const date = day?.date ? normalizeDateOnly(day.date) : null;
      const code = restCodeForDay(day);
      return date && code ? { date, code } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.date - b.date);

  if (!restDays.length) return {};

  const intervals = restDays
    .slice(1)
    .map((day, index) => daysBetween(restDays[index].date, day.date))
    .filter((value) => value > 0 && value <= 14);
  const pattern = intervals.length ? intervals : [7];
  const projected = {};

  function addProjected(date, code) {
    if (date < monthStart || date > monthEnd) return;
    projected[toIsoDate(date)] = buildProjectedRest(date, code);
  }

  let forwardDate = new Date(restDays[0].date);
  let forwardIndex = 0;
  while (forwardDate <= monthEnd) {
    const code = restDays[positiveModulo(forwardIndex, restDays.length)]?.code || 'RP';
    addProjected(forwardDate, code);
    forwardDate = addDays(forwardDate, pattern[positiveModulo(forwardIndex, pattern.length)]);
    forwardIndex += 1;
  }

  let backwardDate = new Date(restDays[0].date);
  let backwardIndex = 0;
  while (backwardDate >= monthStart) {
    backwardIndex -= 1;
    const interval = pattern[positiveModulo(backwardIndex, pattern.length)];
    backwardDate = addDays(backwardDate, -interval);
    const code = restDays[positiveModulo(backwardIndex, restDays.length)]?.code || 'RP';
    addProjected(backwardDate, code);
  }

  return projected;
}

function buildProjectedRestDays(sourceDays, monthDate) {
  const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

  const officialRestDays = buildOfficialRestDays(monthDate);
  if (Object.keys(officialRestDays).length) return officialRestDays;

  const rotation = inferRestRotation(sourceDays);
  if (!rotation) return buildIntervalProjectedRestDays(sourceDays, monthStart, monthEnd);

  const projected = {};
  for (let day = new Date(monthStart); day <= monthEnd; day = addDays(day, 1)) {
    const code = rotation.codeForDate(day);
    if (code) projected[toIsoDate(day)] = buildProjectedRest(day, code);
  }

  return projected;
}

function formatDuration(value) {
  if (!value) return '';
  return `${Number(value.slice(0, 2))}h ${value.slice(2, 4)}m`;
}

function buildShiftCard(day, prefix = '', enrichment = null) {
  if (!day) return null;

  const baseDate = `${prefix}${dateFormatter.format(day.date || new Date(`${day.iso}T00:00:00`))}`;

  if (day.t !== 'turno') {
    const info = SPECIAL_CODES[day.t] || { label: day.t, description: '' };
    return {
      type: 'special',
      iso: day.iso,
      date: baseDate,
      title: info.label,
      code: day.t,
      description: info.description,
      ballot: day.ball || '',
      note: day.ball ? BALLOTTAGGI[day.ball]?.description || 'Turno da assegnare' : day.x,
      ballotLabel: day.ball ? BALLOTTAGGI[day.ball]?.label : '',
    };
  }

  const category = getShiftCategory(day.n);
  return {
    date: baseDate,
    line: day.l || '-',
    number: day.n || '-',
    start: formatCompactTime(day.i),
    startPlace: day.li || '-',
    startDirection: day.di || '',
    end: formatCompactTime(day.e),
    endPlace: day.le || '-',
    endDirection: day.de || '',
    direction: day.di || '-',
    code: day.c || '-',
    status: 'Turno',
    duration: formatDuration(day.d),
    category,
    segments: enrichment?.segments || [],
    isSplit: Boolean(enrichment?.isSplit),
    isEvening: Boolean(enrichment?.isEvening),
    isShortRest: Boolean(enrichment?.isShortRest),
    restMinutes: enrichment?.restMinutes ?? null,
  };
}

function pickHomeDay(days) {
  const today = new Date();
  const candidates = [
    { iso: toIso(today), prefix: 'Oggi · ' },
    { iso: toIso(addDays(today, 1)), prefix: 'Domani · ' },
  ];

  for (const candidate of candidates) {
    if (days[candidate.iso]) return { day: days[candidate.iso], prefix: candidate.prefix };
  }

  for (let offset = 2; offset < 7; offset += 1) {
    const iso = toIso(addDays(today, offset));
    if (days[iso]) return { day: days[iso], prefix: 'Settimana · ' };
  }

  const [firstIso] = Object.keys(days).sort();
  return firstIso ? { day: days[firstIso], prefix: '' } : { day: null, prefix: '' };
}

function buildStats(days, developments) {
  const stats = computeStats(days, developments);
  return [
    { label: 'Turni', value: String(stats.totalShifts) },
    { label: 'Riposi', value: String(stats.restDays) },
    { label: 'Ballottaggi', value: String(stats.ballots) },
    { label: '2 riprese', value: String(stats.splitShifts) },
    { label: 'Serali', value: String(stats.eveningShifts) },
    { label: 'Riposi brevi', value: String(stats.shortRests) },
    { label: 'Durata media', value: stats.averageShiftDuration.label },
    { label: 'Giorno lungo', value: stats.longestDay?.label || '-' },
  ];
}

function buildPeriodLabel(info) {
  if (!info?.dIn || !info?.dTe) return 'Nessun periodo caricato';
  return `${periodFormatter.format(info.dIn)} - ${periodFormatter.format(info.dTe)}`;
}

function getInitialDate(days, fallback = new Date()) {
  const firstIso = Object.keys(days || {}).sort()[0];
  return firstIso ? new Date(`${firstIso}T00:00:00`) : fallback;
}

function isRecognizedLine(day, developments = {}) {
  if (!day || day.t !== 'turno') return false;
  if (day.isGerbidoLine || checkGerbidoLine(day.lineaNorm || day.linea || day.l)) return true;
  return getDevSegments(developments, day.l, day.n, day.date, day).length > 0;
}

function normalizeDayForDisplay(day, developments = {}) {
  if (!day || day.t !== 'turno') return day;
  return {
    ...day,
    isGerbidoLine: isRecognizedLine(day, developments),
  };
}

function dateFromInputValue(value) {
  return value ? new Date(`${value}T00:00:00`) : null;
}

function countPreconoscenzaRows(text) {
  return (text.match(/\d{2}\/\d{2}\/\d{4}\s+(?:DOM|LUN|MAR|MER|GIO|VEN|SAB)\s+/g) || []).length;
}

function countOrariRows(text) {
  return (
    text.match(
      /(?:[A-Z0-9]{1,3}\s+\d{1,3}\s+)?[A-Z0-9]+\s*\/\s*\d+\s+\d{2}[.:]\d{2}\s+[A-Z]{2,4}\s+[AR-]\s+\d{2}[.:]\d{2}\s+[A-Z]{2,4}/g,
    ) || []
  ).length;
}

function countUsefulPdfRows(text) {
  return countPreconoscenzaRows(text) + countOrariRows(text);
}

function textItemsFromContent(content) {
  return content.items
    .filter((item) => item.str?.trim())
    .map((item) => ({
      x: Math.round(item.transform[4]),
      y: Math.round(item.transform[5]),
      str: item.str.trim(),
      height: item.height || 10,
    }));
}

function buildTextFromItems(items, page) {
  if (!items.length) return '';

  const view = page.view;
  const pageWidth = view ? view[2] - view[0] : 595;
  const pageHeight = view ? view[3] - view[1] : 842;

  function byX(sourceItems) {
    const rows = new Map();
    sourceItems.forEach((item) => {
      const key = [...rows.keys()].find((existing) => Math.abs(Number(existing) - item.x) <= 8) ?? String(item.x);
      rows.set(key, [...(rows.get(key) || []), item]);
    });

    return [...rows.keys()]
      .map(Number)
      .sort((a, b) => b - a)
      .map((key) =>
        rows
          .get(String(key))
          .slice()
          .sort((a, b) => a.y - b.y)
          .map((item) => item.str)
          .join(' ')
          .trim(),
      )
      .filter(Boolean)
      .join('\n');
  }

  function byY(sourceItems) {
    const rows = new Map();
    sourceItems.forEach((item) => {
      const key = [...rows.keys()].find((existing) => Math.abs(Number(existing) - item.y) <= 8) ?? String(item.y);
      rows.set(key, [...(rows.get(key) || []), item]);
    });

    return [...rows.keys()]
      .map(Number)
      .sort((a, b) => b - a)
      .map((key) =>
        rows
          .get(String(key))
          .slice()
          .sort((a, b) => a.x - b.x)
          .map((item) => item.str)
          .join(' ')
          .trim(),
      )
      .filter(Boolean)
      .join('\n');
  }

  function byYTop(sourceItems) {
    const sortedItems = sourceItems
      .map((item) => ({ ...item, yTop: pageHeight - item.y }))
      .sort((a, b) => {
        const dy = a.yTop - b.yTop;
        return Math.abs(dy) > 5 ? dy : a.x - b.x;
      });
    const lines = [];
    let currentY = null;
    let currentLine = [];

    sortedItems.forEach((item) => {
      const tolerance = Math.max(3, item.height * 0.4);
      if (currentY === null || Math.abs(item.yTop - currentY) > tolerance) {
        if (currentLine.length) lines.push(currentLine);
        currentLine = [item];
        currentY = item.yTop;
      } else {
        currentLine.push(item);
      }
    });

    if (currentLine.length) lines.push(currentLine);
    return lines
      .map((line) =>
        line
          .slice()
          .sort((a, b) => a.x - b.x)
          .map((item) => item.str)
          .join(' '),
      )
      .join('\n');
  }

  const rotation = page.rotate || 0;
  const builders =
    rotation === 90 || rotation === 270
      ? [byX, byY, byYTop]
      : pageWidth > pageHeight
        ? [byY, byX, byYTop]
        : [byYTop, byY, byX];

  return builders
    .map((builder) => builder(items.slice()))
    .sort((a, b) => countUsefulPdfRows(b) - countUsefulPdfRows(a))[0];
}

async function extractTextFromPage(page) {
  const firstContent = await page.getTextContent({ disableCombineTextItems: true });
  const firstText = buildTextFromItems(textItemsFromContent(firstContent), page);

  try {
    const secondContent = await page.getTextContent({ disableCombineTextItems: false });
    const secondText = buildTextFromItems(textItemsFromContent(secondContent), page);
    return countUsefulPdfRows(secondText) > countUsefulPdfRows(firstText) ? secondText : firstText;
  } catch {
    return firstText;
  }
}

async function extractTextPagesFromPdf(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;

  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    pages.push(await extractTextFromPage(page));
  }

  return { pages, pageCount: pdf.numPages };
}

/* Una botola, non una funzione: si apre solo aggiungendo ?diag=orari
   all'indirizzo, e serve a leggere come il parser ha diviso le pagine del PDF
   fra feriale, sabato e festivo - una cosa che dai dati caricati non si vede.
   Senza il parametro nella app non compare niente. */
function readOrariDiagnosticsFlag() {
  try {
    return new URLSearchParams(window.location.search).get('diag') === 'orari';
  } catch {
    return false;
  }
}

export default function App() {
  const onboardingInputRef = useRef(null);
  const monthPreconoscenzaInputRef = useRef(null);
  const monthOrariInputRef = useRef(null);
  const sectionTopRef = useRef(null);
  const savedPrefs = useMemo(() => loadPreferences(), []);
  const [pdfLoaded, setPdfLoaded] = useState(false);
  const [pdfInfo, setPdfInfo] = useState(null);
  const [days, setDays] = useState({});
  const [developments, setDevelopments] = useState({});
  const [orariInfo, setOrariInfo] = useState(null);
  // Con quale versione del parser e' stata letta la lettura in uso.
  const [orariParserVersion, setOrariParserVersion] = useState(RIENTRI_PARSER_VERSION);
  // La legenda del PDF: dei codici di quattro lettere dice il posto vero.
  const [orariPlaces, setOrariPlaces] = useState({});
  const [orariLoaded, setOrariLoaded] = useState(false);
  const diagnosticsOn = useMemo(() => readOrariDiagnosticsFlag(), []);
  /* Il referto per pagina esiste solo se il PDF viene riletto con la botola
     aperta: le pagine non si salvano, negli sviluppi restano solo i segmenti. */
  const [orariPageDiagnostics, setOrariPageDiagnostics] = useState(null);
  /* Aprendo la app si torna sempre su Oggi, qualunque sezione fosse aperta
     l'ultima volta. La domanda con cui si apre questa app e' sempre la stessa
     - che turno faccio - e riaprirla su Linee o su Altro vuol dire un tocco in
     piu' per arrivarci. La sezione si continua a salvare, che serve a chi
     legge le preferenze, ma non decide piu' da dove si parte. */
  const [activeSection, setActiveSection] = useState('oggi');
  const [linesTab, setLinesTab] = useState('lines');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchMessage, setSearchMessage] = useState('');
  const [rangeFrom, setRangeFrom] = useState(toIsoDate(new Date()));
  const [rangeTo, setRangeTo] = useState(toIsoDate(new Date()));
  const [hideRests, setHideRests] = useState(false);
  const [onlyWorkShifts, setOnlyWorkShifts] = useState(false);
  const [monthFilters, setMonthFilters] = useState(DEFAULT_MONTH_FILTERS);
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [orariLoading, setOrariLoading] = useState(false);
  const [error, setError] = useState('');
  const [orariError, setOrariError] = useState('');
  const [uploadPhase, setUploadPhase] = useState('');
  const [history, setHistory] = useState(() => getHistory());
  const [preferences, setPreferences] = useState(() => ({ autoRestore: true, ...savedPrefs }));
  const [backupMessage, setBackupMessage] = useState('');
  const [storageMessage, setStorageMessage] = useState('');
  const [storageReport, setStorageReport] = useState(() => getStorageReport());
  const [calendarPulse, setCalendarPulse] = useState(0);
  const [suspendedShiftText, setSuspendedShiftText] = useState('');
  const [suspendedShiftError, setSuspendedShiftError] = useState('');
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const manualEntryRef = useRef(null);
  const manualEntryDate =
    selectedDate instanceof Date && !Number.isNaN(selectedDate.getTime()) ? selectedDate : new Date();

  useEffect(() => {
    savePreferences({ ...preferences, activeSection });
  }, [activeSection, preferences]);

  /* Cambiando sezione il contenuto e' gia' in cima: basta riportarci la
     finestra, senza inseguire il pannello a meta' pagina. */
  useEffect(() => {
    if (!pdfLoaded) return;
    window.requestAnimationFrame(() => {
      sectionTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [activeSection, calendarPulse, pdfLoaded]);

  useEffect(() => {
    if (!preferences.autoRestore || pdfLoaded) return;
    const [latest] = getHistory().filter((entry) => entry.type === 'preconoscenza');
    if (!latest) return;
    const stored = loadPreconoscenzaByKey(latest.key);
    if (stored) applyPreconoscenza(stored, { save: false });
  }, []);

  function refreshHistory() {
    setHistory(getHistory());
    setStorageReport(getStorageReport());
  }

  function markStorageFailure(context) {
    setStorageMessage(`${context}: memoria locale piena o non disponibile. Esporta un backup e libera spazio dai dati salvati.`);
    setBackupMessage('Salvataggio non riuscito: memoria locale piena o non disponibile.');
    setActiveSection('altro');
  }

  function applyPreconoscenza(result, options = {}) {
    setDays(result.days);
    setPdfInfo({
      fileName: result.fileName,
      nome: result.nome,
      matricola: result.matricola,
      dIn: result.dIn,
      dTe: result.dTe,
    });
    setPdfLoaded(true);
    const initialDate = result.dIn || getInitialDate(result.days);
    if (!options.keepCalendarPosition) {
      setSelectedDate(initialDate);
      setRangeFrom(toIsoDate(initialDate));
      setRangeTo(toIsoDate(result.dTe || initialDate));
      setViewMonth(initialDate.getMonth());
      setViewYear(initialDate.getFullYear());
      setSearchResults([]);
      setSearchMessage('');
    }
    if (options.save !== false) {
      if (!savePreconoscenza(result)) markStorageFailure('Preconoscenza');
      refreshHistory();
    }
    if (options.loadOrari !== false && result.dIn) {
      const savedKey = orariKey(result.dIn.getFullYear(), result.dIn.getMonth() + 1);
      const savedOrari = loadOrariByKey(savedKey);
      if (savedOrari && Object.keys(savedOrari).length) {
        /* Una lettura salvata prima che l'app sapesse leggere il grafico di
           servizio non ha rientri, e non e' colpa del PDF: va detto qui, dove
           si sa da dove arriva il dato. */
        setOrariParserVersion(loadOrariParserVersion(savedKey));
        setOrariPlaces(loadOrariPlaces(savedKey));
        applyOrari(savedOrari, result, { save: false });
      }
    }
  }

  function applyOrari(parsedDevelopments, sourceInfo = pdfInfo, options = {}) {
    const summary = summarizeDevelopments(parsedDevelopments);
    if (options.save !== false) setOrariParserVersion(RIENTRI_PARSER_VERSION);
    if (options.places) setOrariPlaces(options.places);
    setDevelopments(parsedDevelopments);
    setOrariInfo({
      fileName: sourceInfo?.fileName || 'Orari Linee',
      totalTurns: summary.totalTurns,
      splitTurns: summary.splitTurns,
    });
    setOrariLoaded(true);
    if (options.save !== false) {
      if (!saveOrari(parsedDevelopments, sourceInfo, options.places)) markStorageFailure('Orari Linee');
      refreshHistory();
    }
  }

  async function handlePreconoscenzaUpload(file) {
    setLoading(true);
    setUploadPhase('Lettura Preconoscenza');
    setError('');

    try {
      if (file.type && file.type !== 'application/pdf') {
        throw new Error('Seleziona un file PDF Preconoscenza.');
      }

      const { pages, pageCount } = await extractTextPagesFromPdf(file);
      setUploadPhase('Analisi turni');
      if (pageCount > 20) {
        throw new Error(`Questo sembra gli Orari Linee (${pageCount} pag.), non la Preconoscenza.`);
      }

      const text = pages.join('\n');
      const result = parsePreconoscenza(text);
      const dayCount = Object.keys(result.days).length;

      if (!dayCount) {
        throw new Error('Nessun turno trovato nel PDF Preconoscenza.');
      }

      applyPreconoscenza({ ...result, fileName: file.name });
      setUploadPhase('Preconoscenza caricata');
    } catch (caughtError) {
      setPdfLoaded(false);
      setPdfInfo(null);
      setDays({});
      setError(caughtError.message || 'Errore durante la lettura del PDF.');
    } finally {
      setLoading(false);
      setUploadPhase('');
    }
  }

  async function handleOrariUpload(file) {
    setOrariLoading(true);
    setUploadPhase('Lettura Orari Linee');
    setOrariError('');

    try {
      if (file.type && file.type !== 'application/pdf') {
        throw new Error('Seleziona un file PDF Orari Deposito.');
      }

      const { pages, pageCount } = await extractTextPagesFromPdf(file);
      setUploadPhase('Ricostruzione sviluppi turno');
      if (pageCount < 5) {
        throw new Error('Questo sembra la Preconoscenza, non gli Orari Deposito.');
      }

      const pageDiagnostics = diagnosticsOn ? [] : null;
      const parsedPlaces = {};
      const parsedDevelopments = parseOrari(pages, { diagnostics: pageDiagnostics, places: parsedPlaces });
      if (pageDiagnostics) setOrariPageDiagnostics(pageDiagnostics);
      const summary = summarizeDevelopments(parsedDevelopments);
      if (!summary.totalTurns) {
        throw new Error('Nessun turno trovato nel PDF Orari Deposito.');
      }

      applyOrari(parsedDevelopments, { ...pdfInfo, fileName: file.name }, { places: parsedPlaces });
      setUploadPhase('Orari Linee caricati');
    } catch (caughtError) {
      setDevelopments({});
      setOrariInfo(null);
      setOrariLoaded(false);
      setOrariError(caughtError.message || 'Errore durante la lettura degli Orari Deposito.');
    } finally {
      setOrariLoading(false);
      setUploadPhase('');
    }
  }

  async function handleMonthOrariUpload(file) {
    setOrariLoading(true);
    setUploadPhase('Lettura Orari Linee');
    setOrariError('');

    try {
      if (file.type && file.type !== 'application/pdf') {
        throw new Error('Seleziona un file PDF Orari Deposito.');
      }

      const { pages, pageCount } = await extractTextPagesFromPdf(file);
      setUploadPhase('Archivio Orari mese');
      if (pageCount < 5) {
        throw new Error('Questo sembra la Preconoscenza, non gli Orari Deposito.');
      }

      const parsedPlaces = {};
      const parsedDevelopments = parseOrari(pages, { places: parsedPlaces });
      const summary = summarizeDevelopments(parsedDevelopments);
      if (!summary.totalTurns) {
        throw new Error('Nessun turno trovato nel PDF Orari Deposito.');
      }

      const sourceInfo = {
        ...pdfInfo,
        fileName: file.name,
        dIn: new Date(viewYear, viewMonth, 1),
        dTe: new Date(viewYear, viewMonth + 1, 0),
      };
      applyOrari(parsedDevelopments, sourceInfo, { places: parsedPlaces });
      setUploadPhase('Orari Linee archiviati');
    } catch (caughtError) {
      setOrariError(caughtError.message || 'Errore durante la lettura degli Orari Deposito.');
    } finally {
      setOrariLoading(false);
      setUploadPhase('');
    }
  }

  /* Chiudere il mese caricato con un tocco solo, senza chiedere niente, era
     troppo facile: la copia resta in memoria ma la schermata si svuota. */
  function clearPreconoscenza() {
    if (!window.confirm('Vuoi chiudere la Preconoscenza caricata? Resta salvata nello storico.')) return;
    setPdfLoaded(false);
    setPdfInfo(null);
    setDays({});
    setSearchResults([]);
    setSearchMessage('');
    setError('');
  }

  function clearOrari() {
    if (!window.confirm('Vuoi chiudere gli Orari Linee caricati? Restano salvati nello storico.')) return;
    setDevelopments({});
    setOrariInfo(null);
    setOrariLoaded(false);
    setOrariError('');
  }

  function applyCommunicatedShift(day, text) {
    const parsed = parseCommunicatedShift(text, day?.date, day);
    if (!parsed) {
      throw new Error('Formato turno non riconosciuto. Incolla la riga completa o lo sviluppo con linea/vettura, orari e posti cambio.');
    }

    const targetIso = day?.iso || parsed.iso;
    const nextDay = {
      ...parsed,
      iso: targetIso,
      date: day?.date || parsed.date,
      g: day?.g || parsed.g || '',
      assignedFromBallot: day?.ball || true,
    };
    const nextDays = { ...days, [targetIso]: nextDay };
    setDays(nextDays);
    setSearchResults((current) => current.map((item) => (item?.iso === targetIso ? nextDay : item)));
    if (pdfInfo?.dIn) {
      if (!savePreconoscenza({ ...pdfInfo, days: nextDays })) markStorageFailure('Turno comunicato');
      refreshHistory();
    }
    setSelectedDate(nextDay.date);
    setActiveSection('oggi');
    return nextDay;
  }

  /* Un cambio turno: quello che il PDF diceva non vale piu', e quello nuovo si
     inserisce a mano. Il turno si toglie solo dal periodo in uso e dalla copia
     salvata di questo mese; ricaricare il PDF lo riporta com'era. Subito dopo
     si apre l'inserimento sullo stesso giorno, che e' quello che si vuole fare. */
  function removeShift(day) {
    const iso = day?.iso;
    if (!iso || !days[iso]) return;
    const label = dateFormatter.format(day.date || new Date(`${iso}T00:00:00`));
    if (Object.keys(days).length <= 1) {
      window.alert('E\' l\'unico giorno caricato: per toglierlo chiudi la Preconoscenza da Altro.');
      return;
    }
    const name = day.l && day.n ? `${day.l} / ${day.n}` : 'di questo giorno';
    if (!window.confirm(`Vuoi eliminare il turno ${name} del ${label}? Poi puoi inserire quello nuovo.`)) return;

    const nextDays = { ...days };
    delete nextDays[iso];
    setDays(nextDays);
    if (pdfInfo?.dIn) {
      if (!savePreconoscenza({ ...pdfInfo, days: nextDays })) markStorageFailure('Turno eliminato');
      refreshHistory();
    }
    setSearchResults([]);
    setSelectedDate(day.date || new Date(`${iso}T00:00:00`));
    setSearchMessage(`Turno del ${label} eliminato. Inserisci quello nuovo qui sotto.`);
    setManualEntryOpen(true);
    setActiveSection('oggi');
  }

  /* Un cambio turno senza passare dall'eliminazione: il turno vecchio resta
     dov'e' finche' quello nuovo non viene inserito, e l'inserimento si apre gia'
     su questo giorno. */
  function replaceShift(day) {
    const iso = day?.iso;
    if (!iso || !days[iso]) return;
    const date = day.date || new Date(`${iso}T00:00:00`);
    setSelectedDate(date);
    setSearchResults([day]);
    setSearchMessage(`Stai sostituendo il turno del ${dateFormatter.format(date)}. Incolla qui sotto quello nuovo: prende il suo posto.`);
    setManualEntryOpen(true);
    setActiveSection('oggi');
    requestAnimationFrame(() => manualEntryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  function insertSuspendedShift() {
    setSuspendedShiftError('');
    const fallbackDate = manualEntryDate;
    const parsed = parseCommunicatedShift(suspendedShiftText, fallbackDate, null);
    if (!parsed) {
      setSuspendedShiftError('Formato turno non riconosciuto. Incolla data, linea, turno, orari e posti cambio.');
      return;
    }

    const targetIso = parsed.iso || toIsoDate(parsed.date);
    const targetDate = parsed.date || fallbackDate;
    const nextDay = {
      ...parsed,
      iso: targetIso,
      date: targetDate,
      g: parsed.g || '',
      suspendedPreconoscenza: !pdfLoaded,
    };
    const nextDays = pdfLoaded ? { ...days, [targetIso]: nextDay } : { [targetIso]: nextDay };
    const sourceInfo = pdfLoaded && pdfInfo
      ? {
          ...pdfInfo,
          days: nextDays,
        }
      : {
          nome: 'Preconoscenza sospesa',
          matricola: '',
          fileName: 'Turno comunicato',
          dIn: new Date(targetDate.getFullYear(), targetDate.getMonth(), 1),
          dTe: new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0),
          days: nextDays,
        };

    setDays(nextDays);
    setPdfInfo(sourceInfo);
    setPdfLoaded(true);
    setSelectedDate(targetDate);
    setSearchResults([nextDay]);
    setSearchMessage('');
    setSearchQuery(toIsoDate(targetDate));
    setViewMonth(targetDate.getMonth());
    setViewYear(targetDate.getFullYear());
    setActiveSection('oggi');
    setSuspendedShiftText('');
    setManualEntryOpen(false);
    if (!savePreconoscenza(sourceInfo)) markStorageFailure('Preconoscenza sospesa');
    refreshHistory();
  }

  const enrichedDays = useMemo(() => (pdfLoaded ? enrichShiftDays(days, developments) : {}), [days, developments, pdfLoaded]);

  /* Le sveglie di tutto il periodo, calcolate una volta sola: il Riepilogo le
     elenca e il pulsante le esporta, e devono essere le stesse. */
  const wakeAlarms = useMemo(() => collectWakeAlarms(enrichedDays), [enrichedDays]);

  /* Il giorno con cui la app si apre: oggi se c'e' in preconoscenza, altrimenti
     domani, altrimenti il primo della settimana. La card la costruisce
     cardForDay, che fa gia' tutto il resto. */
  const homeSelection = useMemo(() => (pdfLoaded ? pickHomeDay(days) : { day: null, prefix: '' }), [days, pdfLoaded]);

  const stats = useMemo(() => (pdfLoaded ? buildStats(days, developments) : []), [days, developments, pdfLoaded]);
  const preconoscenzaSummary = useMemo(() => computeStats(days, developments), [days, developments]);
  const isSuspendedPreconoscenza = useMemo(
    () =>
      !pdfLoaded ||
      pdfInfo?.nome === 'Preconoscenza sospesa' ||
      pdfInfo?.fileName === 'Turno comunicato' ||
      Object.values(days).some((day) => day?.suspendedPreconoscenza) ||
      (preconoscenzaSummary.totalDays > 0 && preconoscenzaSummary.totalDays < 20),
    [days, pdfInfo, pdfLoaded, preconoscenzaSummary.totalDays],
  );
  const periodLabel = buildPeriodLabel(pdfInfo);
  const personLabel = pdfLoaded
    ? [pdfInfo?.nome || 'Nominativo non indicato', pdfInfo?.matricola ? `cod. ${pdfInfo.matricola}` : '']
        .filter(Boolean)
        .join(' · ')
    : '';
  const debugInfo = useMemo(() => {
    const firstShift = homeSelection.day?.t === 'turno' ? homeSelection.day : Object.values(days).find((day) => day?.t === 'turno');
    const searchedKey = firstShift ? normalizeShiftKey(firstShift.l, firstShift.n) : '';
    const segments = firstShift ? getDevSegments(developments, firstShift.l, firstShift.n, firstShift.date, firstShift) : [];
    const keys = Object.keys(developments);
    const lineSet = new Set();
    const unknownLineSet = new Set();
    const missingDevelopments = [];
    const checkedDevelopments = [];
    let associations = 0;

    Object.values(days).forEach((day) => {
      if (day?.t !== 'turno') return;
      const displayDay = normalizeDayForDisplay(day, developments);
      if (displayDay.lineaNorm) lineSet.add(displayDay.lineaNorm);
      if (!displayDay.isGerbidoLine && displayDay.lineaNorm) unknownLineSet.add(displayDay.lineaNorm);
      const matchedSegments = getDevSegments(developments, day.l, day.n, day.date, day);
      if (matchedSegments.length) {
        associations += 1;
        checkedDevelopments.push({
          iso: day.iso,
          label: dateFormatter.format(day.date || new Date(`${day.iso}T00:00:00`)),
          searchedKey: normalizeShiftKey(day.l, day.n),
          segmentCount: matchedSegments.length,
          first: matchedSegments[0],
          last: matchedSegments[matchedSegments.length - 1],
        });
      } else if (orariLoaded && keys.length > 0) {
        missingDevelopments.push({
          iso: day.iso,
          label: dateFormatter.format(day.date || new Date(`${day.iso}T00:00:00`)),
          line: day.l || '-',
          shift: day.n || '-',
          start: formatCompactTime(day.i),
          end: formatCompactTime(day.e),
          startPlace: day.li || '-',
          endPlace: day.le || '-',
          searchedKey: normalizeShiftKey(day.l, day.n),
        });
      }
    });

    return {
      hasOrari: orariLoaded && keys.length > 0,
      keyCount: keys.length,
      firstKeys: keys.slice(0, 5),
      searchedKey,
      expectedWindow: firstShift
        ? `${formatCompactTime(firstShift.i)} ${firstShift.li || '-'} → ${formatCompactTime(firstShift.e)} ${firstShift.le || '-'}`
        : '',
      foundSegments: segments.length,
      firstSegments: segments,
      turniEstratti: preconoscenzaSummary.totalShifts,
      checkedDevelopments: checkedDevelopments.slice(0, 16),
      linesFound: [...lineSet].sort(),
      unknownLines: [...unknownLineSet].sort(),
      associations,
      missingDevelopments,
      missingDevelopmentCount: missingDevelopments.length,
    };
  }, [days, developments, homeSelection.day, orariLoaded, preconoscenzaSummary.totalShifts]);

  function shouldShowDay(day) {
    if (!day) return false;
    if (onlyWorkShifts) return day.t === 'turno';
    if (hideRests) return !REST_CODES[day.t];
    return true;
  }

  function shouldShowMonthDay(day) {
    if (!day) return false;
    const hasActiveFilter = Object.values(monthFilters).some(Boolean);
    if (!hasActiveFilter) return true;
    if (day.t === 'turno') return monthFilters.turni;
    if (REST_CODES[day.t]) return monthFilters.riposi;
    if (day.t === 'RIS') return monthFilters.ballottaggi;
    return false;
  }

  function toggleMonthFilter(key) {
    setMonthFilters((current) => ({ ...current, [key]: !current[key] }));
  }

  function cardForDay(day, prefix = '') {
    const displayDay = normalizeDayForDisplay(day, developments);
    const shift = buildShiftCard(displayDay, prefix, enrichedDays[displayDay?.iso]);
    if (!shift) return null;
    return (
      <ShiftCard
        date={displayDay?.date}
        dayData={displayDay}
        developments={developments}
        enrichment={enrichedDays[displayDay?.iso]}
        key={displayDay?.iso || shift.date}
        calendarActions={(dayForExport) => buildCalendarActions([dayForExport], `turno-${dayForExport?.iso || 'turno'}.ics`)}
        onAssignTurn={applyCommunicatedShift}
        onRemoveShift={removeShift}
        onReplaceShift={replaceShift}
        shift={shift}
      />
    );
  }

  function exportEntries(filename, entries) {
    openCalendarICS(buildICS(entries, developments), filename);
  }

  function buildCalendarActions(entries, filename) {
    const validEntries = entries.filter(Boolean);
    const content = buildICS(validEntries, developments);
    return {
      add: () => openCalendarICS(content, filename),
    };
  }

  function setWakeAlarms() {
    if (!wakeAlarms.length) return;
    openCalendarICS(buildWakeAlarmsICS(wakeAlarms), 'sveglie-turni.ics');
  }

  function addBallotsToCalendar() {
    const ballotEntries = Object.values(days).filter((day) => day?.t === 'RIS');
    openCalendarICS(buildBallotICS(ballotEntries), 'turni-ballottaggi.ics');
  }

  function exportCsv(filename, entries) {
    downloadTextFile(filename, buildCsv(entries), 'text/csv;charset=utf-8');
  }

  async function shareReadablePreconoscenza() {
    const entries = Object.values(days).filter(Boolean);
    if (!entries.some((day) => day?.t === 'turno')) return;
    const blob = await buildPreconoscenzaInfographicBlob(entries, pdfInfo);
    const filename = `preconoscenza-turni-${toIsoDate(new Date())}.png`;
    const file = new File([blob], filename, { type: 'image/png' });

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          title: 'Preconoscenza turni',
          files: [file],
        });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }

    downloadBlobFile(filename, blob);
  }

  function exportBackup() {
    downloadTextFile(`turni-smart-backup-${toIsoDate(new Date())}.json`, JSON.stringify(buildBackup(), null, 2), 'application/json;charset=utf-8');
    setBackupMessage('Backup esportato.');
    setStorageMessage('');
  }

  function restoreBackupFile(backup) {
    try {
      restoreBackup(backup);
      refreshHistory();
      setBackupMessage('Backup ripristinato.');
      setStorageMessage('');
    } catch (caughtError) {
      setBackupMessage(caughtError.message || 'Backup non valido.');
    }
  }

  function clearLocalMemory() {
    const confirmed = window.confirm(
      "Attenzione: verranno cancellati Preconoscenza, Orari Linee, archivio mesi e dati inseriti localmente. Prima verra scaricata una copia di sicurezza. Vuoi procedere?"
    );
    if (!confirmed) return;
    exportBackup();
    clearStoredAppData({ keepPreferences: true });
    setDays({});
    setDevelopments({});
    setPdfInfo(null);
    setOrariInfo(null);
    setPdfLoaded(false);
    setOrariLoaded(false);
    setHistory(getHistory());
    setStorageReport(getStorageReport());
    setBackupMessage('Backup esportato. Memoria locale liberata.');
    setStorageMessage('');
  }

  function getMonthHistoryEntry(type, year, monthIndex) {
    return history
      .filter((entry) => entry.type === type && entry.year === year && entry.month === monthIndex + 1)
      .sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0))[0];
  }

  function openCalendarMonth(year, monthIndex) {
    if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return;

    const normalizedDate = new Date(year, monthIndex, 1);
    const normalizedYear = normalizedDate.getFullYear();
    const normalizedMonth = normalizedDate.getMonth();
    const archivedPreconoscenza = getMonthHistoryEntry('preconoscenza', normalizedYear, normalizedMonth);
    const archivedOrari = getMonthHistoryEntry('orari', normalizedYear, normalizedMonth);

    if (archivedPreconoscenza) {
      const stored = loadPreconoscenzaByKey(archivedPreconoscenza.key);
      if (stored) {
        applyPreconoscenza(stored, { save: false, keepCalendarPosition: true, loadOrari: false });
      }
    }

    if (archivedOrari) {
      const storedOrari = loadOrariByKey(archivedOrari.key);
      if (storedOrari && Object.keys(storedOrari).length) {
        // Anche una lettura ripescata dallo storico puo' essere precedente al
        // parser dei rientri: la sua versione e' quella con cui fu salvata.
        setOrariParserVersion(loadOrariParserVersion(archivedOrari.key));
        setOrariPlaces(loadOrariPlaces(archivedOrari.key));
        applyOrari(storedOrari, {
          fileName: archivedOrari.label || 'Orari Linee',
          dIn: new Date(normalizedYear, normalizedMonth, 1),
          dTe: new Date(normalizedYear, normalizedMonth + 1, 0),
        }, { save: false });
      }
    } else {
      setDevelopments({});
      setOrariInfo(null);
      setOrariLoaded(false);
    }

    setViewMonth(normalizedMonth);
    setViewYear(normalizedYear);
    setSelectedDate(normalizedDate);
    setSearchResults([]);
    setSearchMessage('');
  }

  function showCalendar(nextFilters = null) {
    if (nextFilters) setMonthFilters(nextFilters);
    setActiveSection('calendario');
    setCalendarPulse((current) => current + 1);
  }

  function showDaySearch() {
    setActiveSection('oggi');
  }

  function showPreconoscenzaOverview() {
    setActiveSection('periodo');
  }

  /* Il calendario mostra anche i riposi proiettati: aprendo un giorno deve
     pescare dalla stessa mappa che ha disegnato la griglia. */
  function openCalendarDay(date) {
    openDayFrom(date, calendarDays);
  }

  function openDayFromOverview(date) {
    openDayFrom(date, days);
  }

  function openDayFrom(date, source) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return;
    const iso = toIsoDate(date);
    const item = source[iso];
    setSelectedDate(date);
    setSearchQuery(iso);
    setSearchResults(item ? [item] : []);
    setSearchMessage(item ? '' : 'Nessun turno trovato per questa data.');
    setActiveSection('oggi');
  }

  function updateAutoRestore(value) {
    setPreferences((current) => ({ ...current, autoRestore: value }));
  }

  function findDaysBetween(fromValue, toValue) {
    const from = dateFromInputValue(fromValue);
    const to = dateFromInputValue(toValue);
    if (!from || !to || from > to) return [];

    const items = [];
    const cursor = new Date(from);
    while (cursor <= to) {
      const item = days[toIsoDate(cursor)];
      if (shouldShowDay(item)) items.push(item);
      cursor.setDate(cursor.getDate() + 1);
    }
    return items;
  }

  function runSearch(query = searchQuery) {
    let parsed = null;
    try {
      parsed = parseNaturalDate(query, pdfInfo?.dIn?.getFullYear() || selectedDate.getFullYear());
    } catch {
      parsed = null;
    }
    if (!parsed) {
      setSearchResults([]);
      setSearchMessage('Data non riconosciuta. Prova con oggi, domani, 18/05, 18-05-2026 o 18 maggio.');
      return;
    }

    const dates = (Array.isArray(parsed) ? parsed : [parsed]).filter((date) => date instanceof Date && !Number.isNaN(date.getTime()));
    if (!dates.length) {
      setSearchResults([]);
      setSearchMessage('Data non riconosciuta. Prova con oggi, domani, 18/05, 18-05-2026 o 18 maggio.');
      return;
    }
    const results = dates.map((date) => days[toIsoDate(date)]).filter(Boolean);
    setSelectedDate(dates[0]);
    setSearchResults(results);
    setSearchMessage(results.length ? '' : 'Nessun turno trovato per questa data.');
    if (!results.length) setManualEntryOpen(true);
  }

  function quickSearch(label, offset = 0) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    setSearchQuery(label);
    setSelectedDate(date);
    const item = days[toIsoDate(date)];
    setSearchResults(item ? [item] : []);
    setSearchMessage(item ? '' : 'Nessun turno trovato per questa data.');
    if (!item) setManualEntryOpen(true);
  }

  function searchWeek() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const results = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() + index);
      return days[toIsoDate(date)];
    }).filter(Boolean);
    setSearchQuery('prossimi 7 giorni');
    setSearchResults(results);
    setSearchMessage(results.length ? '' : 'Nessun turno trovato nella settimana.');
  }

  function goToQuickSearch(label, offset = 0) {
    quickSearch(label, offset);
    showDaySearch();
  }

  function goToWeekSearch() {
    searchWeek();
    showDaySearch();
  }

  function changeMonth(delta) {
    const next = new Date(viewYear, viewMonth + delta, 1);
    openCalendarMonth(next.getFullYear(), next.getMonth());
  }

  const rangeItems = useMemo(() => findDaysBetween(rangeFrom, rangeTo), [days, rangeFrom, rangeTo, hideRests, onlyWorkShifts]);
  const monthDate = useMemo(() => new Date(viewYear, viewMonth, 1), [viewMonth, viewYear]);
  const monthArchive = useMemo(
    () => ({
      preconoscenza: getMonthHistoryEntry('preconoscenza', viewYear, viewMonth),
      orari: getMonthHistoryEntry('orari', viewYear, viewMonth),
    }),
    [history, viewMonth, viewYear],
  );
  const missingMonthDocuments = useMemo(
    () => ({
      preconoscenza: !monthArchive.preconoscenza,
      orari: !monthArchive.orari,
    }),
    [monthArchive],
  );
  const shouldShowMonthUpload = missingMonthDocuments.preconoscenza || missingMonthDocuments.orari;
  const projectedRestDays = useMemo(() => buildProjectedRestDays(days, monthDate), [days, monthDate]);
  const calendarDays = useMemo(() => ({ ...projectedRestDays, ...days }), [days, projectedRestDays]);
  const monthItems = useMemo(() => {
    return Object.keys(calendarDays)
      .sort()
      .map((iso) => calendarDays[iso])
      .filter((day) => day?.date?.getFullYear() === viewYear && day?.date?.getMonth() === viewMonth)
      .filter(shouldShowMonthDay)
      .sort((a, b) => a.date - b.date);
  }, [calendarDays, monthFilters, viewMonth, viewYear]);
  /* Il turno gia' in cima non e' il prossimo: escluderlo e' l'unico modo
     perche' "Prossimo turno" dica davvero quello dopo. */
  const nextWorkingShift = useMemo(
    () =>
      pdfLoaded
        ? getNextWorkingShift(days, developments, new Date(), { excludeIso: homeSelection.day?.iso })
        : null,
    [days, developments, homeSelection.day?.iso, pdfLoaded],
  );
  const allDayEntries = useMemo(
    () =>
      Object.keys(days)
        .sort()
        .map((iso) => days[iso])
        .filter(Boolean),
    [days],
  );

  return (
    <div className="app-shell">
      {loading || orariLoading ? <LoadingOverlay label={uploadPhase || 'Caricamento PDF'} detail={orariLoading ? 'Sto collegando gli sviluppi turno.' : 'Sto leggendo i turni del mese.'} /> : null}
      {pdfLoaded ? <Header pdfLoaded={pdfLoaded} period={periodLabel} person={personLabel} /> : null}

      <main className={pdfLoaded ? 'app-frame' : 'app-frame app-frame--onboarding'}>
        <input
          accept="application/pdf"
          className="file-input"
          onChange={(event) => {
            const [file] = event.target.files || [];
            if (file) handlePreconoscenzaUpload(file);
            event.target.value = '';
          }}
          ref={onboardingInputRef}
          type="file"
        />

        <section className="content-panel">
          <span className="section-top-anchor" ref={sectionTopRef} aria-hidden="true" />
          {!pdfLoaded ? (
            <OnboardingHome
              error={error}
              loading={loading}
              onPrimaryUpload={() => onboardingInputRef.current?.click()}
              onSuspendedShiftSubmit={insertSuspendedShift}
              onSuspendedShiftTextChange={setSuspendedShiftText}
              suspendedShiftError={suspendedShiftError}
              suspendedShiftText={suspendedShiftText}
            />
          ) : null}

          {pdfLoaded && activeSection === 'oggi' ? (
            <section className="view-panel">
              {/* La risposta prima degli attrezzi. Aprendo la app la domanda e'
                  "che turno faccio oggi", e la card che risponde deve stare
                  sopra la piega: prima c'erano il pannello di ricerca e
                  l'inserimento manuale, e il turno cominciava a meta' schermo.
                  Cercare una data e' l'eccezione, e sta appena sotto. */}
              <div className="result-list">
                {searchResults.map((day) => cardForDay(day))}
                {searchMessage ? <p className="result-message">{searchMessage}</p> : null}
                {/* Senza una ricerca in corso si mostra il turno del giorno:
                    aprire su "nessun giorno selezionato" costava un tocco per
                    sapere una cosa che l'app sapeva gia'. Se oggi non c'e' in
                    preconoscenza si scala a domani e poi alla settimana, e la
                    card lo dice nel titolo. */}
                {!searchResults.length && !searchMessage && homeSelection.day
                  ? cardForDay(homeSelection.day, homeSelection.prefix)
                  : null}
                {!searchResults.length && !searchMessage && !homeSelection.day ? (
                  <EmptySection
                    action={pdfInfo?.dIn ? 'Vai al periodo caricato' : ''}
                    onAction={() => openDayFromOverview(pdfInfo?.dIn)}
                    text={`Cerca una data o usa i tasti rapidi. Il periodo caricato e' ${periodLabel}.`}
                    title="Nessun giorno selezionato"
                  />
                ) : null}
              </div>

              <form
                className="search-panel dc"
                onSubmit={(event) => {
                  event.preventDefault();
                  runSearch();
                }}
              >
                <div className="panel-title-row">
                  <label className="field-label" htmlFor="turn-search">
                    <Icon name="search" size={22} />
                    Che turno faccio il...
                  </label>
                </div>
                <div className="search-row">
                  <input
                    id="turn-search"
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="oggi, domani, 05/03, 5 marzo"
                    type="text"
                    value={searchQuery}
                  />
                  <button className="small-button" type="submit">
                    Mostra turno
                  </button>
                </div>
                <div className="quick-actions">
                  <button onClick={() => quickSearch('oggi', 0)} type="button">
                    Oggi
                  </button>
                  <button onClick={() => quickSearch('domani', 1)} type="button">
                    Domani
                  </button>
                  <button onClick={searchWeek} type="button">
                    Settimana
                  </button>
                  <button className="quick-actions__all" onClick={showPreconoscenzaOverview} type="button">
                    <Icon name="dockOverview" size={18} />
                    Tutto il periodo
                  </button>
                </div>
              </form>

              <details
                className="suspended-shift-disclosure"
                ref={manualEntryRef}
                onToggle={(event) => setManualEntryOpen(event.currentTarget.open)}
                open={manualEntryOpen}
              >
                <summary>
                  <span>{isSuspendedPreconoscenza ? 'Preconoscenza sospesa' : 'Turno fuori preconoscenza'}</span>
                  <strong>Inserisci turno comunicato</strong>
                </summary>
                <SuspendedShiftEntry
                  className="suspended-shift-card--embedded"
                  error={suspendedShiftError}
                  hint={`Incolla qui il turno ricevuto. Se manca la data, verra usato il giorno ${dateFormatter.format(manualEntryDate)}.`}
                  loading={loading}
                  onSubmit={insertSuspendedShift}
                  onTextChange={setSuspendedShiftText}
                  subtitle={`Giorno selezionato: ${dateFormatter.format(manualEntryDate)}`}
                  text={suspendedShiftText}
                  title={isSuspendedPreconoscenza ? 'Preconoscenza sospesa' : 'Inserimento manuale'}
                />
              </details>

              {nextWorkingShift ? (
                <details className="next-shift-panel dc">
                  <summary>
                    <span>Prossimo turno</span>
                    <strong>{dateFormatter.format(nextWorkingShift.day.date || new Date(`${nextWorkingShift.day.iso}T00:00:00`))}</strong>
                  </summary>
                  {cardForDay(nextWorkingShift.day, 'Prossimo · ')}
                </details>
              ) : null}
            </section>
          ) : null}

          {pdfLoaded && activeSection === 'calendario' ? (
            <section className="view-panel view-panel--calendar" key={calendarPulse}>
              <div className="calendar-focus-header">
                <div>
                  <span>Vista calendario</span>
                  <strong>{MONTH_NAMES[viewMonth]} {viewYear}</strong>
                </div>
              </div>
              <input
                accept="application/pdf"
                className="file-input"
                onChange={(event) => {
                  const [file] = event.target.files || [];
                  if (file) handlePreconoscenzaUpload(file);
                  event.target.value = '';
                }}
                ref={monthPreconoscenzaInputRef}
                type="file"
              />
              <input
                accept="application/pdf"
                className="file-input"
                onChange={(event) => {
                  const [file] = event.target.files || [];
                  if (file) handleMonthOrariUpload(file);
                  event.target.value = '';
                }}
                ref={monthOrariInputRef}
                type="file"
              />
              <form
                className="calendar-search-panel dc"
                onSubmit={(event) => {
                  event.preventDefault();
                  runSearch();
                  setActiveSection('oggi');
                }}
              >
                <label className="field-label" htmlFor="calendar-turn-search">
                  <Icon name="search" size={22} />
                  Che turno faccio il...
                </label>
                <div className="search-row">
                  <input
                    id="calendar-turn-search"
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="oggi, domani, 05/03, 5 marzo"
                    type="text"
                    value={searchQuery}
                  />
                  <button className="small-button" type="submit">
                    Mostra turno
                  </button>
                </div>
                <div className="quick-actions">
                  <button onClick={() => goToQuickSearch('oggi', 0)} type="button">
                    Oggi
                  </button>
                  <button onClick={() => goToQuickSearch('domani', 1)} type="button">
                    Domani
                  </button>
                  <button onClick={goToWeekSearch} type="button">
                    Settimana
                  </button>
                  <button className="quick-actions__all" onClick={showPreconoscenzaOverview} type="button">
                    <Icon name="dockOverview" size={18} />
                    Tutto il periodo
                  </button>
                </div>
              </form>
              <MonthView
                days={calendarDays}
                activeFilters={monthFilters}
                highlightDate={nextWorkingShift?.day?.date}
                monthDate={monthDate}
                onNextMonth={() => changeMonth(1)}
                onPrevMonth={() => changeMonth(-1)}
                onSelectDay={openCalendarDay}
                onToggleFilter={toggleMonthFilter}
              />
              <section className="calendar-actions-panel dc" aria-label="Azioni calendario">
                <div>
                  <strong>Azioni calendario</strong>
                  <span>Aggiungi o esporta i giorni visibili del mese selezionato.</span>
                </div>
                <div className="calendar-actions">
                  <button className="small-button" disabled={!monthItems.length} onClick={() => exportEntries('turni-mese.ics', monthItems)} type="button">
                    Aggiungi periodo al calendario
                  </button>
                  <button className="small-button" disabled={!Object.values(days).some((day) => day?.t === 'RIS')} onClick={addBallotsToCalendar} type="button">
                    Aggiungi ballottaggi al calendario
                  </button>
                  <button className="small-button small-button--ghost" disabled={!monthItems.length} onClick={() => exportCsv('turni-mese.csv', monthItems)} type="button">
                    Esporta mese in CSV
                  </button>
                </div>
              </section>
              <div className={shouldShowMonthUpload ? 'calendar-archive-panel calendar-archive-panel--missing' : 'calendar-archive-panel'}>
                <div>
                  <strong>{shouldShowMonthUpload ? 'Completa questo mese' : 'Archivio mese'}</strong>
                  <span>
                    {MONTH_NAMES[viewMonth]} {viewYear}: {missingMonthDocuments.preconoscenza ? 'manca Preconoscenza' : 'Preconoscenza salvata'} ·{' '}
                    {missingMonthDocuments.orari ? 'mancano Orari Linee' : 'Orari Linee salvati'}
                  </span>
                </div>
                <div className="calendar-archive-actions">
                  {missingMonthDocuments.preconoscenza ? (
                    <button className="small-button" onClick={() => monthPreconoscenzaInputRef.current?.click()} type="button">
                      Carica Preconoscenza
                    </button>
                  ) : null}
                  {missingMonthDocuments.orari ? (
                    <button className="small-button small-button--ghost" onClick={() => monthOrariInputRef.current?.click()} type="button">
                      Carica Orari Linee
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="result-toolbar">
                <span>{monthItems.length} giorni nel mese</span>
              </div>
              <MonthDayList days={monthItems} onSelectDay={openCalendarDay} />
            </section>
          ) : null}

          {pdfLoaded && activeSection === 'periodo' ? (
            <div className="utility-panel-anchor utility-panel-anchor--preconoscenza">
              <PreconoscenzaOverview
                days={days}
                enrichedDays={enrichedDays}
                onAddPeriodToCalendar={() => exportEntries('preconoscenza-completa.ics', allDayEntries)}
                onClose={showDaySearch}
                onExportCsv={() => exportCsv('preconoscenza-completa.csv', allDayEntries)}
                onSelectDay={openDayFromOverview}
                onSetWakeAlarms={setWakeAlarms}
                onShareInfographic={shareReadablePreconoscenza}
                pdfInfo={pdfInfo}
                wakeAlarms={wakeAlarms}
              />
            </div>
          ) : null}

          {pdfLoaded && activeSection === 'linee' ? (
            <div className="utility-panel-anchor utility-panel-anchor--lines">
              {orariLoaded ? (
                <>
                  <div className="section-switch" role="tablist" aria-label="Consultazione linee">
                    {[
                      ['lines', 'Linee'],
                      ['returns', 'Rientri'],
                      ['departures', 'Uscite'],
                    ].map(([key, label]) => (
                      <button
                        aria-selected={linesTab === key}
                        className={linesTab === key ? 'section-switch__button is-active' : 'section-switch__button'}
                        key={key}
                        onClick={() => setLinesTab(key)}
                        role="tab"
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {linesTab === 'lines' ? <LineConsultation developments={developments} /> : null}
                  {linesTab === 'returns' ? (
                    <DepotReturnsPanel
                      developments={developments}
                      places={orariPlaces}
                      staleParse={orariParserVersion < RIENTRI_PARSER_VERSION}
                    />
                  ) : null}
                  {linesTab === 'departures' ? (
                    <DepotDeparturesPanel
                      developments={developments}
                      places={orariPlaces}
                      staleParse={orariParserVersion < RIENTRI_PARSER_VERSION}
                    />
                  ) : null}
                </>
              ) : (
                <EmptySection
                  action="Vai ai documenti"
                  onAction={() => setActiveSection('altro')}
                  text="Carica il PDF Orari Deposito per consultare linee e rientri."
                  title="Orari Linee non caricati"
                />
              )}
            </div>
          ) : null}

          {pdfLoaded && activeSection === 'altro' ? (
            <div className="utility-panel-anchor utility-panel-anchor--tools">
              <UploadPanel
                debugInfo={debugInfo}
                error={error}
                onClearOrari={clearOrari}
                onClearPreconoscenza={clearPreconoscenza}
                orariError={orariError}
                orariLoading={orariLoading}
                pdfInfo={pdfInfo}
                preconoscenzaSummary={preconoscenzaSummary}
                loading={loading}
                onOrariUpload={handleOrariUpload}
                onPreconoscenzaUpload={handlePreconoscenzaUpload}
                onSharePreconoscenza={shareReadablePreconoscenza}
                onShowPreconoscenzaOverview={showPreconoscenzaOverview}
              />
              <StatsPanel stats={stats} title="Statistiche periodo" />
              <AdvancedTools
                backupMessage={backupMessage}
                onClearStorage={clearLocalMemory}
                onExportBackup={exportBackup}
                onRestoreBackup={restoreBackupFile}
                onToggleAutoRestore={updateAutoRestore}
                preferences={preferences}
                storageReport={storageReport}
              />
              {storageMessage ? <p className="storage-alert">{storageMessage}</p> : null}
            </div>
          ) : null}

          {/* La botola: compare solo con ?diag=orari nell'indirizzo. */}
          {diagnosticsOn ? (
            <div className="orari-diagnostics">
              <pre>{buildOrariReport({ developments, pages: orariPageDiagnostics })}</pre>
              <button
                onClick={() =>
                  navigator.clipboard?.writeText(buildOrariReport({ developments, pages: orariPageDiagnostics }))
                }
                type="button"
              >
                Copia il referto
              </button>
            </div>
          ) : null}

          {pdfLoaded ? (
            <nav className="utility-dock" aria-label="Sezioni">
              {[
                { icon: 'dockToday', key: 'oggi', label: 'Oggi' },
                { icon: 'dockCalendar', key: 'calendario', label: 'Mese' },
                { icon: 'dockOverview', key: 'periodo', label: 'Periodo' },
                { icon: 'dockLines', key: 'linee', label: 'Linee' },
                { icon: 'dockTools', key: 'altro', label: 'Altro' },
              ].map((item) => (
                <button
                  aria-current={activeSection === item.key ? 'page' : undefined}
                  className={activeSection === item.key ? 'utility-dock__button is-active' : 'utility-dock__button'}
                  key={item.key}
                  onClick={() => (item.key === 'calendario' ? showCalendar() : setActiveSection(item.key))}
                  type="button"
                >
                  <Icon name={item.icon} size={24} />
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function EmptySection({ action, onAction, text, title }) {
  return (
    <div className="empty-section">
      <strong>{title}</strong>
      <p>{text}</p>
      {action ? (
        <button className="small-button" onClick={onAction} type="button">
          {action}
        </button>
      ) : null}
    </div>
  );
}

function LoadingOverlay({ label, detail }) {
  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-card">
        <div className="progress-ball" aria-hidden="true">
          <span />
        </div>
        <div>
          <strong>{label}</strong>
          <p>{detail}</p>
        </div>
      </div>
    </div>
  );
}
