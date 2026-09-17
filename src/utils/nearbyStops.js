import {
  buildChangePointDirectionsUrl,
  buildDepotDirectionsUrl,
  buildMoovitDirectionsUrl,
  buildMoovitWebUrl,
} from './gttLinks.js';

// Una lettura recente va benissimo per sapere cosa passa intorno: pretenderne
// una nuova di zecca fa solo scadere il GPS al chiuso.
const FIRST_TRY = { enableHighAccuracy: true, maximumAge: 60000, timeout: 10000 };
const RETRY = { enableHighAccuracy: false, maximumAge: 300000, timeout: 8000 };

const PERMISSION_DENIED = 1;
const TIMEOUT = 3;

export function describeGeolocationError(error) {
  if (error?.code === PERMISSION_DENIED) {
    return 'Permesso posizione negato: va riattivato per questo sito nelle impostazioni del telefono.';
  }
  if (error?.code === TIMEOUT) {
    return 'Il GPS non ha risposto in tempo: riprova, se puoi all aperto.';
  }
  return 'Posizione non disponibile in questo momento: riprova tra qualche secondo.';
}

/**
 * Legge la posizione e la passa a `buildUrl`. Niente window.open qui dentro:
 * aprire una scheda in attesa del GPS la lascia bianca su iOS, perche' il
 * telefono passa alla scheda nuova e la richiesta di permesso resta in quella
 * vecchia. La pagina la apre chi chiama, con un tocco dell'utente sul link.
 */
export function readPositionUrl(buildUrl) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocalizzazione non disponibile su questo dispositivo.'));
      return;
    }

    const success = (position) => {
      const url = buildUrl({ lat: position.coords.latitude, lng: position.coords.longitude });
      if (url) resolve(url);
      else reject(new Error(describeGeolocationError(null)));
    };

    const fail = (error) => reject(new Error(describeGeolocationError(error)));

    navigator.geolocation.getCurrentPosition(
      success,
      (error) => {
        // Un timeout non e' un rifiuto: si riprova senza alta precisione.
        if (error?.code === TIMEOUT) {
          navigator.geolocation.getCurrentPosition(success, fail, RETRY);
          return;
        }
        fail(error);
      },
      FIRST_TRY,
    );
  });
}

/**
 * La posizione, e basta. Serve a misurare quanto dista un posto cambio: e' un
 * conto che si fa in casa, senza aprire niente e senza chiedere niente a
 * nessuno. Se il GPS non risponde si va avanti lo stesso, i rientri restano
 * quelli - manca solo la distanza.
 */
export function readPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocalizzazione non disponibile su questo dispositivo.'));
      return;
    }

    const success = (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude });
    const fail = (error) => reject(new Error(describeGeolocationError(error)));

    navigator.geolocation.getCurrentPosition(
      success,
      (error) => {
        if (error?.code === TIMEOUT) {
          navigator.geolocation.getCurrentPosition(success, fail, RETRY);
          return;
        }
        fail(error);
      },
      FIRST_TRY,
    );
  });
}

export function readDepotDirectionsUrl() {
  return readPositionUrl(buildMoovitDirectionsUrl);
}

export function readDepotMapsDirectionsUrl() {
  return readPositionUrl(buildDepotDirectionsUrl);
}

export function readMoovitWebUrl() {
  return readPositionUrl(buildMoovitWebUrl);
}

export function readChangePointDirectionsUrl(code) {
  return readPositionUrl((position) => buildChangePointDirectionsUrl(position, code));
}
