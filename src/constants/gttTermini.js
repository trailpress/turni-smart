import { distanceMeters } from './gttPaline.js';

// I capolinea delle linee del Gerbido, con la loro palina e il punto in cui
// stanno. Vengono dal GTFS statico di GTT (istantanea del 12/07/2026, dal
// repository BusRadar): per ogni linea si prende il primo e l'ultimo fermata di
// ogni variante di percorso, cioe' i capolinea per come li dichiara GTT stessa.
//
// Servono ai rientri. Il grafico di servizio chiama i capolinea con codici di
// quattro lettere - GORX, NEGR, FERM - che non stanno da nessun'altra parte e
// non hanno numero di palina accanto. La legenda della stessa pagina pero' li
// traduce nel nome, e il nome, cercato solo fra i capolinea di quella linea,
// individua la fermata: sono due o quattro candidati, non settemila.
//
// Il numero di palina non e' decorazione: e' la prova che il nome ha trovato la
// fermata giusta, e la posizione da cui si misura quanto dista da chi cerca.
//
// E' anche l'unico elenco di posti del Gerbido con lat/lng gia' verificate per
// ogni linea: serve percio' anche alla domanda opposta - non "a che distanza e'
// il capolinea di questa linea", ma "quali linee hanno un capolinea qui vicino"
// (-> findNearbyTermini, in fondo al file).
export const TERMINI = {
  '5': [
    { code: '303', name: 'SICCARDI CAP', lat: 45.07296, lng: 7.67568 },
    { code: '2927', name: 'DALLA CHIESA CAP', lat: 45.0078, lng: 7.54506 },
    { code: '308', name: 'CATTANEO', lat: 45.03618, lng: 7.62581 },
    { code: '300', name: 'SETTEMBRINI', lat: 45.03158, lng: 7.61453 },
    { code: '299', name: 'SETTEMBRINI', lat: 45.03106, lng: 7.61206 },
  ],
  '10': [
    { code: '820', name: 'SETTEMBRINI', lat: 45.0305, lng: 7.61553 },
    { code: '350', name: 'MASSARI CAP', lat: 45.10645, lng: 7.68046 },
    { code: '1759', name: 'VEROLENGO', lat: 45.09566, lng: 7.67159 },
    { code: '149', name: 'CAIO MARIO CAP', lat: 45.02406, lng: 7.63622 },
  ],
  '12': [
    { code: '3588', name: 'VITTORIO EMANUELE II CAP', lat: 45.06364, lng: 7.67693 },
    { code: '3428', name: 'ALLASON CAP', lat: 45.03841, lng: 7.61581 },
    { code: '318', name: 'SANTA RITA', lat: 45.04602, lng: 7.64529 },
    { code: '317', name: 'SANTA RITA', lat: 45.04595, lng: 7.64538 },
  ],
  '14': [
    { code: '2069', name: 'SOLFERINO CAP', lat: 45.06859, lng: 7.67638 },
    { code: '922', name: 'AMENDOLA CAP', lat: 44.9954, lng: 7.63531 },
    { code: '734', name: 'TUNISI', lat: 45.04075, lng: 7.6578 },
    { code: '512', name: 'UNIONE SOVIETICA', lat: 45.04136, lng: 7.65654 },
  ],
  '17': [
    { code: '3623', name: 'VENTIMIGLIA CAP', lat: 45.03451, lng: 7.67265 },
    { code: '3494', name: 'OSPEDALE DI RIVOLI CAP', lat: 45.05959, lng: 7.52054 },
    { code: '3578', name: 'BAROCCHIO CAP', lat: 45.05016, lng: 7.61571 },
    { code: '697', name: 'LICEO CURIE', lat: 45.05117, lng: 7.60816 },
    { code: '696', name: 'LICEO CURIE', lat: 45.05113, lng: 7.60764 },
  ],
  '33': [
    { code: '1415', name: 'VITTORIO EMANUELE II CAP', lat: 45.0621, lng: 7.68123 },
    { code: '3541', name: 'PAPA GIOVANNI XXIII CAP', lat: 45.07839, lng: 7.57405 },
    { code: '1954', name: 'ADUA CAP', lat: 45.05252, lng: 7.70678 },
    { code: '853', name: 'MACEDONIA', lat: 45.07386, lng: 7.60412 },
  ],
  '34': [
    { code: '2133', name: 'VENTIMIGLIA CAP', lat: 45.0339, lng: 7.67224 },
    { code: '2780', name: 'VIII MARZO', lat: 45.02489, lng: 7.59168 },
    { code: '2235', name: 'CIMITERO PARCO CAP', lat: 45.03271, lng: 7.60404 },
    { code: '1170', name: 'PORTOFINO', lat: 45.01923, lng: 7.63375 },
  ],
  '35': [
    { code: '6165', name: 'ARTOM CAP', lat: 45.01624, lng: 7.64821 },
    { code: '5101', name: 'AMENDOLA CAP', lat: 44.99605, lng: 7.6356 },
    { code: '3448', name: 'ARTOM CAP', lat: 45.01494, lng: 7.64856 },
  ],
  '36': [
    { code: '3324', name: 'MASSAUA CAP', lat: 45.07454, lng: 7.62138 },
    { code: '3146', name: 'FRANCIA CAP', lat: 45.07036, lng: 7.52301 },
    { code: '968', name: 'GRAMSCI NORD', lat: 45.07294, lng: 7.57962 },
    { code: '970', name: 'XXIV MAGGIO', lat: 45.07269, lng: 7.57409 },
    { code: '1411', name: 'XVIII DICEMBRE', lat: 45.07425, lng: 7.66863 },
  ],
  '38': [
    { code: '3401', name: 'MINGHETTI CAP', lat: 45.07782, lng: 7.57229 },
    { code: '690', name: 'GORINI', lat: 45.04179, lng: 7.59288 },
    { code: '3483', name: 'FRANCIA', lat: 45.07203, lng: 7.5727 },
    { code: '149', name: 'CAIO MARIO CAP', lat: 45.02406, lng: 7.63622 },
    { code: '1365', name: 'MARONCELLI CAP', lat: 45.01808, lng: 7.66303 },
    { code: '691', name: 'GORINI OVEST', lat: 45.04261, lng: 7.59156 },
  ],
  '39': [
    { code: '1119', name: 'CAIO MARIO CAP', lat: 45.02446, lng: 7.63614 },
    { code: '3371', name: 'BADEN BADEN CAP', lat: 45.00175, lng: 7.68621 },
  ],
  '43': [
    { code: '3605', name: 'GOITO CAP', lat: 45.00005, lng: 7.679 },
    { code: '3674', name: 'GORIZIA CAP', lat: 45.03602, lng: 7.51737 },
    { code: '300', name: 'SETTEMBRINI', lat: 45.03158, lng: 7.61453 },
    { code: '299', name: 'SETTEMBRINI', lat: 45.03106, lng: 7.61206 },
  ],
  '44': [
    { code: '2660', name: 'DON BORIO CAP', lat: 45.04464, lng: 7.61792 },
    { code: '3677', name: 'PARTIGIANI CAP', lat: 45.09279, lng: 7.5714 },
    { code: '1968', name: 'MORGARI', lat: 45.06586, lng: 7.5806 },
    { code: '1969', name: 'MORGARI', lat: 45.06572, lng: 7.58095 },
  ],
  '55': [
    { code: '1540', name: 'FARINI CAP', lat: 45.07103, lng: 7.70347 },
    { code: '318', name: 'SANTA RITA', lat: 45.04602, lng: 7.64529 },
    { code: '1486', name: 'MONCALIERI CAP', lat: 45.04436, lng: 7.61743 },
    { code: '317', name: 'SANTA RITA', lat: 45.04595, lng: 7.64538 },
  ],
  '58': [
    { code: '1683', name: 'BERTOLA CAP', lat: 45.06996, lng: 7.68134 },
    { code: '1649', name: 'ALLASON CAP', lat: 45.03872, lng: 7.6158 },
    { code: '1666', name: 'FILADELFIA', lat: 45.04411, lng: 7.6403 },
    { code: '3542', name: 'GROSSO CAP', lat: 45.04929, lng: 7.62255 },
    { code: '1671', name: 'ADA NEGRI', lat: 45.05152, lng: 7.64158 },
  ],
  /* La 58/ - che l'app scrive 58B - va da via Grosso a via Bertola, e il
     capolinea di Bertola lo divide con la 58: il GTFS elenca la palina 1683 su
     tutte e due. Senza questa voce un grafico della 58/ non trovava nessun
     capolinea, perche' la tabella conosceva solo la 58. */
  '58B': [
    { code: '1683', name: 'BERTOLA CAP', lat: 45.06996, lng: 7.68134 },
    { code: '3542', name: 'GROSSO CAP', lat: 45.04929, lng: 7.62255 },
  ],
  '62': [
    { code: '1868', name: 'SEBASTOPOLI', lat: 45.0512, lng: 7.62989 },
    { code: '2393', name: 'SOFIA CAP', lat: 45.09536, lng: 7.71649 },
    { code: '1887', name: 'CAIO MARIO CAP', lat: 45.02464, lng: 7.63625 },
    { code: '3583', name: 'BAROCCHIO CAP', lat: 45.05036, lng: 7.6153 },
    { code: '2409', name: 'STAMPALIA', lat: 45.11175, lng: 7.65834 },
    { code: '719', name: 'GUIDO RENI', lat: 45.05009, lng: 7.6305 },
    { code: '2410', name: 'STAMPALIA', lat: 45.11199, lng: 7.65832 },
  ],
  '63': [
    { code: '3418', name: 'SOLFERINO CAP', lat: 45.06882, lng: 7.67655 },
    { code: '1158', name: 'NEGARVILLE CAP', lat: 45.02045, lng: 7.61226 },
    { code: '2604', name: 'STAZIONE LINGOTTO', lat: 45.02628, lng: 7.65665 },
    { code: '1232', name: 'CAIO MARIO CAP', lat: 45.02439, lng: 7.63627 },
  ],
  '71': [
    { code: '1982', name: 'SERVAIS CAP', lat: 45.08557, lng: 7.61533 },
    { code: '308', name: 'CATTANEO', lat: 45.03618, lng: 7.62581 },
    { code: '2123', name: 'FARINELLI CAP', lat: 45.01527, lng: 7.63311 },
  ],
  '74': [
    { code: '2128', name: 'VENTIMIGLIA CAP', lat: 45.03605, lng: 7.67321 },
    { code: '693', name: 'GORINI CAP', lat: 45.03941, lng: 7.59166 },
  ],
  '76': [
    { code: '3678', name: 'PARTIGIANI CAP', lat: 45.0928, lng: 7.57189 },
    { code: '1920', name: 'TORINO', lat: 45.06733, lng: 7.60783 },
    { code: '2573', name: 'OLEVANO N.87', lat: 45.059, lng: 7.5692 },
  ],
  '132': [
    { code: '5001', name: 'FERMI CAP', lat: 45.07632, lng: 7.59044 },
    { code: '2763', name: 'ROBOTTI CAP', lat: 45.09181, lng: 7.52381 },
  ],
  'CP1': [
    { code: '884', name: 'FERMI CAP', lat: 45.07637, lng: 7.59016 },
    { code: '3206', name: 'MUSINÈ CAP', lat: 45.1091, lng: 7.54419 },
    { code: '3086', name: 'ITAS CAP', lat: 45.10498, lng: 7.54389 },
  ],
  'M1S': [
    { code: '962', name: 'MASSAUA NORD', lat: 45.07468, lng: 7.62055 },
    { code: '3709', name: 'FERMI CAP', lat: 45.07623, lng: 7.59015 },
    { code: '1182', name: 'MARONCELLI CAP', lat: 45.0181, lng: 7.66282 },
    { code: '13', name: 'RIVOLI', lat: 45.07548, lng: 7.64448 },
  ],
};
function normalizeName(value = '') {
  return String(value)
    .toUpperCase()
    /* "CAP" alla fine e' GTT che dice "capolinea", e la legenda del grafico non
       lo scrive. Via anche le abbreviazioni di strada, che i due documenti
       mettono in modo diverso: "V. GORINI" contro "GORINI". */
    .replace(/\bCAP\b/g, ' ')
    .replace(/\b(P\.?ZA|PIAZZA|P\.?LE|PIAZZALE|L\.?GO|LARGO|V\.?LE|VIALE|VIA|V\.|C\.?SO|CORSO|C\.|STR\.?|STRADA)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * Il capolinea di una linea che porta questo nome. Cerca solo fra i capolinea
 * di quella linea: e' cio' che rende il confronto per nome affidabile, perche'
 * i candidati sono pochi e tutti pertinenti. Fuori da quella lista lo stesso
 * nome pescherebbe fermate dall'altra parte della citta'.
 *
 * Un nome composto - "C. Orbassano / C. Settembrini" - viene provato anche a
 * pezzi, perche' il grafico nomina l'incrocio e GTT nomina la fermata.
 */
export function findTerminus(line, name) {
  const candidates = TERMINI[String(line || '').trim().toUpperCase()];
  if (!candidates?.length) return null;

  const wanted = normalizeName(name);
  if (!wanted) return null;

  const exact = candidates.find((stop) => normalizeName(stop.name) === wanted);
  if (exact) return exact;

  const parts = wanted.split(' ').filter((part) => part.length > 3);
  if (!parts.length) return null;

  const matches = candidates.filter((stop) => {
    const stopName = normalizeName(stop.name);
    return parts.some((part) => stopName === part || stopName.split(' ').includes(part));
  });
  // Due capolinea che rispondono allo stesso nome sono un pareggio, e un
  // pareggio non si scioglie a caso: meglio nessuna posizione che quella
  // sbagliata.
  return matches.length === 1 ? matches[0] : null;
}

// Oltre questa distanza un capolinea non e' piu' "qui vicino": e' un altro
// quartiere. Duemilacinquecento metri sono una mezz'ora a piedi, il limite
// oltre cui la domanda non e' piu' "cosa passa qui" ma "come arrivo li'".
const NEARBY_MAX_METERS = 2500;
const NEARBY_LIMIT = 6;

/**
 * Le linee del Gerbido il cui capolinea sta vicino a una posizione data.
 *
 * Risponde alla domanda opposta di `findTerminus`: non "dov'e' il capolinea di
 * questa linea", ma "quali linee hanno un capolinea qui vicino". E' quanto
 * basta per dire onestamente "qui passa la tale linea", con la palina a prova
 * — mai "qui vicino ci sono fermate", che senza sapere quali linee ci passano
 * non risponde a niente.
 *
 * Un capolinea puo' essere condiviso da piu' linee - Bertola dalla 58 e dalla
 * 58/, Cattaneo dalla 5 e dalla 71 - e in quel caso compare una volta sola, con
 * tutte le linee che lo usano. Il raggruppamento e' per numero di palina: due
 * paline diverse restano due punti diversi anche se stanno vicine, perche'
 * sono davvero due fermate (andata e ritorno).
 *
 * Copre solo i capolinea, non ogni fermata della rete: e' l'unico dato che
 * questo progetto ha verificato palina per palina (-> docs/dati.md). Lontano
 * da un capolinea la risposta e' onestamente "niente", non una fermata
 * indovinata.
 */
export function findNearbyTermini(position, { limit = NEARBY_LIMIT, maxMeters = NEARBY_MAX_METERS } = {}) {
  if (!position) return [];

  const byCode = new Map();
  Object.entries(TERMINI).forEach(([line, stops]) => {
    stops.forEach((stop) => {
      const meters = distanceMeters(position, stop);
      if (meters === null || meters > maxMeters) return;
      if (!byCode.has(stop.code)) {
        byCode.set(stop.code, { code: stop.code, lat: stop.lat, lines: new Set(), lng: stop.lng, meters, name: stop.name });
      }
      byCode.get(stop.code).lines.add(line);
    });
  });

  return [...byCode.values()]
    .map((item) => ({ ...item, lines: [...item.lines].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) }))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit);
}
