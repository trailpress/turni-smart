import { compactTimeToMinutes } from './timeUtils.js';

/* Quanto in la' nel futuro ha ancora senso dire "attacchi tra...": oltre
   due giorni il conto alla rovescia non aiuta piu' nessuno. */
const COUNTDOWN_HORIZON_MINUTES = 48 * 60;

/* Sotto quest'ora di attacco la sveglia va suggerita: e' il turno che si
   prepara la sera prima.

   Da non confondere con la finestra di `utils/wakeAlarms.js`, che e' piu'
   larga (04:00-08:30). Le due rispondono a domande diverse: qui "vale la pena
   ricordare la sveglia in questa card", li' "per quali turni il telefono deve
   suonare davvero". La seconda l'ha fissata l'utente. */
const EARLY_START_MINUTES = 6 * 60;

/* Tempo tipico tra sveglia e presa servizio: vestirsi, viaggio, margine. */
const DEFAULT_WAKE_LEAD_MINUTES = 75;

export function shiftStartDate(day) {
  if (!day || day.t !== 'turno' || !day.i) return null;
  const base = day.date instanceof Date ? day.date : day.iso ? new Date(`${day.iso}T00:00:00`) : null;
  if (!base || Number.isNaN(base.getTime())) return null;

  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  start.setMinutes(compactTimeToMinutes(day.i));
  return start;
}

export function shiftEndDate(day) {
  const start = shiftStartDate(day);
  if (!start || !day.e) return null;
  const end = new Date(start);
  end.setHours(0, 0, 0, 0);
  end.setMinutes(compactTimeToMinutes(day.e));
  if (end <= start) end.setDate(end.getDate() + 1);
  return end;
}

/** La durata dagli orari di attacco e di fine, quando la preconoscenza non la porta. */
export function shiftSpanMinutes(day) {
  const start = shiftStartDate(day);
  const end = shiftEndDate(day);
  return start && end ? Math.round((end - start) / 60000) : null;
}

/** «Attacchi tra» anche quando manca piu' di un giorno o due: oltre le 48 ore a giorni. */
export function formatDistantCountdown(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return '';
  if (minutes < 48 * 60) return formatCountdown(minutes);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return hours ? `${days}g ${hours}h` : `${days}g`;
}

export function formatCountdown(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return '';
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}

/**
 * Conteggio vivo. Nell'ultima ora scende al secondo in mm:ss, che e' la
 * forma che si legge a colpo d'occhio quando manca poco; piu' in la' resta
 * a ore e minuti, perche' i secondi a nove ore di distanza sono rumore.
 * Le parti tornano separate cosi' la vista puo' far lampeggiare i due punti
 * senza rimontare le cifre.
 */
export function formatLiveCountdown(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return {
      head: String(minutes).padStart(2, '0'),
      separator: ':',
      tail: String(Math.floor(seconds % 60)).padStart(2, '0'),
      ticksBySecond: true,
    };
  }

  return { head: formatCountdown(Math.floor(seconds / 60)), separator: '', tail: '', ticksBySecond: false };
}

/**
 * Le due informazioni che l'autista calcola a mente ogni sera: quanto manca
 * all'attacco e a che ora deve suonare la sveglia.
 */
export function describeShiftTiming(day, now = new Date(), leadMinutes = DEFAULT_WAKE_LEAD_MINUTES) {
  const start = shiftStartDate(day);
  if (!start) return { countdown: '', isImminent: false, isLive: false, live: null, secondsAway: null, wakeUp: '' };

  const secondsAway = (start - now) / 1000;
  const minutesAway = Math.round(secondsAway / 60);
  const withinHorizon = minutesAway >= 0 && minutesAway <= COUNTDOWN_HORIZON_MINUTES;
  const startMinutes = compactTimeToMinutes(day.i);

  const wake = new Date(start);
  wake.setMinutes(wake.getMinutes() - leadMinutes);

  return {
    countdown: withinHorizon ? formatCountdown(minutesAway) : '',
    live: withinHorizon ? formatLiveCountdown(secondsAway) : null,
    /* Solo dentro l'orizzonte vale la pena tenere acceso un timer. */
    isLive: withinHorizon && secondsAway > 0,
    secondsAway,
    isImminent: minutesAway >= 0 && minutesAway <= 180,
    /* La sveglia si suggerisce solo quando serve davvero, e solo se il turno
       non e' gia' passato. */
    wakeUp:
      withinHorizon && startMinutes > 0 && startMinutes < EARLY_START_MINUTES
        ? `${String(wake.getHours()).padStart(2, '0')}:${String(wake.getMinutes()).padStart(2, '0')}`
        : '',
  };
}
