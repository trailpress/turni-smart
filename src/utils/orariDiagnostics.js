import { DEPOT_CODE, getServiceTypes, normalizePlace } from './depotReturns.js';
import { isRientriKey, isUsciteKey } from '../parserRientri.js';
import { timeToMinutes } from './timeUtils.js';

/**
 * Un referto su cosa il parser ha capito degli Orari caricati.
 *
 * Non fa parte dell'interfaccia e non si vede usando la app: esiste per
 * rispondere a una domanda che dai dati non si legge in altro modo, cioe'
 * come le pagine del PDF sono state divise fra feriale, sabato e festivo.
 *
 * La classificazione avviene per intestazione di pagina, e quando
 * un'intestazione non viene riconosciuta la pagina eredita il tipo di quella
 * prima. Un'eredita' sbagliata al confine fra due sezioni si porta dietro
 * tutto il resto del documento senza lasciare traccia: questo referto e'
 * la traccia.
 */

/* I tratti che partono dal Gerbido e non ci tornano, in tutto quello che il
   parser ha letto. Non sono le uscite del pannello, che vengono dal solo
   grafico di servizio (-> decisioni/0010): qui dentro finiscono anche le
   riprese della pagina dei turni, ed e' voluto. Contati due volte - righe lette
   e tratti distinti - perche' la distanza fra i due numeri e' quanto il parser
   sta duplicando. */
export function countExits(segments = []) {
  const seen = new Set();
  let rows = 0;

  segments.forEach((segment) => {
    if (normalizePlace(segment?.loc_s) !== DEPOT_CODE) return;
    const to = normalizePlace(segment?.loc_e);
    if (!to || to === DEPOT_CODE) return;
    rows += 1;
    const line = segment.lineaNorm || segment.ln || '';
    seen.add([line, segment.start, segment.end, to].join('|'));
  });

  return { rows, unique: seen.size };
}

/** Cosa c'e' nei dati, raggruppato per la stringa di intestazione. */
export function summarizeByGt(developments = {}) {
  const byGt = new Map();

  Object.values(developments || {}).forEach((segments) => {
    if (!Array.isArray(segments)) return;
    segments.forEach((segment) => {
      const gt = String(segment?.gt ?? '');
      if (!byGt.has(gt)) byGt.set(gt, { gt, segments: [], service: getServiceTypes(gt).join('+') });
      byGt.get(gt).segments.push(segment);
    });
  });

  return [...byGt.values()]
    .map((item) => ({
      exits: countExits(item.segments),
      gt: item.gt,
      segments: item.segments.length,
      service: item.service,
    }))
    .sort((a, b) => b.segments - a.segments);
}

/**
 * Le pagine compattate in tratte consecutive dello stesso tipo, con quante di
 * quelle pagine il tipo se lo sono dichiarato da sole. Una tratta lunga con
 * una sola pagina riconosciuta e' un'eredita' che si e' propagata.
 */
export function summarizePages(diagnostics = []) {
  const runs = [];
  let recognized = 0;

  diagnostics.forEach((page) => {
    if (page.own) recognized += 1;
    const last = runs[runs.length - 1];
    if (last && last.gt === page.gt) {
      last.to = page.page;
      last.pages += 1;
      if (page.own) last.recognized += 1;
    } else {
      runs.push({
        from: page.page,
        gt: page.gt,
        pages: 1,
        recognized: page.own ? 1 : 0,
        service: getServiceTypes(page.gt).join('+'),
        to: page.page,
      });
    }
  });

  return {
    inherited: diagnostics.length - recognized,
    recognized,
    runs,
    total: diagnostics.length,
  };
}

/* I rientri letti dal grafico di servizio, per linea. Sono l'unica fonte delle
   ultime corse prima del deposito: se qui c'e' zero, il PDF quella pagina non
   l'ha o il testo estratto ha una forma che il parser non riconosce, e il
   pannello Rientri restera' vuoto per quella linea. */
export function summarizeReturns(developments = {}) {
  return Object.entries(developments || {})
    .filter(([key]) => isRientriKey(key))
    .map(([key, segments]) => ({
      key,
      places: [...new Set((segments || []).map((segment) => normalizePlace(segment.loc_s)))].sort(),
      segments: (segments || []).length,
      // Gli orari veri, in ordine: sono l'unico modo di rispondere a "quel
      // rientro c'era o no" senza avere il PDF sotto mano.
      times: (segments || [])
        .map((segment) => `${segment.start}\u2192${segment.end}`)
        .sort(),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/* Le uscite lette dal grafico di servizio, per linea. Sono l'unica fonte dei
   trasferimenti con cui le vetture lasciano il deposito: se qui c'e' zero, il
   pannello Uscite restera' vuoto per quella linea. */
export function summarizeExits(developments = {}) {
  return Object.entries(developments || {})
    .filter(([key]) => isUsciteKey(key))
    .map(([key, segments]) => ({
      key,
      places: [...new Set((segments || []).map((segment) => normalizePlace(segment.loc_e)))].sort(),
      segments: (segments || []).length,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Rientri e uscite a confronto, linea per linea.
 *
 * Ogni vettura che esce dal deposito prima o poi ci rientra: i due conti della
 * stessa pagina devono somigliarsi. Quando non si somigliano, una delle due
 * meta' si sta perdendo per strada.
 *
 * Non e' teoria. Il 24 agosto il referto diceva «58B LUN - VEN: rientri 2,
 * uscite 13» e «17 LUN - VEN: 1 e 9», e li' dentro c'era la spiegazione di un
 * difetto che durava da mesi - i rientri cercavano l'Entra a poche parole
 * dall'U.L., mentre nel testo estratto per colonne sta molto piu' in la'. Il
 * conto c'era gia', ma nessuno metteva le due colonne una accanto all'altra.
 */
export function compareReturnsAndExits(developments = {}) {
  const byLine = new Map();

  const add = (key, field) => {
    const name = String(key).replace(/^(RIENTRI|USCITE)\s+/, '');
    if (!byLine.has(name)) byLine.set(name, { name, returns: 0, exits: 0 });
    byLine.get(name)[field] = (developments[key] || []).length;
  };

  Object.keys(developments || {}).forEach((key) => {
    if (isRientriKey(key)) add(key, 'returns');
    else if (isUsciteKey(key)) add(key, 'exits');
  });

  return [...byLine.values()]
    .filter((item) => {
      const low = Math.min(item.returns, item.exits);
      const high = Math.max(item.returns, item.exits);
      // Meno della meta' non e' oscillazione: e' roba che manca.
      return high > 0 && low * 2 < high;
    })
    .sort((a, b) => b.exits - b.returns - (a.exits - a.returns));
}

/* Gli sviluppi in cui due tratti dello stesso tipo di servizio si sovrappongono
   nel tempo: una persona non guida due tratti insieme, quindi sotto quel turno
   ci sono righe di altri turni. E' il segno del difetto «lo sviluppo mischia
   turni» e dice, per ogni riga, la vettura e la ripresa (#) con cui e' stata
   letta - il solo modo di capire da dove arrivi senza avere il PDF in mano. */
export function findMixedDevelopments(developments = {}) {
  const mixed = [];

  Object.entries(developments || {}).forEach(([key, segments]) => {
    if (isRientriKey(key) || isUsciteKey(key) || !Array.isArray(segments)) return;
    const byGt = new Map();
    segments.forEach((segment) => {
      const gt = String(segment?.gt ?? '');
      byGt.set(gt, [...(byGt.get(gt) || []), segment]);
    });
    byGt.forEach((items, gt) => {
      const sorted = items.slice().sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
      const overlap = sorted.some((segment, index) => {
        if (!index) return false;
        const previous = sorted[index - 1];
        const previousStart = timeToMinutes(previous.start);
        const previousEnd = timeToMinutes(previous.end);
        const start = timeToMinutes(segment.start);
        return previousEnd >= previousStart && start >= previousStart && start < previousEnd;
      });
      if (overlap) mixed.push({ key, gt, segments: sorted });
    });
  });

  return mixed;
}

const MAX_MIXED = 12;
const MAX_RUNS = 24;
// Quanti orari di rientro mostrare per linea prima di riassumere.
const MAX_TIMES = 14;
const MAX_EXCERPTS = 3;

/** Il referto in testo semplice, fatto per essere fotografato o incollato. */
export function buildOrariReport({ developments = {}, pages = null } = {}) {
  const lines = ['ORARI · diagnostica'];

  if (pages?.length) {
    const summary = summarizePages(pages);
    lines.push(`pagine ${summary.total} · riconosciute ${summary.recognized} · ereditate ${summary.inherited}`);
    summary.runs.slice(0, MAX_RUNS).forEach((run) => {
      const range = run.from === run.to ? `p${run.from}` : `p${run.from}-${run.to}`;
      lines.push(`${range} "${run.gt}" [${run.service}] ric ${run.recognized}/${run.pages}`);
    });
    if (summary.runs.length > MAX_RUNS) lines.push(`… altre ${summary.runs.length - MAX_RUNS} tratte`);
    /* Dice che questa versione dell'app ha la correzione delle etichette dei
       turni e quante pagine ne hanno avuto bisogno: se la riga manca, il
       referto viene da una versione vecchia. */
    const realigned = pages.filter((page) => page.realigned).map((page) => page.page);
    lines.push(
      realigned.length
        ? `etichette dei turni riallineate su ${realigned.length} pagine (p${realigned.slice(0, 12).join(' p')}${realigned.length > 12 ? ' …' : ''})`
        : 'etichette dei turni riallineate: nessuna pagina',
    );
  } else {
    lines.push('pagine: non disponibili (ricarica il PDF Orari con la diagnostica attiva)');
  }

  lines.push('--');
  const byGt = summarizeByGt(developments);
  if (!byGt.length) lines.push('nessuno sviluppo caricato');
  byGt.forEach((item) => {
    lines.push(`"${item.gt}" [${item.service}] segm ${item.segments} · usc ${item.exits.rows} → ${item.exits.unique}`);
  });
  lines.push(`chiavi ${Object.keys(developments || {}).length}`);

  lines.push('--');
  const returns = summarizeReturns(developments);
  if (!returns.length) lines.push('rientri: nessuno (grafico di servizio non letto)');
  returns.forEach((item) => {
    lines.push(`${item.key} · ultime corse ${item.segments} · da ${item.places.join(' ') || '-'}`);
    /* Gli orari, non solo il conto. «La 63 rientrava e l'app non la dava» si
       risolve in un colpo solo guardando se quel rientro c'e' e a che ora: il
       conto da solo non lo dice, e senza il PDF in mano non c'e' altro modo di
       saperlo. */
    if (item.times.length) {
      const shown = item.times.slice(0, MAX_TIMES).join(' ');
      const rest = item.times.length > MAX_TIMES ? ` … +${item.times.length - MAX_TIMES}` : '';
      lines.push(`  ${shown}${rest}`);
    }
  });

  const exits = summarizeExits(developments);
  if (!exits.length) lines.push('uscite: nessuna (grafico di servizio non letto)');
  exits.forEach((item) => {
    lines.push(`${item.key} · trasferimenti ${item.segments} · verso ${item.places.join(' ') || '-'}`);
  });

  /* Il controllo che si legge per primo quando qualcosa non torna: ogni vettura
     che esce rientra, quindi due conti molto diversi sulla stessa pagina
     vogliono dire che una delle due meta' si sta perdendo. */
  const squilibri = compareReturnsAndExits(developments);
  lines.push('--');
  if (!squilibri.length) {
    lines.push('rientri e uscite: conti confrontabili su tutte le linee');
  } else {
    lines.push(`squilibrio rientri/uscite su ${squilibri.length}:`);
    squilibri.forEach((item) => {
      lines.push(`  ${item.name} · rientri ${item.returns} · uscite ${item.exits}`);
    });
  }

  const mixed = findMixedDevelopments(developments);
  lines.push('--');
  if (!mixed.length) {
    lines.push('sviluppi con tratti sovrapposti: nessuno');
  } else {
    lines.push(`sviluppi con tratti sovrapposti: ${mixed.length}`);
    mixed.slice(0, MAX_MIXED).forEach((item) => {
      const shown = item.segments
        .map((segment) => `${segment.start}-${segment.end} ${segment.loc_s}>${segment.loc_e} v${segment.vett || '?'} #${segment.run_id ?? '-'}`)
        .join(' | ');
      lines.push(`  ${item.key} "${item.gt}": ${shown}`);
    });
    if (mixed.length > MAX_MIXED) lines.push(`  … altri ${mixed.length - MAX_MIXED}`);
  }

  /* Le pagine che hanno i marcatori del grafico ma non ne hanno ricavato tutto.
     Sono le sole su cui si puo' intervenire, e il loro testo dice in che forma
     escono davvero le colonne: e' l'unico dato su cui correggere il parser
     senza avere il PDF sotto mano.

     Si mostrano anche quando altrove rientri e uscite si leggono. Il conto
     globale non basta: se su cento pagine le uscite si perdono in ottanta, il
     totale non e' zero e prima questo elenco restava muto proprio nel caso in
     cui serviva di piu'. */
  lines.push('--');
  if (!pages) {
    /* Senza i dati delle pagine non si sa se il PDF il grafico ce l'abbia:
       dirlo e' l'unica risposta onesta. Prima qui usciva "nessuna pagina col
       grafico", che e' un'affermazione sul PDF che il referto non puo' fare. */
    lines.push('pagine col grafico: non si sa (ricarica il PDF Orari con la diagnostica attiva)');
    return lines.join('\n');
  }

  const marked = pages.filter((page) => page.graphicMarkers?.length);
  const incomplete = pages.filter((page) => page.graphicExcerpt);

  if (!marked.length) {
    lines.push('nessuna pagina col grafico in questo PDF');
  } else if (!incomplete.length) {
    lines.push(`pagine col grafico ${marked.length}, tutte lette per intero`);
  } else {
    lines.push(`pagine col grafico ${marked.length}, incomplete ${incomplete.length}`);
    incomplete.slice(0, MAX_EXCERPTS).forEach((page) => {
      lines.push(
        `p${page.page} rientri ${page.returns ?? 0} uscite ${page.exits ?? 0} marcatori ${page.graphicMarkers.join(',')}`,
      );
      lines.push(`  ${page.graphicExcerpt}`);
    });
    if (incomplete.length > MAX_EXCERPTS) {
      lines.push(`… altre ${incomplete.length - MAX_EXCERPTS} pagine incomplete`);
    }
  }

  return lines.join('\n');
}
