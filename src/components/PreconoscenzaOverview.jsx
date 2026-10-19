import { useMemo, useState } from 'react';
import { Icon } from './Icon.jsx';
import { ALARM_WINDOW_LABEL, summarizeWakeAlarms } from '../utils/wakeAlarms.js';
import {
  OVERVIEW_FILTERS,
  TIMELINE_TICKS,
  buildOverviewRows,
  filterRows,
  groupRowsByWeek,
  summarizeRows,
} from '../utils/preconoscenzaOverview.js';

const periodFormatter = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });

function tickPosition(hour) {
  const offset = ((hour - 4 + 24) % 24) / 24;
  return `${offset * 100}%`;
}

function buildPeriod(pdfInfo) {
  return [pdfInfo?.dIn, pdfInfo?.dTe]
    .filter((value) => value instanceof Date && !Number.isNaN(value.getTime()))
    .map((value) => periodFormatter.format(value))
    .join(' - ');
}

function OverviewTrack({ row }) {
  if (row.kind !== 'turno') {
    return (
      <div className={`overview-track overview-track--${row.kind}`}>
        <span className="overview-track__idle">{row.kind === 'ballottaggio' ? 'Da assegnare' : 'Giornata libera'}</span>
      </div>
    );
  }

  return (
    <div className="overview-track">
      <div className="overview-track__rail" aria-hidden="true">
        {TIMELINE_TICKS.map((hour) => (
          <i key={hour} style={{ left: tickPosition(hour) }} />
        ))}
      </div>
      {row.blocks.map((block, index) => (
        <span
          className="overview-track__block"
          key={`${row.iso}-${index}`}
          style={{ '--block-left': `${block.left}%`, '--block-width': `${block.width}%`, '--block-color': row.color }}
          title={`${block.startLabel} - ${block.endLabel}`}
        />
      ))}
      {row.blocks.length ? null : <span className="overview-track__idle">Orario non disponibile</span>}
    </div>
  );
}

function buildDurationNote(row) {
  if (row.isSplit && row.breakLabel) {
    return [row.workedLabel ? `${row.workedLabel} in servizio` : '', `pausa ${row.breakLabel}`].filter(Boolean).join(' · ');
  }
  return row.durationLabel ? `${row.durationLabel} in servizio` : '';
}

function buildPlacesNote(row) {
  if (!row.startPlace && !row.endPlace) return '';
  return `${row.startPlace || '-'} → ${row.endPlace || '-'}`;
}

function OverviewDay({ row, onSelectDay }) {
  // Il badge della categoria dice gia' "2 riprese": non va ripetuto due volte.
  const showSplitTag = row.isSplit && row.categoryBadge !== '2 riprese';
  const className = [
    'overview-day',
    `overview-day--${row.kind}`,
    row.isToday ? 'is-today' : '',
    row.isPast ? 'is-past' : '',
    row.isWeekend ? 'is-weekend' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li>
      <button
        className={className}
        onClick={() => onSelectDay?.(row.date)}
        style={{ '--day-color': row.color }}
        type="button"
      >
        <span className="overview-day__date">
          <em>{row.weekday}</em>
          <strong>{row.dayNumber}</strong>
          {row.isToday ? <span className="overview-day__today">oggi</span> : null}
        </span>

        <span className="overview-day__main">
          <strong>{row.title}</strong>
          <span className="overview-day__tags">
            {row.subtitle ? <i className="overview-tag overview-tag--plain">{row.subtitle}</i> : null}
            {row.categoryBadge ? <i className="overview-tag overview-tag--category">{row.categoryBadge}</i> : null}
            {showSplitTag ? <i className="overview-tag overview-tag--split">2 riprese</i> : null}
            {row.isEvening ? <i className="overview-tag overview-tag--evening">Serale</i> : null}
            {row.restLabel ? (
              <i
                className={`overview-tag ${
                  row.isShortRest ? 'overview-tag--warning' : row.isAfternoonToMorning ? 'overview-tag--late' : 'overview-tag--plain'
                }`}
              >
                {row.isAfternoonToMorning ? 'Pomeriggio → mattina · ' : ''}
                {row.restLabel}
              </i>
            ) : row.isShortRest ? (
              <i className="overview-tag overview-tag--warning">Riposo breve</i>
            ) : null}
          </span>
          {row.note ? <small>{row.note}</small> : null}
          {row.restNote ? <small>{row.restNote}</small> : null}
        </span>

        <span className="overview-day__time">
          {row.kind === 'turno' ? (
            <>
              <strong>
                {row.start} <i>→</i> {row.end}
              </strong>
              <small>{buildDurationNote(row)}</small>
              {buildPlacesNote(row) ? <small className="overview-day__places">{buildPlacesNote(row)}</small> : null}
            </>
          ) : (
            <strong className="overview-day__time--empty">—</strong>
          )}
        </span>

        <OverviewTrack row={row} />
      </button>
    </li>
  );
}

const WEEKDAY_SHORT = ['DOM', 'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB'];

function formatAlarmDay(iso) {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return `${WEEKDAY_SHORT[date.getDay()]} ${date.getDate()}`;
}

/* Prima di impostare venti sveglie notturne uno vuole vedere quali sono.
   L'elenco non e' un dettaglio di cortesia: e' il controllo. Un turno di
   troppo qui significa un telefono che suona alle tre in un giorno di riposo,
   uno mancante significa un turno perso. */
function WakeAlarmsBlock({ alarms = [], onSetWakeAlarms }) {
  if (!onSetWakeAlarms) return null;

  const summary = summarizeWakeAlarms(alarms);

  return (
    <section className="wake-alarms" aria-labelledby="wake-alarms-title">
      <div className="wake-alarms__head">
        <div>
          <h3 id="wake-alarms-title">
            <Icon name="clock" size={17} />
            Sveglie del mattino
          </h3>
          <p>
            {summary.count
              ? `${summary.count} ${summary.count === 1 ? 'turno attacca' : 'turni attaccano'} ${ALARM_WINDOW_LABEL}. Sveglia un'ora prima dell'attacco, dalle ${summary.earliest} alle ${summary.latest}.`
              : `Nessun turno del periodo attacca ${ALARM_WINDOW_LABEL}.`}
          </p>
        </div>
        <button className="small-button" disabled={!summary.count} onClick={onSetWakeAlarms} type="button">
          Imposta le sveglie
        </button>
      </div>

      {summary.count ? (
        <>
          <ul className="wake-alarms__list">
            {alarms.map((alarm) => (
              <li key={alarm.iso}>
                <span className="wake-alarms__day">{formatAlarmDay(alarm.iso)}</span>
                <strong>{alarm.wakeTime}</strong>
                <span className="wake-alarms__shift">
                  turno {alarm.line} {alarm.turn}, attacco {alarm.startTime}
                </span>
              </li>
            ))}
          </ul>
          {/* Va detto qui, non solo nella documentazione: chi preme si aspetta
              che suoni, e senza la scorciatoia questi restano avvisi. */}
          <p className="wake-alarms__note">
            Si apre il calendario per confermare. Perche' suonino come sveglie vere, anche a telefono silenziato, serve la
            scorciatoia descritta in <strong>docs/sveglia-automatica.md</strong>: senza, restano avvisi del calendario.
          </p>
        </>
      ) : null}
    </section>
  );
}

export function PreconoscenzaOverview({
  days = {},
  enrichedDays = {},
  pdfInfo = null,
  onAddPeriodToCalendar,
  onClose,
  onExportCsv,
  onSelectDay,
  onSetWakeAlarms,
  onShareInfographic,
  wakeAlarms = [],
}) {
  const [filter, setFilter] = useState('tutto');

  const rows = useMemo(() => buildOverviewRows(days, enrichedDays), [days, enrichedDays]);
  const summary = useMemo(() => summarizeRows(rows), [rows]);
  const visibleRows = useMemo(() => filterRows(rows, filter), [filter, rows]);
  const weeks = useMemo(() => groupRowsByWeek(visibleRows), [visibleRows]);

  const period = buildPeriod(pdfInfo);
  const person = [pdfInfo?.nome, pdfInfo?.matricola ? `cod. ${pdfInfo.matricola}` : ''].filter(Boolean).join(' · ');
  const metrics = [
    { key: 'turni', label: 'Turni', value: summary.shifts, color: '#0b7bd3' },
    { key: 'riposi', label: 'Riposi', value: summary.rests, color: '#1b7a3d' },
    { key: 'ballottaggi', label: 'Ballottaggi', value: summary.ballots, color: '#c62828' },
    { key: 'spezzati', label: '2 riprese', value: summary.split, color: '#e65100' },
    { key: 'serali', label: 'Serali', value: summary.evening, color: '#5b189a' },
  ];

  return (
    <section className="preconoscenza-overview dc" aria-labelledby="overview-title">
      <header className="overview-hero">
        <div className="overview-hero__text">
          <span className="overview-hero__kicker">
            <Icon name="document" size={17} />
            Preconoscenza completa
          </span>
          <h2 id="overview-title">Tutto il periodo in un colpo d&apos;occhio</h2>
          <p>{[person, period].filter(Boolean).join(' · ') || 'Periodo caricato'}</p>
        </div>
        {onClose ? (
          <button className="overview-close" onClick={onClose} type="button">
            Chiudi
          </button>
        ) : null}
      </header>

      <div className="overview-metrics">
        {metrics.map((metric) => (
          <div className="overview-metric" key={metric.key} style={{ '--metric-color': metric.color }}>
            <strong>{metric.value}</strong>
            <span>{metric.label}</span>
          </div>
        ))}
        <div className="overview-metric overview-metric--wide">
          <strong>{summary.days}</strong>
          <span>giorni caricati{summary.lines.length ? ` · linee ${summary.lines.join(', ')}` : ''}</span>
        </div>
      </div>

      <div className="overview-toolbar">
        <div className="overview-filters" role="group" aria-label="Filtra i giorni">
          {OVERVIEW_FILTERS.map((item) => (
            <button
              className={filter === item.key ? 'overview-chip is-active' : 'overview-chip'}
              key={item.key}
              onClick={() => setFilter(item.key)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="overview-hint">
          <Icon name="clock" size={15} />
          La barra copre la giornata dalle 04:00 alle 04:00: tocca un giorno per aprire il dettaglio.
        </p>
      </div>

      <div className="overview-scale" aria-hidden="true">
        <span className="overview-scale__spacer" />
        <div className="overview-scale__hours">
          {TIMELINE_TICKS.map((hour) => (
            <i key={hour} style={{ left: tickPosition(hour) }}>
              {String(hour).padStart(2, '0')}
            </i>
          ))}
        </div>
      </div>

      {weeks.length ? (
        weeks.map((week) => (
          <section className="overview-week" key={week.key}>
            <header className="overview-week__head">
              <strong>{week.label}</strong>
              <span>
                {week.shifts} turni · {week.rests} riposi
                {week.ballots ? ` · ${week.ballots} ballott.` : ''}
              </span>
            </header>
            <ul className="overview-days">
              {week.rows.map((row) => (
                <OverviewDay key={row.iso} onSelectDay={onSelectDay} row={row} />
              ))}
            </ul>
          </section>
        ))
      ) : (
        <p className="overview-empty">Nessun giorno da mostrare con questo filtro.</p>
      )}

      <WakeAlarmsBlock alarms={wakeAlarms} onSetWakeAlarms={onSetWakeAlarms} />

      <footer className="overview-actions">
        <button className="small-button" disabled={!summary.days} onClick={onAddPeriodToCalendar} type="button">
          <Icon name="calendar" size={17} />
          Aggiungi tutto al calendario
        </button>
        <button className="small-button small-button--ghost" disabled={!summary.days} onClick={onExportCsv} type="button">
          <Icon name="document" size={17} />
          Esporta in CSV
        </button>
        <button className="small-button small-button--ghost" disabled={!summary.shifts} onClick={onShareInfographic} type="button">
          <Icon name="share" size={17} />
          Invia infografica
        </button>
      </footer>
    </section>
  );
}
