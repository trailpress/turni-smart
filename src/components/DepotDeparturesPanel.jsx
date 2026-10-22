import { useMemo, useState } from 'react';
import { getLineDisplayName } from '../constants/depotGerbido.js';
import { getChangePointLabel, getChangePointStop } from '../constants/changePoints.js';
import { findOppositeTerminus, stripPlaceRole } from '../parserRientri.js';
import { DEPARTURE_WINDOW_MINUTES, searchDepartures } from '../utils/depotDepartures.js';
import { formatClock } from '../utils/depotReturns.js';
import { formatMinutes } from '../utils/timeUtils.js';
import { Icon } from './Icon.jsx';

/* La finestra guarda da entrambe le parti: un mezzo partito pochi minuti prima
   si prende ancora, quindi tenerlo fuori sarebbe un artificio del filtro. */
const WINDOW_OPTIONS = [5, 10, DEPARTURE_WINDOW_MINUTES, 30, 60, 120];

/* Con la giornata intera si pianifica, non si corre a prendere un mezzo: la
   finestra copre tutto e l'elenco si legge per fasce orarie. */
const ALL_DAY_MINUTES = 720;

const SERVICE_OPTIONS = [
  { value: '', label: 'Servizio di oggi' },
  { value: 'feriali', label: 'Feriale (lun-ven)' },
  { value: 'sabato', label: 'Sabato' },
  { value: 'festivi', label: 'Festivo' },
];

const SERVICE_LABELS = { feriali: 'feriale', sabato: 'sabato', festivi: 'festivo' };

const DEPOT_LABEL = 'Gerbido';

/* Quanto ci mette da qui a li'. E' il numero per cui si guarda questo pannello:
   se esco alle 13:29 e il trasferimento e' di sette minuti, a Settembrini ci
   sono alle 13:36, e so se il cambio lo prendo. */
function formatLeg(minutes) {
  return minutes >= 60 ? formatMinutes(minutes) : `${minutes} min`;
}

/* Le uscite lette per fascia oraria: con la giornata intera un elenco piatto
   non si scorre, e la fascia e' il modo in cui si ragiona pianificando. Con
   una finestra stretta resta un gruppo solo e non da' fastidio. */
function groupByHour(matches = []) {
  const groups = [];
  matches.forEach((item) => {
    const hour = `${String(item.departure).slice(0, 2)}:00`;
    const last = groups[groups.length - 1];
    if (last && last.hour === hour) last.items.push(item);
    else groups.push({ hour, items: [item] });
  });
  return groups;
}

/**
 * Lo specchio dei rientri: cosa parte dal Gerbido.
 *
 * La domanda a cui risponde non e' "come torno" ma "cosa esce da qui per
 * arrivare dove devo andare": si sceglie il posto cambio e restano solo le
 * uscite che ci vanno. Senza sceglierlo si vedono tutte, che e' il modo giusto
 * di guardare la giornata quando si sta ancora decidendo.
 *
 * Come i rientri, le uscite stanno solo sul grafico di servizio: senza quella
 * pagina il pannello non ha niente da mostrare e lo dice.
 */
export function DepotDeparturesPanel({ developments = {}, places = {}, staleParse = false }) {
  const [form, setForm] = useState(() => ({
    place: '',
    service: '',
    time: formatClock(new Date()),
    windowMinutes: DEPARTURE_WINDOW_MINUTES,
  }));

  const result = useMemo(
    () =>
      searchDepartures(developments, {
        place: form.place,
        service: form.service,
        time: form.time,
        windowMinutes: form.windowMinutes,
      }),
    [developments, form.place, form.service, form.time, form.windowMinutes],
  );

  const anchor = form.time || formatClock(new Date());
  const serviceLabel = SERVICE_LABELS[result.service] || result.service;
  const placeLabel = form.place ? namePlace(form.place) : '';

  /* Il selettore offre solo posti che negli orari caricati hanno davvero
     un'uscita dal Gerbido, in ordine alfabetico perche' si cerca per nome. Se
     il posto scelto sparisce cambiando servizio resta comunque nell'elenco,
     altrimenti la select si mostrerebbe vuota senza spiegare perche'. */
  const placeOptions = useMemo(() => {
    /* Gli stessi nomi che compaiono sulle schede: quelli del documento, non
       quelli della nostra tabella, altrimenti il posto scelto nel selettore si
       legge in un modo e nel risultato in un altro. */
    const name = (code) =>
      stripPlaceRole(places?.[String(code || '').toUpperCase()]?.label || getChangePointLabel(code));
    const options = result.places.map((item) => ({
      count: item.count,
      label: name(item.place),
      value: item.place,
    }));
    if (form.place && !options.some((option) => option.value === form.place)) {
      options.push({ count: 0, label: name(form.place), value: form.place });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label, 'it'));
  }, [form.place, places, result.places]);

  /* Quante uscite verso il posto scelto ci sono in tutta la giornata: serve a
     dire "non in questa finestra, ma piu' tardi si'" invece di un secco no. */
  const placeDayCount = form.place ? result.places.find((item) => item.place === form.place)?.count || 0 : 0;

  function updateForm(patch) {
    setForm((current) => ({ ...current, ...patch }));
  }

  /* Il nome che il documento da' a quel posto, senza la coda che ne dice il
     ruolo: sulla scheda serve «Via Bertola», non «Via Bertola - Capolinea
     andata 58/». */
  function namePlace(code) {
    return stripPlaceRole(places?.[String(code || '').toUpperCase()]?.label || getChangePointLabel(code));
  }

  /* Da che parte va il mezzo. Il grafico non lo scrive, ma se la vettura entra
     in linea a un capolinea allora parte verso l'altro capo della linea, e
     quali siano lo dice la legenda. Quando non e' certo non si scrive niente:
     mandare qualcuno dalla parte sbagliata e' peggio che tacere. */
  function towardsLabel(item) {
    const opposite = findOppositeTerminus(places, { line: item.line, place: item.toPlace });
    return opposite ? `verso ${namePlace(opposite)}` : '';
  }

  return (
    <section className="depot-returns-panel dc" aria-labelledby="depot-departures-title">
      <div className="depot-returns-panel__header">
        <span className="section-kicker">
          <Icon name="route" size={22} />
          Uscite deposito
        </span>
        <h2 id="depot-departures-title">Cosa esce dal Gerbido</h2>
        <p>
          I mezzi che lasciano il Gerbido intorno all&apos;orario scelto, con la linea e il posto dove entrano in
          linea. Se devi raggiungere un posto cambio preciso scegli <strong>Vado a</strong>: restano solo le uscite
          che ci vanno.
        </p>
      </div>

      {/* La ricerca si aggiorna da se' al cambio dei criteri: qui non c'e'
          niente da leggere dal GPS ne' da attendere, quindi un bottone
          "Trova" non aggiungerebbe nulla. */}
      <form className="depot-returns-form" onSubmit={(event) => event.preventDefault()}>
        <div className="depot-returns-controls">
          <label>
            <span>Sono in deposito alle</span>
            <input
              aria-label="Orario intorno al quale cercare le uscite dal deposito"
              onChange={(event) => updateForm({ time: event.target.value })}
              type="time"
              value={form.time}
            />
          </label>
          <label>
            <span>Cerca entro</span>
            <select
              aria-label="Quanti minuti prima e dopo l'orario scelto"
              onChange={(event) => updateForm({ windowMinutes: Number(event.target.value) })}
              value={form.windowMinutes}
            >
              {WINDOW_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  &plusmn; {minutes} min
                </option>
              ))}
              <option value={ALL_DAY_MINUTES}>tutta la giornata</option>
            </select>
          </label>
          <label>
            <span>Vado a</span>
            <select
              aria-label="Posto cambio da raggiungere"
              onChange={(event) => updateForm({ place: event.target.value })}
              value={form.place}
            >
              <option value="">Tutti i posti cambio</option>
              {placeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Servizio</span>
            <select onChange={(event) => updateForm({ service: event.target.value })} value={form.service}>
              {SERVICE_OPTIONS.map((option) => (
                <option key={option.value || 'auto'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </form>

      {/* Una lettura fatta prima della correzione del 22 ottobre (la 39 feriale
          perdeva meta' delle uscite) non si corregge da sola: serve rileggere il
          PDF. Lo si dice, invece di lasciare un elenco corto senza spiegazione. */}
      {result.graphicLoaded && staleParse ? (
        <p className="depot-returns-message">
          Gli orari in uso sono stati letti da una versione precedente dell&apos;app, che perdeva alcune uscite. Ricarica il
          PDF degli orari per averle tutte.
        </p>
      ) : null}
      {/* Senza grafico "nessuna uscita alle 07:20" e' vero ma fuorviante: non e'
          quella fascia a essere vuota, e' il PDF a non avere la pagina. La
          ragione la da' il messaggio qui sotto, da solo. */}
      <p className="depot-returns-summary" hidden={!result.graphicLoaded}>
        {result.total ? (
          <>
            <strong>
              {result.total} {result.total === 1 ? 'uscita' : 'uscite'}
            </strong>
            {placeLabel ? ` verso ${placeLabel}` : ''}
            {form.windowMinutes >= ALL_DAY_MINUTES
              ? ` nella giornata, servizio ${serviceLabel}`
              : ` intorno alle ${anchor} (± ${form.windowMinutes} min), servizio ${serviceLabel}`}
          </>
        ) : (
          <>
            Nessuna uscita{placeLabel ? ` verso ${placeLabel}` : ''}
            {form.windowMinutes >= ALL_DAY_MINUTES ? ' nella giornata' : ` intorno alle ${anchor}`} con il servizio{' '}
            {serviceLabel}.
          </>
        )}
      </p>

      {result.byLine.length ? (
        <div className="departure-lines" aria-label="Uscite per linea">
          {result.byLine.map((item) => (
            <span className="departure-line-chip" key={item.line}>
              Linea {getLineDisplayName(item.line)}
              <em>{item.count}</em>
            </span>
          ))}
        </div>
      ) : null}

      {/* Un elenco vuoto ha sempre una ragione, e dirla e' l'unico modo per
          distinguere un dato che manca da una funzione rotta. La prima ragione
          possibile e' che il grafico di servizio non sia stato letto: senza
          quella pagina non c'e' niente su cui cercare, e prima di dare la colpa
          al PDF va escluso che gli Orari in uso vengano da una versione
          dell'app che le uscite non le ricavava ancora. */}
      {!result.graphicLoaded ? (
        <p className="depot-returns-message">
          {staleParse
            ? "Gli orari in uso sono stati letti da una versione precedente dell'app, che non ricavava le uscite. Ricarica il PDF degli orari e le uscite compaiono."
            : 'Negli orari caricati manca il grafico di servizio, la pagina che dice a che ora ogni vettura lascia il deposito. Senza quella le uscite non si possono calcolare.'}
        </p>
      ) : null}
      {result.graphicLoaded && !result.total && result.otherServiceCount ? (
        <p className="depot-returns-message">
          In questa fascia {result.otherServiceCount === 1 ? "c'è 1 uscita" : `ci sono ${result.otherServiceCount} uscite`}
          {placeLabel ? ` verso ${placeLabel}` : ''}, ma di un altro servizio
          {` (${Object.entries(result.otherServiceByType)
            .map(([key, count]) => `${SERVICE_LABELS[key] || key}: ${count}`)
            .join(', ')})`}
          . Cambia <em>Servizio</em> per vederle.
        </p>
      ) : null}
      {/* Che le altre uscite vadano altrove non e' una notizia per chi ha
          appena scelto dove andare: le due righe che restano dicono le sole
          cose che si possono fare, cambiare servizio o allargare la fascia. */}
      {!result.total && placeLabel && placeDayCount ? (
        <p className="depot-returns-message">
          Verso {placeLabel} nella giornata {placeDayCount === 1 ? "c'è 1 uscita" : `ci sono ${placeDayCount} uscite`},
          ma fuori da questa fascia: allarga <em>Cerca entro</em>.
        </p>
      ) : null}
      {!result.total && !placeLabel && !result.otherServiceCount && result.outsideWindow ? (
        <p className="depot-returns-message">
          Niente in questa fascia, ma {result.outsideWindow}{' '}
          {result.outsideWindow === 1 ? 'uscita' : 'uscite'} altrove nella giornata: allarga <em>Cerca entro</em>.
        </p>
      ) : null}

      <div className="depot-returns-results" aria-live="polite">
        {groupByHour(result.matches).map((group) => (
          <div className="departure-hour" key={group.hour}>
            <h3 className="departure-hour__title">
              {group.hour}
              <em>
                {group.items.length} {group.items.length === 1 ? 'uscita' : 'uscite'}
              </em>
            </h3>
            {group.items.map((item) => {
              /* La palina e' una per senso di marcia: senza sapere da che
                 parte il mezzo prosegue, mostrarne una vuol dire indovinare
                 quale delle due, e mandare qualcuno dal lato sbagliato della
                 strada e' peggio che non dirgli niente. */
              const palina = item.direction
                ? getChangePointStop(item.toPlace, { direction: item.direction, line: item.line })
                : '';
              const place = namePlace(item.toPlace);
              return (
                <article
                  className="depot-return-card"
                  key={`${item.line}-${item.vehicleShift}-${item.departure}-${item.toPlace}`}
                >
                  <p className="depot-return-card__head">
                    <strong>{getLineDisplayName(item.line)}</strong>
                    {towardsLabel(item)}
                  </p>
                  {/* I due orari sono l'uscita dal deposito e l'ingresso in
                      linea, con sotto il posto a cui si riferiscono: senza
                      scriverlo, il secondo si legge come fine corsa. */}
                  <p className="depot-return-card__times">
                    <span className="depot-return-card__stop">
                      <strong>{item.departure}</strong>
                      <small>{DEPOT_LABEL}</small>
                    </span>
                    <i aria-hidden="true">→</i>
                    <span className="depot-return-card__stop">
                      <strong>{item.arrival}</strong>
                      <small>
                        {palina ? `palina ${palina} · ` : ''}
                        {place}
                      </small>
                    </span>
                  </p>
                  <p className="depot-return-card__meta">
                    {[`${formatLeg(item.legMinutes)} fino a ${place}`, item.vehicleShift ? `vettura ${item.vehicleShift}` : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </article>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
