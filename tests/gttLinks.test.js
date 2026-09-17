import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANGE_POINTS,
  getChangePointLabel,
  getChangePointPosition,
  getChangePointStop,
} from '../src/constants/changePoints.js';
import { distanceMeters, PALINE } from '../src/constants/gttPaline.js';
import {
  buildChangePointDirectionsUrl,
  buildDepotDirectionsUrl,
  buildGttPassagesTarget,
  buildMoovitDirectionsUrl,
  buildMoovitWebUrl,
} from '../src/utils/gttLinks.js';

test('risolve la palina per direzione', () => {
  assert.equal(getChangePointStop('CATT', { direction: 'A' }), '307');
  assert.equal(getChangePointStop('CATT', { direction: 'R' }), '308');
  assert.equal(getChangePointStop('LING', { direction: 'R' }), '2603');
  assert.equal(getChangePointStop('BENS', { direction: 'A' }), '3628');
  assert.equal(getChangePointStop('CLMA', { direction: 'R' }), '852');
});

test('sulla linea 62 le direzioni di Orbassano sono invertite', () => {
  assert.equal(getChangePointStop('ORSA', { direction: 'A' }), '728');
  assert.equal(getChangePointStop('ORSA', { direction: 'R' }), '729');
  assert.equal(getChangePointStop('ORSA', { direction: 'A', line: '62' }), '729');
  assert.equal(getChangePointStop('ORSA', { direction: 'R', line: '62' }), '728');
});

test('la linea 2 non e piu del Gerbido, e con lei il posto cambio Pitagora', () => {
  assert.equal(CHANGE_POINTS.PITA, undefined);
  assert.equal(getChangePointStop('PITA', { direction: 'A' }), '');
  assert.equal(getChangePointLabel('PITA'), 'PITA');
});

test('senza direzione usa l andata, e Cairoli ha la stessa palina nei due sensi', () => {
  assert.equal(getChangePointStop('BARB', { direction: '-' }), '1169');
  assert.equal(getChangePointStop('CAIO', { direction: 'A' }), '1119');
  assert.equal(getChangePointStop('CAIO', { direction: 'R' }), '1119');
});

test('un posto cambio senza paline non ne inventa una', () => {
  // Il deposito non e' una fermata di linea: e' l'unico rimasto senza palina.
  assert.equal(getChangePointStop('GERB', { direction: 'A' }), '');
  assert.equal(getChangePointStop('ZZZZ', { direction: 'A' }), '');
});

test('il link punta alla palina quando c e, altrimenti alla linea', () => {
  const withStop = buildGttPassagesTarget({ line: '71', place: 'CATT', direction: 'R' });
  assert.match(withStop.url, /view=palina/);
  assert.match(withStop.url, /palina=308/);
  assert.equal(withStop.palina, '308');

  const withoutStop = buildGttPassagesTarget({ line: '71', place: 'GERB', direction: 'R' });
  assert.match(withoutStop.url, /view=percorsi/);
  assert.equal(withoutStop.palina, '');
});

test('l etichetta usa il codice del posto cambio', () => {
  const target = buildGttPassagesTarget({ line: '71', place: 'CATT', direction: 'A' });
  assert.match(target.label, /CATT/);
  assert.match(target.title, /palina 307/);
});

test('nessun posto cambio porta coordinate scritte a occhio', () => {
  // La posizione arriva dal numero di palina, che e' una chiave esatta nel
  // GTFS di GTT. Nella tabella dei posti cambio non ci sono coordinate a mano.
  Object.values(CHANGE_POINTS).forEach((meta) => {
    assert.equal(meta.coordinates, undefined);
  });
});

test('il percorso al deposito parte dalla posizione e va in mezzi pubblici', () => {
  const url = buildDepotDirectionsUrl({ lat: 45.0668, lng: 7.6513 });
  assert.match(url, /^https:\/\/www\.google\.com\/maps\/dir\/\?/);
  assert.match(url, /origin=45\.066800%2C7\.651300/);
  assert.match(url, /travelmode=transit/);
  // Il deposito e' in via Gorini: lo dice GTT sulla destinazione della 74.
  assert.match(url, /destination=Via\+Gorini%2C\+Torino/);

  assert.equal(buildDepotDirectionsUrl({ lat: 'boh', lng: 7.6 }), '');
  assert.equal(buildDepotDirectionsUrl(), '');
});

test('il percorso Moovit usa lo schema dell app, non un indirizzo web', () => {
  const url = buildMoovitDirectionsUrl({ lat: 45.0668, lng: 7.6513 });
  assert.match(url, /^moovit:\/\/directions\?/);
  assert.match(url, /orig_lat=45\.066800&orig_lon=7\.651300/);
  // Palina 693 "GORINI CAP", capolinea della 74: il punto del deposito.
  assert.match(url, /dest_lat=45\.039410&dest_lon=7\.591660/);
  assert.match(url, /dest_name=Via%20Gorini/);
  assert.match(url, /auto_run=true/);
  // Gli spazi restano spazi codificati: un piu' non verrebbe riletto come tale.
  assert.match(url, /orig_name=La%20mia%20posizione/);
  assert.ok(!url.includes('+'));

  assert.equal(buildMoovitDirectionsUrl({ lat: null, lng: 7.6 }), '');
  assert.equal(buildMoovitDirectionsUrl(), '');
});

test('resta l indirizzo web di Moovit per chi non ha l app', () => {
  const url = buildMoovitWebUrl({ lat: 45.0668, lng: 7.6513 });
  assert.match(url, /^https:\/\/moovitapp\.com\/\?/);
  assert.match(url, /fll=45\.066800_7\.651300/);
  assert.match(url, /tll=45\.039410_7\.591660/);
  assert.equal(buildMoovitWebUrl(), '');
});

test('i nomi dei posti cambio sono quelli delle paline GTT', () => {
  assert.equal(getChangePointLabel('OSET'), 'Settembrini');
  assert.equal(getChangePointLabel('CAIO'), 'Caio Mario');
  assert.equal(getChangePointLabel('BARB'), 'Portofino');
  assert.equal(getChangePointLabel('CLGR'), 'Gramsci Nord');
  assert.equal(getChangePointLabel('CLMA'), 'Macedonia');
  assert.equal(getChangePointLabel('BABE'), 'Barbera');
  // Un codice che la tabella non ha resta il codice, cosi' com'e' scritto.
  assert.equal(getChangePointLabel('ZZZZ'), 'ZZZZ');
});

test('il percorso fino al posto cambio usa il suo indirizzo', () => {
  const url = buildChangePointDirectionsUrl({ lat: 45.0668, lng: 7.6513 }, 'CAIO');
  assert.match(url, /origin=45\.066800%2C7\.651300/);
  assert.match(url, /destination=Piazzale\+Caio\+Mario%2C\+Torino/);
  assert.match(url, /travelmode=transit/);

  // Senza indirizzo non si inventa una destinazione.
  assert.equal(buildChangePointDirectionsUrl({ lat: 45.06, lng: 7.65 }, 'ZZZZ'), '');
  assert.equal(buildChangePointDirectionsUrl({}, 'CAIO'), '');
});

test('le coordinate dei posti cambio vengono dalla palina, non da noi', () => {
  // La palina 308 e' Cattaneo lato ritorno: la posizione e' quella che GTT
  // pubblica per quel numero, non un punto messo a occhio sulla mappa.
  assert.deepEqual(getChangePointPosition('CATT', { direction: 'R' }), { lat: 45.03618, lng: 7.62581 });
  assert.deepEqual(getChangePointPosition('CATT', { direction: 'A' }), { lat: 45.03614, lng: 7.62627 });
  // Sulla 62 le direzioni di Orbassano sono invertite, e le coordinate seguono.
  assert.deepEqual(getChangePointPosition('ORSA', { direction: 'A', line: '62' }), getChangePointPosition('ORSA', { direction: 'R' }));
  // Un capolinea del grafico non ha palina: senza quella non si inventa un punto.
  assert.equal(getChangePointPosition('GORX'), null);
  assert.equal(getChangePointPosition(''), null);
});

test('i due lati di corso Siracusa sono due punti diversi', () => {
  /* 711 e' SIRACUSA, 128 e' MONFALCONE: le due vie che si incrociano li'.
     Finche' la seconda non era in tabella il ritorno prendeva le coordinate
     dell'andata, e mandava sessanta metri piu' in la' - dall'altra parte del
     corso, che alle quattro del mattino non e' un dettaglio. */
  assert.deepEqual(getChangePointPosition('SIRA', { direction: 'A' }), { lat: 45.05287, lng: 7.6338 });
  assert.deepEqual(getChangePointPosition('SIRA', { direction: 'R' }), { lat: 45.05292, lng: 7.63458 });
});

test('GCAS e via Grosso, non via Bertola', () => {
  /* Grosso-CASalegno: il capolinea della 58/ in via Grosso, palina 3542.
     Per un giorno c'e' stato scritto Bertola, che e' l'altro capolinea della
     stessa linea, tre chilometri piu' in la': la scheda mandava a prendere il
     mezzo dalla parte opposta. */
  assert.deepEqual(getChangePointPosition('GCAS'), { lat: 45.04929, lng: 7.62255 });
});

test('ogni palina nota porta un nome che conferma la ricerca', () => {
  Object.entries(PALINE).forEach(([palina, meta]) => {
    assert.ok(Number.isFinite(meta.lat) && Number.isFinite(meta.lng), `palina ${palina} senza coordinate`);
    assert.ok(meta.name && meta.name.length > 2, `palina ${palina} senza nome GTT`);
    // Torino e la sua cintura: fuori da qui la ricerca ha preso la fermata sbagliata.
    assert.ok(meta.lat > 44.9 && meta.lat < 45.2, `palina ${palina} fuori Torino`);
    assert.ok(meta.lng > 7.4 && meta.lng < 7.8, `palina ${palina} fuori Torino`);
  });
});

test('la distanza in linea d aria regge i casi vuoti', () => {
  const cattaneo = getChangePointPosition('CATT', { direction: 'R' });
  const settembrini = getChangePointPosition('OSET', { direction: 'R' });
  const metri = distanceMeters(cattaneo, settembrini);
  // Cattaneo e Settembrini sono sullo stesso corso, poco piu' di un chilometro.
  assert.ok(metri > 800 && metri < 1600, `distanza inattesa: ${metri} m`);
  assert.equal(distanceMeters(cattaneo, null), null);
  assert.equal(distanceMeters({ lat: 'boh', lng: 7 }, cattaneo), null);
});
