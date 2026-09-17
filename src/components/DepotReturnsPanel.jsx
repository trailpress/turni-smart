import { useEffect, useMemo, useState } from 'react';
import { getLineDisplayName } from '../constants/depotGerbido.js';
import { findNearbyTermini } from '../constants/gttTermini.js';
import { buildBusRadarTarget } from '../utils/busRadar.js';
import {
  ANY_PLACE,
  formatClock,
  MAX_RIDE_MINUTES,
  RETURN_WINDOW_MINUTES,
  searchReturns,
  walkingMinutes,
  withDistance,
} from '../utils/depotReturns.js';
import {
  readChangePointDirectionsUrl,
  readDepotDirectionsUrl,
  readDepotMapsDirectionsUrl,
  readPosition,
} from '../utils/nearbyStops.js';
import { getChangePointLabel, getChangePointStop } from '../constants/changePoints.js';
import { stripPlaceRole } from '../parserRientri.js';
import { formatMinutes } from '../utils/timeUtils.js';
import { BusRadarModal } from './BusRadarPanel.jsx';
import { Icon } from './Icon.jsx';

// La ricerca e' istantanea: la barra resta visibile il minimo che basta a
// vedere che qualcosa e' partito, altrimenti premere Trova sembra inutile.
const SEARCH_FEEDBACK_MS = 520;

const UPCOMING_LIMIT = 3;

// Il deposito e' sempre lo stesso: sulle schede basta il nome corto.
const DEPOT_LABEL = 'Gerbido';

const WINDOW_OPTIONS = [30, 60, 90, 120];

const SERVICE_LABELS = {
  feriali: 'feriale',
  sabato: 'sabato',
  festivi: 'festivo',
};

function clockFromNow(offsetMinutes = 0) {
  const date = new Date();
  date.setMinutes(date.getMinutes() + offsetMinutes);
  return formatClock(date);
}

/**
 * Gli orari di partenza e arrivo sono sempre scritti per esteso: qui serve solo
 * quanto si aspetta, che e' la cosa che quegli orari non dicono. E' un'attesa
 * contata dall'orario cercato, non da adesso, quindi va detta come attesa e non
 * come conto alla rovescia.
 */
function formatSpan(minutes) {
  return minutes >= 60 ? formatMinutes(minutes) : `${minutes} min`;
}

function formatWaitShort(waitMinutes) {
  return waitMinutes <= 0 ? 'in transito' : `attesa ${formatSpan(waitMinutes)}`;
}

/**
 * Quanto dista il posto da cui parte, e se ci si arriva prima che passi. Senza
 * posizione non si dice niente: e' l'unica risposta onesta quando il GPS tace o
 * quel capolinea non ha una palina da cui ricavarne il punto.
 */
function formatDistance(item) {
  if (!Number.isFinite(item.meters)) return '';
  const distanza = item.meters >= 1000 ? `${(item.meters / 1000).toFixed(1)} km` : `${item.meters} m`;
  if (item.reachable === false) return `a ${distanza}, ${item.walkMinutes} min a piedi: non ci arrivi`;
  return `a ${distanza} · ${item.walkMinutes} min a piedi`;
}

/* La stessa distanza, per un capolinea vicino che non e' un rientro da
   prendere: qui non c'e' un "ci arrivi in tempo", c'e' solo quanto e' vicino. */
function formatNearbyDistance(meters) {
  const distanza = meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
  const minutes = walkingMinutes(meters);
  return minutes ? `a ${distanza} · ${minutes} min a piedi` : `a ${distanza}`;
}

/* La fine della finestra cercata. Il riepilogo diceva solo «dalle 12:13», e da
   li' non si capiva fin dove avesse guardato: adesso dice l'intervallo intero,
   che e' esattamente la domanda a cui sta rispondendo. */
function clockPlus(time, minutes) {
  const match = String(time || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const total = (Number(match[1]) * 60 + Number(match[2]) + minutes) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatWindow(windowMinutes) {
  if (windowMinutes < 60) return `${windowMinutes} minuti`;
  const hours = windowMinutes / 60;
  return hours === 1 ? '1 ora' : `${hours} ore`;
}

/* Il grafico dice il posto dove la corsa finisce e l'ora, non se il mezzo sta
   passando proprio adesso da dove sei: quella e' la posizione vera del mezzo
   in questo momento, e un orario stampato non la puo' dare, per quanto lo si
   incroci con il GPS. Solo un dato in tempo reale risponde a "sta per passare
   qui" - e BusRadar, l'altra applicazione di chi guida queste linee, mostra i
   mezzi della linea sulla mappa dal vivo. Qui non si inventa una vicinanza che
   l'orario da solo non puo' dare: si manda a vedere quella vera. */
function getReturnBusRadarTarget(item) {
  return buildBusRadarTarget({ line: item.line, place: item.from });
}

// Oltre questo si smette di aspettare il GPS e si dice che la posizione non c'e'.
const GEO_DEADLINE_MS = 12000;

/* Il GPS puo' anche non rispondere mai: sul telefono capita al chiuso, o
   quando il permesso resta in sospeso senza che nessuno lo sciolga. Senza una
   scadenza nostra un bottone che aspetta la posizione resta "Leggo la
   posizione…" per sempre, e da fuori non si distingue da un bottone rotto -
   e' il difetto dietro "non si apre il localizzatore". Ogni lettura della
   posizione di questo pannello passa da qui, cosi' nessuna ne resta senza. */
function withGeoDeadline(promise) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const giveUp = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Il GPS non ha risposto in tempo: riprova, se puoi all aperto.'));
    }, GEO_DEADLINE_MS);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(giveUp);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(giveUp);
        reject(error);
      },
    );
  });
}

export function DepotReturnsPanel({ developments = {}, places = {}, staleParse = false }) {
  /* I codici di quattro lettere sono roba interna al documento: GORX e NEGR
     non li ha mai sentiti nessuno. La legenda degli Orari li traduce nel posto
     vero, e quando manca resta la tabella dei posti cambio raccolta a mano.
     La coda che ne dice il ruolo si toglie qui e non solo in lettura: gli
     orari restano salvati, e chi ha letto il PDF prima della correzione si
     ritroverebbe «C.so Maroncelli - Capolinea Ritorno M1s» sulla scheda. */
  function placeLabel(code) {
    return stripPlaceRole(places?.[String(code || '').toUpperCase()]?.label || getChangePointLabel(code));
  }

  const [form, setForm] = useState(() => ({
    service: '',
    time: clockFromNow(0),
    windowMinutes: RETURN_WINDOW_MINUTES,
  }));
  // I criteri confermati restano separati dal form: la ricerca parte quando si
  // preme Trova, non a ogni tasto premuto.
  const [criteria, setCriteria] = useState(form);
  const [searching, setSearching] = useState(false);
  const [geoMessage, setGeoMessage] = useState('');
  const [geoBusy, setGeoBusy] = useState('');
  // Il link si prepara prima e si apre con un tocco a parte: aprire una scheda
  // in attesa del GPS la lascia bianca su iOS.
  const [positionLink, setPositionLink] = useState(null);
  /* Dove si e' adesso, per misurare quanto dista ogni rientro. Si legge insieme
     alla ricerca e non la blocca: se il GPS tace i rientri escono lo stesso. */
  const [here, setHere] = useState(null);
  /* Che fine ha fatto la lettura della posizione. Il solo risultato non basta a
     raccontarlo: senza uno stato, un GPS che non risponde e un GPS mai chiesto
     si vedono uguali, cioe' non si vedono. */
  const [geoState, setGeoState] = useState('idle');
  // Le linee vicine si chiedono a parte: non serve impostare orario e finestra
  // per sapere solo cosa passa qui. Tre stati bastano - non richiesta, in
  // lettura, richiesta - perche' il risultato, una volta letta la posizione,
  // sta gia' in `here` e si calcola da li'.
  const [nearbyAsked, setNearbyAsked] = useState(false);
  const [nearbyBusy, setNearbyBusy] = useState(false);
  const [nearbyError, setNearbyError] = useState('');
  // Il rientro di cui si sta guardando la mappa dal vivo: uno solo alla
  // volta, come lo sviluppo turno.
  const [mapItem, setMapItem] = useState(null);

  function findNearby() {
    setNearbyAsked(true);
    setNearbyError('');
    // La posizione puo' essere gia' nota - da una ricerca fatta prima - e in
    // quel caso non c'e' niente da chiedere di nuovo al telefono.
    if (here) return;
    setNearbyBusy(true);
    withGeoDeadline(readPosition())
      .then((position) => {
        setHere(position);
        setGeoState('ok');
      })
      .catch((error) => setNearbyError(error.message))
      .finally(() => setNearbyBusy(false));
  }

  const nearbyTermini = useMemo(() => (here ? findNearbyTermini(here) : []), [here]);

  // Due link diversi, uno solo alla volta: le fermate intorno, oppure il
  // percorso in mezzi fino al deposito calcolato sulla rete GTT vera.
  function openWithPosition(reader, kind) {
    setGeoMessage('');
    setPositionLink(null);
    setGeoBusy(kind);
    withGeoDeadline(reader())
      .then((url) => setPositionLink({ kind, url }))
      .catch((error) => setGeoMessage(error.message))
      .finally(() => setGeoBusy(''));
  }

  const result = useMemo(
    () =>
      // Sempre tutti i posti cambio: il punto di partenza e' dove si e' adesso,
      // non un codice scelto da un elenco.
      searchReturns(developments, ANY_PLACE, {
        service: criteria.service,
        time: criteria.time,
        windowMinutes: criteria.windowMinutes,
      }),
    [criteria, developments],
  );

  const isDirty =
    form.service !== criteria.service ||
    form.time !== criteria.time ||
    form.windowMinutes !== criteria.windowMinutes;

  function updateForm(changes) {
    setForm((current) => ({ ...current, ...changes }));
  }

  function runSearch(changes = {}) {
    const next = { ...form, ...changes };
    setForm(next);
    setCriteria(next);
    setSearching(true);
    setGeoState('reading');

    withGeoDeadline(readPosition())
      .then((position) => {
        setHere(position);
        setGeoState('ok');
      })
      .catch(() => {
        setHere(null);
        setGeoState('off');
      });
  }

  useEffect(() => {
    if (!searching) return undefined;
    const timer = setTimeout(() => setSearching(false), SEARCH_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [criteria, searching]);

  // Le linee che stanno rientrando, in ordine di arrivo: e' la risposta corta
  // alla domanda "quale linea prendo per tornare al Gerbido".
  /* Prima chi si fa in tempo a prendere, e fra quelli chi porta in deposito
     prima. Un rientro che parte fra sei minuti da un capolinea a tre chilometri
     non e' un rientro: e' un orario stampato. */
  const matches = useMemo(() => {
    const measured = withDistance(result.matches, here);
    if (!here) return measured;
    return measured.slice().sort((a, b) => {
      if (a.reachable !== b.reachable) return a.reachable ? -1 : 1;
      return (a.meters ?? Infinity) - (b.meters ?? Infinity) || a.totalMinutes - b.totalMinutes;
    });
  }, [here, result.matches]);

  /* I rientri oltre la finestra. Erano un elenco a parte, stretto, con la linea
     e i due orari sulla stessa riga: l'utente ha detto che non si capiva cosa
     fosse quella tabella in fondo. Sono rientri come gli altri - solo piu'
     tardi - quindi sono schede come le altre, e ne bastano poche. */
  const upcoming = useMemo(
    () => withDistance(result.upcoming.slice(0, UPCOMING_LIMIT), here),
    [here, result.upcoming],
  );

  // Un rientro di cui il grafico non dice la linea non ha una pillola da
  // mettere qui sopra: lo dice la sua scheda, e basta.
  const returningLines = [...new Set(matches.map((item) => getLineDisplayName(item.line)).filter(Boolean))];
  const nextUpcoming = result.upcoming[0];
  const otherServices = Object.entries(result.passagesByService).filter(
    ([service, count]) => service !== result.service && count > 0,
  );

  /* Una scheda sola per tutti i rientri, dentro la finestra e oltre. Prima ce
     n'erano due formati diversi, e il secondo - linea e due orari sulla stessa
     riga, dentro un riquadro tratteggiato - andava a capo dove capitava. */
  function renderCard(item) {
    const stop = getChangePointStop(item.from, { line: item.line });
    const line = getLineDisplayName(item.line);
    const mapTarget = getReturnBusRadarTarget(item);
    return (
      <article
        className={`depot-return-card${item.reachable === false ? ' depot-return-card--far' : ''}`}
        key={`${item.line}-${item.from}-${item.shift}-${item.departure}-${item.vehicleShift}`}
      >
        {/* La pillola gialla e' il numero della linea. Senza numero sarebbe una
            macchia gialla vuota, che non dice ne' cosa prendere ne' che il dato
            manca: in quel caso lo si scrive. I tratti si dicono solo quando
            sono piu' di uno. Quando si sa dove cercarla, la pillola si tocca:
            apre la mappa dal vivo di BusRadar, per vedere se il mezzo sta
            passando davvero qui vicino - cosa che l'orario da solo non dice. */}
        <p className="depot-return-card__head" title={item.route}>
          {line ? (
            mapTarget ? (
              <button
                className="depot-return-card__line"
                onClick={() => setMapItem(item)}
                title={mapTarget.title}
                type="button"
              >
                <Icon name="mapPin" size={12} />
                {line}
              </button>
            ) : (
              <strong>{line}</strong>
            )
          ) : (
            <span>linea non indicata sul grafico</span>
          )}
          {item.direct ? '' : `${item.legs.length} tratti`}
        </p>
        {/* I due orari sono l'uno il passaggio alla palina dove si sale e
            l'altro l'arrivo in deposito: senza scriverlo sotto ciascuno, il
            primo si legge come partenza dal capolinea. */}
        <p className="depot-return-card__times">
          <span className="depot-return-card__stop">
            <strong>{item.departure}</strong>
            <small>
              {stop ? `palina ${stop} · ` : ''}
              {placeLabel(item.from)}
            </small>
          </span>
          <i aria-hidden="true">→</i>
          <span className="depot-return-card__stop">
            <strong>{item.arrival}</strong>
            <small>{DEPOT_LABEL}</small>
          </span>
        </p>
        <p className="depot-return-card__meta">
          {[
            formatDistance(item),
            formatWaitShort(item.waitMinutes),
            // Su un rientro a piu' tratti dentro ci sta anche il recupero a
            // capolinea fra un tratto e l'altro: e' tempo passato sul mezzo,
            // non viaggio.
            `a bordo ${formatSpan(item.rideMinutes)}`,
            item.vehicleShift ? `vettura ${item.vehicleShift}` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {positionLink?.kind === `to-${item.from}` ? (
          <a
            className="depot-returns-maps-link"
            href={positionLink.url}
            onClick={() => setPositionLink(null)}
            rel="noopener noreferrer"
            target="_blank"
          >
            Apri il percorso fino a {placeLabel(item.from)}
          </a>
        ) : (
          <button
            className="depot-returns-maps-link"
            disabled={Boolean(geoBusy)}
            onClick={() => openWithPosition(() => readChangePointDirectionsUrl(item.from), `to-${item.from}`)}
            type="button"
          >
            {geoBusy === `to-${item.from}` ? 'Leggo la posizione…' : 'ci arrivo in tempo?'}
          </button>
        )}
      </article>
    );
  }

  function renderEmptyState() {
    // I rientri stanno solo sul grafico di servizio. Senza quella pagina non
    // c'e' niente da cercare, e va detto: la pagina dei turni ha le riprese
    // intere, che rientri non sono. Ma prima di dare la colpa al PDF va escluso
    // il caso piu' comune, cioe' che gli Orari in uso siano stati letti da una
    // versione dell'app che il grafico non lo leggeva ancora.
    if (!result.graphicLoaded) {
      if (staleParse) {
        return (
          <p className="result-message">
            Gli orari in uso sono stati letti da una versione precedente dell&apos;app, che non ricavava i rientri.
            Ricarica il PDF degli orari e i rientri compaiono.
          </p>
        );
      }
      return (
        <p className="result-message">
          Negli orari caricati manca il grafico di servizio, la pagina con le ultime corse e gli ingressi in deposito.
          Senza quella i rientri non si possono calcolare: usa Come arrivo al Gerbido qui sotto.
        </p>
      );
    }

    if (!result.placeKnown) {
      return (
        <p className="result-message">
          Negli orari caricati non c&apos;e nessuna corsa. Controlla di aver caricato il PDF degli orari giusto.
        </p>
      );
    }

    if (!result.passages && otherServices.length) {
      return (
        <div className="result-message">
          <p>
            Gli orari caricati hanno corse solo per il servizio{' '}
            {otherServices.map(([service]) => SERVICE_LABELS[service] || service).join(' e ')}, non per il servizio{' '}
            {SERVICE_LABELS[result.service] || result.service}.
          </p>
          <div className="depot-returns-quick">
            {otherServices.map(([service]) => (
              <button key={service} onClick={() => runSearch({ service })} type="button">
                Cerca nel servizio {SERVICE_LABELS[service] || service}
              </button>
            ))}
          </div>
        </div>
      );
    }

    // Il riepilogo sopra ha gia' detto posto, orario e finestra, e l'elenco
    // qui sotto dice quando passano i prossimi: qui non serve altro.
    if (nextUpcoming) return null;

    if (!result.passages) {
      return (
        <p className="result-message">Dopo le {criteria.time} non parte nessuna corsa. Sposta l&apos;orario.</p>
      );
    }

    const passages = result.passages === 1 ? 'passa 1 mezzo' : `passano ${result.passages} mezzi`;

    // Distinguere i due casi conta: uno dice che di qui al deposito non ci si
    // va, l'altro che ci si va ma solo restando su tutta la ripresa. Negli
    // orari una riga e' la ripresa intera di un turno, non la singola corsa:
    // chiamarla "viaggio" faceva sembrare rotto il calcolo.
    if (result.longRides) {
      return (
        <p className="result-message">
          Dopo le {criteria.time} {passages}:{' '}
          {result.longRides === 1 ? 'uno chiude in deposito ' : `${result.longRides} chiudono in deposito `}
          {result.shortestLongRide ? formatMinutes(result.shortestLongRide) : `piu di ${MAX_RIDE_MINUTES} minuti`} dopo
          la presa, {result.longRides === 1 ? "e' una ripresa intera" : 'sono riprese intere'}, non un passaggio verso
          il Gerbido.
        </p>
      );
    }

    return (
      <p className="result-message">
        Dopo le {criteria.time} {passages}, ma nessuno arriva al Gerbido.
      </p>
    );
  }

  return (
    <section className="depot-returns-panel dc" aria-labelledby="depot-returns-title">
      <div className="depot-returns-panel__header">
        <span className="section-kicker">
          <Icon name="dockReturns" size={22} />
          Rientri deposito
        </span>
        <h2 id="depot-returns-title">Cosa mi riporta al Gerbido</h2>
        <p>
          Le corse che passano dopo l&apos;orario indicato e finiscono in deposito. Con la posizione attiva sono in
          ordine di vicinanza, con quanto dista ognuna da dove sei.
        </p>
      </div>

      <form
        className="depot-returns-form"
        onSubmit={(event) => {
          event.preventDefault();
          runSearch();
        }}
      >
        <div className="depot-returns-controls">
          <label>
            <span>Fine servizio alle</span>
            <input
              aria-label="Orario da cui cercare i rientri"
              onChange={(event) => updateForm({ time: event.target.value })}
              type="time"
              value={form.time}
            />
          </label>
          <label>
            <span>Entro</span>
            <select
              onChange={(event) => updateForm({ windowMinutes: Number(event.target.value) })}
              value={form.windowMinutes}
            >
              {WINDOW_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {formatWindow(minutes)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="depot-returns-actions">
          <button className="depot-returns-search" type="submit">
            <Icon name="mapPin" size={18} />
            {geoState === 'reading' ? 'Leggo la posizione…' : 'Trova rientri da qui'}
          </button>
        </div>

      </form>

      {/* Un solo bottone principale, non tre pillole uguali una accanto
          all'altra: "Cosa passa qui vicino" e "Come arrivo al Gerbido"
          usavano lo stesso blu e la stessa forma di "Trova rientri da qui", e
          si leggevano come tre varianti della stessa cosa invece che tre
          risposte diverse. "Come arrivo al Gerbido" c'era gia' anche nel
          ripiego qui sotto, per quando davvero serve: qui sopra era solo
          ripetuto. "Cosa passa qui vicino" resta, ma come link di testo - un
          ripiego leggero, non un secondo bottone da scegliere. */}
      <button
        className="depot-returns-nearby-toggle"
        disabled={nearbyBusy}
        onClick={findNearby}
        title="Le linee del Gerbido il cui capolinea e' vicino a dove sei adesso"
        type="button"
      >
        <Icon name="mapPin" size={14} />
        {nearbyBusy ? 'Leggo la posizione…' : 'Cosa passa qui vicino'}
      </button>

      {/* La risposta a "Cosa passa qui vicino", subito qui sotto il bottone:
          niente da aprire, niente secondo tocco. Un capolinea condiviso da piu'
          linee - Bertola dalla 58 e dalla 58/, Cattaneo dalla 5 e dalla 71 -
          compare una volta sola con tutte le sue linee. */}
      {nearbyAsked ? (
        <div className="depot-returns-nearby">
          {nearbyBusy ? (
            <p className="depot-returns-geo depot-returns-geo--off">
              <Icon name="mapPin" size={14} />
              Cerco dove sei…
            </p>
          ) : nearbyError ? (
            <p className="depot-returns-message">{nearbyError}</p>
          ) : nearbyTermini.length ? (
            <ul className="depot-returns-nearby__list">
              {nearbyTermini.map((item) => (
                <li key={item.code}>
                  <strong>{item.lines.map((line) => getLineDisplayName(line)).join(' · ')}</strong>
                  <span>
                    {item.name} · palina {item.code}
                  </span>
                  <span>{formatNearbyDistance(item.meters)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="depot-returns-message">
              Nessun capolinea del Gerbido entro due chilometri e mezzo da qui: qui vicino non passa nessuna delle
              linee del deposito.
            </p>
          )}
        </div>
      ) : null}

      {searching ? (
        <div className="depot-returns-progress" role="status">
          <span className="depot-returns-progress__track">
            <span className="depot-returns-progress__bar" />
          </span>
          <span className="depot-returns-progress__label">
            Cerco le corse che rientrano al Gerbido…
          </span>
        </div>
      ) : null}

      {geoMessage ? <p className="depot-returns-message">{geoMessage}</p> : null}

      {!searching && isDirty ? (
        <p className="depot-returns-message">Criteri cambiati: premi Trova rientri da qui per aggiornare.</p>
      ) : null}

      {/* Cosa ha fatto il GPS, detto sempre: e' l'unica cosa che spiega perche'
          un elenco e' ordinato per vicinanza e un altro no. Anche l'attesa va
          detta, perche' il telefono ci mette qualche secondo e nel frattempo
          l'elenco e' gia' li', solo non ancora in ordine di vicinanza. */}
      {!searching && geoState === 'reading' ? (
        <p className="depot-returns-geo depot-returns-geo--off">
          <Icon name="mapPin" size={14} />
          Cerco dove sei…
        </p>
      ) : null}
      {!searching && geoState === 'ok' ? (
        <p className="depot-returns-geo depot-returns-geo--on">
          <Icon name="mapPin" size={14} />
          Posizione trovata: i rientri sono in ordine di vicinanza, dal piu&apos; comodo da raggiungere.
        </p>
      ) : null}
      {!searching && geoState === 'off' ? (
        <p className="depot-returns-geo depot-returns-geo--off">
          <Icon name="mapPin" size={14} />
          Posizione non disponibile: i rientri ci sono lo stesso, ma senza distanza ne&apos; ordine di vicinanza.
        </p>
      ) : null}
      {/* Finestra e servizio scelti stanno gia' nei selettori qui sopra: qui
          basta il conto e l'orario di partenza della ricerca. Il servizio si
          dice solo quando l'ha dedotto l'app al posto di chi cerca. */}
      {!searching ? (
        <p className="depot-returns-summary">
          {matches.length
            ? `${matches.length} ${matches.length === 1 ? 'rientro' : 'rientri'}`
            : 'Nessun rientro'}{' '}
          fra le {criteria.time} e le {clockPlus(criteria.time, criteria.windowMinutes)}
          {criteria.service ? '' : ` · servizio ${SERVICE_LABELS[result.service] || result.service}`}
        </p>
      ) : null}

      {/* Con una sola linea le pillole ripeterebbero la scheda qui sotto. */}
      {!searching && returningLines.length > 1 ? (
        <p className="depot-returns-lines">
          <span>Linee in rientro</span>
          {returningLines.map((line) => (
            <strong key={line}>{line}</strong>
          ))}
        </p>
      ) : null}

      <div className="depot-returns-results" aria-live="polite">
        {searching ? null : matches.length ? matches.map(renderCard) : renderEmptyState()}
      </div>

      {/* I rientri oltre la finestra, con le stesse schede: prima si vedeva un
          elenco stretto intitolato "Prossimi rientri", che sopra a un pannello
          che diceva "nessun rientro" non si capiva cosa fosse. Sono rientri
          anche quelli, solo piu' tardi, e il titolo dice quanto piu' tardi. */}
      {!searching && upcoming.length ? (
        <div className="depot-returns-upcoming">
          <h3>
            {matches.length
              ? `Piu' tardi, oltre ${formatWindow(criteria.windowMinutes)}`
              : `Il primo e' alle ${upcoming[0].departure}`}
          </h3>
          <div className="depot-returns-results">{upcoming.map(renderCard)}</div>
        </div>
      ) : null}

      {/* Ultimo, e non piu' in mezzo alla pagina: e' il ripiego per quando in
          servizio non torna indietro niente, non la risposta principale. Un
          bottone e un link, non tre. */}
      {!searching && !matches.length ? (
        <div className="depot-returns-fallback">
          <p>In servizio non rientra niente. Moovit ti porta al Gerbido coi mezzi di linea, da dove sei.</p>
          {positionLink?.kind === 'depot' ? (
            <a
              className="depot-returns-search"
              href={positionLink.url}
              onClick={() => setPositionLink(null)}
              rel="noopener noreferrer"
            >
              <Icon name="route" size={18} />
              Apri il percorso nell&apos;app Moovit
            </a>
          ) : (
            <button
              className="depot-returns-search"
              disabled={Boolean(geoBusy)}
              onClick={() => openWithPosition(readDepotDirectionsUrl, 'depot')}
              type="button"
            >
              <Icon name="route" size={18} />
              {geoBusy === 'depot' ? 'Leggo la posizione…' : 'Come arrivo al Gerbido da qui'}
            </button>
          )}
          {/* Riserva: se Moovit non risponde come deve, la mappa fa lo stesso. */}
          {positionLink?.kind === 'maps' ? (
            <a
              className="depot-returns-maps-link"
              href={positionLink.url}
              onClick={() => setPositionLink(null)}
              rel="noopener noreferrer"
              target="_blank"
            >
              Apri lo stesso percorso su Google Maps
            </a>
          ) : (
            <button
              className="depot-returns-maps-link"
              disabled={Boolean(geoBusy)}
              onClick={() => openWithPosition(readDepotMapsDirectionsUrl, 'maps')}
              type="button"
            >
              {geoBusy === 'maps' ? 'Leggo la posizione…' : 'oppure con Google Maps'}
            </button>
          )}
        </div>
      ) : null}

      {mapItem ? (
        <BusRadarModal
          onClose={() => setMapItem(null)}
          subtitle={`${mapItem.departure} - ${mapItem.arrival} · ${placeLabel(mapItem.from)} → ${DEPOT_LABEL}`}
          target={getReturnBusRadarTarget(mapItem)}
          title={`Linea ${getLineDisplayName(mapItem.line)}`}
        />
      ) : null}

    </section>
  );
}
