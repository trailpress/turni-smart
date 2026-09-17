import test from 'node:test';
import assert from 'node:assert/strict';
import { describeGeolocationError } from '../src/utils/nearbyStops.js';

// navigator in Node esiste ed e' in sola lettura: si ridefinisce la proprieta'.
function setGeolocation(geolocation) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { geolocation },
  });
}

test('distingue il permesso negato dal GPS che non risponde', () => {
  assert.match(describeGeolocationError({ code: 1 }), /Permesso posizione negato/);
  assert.match(describeGeolocationError({ code: 3 }), /non ha risposto in tempo/);
  assert.match(describeGeolocationError({ code: 2 }), /non disponibile/);
  assert.match(describeGeolocationError(null), /non disponibile/);
});

test('legge la posizione e prepara il link del percorso', async () => {
  setGeolocation({ getCurrentPosition: (ok) => ok({ coords: { latitude: 45.07, longitude: 7.68 } }) });
  const { readDepotDirectionsUrl } = await import('../src/utils/nearbyStops.js');
  assert.match(await readDepotDirectionsUrl(), /^moovit:\/\/directions\?/);
});

test('un timeout fa ritentare senza alta precisione, un rifiuto no', async () => {
  const { readDepotDirectionsUrl } = await import('../src/utils/nearbyStops.js');

  let calls = 0;
  setGeolocation({
    getCurrentPosition: (ok, err) => {
      calls += 1;
      if (calls === 1) err({ code: 3 });
      else ok({ coords: { latitude: 45, longitude: 7 } });
    },
  });
  await readDepotDirectionsUrl();
  assert.equal(calls, 2);

  calls = 0;
  setGeolocation({
    getCurrentPosition: (ok, err) => {
      calls += 1;
      err({ code: 1 });
    },
  });
  await assert.rejects(readDepotDirectionsUrl(), /Permesso posizione negato/);
  assert.equal(calls, 1);
});
