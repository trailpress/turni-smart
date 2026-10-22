import { timeToMinutes } from './timeUtils.js';

/**
 * Il controllo che dice se i tratti letti sotto un turno sono davvero i suoi.
 *
 * Sul PDF, in coda alla prima riga di ogni turno, c'e' il «tempo netto di
 * guida»: la somma delle durate dei tratti di quel turno. Il parser lo
 * conserva (`netMinutes`), e qui lo si confronta con quello che e' stato letto.
 * Se torna, lo sviluppo e' quello vero; se non torna, o se i tratti si
 * accavallano, sotto lo stesso turno c'e' roba di un altro.
 *
 * Un turno puo' comparire in piu' «letture» (`run_id`): sono gruppi di righe
 * che il parser non ha messo insieme, e vanno mostrate separate invece di
 * essere fuse in un elenco solo.
 */
function durationMinutes(segment) {
  const start = timeToMinutes(segment.start);
  const end = timeToMinutes(segment.end);
  return (end - start + 1440) % 1440;
}

function overlapCount(sortedSegments) {
  let count = 0;
  sortedSegments.forEach((segment, index) => {
    if (!index) return;
    const previous = sortedSegments[index - 1];
    const previousStart = timeToMinutes(previous.start);
    const previousEnd = timeToMinutes(previous.end);
    const start = timeToMinutes(segment.start);
    if (previousEnd >= previousStart && start >= previousStart && start < previousEnd) count += 1;
  });
  return count;
}

export function checkDevelopment(segments = []) {
  const runs = new Map();
  segments.forEach((segment) => {
    const run = segment.run_id === undefined ? '_' : String(segment.run_id);
    runs.set(run, [...(runs.get(run) || []), segment]);
  });

  const blocks = [...runs.entries()].map(([runId, items]) => {
    const sorted = items.slice().sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
    const workedMinutes = sorted.reduce((sum, segment) => sum + durationMinutes(segment), 0);
    const heads = sorted.filter((segment) => Number.isFinite(segment.netMinutes) && segment.netMinutes > 0);
    const overlaps = overlapCount(sorted);
    let status = 'unverified';
    let netMinutes = null;

    if (heads.length === 1) {
      netMinutes = heads[0].netMinutes;
      status = Math.abs(netMinutes - workedMinutes) <= 1 && !overlaps ? 'ok' : 'mismatch';
    } else if (heads.length > 1) {
      status = 'mixed';
    } else if (overlaps) {
      status = 'mismatch';
    }

    return { runId, segments: sorted, workedMinutes, netMinutes, overlaps, status };
  });

  return blocks.sort((a, b) => timeToMinutes(a.segments[0].start) - timeToMinutes(b.segments[0].start));
}
