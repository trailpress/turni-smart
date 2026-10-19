import { useEffect, useState } from 'react';
import { formatMinutes, formatRestBetweenShifts, minutesBetween } from '../utils/timeUtils.js';
import { getDevSegments } from '../parserOrari.js';
import { getLineDisplayName } from '../constants/depotGerbido.js';
import { getChangePointAddress, normalizeChangePoint } from '../constants/changePoints.js';
import { BALLOTTAGGI } from '../constants/shiftClassification.js';
import { buildGttPassagesTarget, buildMoovitFromDepotUrl, getPrimaryGttChangePoint } from '../utils/gttLinks.js';
import { buildBusRadarTarget } from '../utils/busRadar.js';
import { describeShiftTiming } from '../utils/shiftTiming.js';
import { subscribeToClock } from '../utils/clock.js';
import { getReminderNote } from '../calendarExport.js';
import { BusRadarModal, VehicleShiftButton } from './BusRadarPanel.jsx';
import { AssetIcon, Icon } from './Icon.jsx';

const DIRECTION_LABELS = {
  A: 'Andata',
  R: 'Ritorno',
  '-': '-',
};

const SEGMENT_VEHICLES_KEY = 'ts_segment_vehicles_v1';

function readSegmentVehicles() {
  try {
    return JSON.parse(window.localStorage.getItem(SEGMENT_VEHICLES_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeSegmentVehicles(value) {
  try {
    window.localStorage.setItem(SEGMENT_VEHICLES_KEY, JSON.stringify(value || {}));
  } catch {
    // localStorage non disponibile: il valore resta valido solo nella sessione.
  }
}

function parseVehicleNumbers(value = '') {
  return String(value || '')
    .split(/[\s,;/-]+/)
    .map((part) => part.replace(/\D/g, '').slice(0, 4))
    .filter(Boolean)
    .slice(0, 8);
}

function sanitizeVehicleNumbersInput(value = '') {
  return String(value || '')
    .replace(/[^\d\s,;/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 64);
}

function sanitizeSingleVehicleNumber(value = '') {
  return String(value || '').replace(/\D/g, '').slice(0, 4);
}

function getVehicleInputValues(value = '') {
  const raw = String(value || '');
  if (!raw) return [''];
  const parts = raw
    .split(/[\s,;/-]+/)
    .map(sanitizeSingleVehicleNumber)
    .filter((part, index, list) => part || index === list.length - 1)
    .slice(0, 8);
  return parts.length ? parts : [''];
}

function serializeVehicleInputs(values = []) {
  return values.map(sanitizeSingleVehicleNumber).join(', ');
}

function formatVehicleNumbers(value = '') {
  const vehicles = parseVehicleNumbers(value);
  if (!vehicles.length) return '';
  return `${vehicles.length > 1 ? 'Vetture' : 'Vettura'} ${vehicles.join(', ')}`;
}

function normalizeVehicleRecord(record) {
  if (record && typeof record === 'object' && !Array.isArray(record)) {
    return {
      insertedAt: record.insertedAt && typeof record.insertedAt === 'object' ? record.insertedAt : {},
      value: String(record.value || ''),
    };
  }
  return {
    insertedAt: {},
    value: String(record || ''),
  };
}

function formatInsertedTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function formatVehicleNumbersWithTimes(value = '', insertedAt = {}) {
  const vehicles = parseVehicleNumbers(value);
  if (!vehicles.length) return '';
  return vehicles
    .map((vehicle) => {
      const time = formatInsertedTime(insertedAt[vehicle]);
      return time ? `${vehicle} · inserita ${time}` : vehicle;
    })
    .join(' · ');
}

function getDateParts(label = '') {
  const match = String(label).match(/(?:(Prossimo|Oggi|Domani|Settimana)\s+·\s+)?([a-zà]+)\s+(\d{1,2})\s+([a-zà]+)/i);
  return {
    context: match?.[1] || '',
    weekday: (match?.[2] || '').toUpperCase(),
    day: match?.[3] || '',
    month: (match?.[4] || '').toUpperCase(),
  };
}

function formatDevelopmentLines(segments = []) {
  if (!segments.length) return [];
  return [
    'Sviluppo turno:',
    ...segments.map((segment, index) => {
      const direction = DIRECTION_LABELS[segment.dir] || segment.dir || '-';
      const vehicleShift = getVehicleShiftLabel(segment);
      const vehicleNumber = formatVehicleNumbersWithTimes(segment.vehicleNumber, segment.vehicleInsertedAt);
      return `${index + 1}. ${segment.start} - ${segment.end} | ${segment.loc_s} ${direction} ${segment.loc_e}${vehicleShift ? ` | ${vehicleShift}` : ''}${vehicleNumber ? ` | ${vehicleNumber}` : ''}`;
    }),
  ];
}

function buildShareText(shift, segments = [], assignedTurn = '') {
  if (!shift) return '';
  if (shift.type === 'special') {
    return [
      shift.date,
      shift.title,
      shift.ballot ? shift.ballotLabel || 'Turno da assegnare' : shift.description || 'Giornata senza turno',
      shift.note,
      assignedTurn ? `Turno comunicato:\n${assignedTurn}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    `${shift.date}`,
    `Linea ${shift.line} - Turno ${shift.number}`,
    `${shift.start} ${shift.startPlace} -> ${shift.end} ${shift.endPlace}`,
    `Cod. ${shift.code}${shift.duration ? ` - Dur. ${shift.duration}` : ''}`,
    ...formatDevelopmentLines(segments),
  ].join('\n');
}

function formatPlaceDirection(place, direction) {
  const normalized = DIRECTION_LABELS[direction] || direction || '';
  if (!normalized || normalized === '-') return place;
  return `${place} ${normalized}`;
}

function formatVehicleShift(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  const [, shift] = normalized.split(/\s+/);
  return shift || normalized;
}

function getVehicleShiftLabel(segment = {}) {
  const value = formatVehicleShift(segment.turnoVettura || segment.vett || '');
  return value ? `Turno vettura ${value}` : '';
}

/**
 * Dove sta adesso, su BusRadar, la vettura che fa questo tratto. La linea del
 * tratto viene prima di quella del turno: uno sviluppo puo' passare da una
 * linea all'altra, e chi guarda il tratto vuole la linea di quel tratto.
 */
function getSegmentBusRadarTarget(segment = {}, fallbackLine = '') {
  return buildBusRadarTarget({
    direction: segment.dir,
    line: segment.lineaNorm || segment.ln || segment.linea || fallbackLine,
    place: segment.loc_s,
    vehicleNumber: segment.vehicleNumber,
    vehicleShift: segment.turnoVettura || segment.vett || '',
  });
}

function getSegmentMapTitle(segment = {}, target = null) {
  if (target?.hasVehicle) {
    return `${target.fleetNumbers.length > 1 ? 'Vetture' : 'Vettura'} ${target.fleetNumbers.join(', ')}`;
  }
  return `Linea ${target?.line || segment.ln || ''}${getVehicleShiftLabel(segment) ? ` · ${getVehicleShiftLabel(segment)}` : ''}`;
}

function getSegmentMapSubtitle(segment = {}) {
  const direction = DIRECTION_LABELS[segment.dir] || segment.dir || '';
  return [`${segment.start} - ${segment.end}`, [segment.loc_s, direction, segment.loc_e].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(' · ');
}

function getCategoryIconName(category, shift) {
  const text = `${category?.label || ''} ${category?.badge || ''}`.toLowerCase();
  if (shift?.isShortRest || text.includes('riposo')) return 'rest';
  if (shift?.isSplit || text.includes('riprese') || text.includes('spezz')) return 'route';
  if (shift?.isEvening || text.includes('seral')) return 'stats';
  return 'busMark';
}

/**
 * Sul chip resta il nome della fascia; la codifica e la finestra oraria che
 * l'accordo le assegna stanno nel titolo, per chi vuole controllarle.
 */
function buildCategoryTitle(category) {
  if (!category?.code) return category?.label || '';
  const parts = [`${category.label} · codifica ${category.range || category.code}`];
  if (category.earliestStart && category.latestEnd) {
    parts.push(`inizio non prima delle ${category.earliestStart}, termine entro le ${category.latestEnd}`);
  }
  return parts.join(' · ');
}

function getSegmentVehicleStorageKey({ dayData, date, index, segment, shift }) {
  return [
    dayData?.iso || date || shift?.date || 'giorno',
    dayData?.lineaNorm || shift?.line || segment?.lineaNorm || segment?.ln || 'linea',
    shift?.number || dayData?.n || 'turno',
    index,
    segment?.start,
    segment?.end,
    segment?.loc_s,
    segment?.loc_e,
  ]
    .filter(Boolean)
    .join('|');
}

export function ShiftCard({ calendarActions, date, developments = {}, enrichment = null, onAssignTurn, shift, dayData }) {
  const [isFlipped, setIsFlipped] = useState(false);
  const [assignedTurn, setAssignedTurn] = useState('');
  const [assignedTurnError, setAssignedTurnError] = useState('');
  const [assignedTurnSuccess, setAssignedTurnSuccess] = useState('');
  const [isBallotInfoOpen, setIsBallotInfoOpen] = useState(false);
  const [segmentVehicles, setSegmentVehicles] = useState(() => readSegmentVehicles());

  if (shift.type === 'special') {
    const isBallot = Boolean(shift.ballot);
    const ballotInfo = shift.ballot ? BALLOTTAGGI[shift.ballot] : null;
    const shareText = buildShareText(shift, [], assignedTurn.trim());
    function confirmAssignedTurn() {
      setAssignedTurnError('');
      setAssignedTurnSuccess('');
      try {
        onAssignTurn?.(dayData, assignedTurn);
        setAssignedTurnSuccess('Turno inserito.');
      } catch (error) {
        setAssignedTurnError(error.message || 'Formato turno non riconosciuto.');
      }
    }

    return (
      <article className="shift-card shift-card--special dc">
        <div className="shift-special-layout">
          <div className="shift-date-tile" aria-label={shift.date}>
            <span>{getDateParts(shift.date).weekday || shift.date}</span>
            {getDateParts(shift.date).day ? <strong>{getDateParts(shift.date).day}</strong> : null}
            {getDateParts(shift.date).month ? <small>{getDateParts(shift.date).month}</small> : null}
          </div>
          <div>
            <p className="shift-date">{shift.date}</p>
            <h3>{shift.title}</h3>
            <div className="shift-special-summary">
              {isBallot ? (
                <>
                  <p>{shift.ballotLabel || 'Turno da assegnare'}</p>
                  <button className="ballot-info-button" onClick={() => setIsBallotInfoOpen(true)} type="button">
                    <Icon name="question" size={17} />
                    Dettagli ballottaggio
                  </button>
                </>
              ) : (
                <span className="shift-meta-chip shift-meta-chip--rest">
                  {shift.code || shift.title}
                </span>
              )}
            </div>
          </div>
          <div className={isBallot ? 'shift-special-icon shift-special-icon--assignment' : 'shift-special-icon'} aria-hidden="true">
            {isBallot ? <Icon name="question" size={62} strokeWidth={2.9} /> : <AssetIcon name="rest" size={88} />}
          </div>
        </div>
        {isBallot ? (
          <div className="ballot-assignment-box">
            <label htmlFor={`ballot-assignment-${shift.date}`}>Turno comunicato</label>
            <textarea
              id={`ballot-assignment-${shift.date}`}
              onChange={(event) => setAssignedTurn(event.target.value)}
              placeholder="Scrivi o incolla qui il turno assegnato con eventuale sviluppo."
              rows={4}
              value={assignedTurn}
            />
            {assignedTurnError ? <p className="ballot-assignment-error">{assignedTurnError}</p> : null}
            {assignedTurnSuccess ? <p className="ballot-assignment-success">{assignedTurnSuccess}</p> : null}
            <button className="ballot-insert-button" disabled={!assignedTurn.trim()} onClick={confirmAssignedTurn} type="button">
              Inserisci turno
            </button>
          </div>
        ) : null}
        {calendarActions ? <CalendarActions actions={calendarActions(dayData, [])} compact shareText={shareText} shift={shift} /> : null}
        {isBallot && isBallotInfoOpen ? (
          <div className="ballot-modal" role="dialog" aria-modal="true" aria-label="Dettagli ballottaggio">
            <div className="ballot-modal__panel">
              <div className="ballot-modal__header">
                <div>
                  <span>{shift.ballot || 'RIS'}</span>
                  <h4>{ballotInfo?.label || shift.ballotLabel || 'Turno da assegnare'}</h4>
                </div>
                <button aria-label="Chiudi dettagli ballottaggio" onClick={() => setIsBallotInfoOpen(false)} type="button">
                  ×
                </button>
              </div>
              <p>{ballotInfo?.description || shift.note || 'Il turno verra comunicato successivamente.'}</p>
              <div className="ballot-modal__legend">
                {Object.entries(BALLOTTAGGI).map(([code, item]) => (
                  <div key={code}>
                    <strong>{code}</strong>
                    <span>{item.label}</span>
                    <small>{item.description}</small>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </article>
    );
  }

  const lookupSegments =
    dayData?.t === 'turno'
      ? dayData.manualSegments?.length
        ? dayData.manualSegments
        : getDevSegments(developments, dayData.l, dayData.n, date || dayData.date, dayData)
      : [];
  const rawSegments = lookupSegments.length ? lookupSegments : shift.segments || [];
  const segments = rawSegments.map((segment, index) => {
    const vehicleRecord = normalizeVehicleRecord(segmentVehicles[getSegmentVehicleStorageKey({ date, dayData, index, segment, shift })]);
    return {
      ...segment,
      vehicleInsertedAt: vehicleRecord.insertedAt,
      vehicleNumber: vehicleRecord.value,
    };
  });
  /* Due cose diverse che prima erano una sola. "A due riprese" lo dice la
     nomenclatura dell'Accordo e riguarda il turno; "piu' tratti" riguarda lo
     sviluppo, e capita anche a un turno a ripresa unica che si ferma venti
     minuti al capolinea. Solo la prima merita un'etichetta. */
  const isSplit = Boolean(enrichment?.isSplit ?? shift.isSplit);
  const hasMultipleLegs = segments.length > 1;
  const isEvening = Boolean(enrichment?.isEvening ?? shift.isEvening);
  const isShortRest = Boolean(enrichment?.isShortRest ?? shift.isShortRest);
  const restMinutes = enrichment?.restMinutes ?? shift.restMinutes ?? null;
  const category = enrichment?.category || shift.category;
  const hasSegments = segments.length > 0;
  const legPause = hasMultipleLegs ? minutesBetween(segments[0].end, segments[1].start) : null;
  const dateParts = getDateParts(shift.date);
  /* Lo sviluppo si apre quando c'e' piu' di un tratto da leggere, che e' una
     domanda sullo sviluppo e non sulla categoria del turno. */
  const canFlipDevelopment = hasMultipleLegs && hasSegments;
  const showEveningBadge = isEvening && category?.badge !== 'Serale';
  const categoryIconName = getCategoryIconName(category, { ...shift, isEvening, isShortRest, isSplit });
  const categoryTitle = buildCategoryTitle(category);
  const shareText = buildShareText(shift, segments);
  const changePoint = getPrimaryGttChangePoint({ dayData, segments, shift });
  const gttTarget = buildGttPassagesTarget(changePoint);
  const moovitTarget = buildMoovitFromDepotUrl(changePoint.place);
  /* Un posto cambio che la tabella non conosce faceva sparire il bottone senza
     dire niente, e da fuori sembrava un guasto. Meglio dirlo: chi legge sa che
     manca un dato, non che l'app e' rotta. */
  const unknownPlace = (() => {
    const code = normalizeChangePoint(changePoint.place);
    return code && code !== 'GERB' && !getChangePointAddress(code) ? code : '';
  })();

  function updateSegmentVehicle(index, segment, values) {
    const normalized = Array.isArray(values) ? serializeVehicleInputs(values) : sanitizeVehicleNumbersInput(values);
    const key = getSegmentVehicleStorageKey({ date, dayData, index, segment, shift });
    setSegmentVehicles((current) => {
      const previous = normalizeVehicleRecord(current[key]);
      const now = new Date().toISOString();
      const nextVehicles = parseVehicleNumbers(normalized);
      const nextInsertedAt = {};
      nextVehicles.forEach((vehicle) => {
        if (vehicle.length === 4) {
          nextInsertedAt[vehicle] = previous.insertedAt?.[vehicle] || now;
        }
      });
      const next = { ...current };
      if (nextVehicles.length) next[key] = { insertedAt: nextInsertedAt, value: normalized };
      else delete next[key];
      writeSegmentVehicles(next);
      return next;
    });
  }

  return (
    <article className={canFlipDevelopment ? 'shift-card shift-card--flip dc' : 'shift-card dc'}>
      <div className={isFlipped ? 'shift-card__flipper is-flipped' : 'shift-card__flipper'}>
        <div className="shift-card__face shift-card__face--front">
          <div className="shift-card__main">
            <div className="shift-date-tile" aria-label={shift.date}>
              {dateParts.context ? <span className="shift-date-context">{dateParts.context}</span> : null}
              <span>{dateParts.weekday || shift.date}</span>
              {dateParts.day ? <strong>{dateParts.day}</strong> : null}
              {dateParts.month ? <small>{dateParts.month}</small> : null}
            </div>

            {/* Data e identita' del turno stanno sulla stessa riga: accanto al
                tassello c'era mezzo schermo vuoto. */}
            <div className="shift-heading-row">
              <div className="shift-heading-copy">
                <h3>
                  <span className="line-pill">
                    <AssetIcon className="line-pill__mark" name="busMark" size={28} />
                    Linea {getLineDisplayName(dayData?.lineaNorm || shift.line)}
                  </span>
                  <span>Turno {shift.number}</span>
                </h3>
                {canFlipDevelopment ? (
                  <button className="flip-action flip-action--inline" onClick={() => setIsFlipped(true)} type="button">
                    Mostra sviluppo turno
                  </button>
                ) : null}
              </div>
              <div className="shift-badge-row" aria-label="Classificazione turno">
                {dayData?.isGerbidoLine ? <span className="shift-badge shift-badge--line">Gerbido</span> : null}
                {dayData && !dayData.isGerbidoLine ? <span className="shift-badge shift-badge--rest">Linea non riconosciuta</span> : null}
                {isSplit ? <span className="shift-badge shift-badge--warning">2 riprese</span> : null}
                {showEveningBadge ? <span className="shift-badge shift-badge--evening">Serale</span> : null}
                {/* Quanto si sta a casa fra il turno prima e questo, su ogni turno e
                    non solo quando e' poco: dal pomeriggio tardi al mattino e'
                    il numero che si va a cercare. Sotto le undici ore e' rosso. */}
                {formatRestBetweenShifts(restMinutes) ? (
                  <span className={`shift-badge ${isShortRest ? 'shift-badge--rest' : 'shift-badge--category'}`}>
                    {formatRestBetweenShifts(restMinutes)}
                  </span>
                ) : isShortRest ? (
                  <span className="shift-badge shift-badge--rest">Riposo breve</span>
                ) : null}
              </div>
            </div>

            <div className="shift-card__body">
              {/* Prima la risposta - a che ora attacco e da dove - poi tutto il resto. */}
              <div className="shift-route">
                <div>
                  <strong>{shift.start}</strong>
                  <span>
                    <Icon name="mapPin" size={14} />
                    {formatPlaceDirection(shift.startPlace, shift.startDirection || shift.direction)}
                  </span>
                  <small>Partenza</small>
                </div>
                <div className="route-line" aria-hidden="true" />
                <div>
                  <strong>{shift.end}</strong>
                  <span>
                    <Icon name="mapPin" size={14} />
                    {formatPlaceDirection(shift.endPlace, shift.endDirection)}
                  </span>
                  <small>Termine</small>
                </div>
              </div>

              <ShiftTiming dayData={dayData} duration={shift.duration} />
            </div>

            <div className="shift-calendar-zone">
              {calendarActions ? <CalendarActions actions={calendarActions(dayData, segments)} gttTarget={gttTarget} moovitTarget={moovitTarget} shareText={shareText} shift={shift} unknownPlace={unknownPlace} /> : null}
            </div>
          </div>

          <div className="shift-meta">
            {category?.label ? (
              <span className="shift-meta-chip shift-meta-chip--category" title={categoryTitle}>
                <AssetIcon name={categoryIconName} size={24} />
                {category.label}
                {category.code ? <em className="shift-meta-code">{category.code}</em> : null}
              </span>
            ) : null}
            <span className="shift-meta-chip">
              <Icon name="compass" size={14} />
              Dir. {DIRECTION_LABELS[shift.direction] || shift.direction}
            </span>
            {/* La durata sta gia' in evidenza nella riga degli orari, sopra:
                scriverla due volte nella stessa card non aggiunge niente. */}
          </div>

          {!canFlipDevelopment ? (
            <DevelopmentPanel hasMultipleLegs={hasMultipleLegs} hasSegments={hasSegments} isSplit={isSplit} legPause={legPause} line={dayData?.lineaNorm || shift.line} onVehicleNumberChange={updateSegmentVehicle} segments={segments} />
          ) : null}
        </div>

        {canFlipDevelopment ? (
          <div className="shift-card__face shift-card__face--back">
            <div className="development-back-header">
              <div>
                <p className="shift-date">{shift.date}</p>
                <h3>Sviluppo turno</h3>
                <span>
                  Linea {getLineDisplayName(dayData?.lineaNorm || shift.line)} · Turno {shift.number}
                </span>
              </div>
              <button className="flip-action flip-action--ghost" onClick={() => setIsFlipped(false)} type="button">
                Torna al turno
              </button>
            </div>
            <DevelopmentPanel expanded hasMultipleLegs={hasMultipleLegs} hasSegments={hasSegments} isSplit={isSplit} legPause={legPause} line={dayData?.lineaNorm || shift.line} onVehicleNumberChange={updateSegmentVehicle} segments={segments} />
          </div>
        ) : null}
      </div>
    </article>
  );
}

/**
 * Le tre cose che l'autista calcola a mente la sera prima: quanto dura,
 * quanto manca, a che ora deve suonare la sveglia.
 *
 * Il conto alla rovescia si ricalcola qui dentro e non nella card, cosi'
 * ogni secondo si ridisegna questa riga e non tutto il turno.
 */
function ShiftTiming({ dayData, duration }) {
  const [now, setNow] = useState(() => Date.now());
  const timing = describeShiftTiming(dayData, new Date(now));

  useEffect(() => {
    /* Fuori dall'orizzonte non c'e' niente che scorre: niente timer. */
    if (!timing.isLive) return undefined;
    return subscribeToClock(setNow);
  }, [timing.isLive]);

  if (!duration && !timing.live && !timing.wakeUp) return null;

  return (
    <div className={timing.isImminent ? 'shift-timing shift-timing--imminent' : 'shift-timing'}>
      {duration ? (
        <span className="shift-timing__item">
          <Icon name="clock" size={15} />
          Durata {duration}
        </span>
      ) : null}
      {timing.live ? (
        <span
          className={
            timing.live.ticksBySecond
              ? 'shift-timing__item shift-timing__item--countdown is-ticking'
              : 'shift-timing__item shift-timing__item--countdown'
          }
        >
          <Icon name="clock" size={15} />
          Attacchi tra{' '}
          {/* Il valore vivo resta fuori dalle letture assistive: un numero
              che cambia ogni secondo renderebbe la card illeggibile allo
              screen reader. La riga accanto dice la stessa cosa, ferma. */}
          <span aria-hidden="true" className="shift-timing__value">
            <span>{timing.live.head}</span>
            {timing.live.separator ? (
              <span className="shift-timing__separator">{timing.live.separator}</span>
            ) : null}
            {timing.live.tail ? <span>{timing.live.tail}</span> : null}
          </span>
          <span className="sr-only">{timing.countdown}</span>
        </span>
      ) : null}
      {timing.wakeUp ? (
        <span className="shift-timing__item shift-timing__item--wake">
          <AssetIcon name="rest" size={17} />
          Sveglia {timing.wakeUp}
        </span>
      ) : null}
    </div>
  );
}

function DevelopmentPanel({ expanded = false, hasMultipleLegs, hasSegments, isSplit, legPause, line = '', onVehicleNumberChange, segments }) {
  /* Quale tratto sta guardando la mappa. L'indice e non il tratto: il numero
     di vettura si puo' scrivere mentre il riquadro e' aperto, e la mappa deve
     seguirlo invece di restare ferma su una copia vecchia. */
  const [mapSegmentIndex, setMapSegmentIndex] = useState(null);
  const mapSegment = mapSegmentIndex == null ? null : segments[mapSegmentIndex];
  const mapTarget = mapSegment ? getSegmentBusRadarTarget(mapSegment, line) : null;

  return (
    <div className={expanded ? 'shift-development shift-development--expanded' : 'shift-development'} aria-label="Sviluppo turno">
      <h4>Sviluppo turno</h4>
      {hasSegments ? (
        <>
          {segments.map((segment, index) => {
            const vehicleInputs = getVehicleInputValues(segment.vehicleNumber);
            const hasCompleteVehicle = parseVehicleNumbers(segment.vehicleNumber).length > 0;

            function updateVehicleInput(vehicleIndex, value) {
              const nextValues = [...vehicleInputs];
              nextValues[vehicleIndex] = sanitizeSingleVehicleNumber(value);
              onVehicleNumberChange?.(index, segment, nextValues);
            }

            function addVehicleInput() {
              if (!hasCompleteVehicle || vehicleInputs.length >= 8) return;
              onVehicleNumberChange?.(index, segment, [...vehicleInputs, '']);
            }

            function removeVehicleInput(vehicleIndex) {
              const nextValues = vehicleInputs.filter((_, itemIndex) => itemIndex !== vehicleIndex);
              onVehicleNumberChange?.(index, segment, nextValues.length ? nextValues : ['']);
            }

            return (
              <div className={hasMultipleLegs ? 'shift-segment is-split' : 'shift-segment'} key={`${segment.start}-${segment.end}-${index}`}>
                <span className="segment-index">{index + 1}</span>
                <strong>
                  {segment.start} - {segment.end}
                </strong>
                <span>
                  {segment.loc_s} {DIRECTION_LABELS[segment.dir] || segment.dir || '-'} {segment.loc_e}
                </span>
                <VehicleShiftButton
                  className="segment-vehicle"
                  label={getVehicleShiftLabel(segment)}
                  onOpen={() => setMapSegmentIndex(index)}
                  target={getSegmentBusRadarTarget(segment, line)}
                />
                <div className="segment-vehicle-number">
                  <div className="segment-vehicle-number__header">
                    <span>Vetture</span>
                    <button aria-label="Aggiungi numero vettura" disabled={!hasCompleteVehicle || vehicleInputs.length >= 8} onClick={addVehicleInput} type="button">
                      +
                    </button>
                  </div>
                  <div className="segment-vehicle-list">
                    {vehicleInputs.map((vehicle, vehicleIndex) => (
                      <label className="segment-vehicle-row" key={`${index}-vehicle-${vehicleIndex}`}>
                        <span className="sr-only">Numero vettura {vehicleIndex + 1}</span>
                        <input
                          inputMode="numeric"
                          maxLength={4}
                          onChange={(event) => updateVehicleInput(vehicleIndex, event.target.value)}
                          pattern="\d{4}"
                          placeholder="4 cifre"
                          type="text"
                          value={vehicle}
                        />
                        {vehicleInputs.length > 1 ? (
                          <button aria-label={`Rimuovi vettura ${vehicleIndex + 1}`} onClick={() => removeVehicleInput(vehicleIndex)} type="button">
                            ×
                          </button>
                        ) : null}
                      </label>
                    ))}
                  </div>
                  {parseVehicleNumbers(segment.vehicleNumber).length ? (
                    <small className="segment-vehicle-inserted">{formatVehicleNumbersWithTimes(segment.vehicleNumber, segment.vehicleInsertedAt)}</small>
                  ) : null}
                </div>
              </div>
            );
          })}
          {/* Fra due riprese c'e' una pausa vera, fra due tratti dello stesso
              servizio una sosta: chiamarle con lo stesso nome faceva sembrare
              spezzato un turno che non lo e'. */}
          {legPause !== null ? (
            <p className="split-pause">
              {isSplit ? 'Pausa tra le riprese' : 'Sosta tra i tratti'}: {formatMinutes(legPause)}
            </p>
          ) : null}
        </>
      ) : (
        <p className="development-empty">
          Sviluppo non disponibile. Carica il PDF Orari Deposito da <strong>Altro › Documenti</strong> per vedere le riprese di questo turno.
        </p>
      )}
      {mapTarget ? (
        <BusRadarModal
          onClose={() => setMapSegmentIndex(null)}
          subtitle={getSegmentMapSubtitle(mapSegment)}
          target={mapTarget}
          title={getSegmentMapTitle(mapSegment, mapTarget)}
        />
      ) : null}
    </div>
  );
}

function CalendarActions({ actions, compact = false, gttTarget = null, moovitTarget = null, shareText = '', shift = null, unknownPlace = '' }) {
  const [copied, setCopied] = useState(false);
  if (!actions) return null;

  async function copyShift() {
    if (!shareText) return;
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = shareText;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    }
  }

  function sendWhatsapp() {
    if (!shareText) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener,noreferrer');
  }

  function openGttPassages() {
    if (!gttTarget?.url) return;
    window.open(gttTarget.url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className={compact ? 'calendar-actions calendar-actions--compact calendar-actions--single' : 'calendar-actions calendar-actions--single'}>
      {/* Una primaria. Il resto sta dietro un tocco: erano cinque bottoni di
          pari peso piu' due paragrafi di note. */}
      {/* Le due cose che servono prima di un turno: mettertelo in agenda e
          sapere come ci arrivi. Stavano una in chiaro e una dentro il
          cassetto richiuso, dove nessuno andava a cercarla. */}
      <button className="inline-action inline-action--primary" onClick={actions.add} type="button">
        <Icon name="calendar" size={18} />
        {compact ? 'Aggiungi turno' : 'Aggiungi al calendario'}
      </button>
      {moovitTarget ? (
        <a
          className="inline-action inline-action--gtt inline-action--route"
          href={moovitTarget.url}
          rel="noopener noreferrer"
          title={`Percorso Moovit dal Deposito Gerbido a ${moovitTarget.label}${
            moovitTarget.hasPosition ? '' : ', cercato per nome: di questo posto cambio non abbiamo la palina'
          }`}
        >
          <Icon name="mapPin" size={18} />
          Vai al cambio · {moovitTarget.label}
        </a>
      ) : null}
      {unknownPlace ? (
        <p className="action-note action-note--missing">
          Il posto cambio <strong>{unknownPlace}</strong> non e&apos; ancora in archivio: senza il suo indirizzo non si
          puo&apos; calcolare il percorso ne&apos; puntare la palina.
        </p>
      ) : null}
      {!compact ? <p className="action-note action-note--calendar">{getReminderNote(shift)}</p> : null}

      <details className="secondary-actions">
        <summary>Altre azioni</summary>
        <div className="share-actions">
          <button className="inline-action inline-action--whatsapp" onClick={sendWhatsapp} type="button">
            <Icon name="whatsapp" size={18} />
            WhatsApp
          </button>
          <button className="inline-action inline-action--copy" onClick={copyShift} type="button">
            <Icon name="copy" size={18} />
            {copied ? 'Copiato' : 'Copia turno'}
          </button>
          {gttTarget?.url ? (
            <button className="inline-action inline-action--gtt" onClick={openGttPassages} title={gttTarget.title} type="button">
              <AssetIcon name="gttPassages" size={22} />
              {gttTarget.palina ? 'Passaggi GTT' : 'Itinerario linea'}
            </button>
          ) : null}
        </div>
        {gttTarget?.palina ? (
          <p className="action-note action-note--gtt">
            Passaggi GTT apre la palina {gttTarget.palina} del posto cambio di inizio turno.
          </p>
        ) : null}
      </details>
    </div>
  );
}
