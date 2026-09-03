import {
  CRA_EVENTS,
  dueAtFor,
  informationState,
  isCraEventType,
  type CraEventType,
} from './reporting-events.js';

/**
 * `legalithm cra simulate` — run the real clock engine on a hypothetical.
 *
 * WHY THIS EXISTS AND WHY IT IS THE PRIMARY SURFACE before 11 September 2026. An incident
 * workflow has no users until somebody both adopts Legalithm AND has an actively exploited
 * vulnerability. Before the deadline its job is to let a manufacturer see the Tuesday-10:15
 * question answered — "we found out at 10:15, now what" — without waiting for a real one.
 *
 * IT WRITES NOTHING. No clocks stream, no evidence, no record. A simulation that leaves
 * artifacts behind would contaminate the append-only history the real workflow depends on,
 * and the first person to discover that would be someone reconciling a genuine incident.
 *
 * SAME ENGINE AS THE REAL PATH. The deadlines come from the same table and the same
 * awareness arithmetic as `cra watch`. A demo computed by a second implementation would
 * eventually show a number the product does not produce.
 */
export interface SimulateIo {
  log: (message: string) => void;
  error: (message: string) => void;
  now?: () => Date;
}

export interface SimulateOpts {
  scenario?: string;
  becameAwareAt?: string;
  becameAwareNow?: boolean;
  product?: string;
  owner?: string;
  /** Required information already in hand, for the known/missing split. */
  have?: string[];
  json?: boolean;
}

const fmt = (iso: string | null): string => (iso === null ? '—' : iso.replace('T', ' ').replace('.000Z', ' UTC'));

export function craSimulate(io: SimulateIo, opts: SimulateOpts): number {
  const scenario = opts.scenario ?? 'exploited-vulnerability';
  if (!isCraEventType(scenario)) {
    io.error(
      `Unknown scenario "${scenario}". Article 14 creates two reporting duties:\n` +
        '  exploited-vulnerability   Article 14(1)/(2)\n' +
        '  severe-incident           Article 14(3)/(4)',
    );
    return 1;
  }

  const now = (io.now ?? (() => new Date()))();

  // The awareness invariant holds in simulation too. Demoing a convenience the real command
  // refuses would teach the wrong habit to exactly the people about to use the real one.
  let awareness: Date;
  if (opts.becameAwareAt !== undefined) {
    const parsed = new Date(opts.becameAwareAt);
    if (Number.isNaN(parsed.getTime())) {
      io.error(`Could not read --became-aware-at "${opts.becameAwareAt}". Use an ISO timestamp.`);
      return 1;
    }
    awareness = parsed;
  } else if (opts.becameAwareNow) {
    awareness = now;
  } else {
    io.error(
      'A reporting clock runs from when you became aware.\n' +
        '  --became-aware-at <ISO timestamp>\n' +
        '  --became-aware-now',
    );
    return 1;
  }

  const event = CRA_EVENTS[scenario as CraEventType];
  const rows = event.deliverables.map((d) => {
    const { known, missing } = informationState(d, opts.have ?? []);
    return { deliverable: d, dueAt: dueAtFor(d, awareness), known, missing };
  });

  if (opts.json) {
    io.log(
      JSON.stringify(
        {
          simulation: true,
          scenario,
          product: opts.product ?? null,
          owner: opts.owner ?? null,
          dutyArticle: event.dutyArticle,
          timingArticle: event.timingArticle,
          recipient: event.recipient,
          becameAwareAt: awareness.toISOString(),
          recordedAt: now.toISOString(),
          deliverables: rows.map((r) => ({
            article: r.deliverable.article,
            deliverable: r.deliverable.deliverable,
            dueAt: r.dueAt,
            notFromAwareness: r.deliverable.notFromAwareness ?? null,
            known: r.known,
            missing: r.missing,
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  io.log(`SIMULATION — nothing has been reported and nothing was written to the record.`);
  io.log('');
  io.log(`  Scenario        ${event.label}`);
  io.log(`  Duty            ${event.dutyArticle}, timings ${event.timingArticle}`);
  io.log(`  Report to       ${event.recipient}`);
  if (opts.product) io.log(`  Product         ${opts.product}`);
  io.log(`  Owner           ${opts.owner ?? 'unassigned'}`);
  io.log('');
  io.log(`  Became aware    ${fmt(awareness.toISOString())}`);
  io.log(`  Recorded        ${fmt(now.toISOString())}`);
  io.log('');

  for (const r of rows) {
    io.log(`  ${r.deliverable.article}  ${r.deliverable.deliverable}`);
    if (r.dueAt) {
      const hoursLeft = (new Date(r.dueAt).getTime() - now.getTime()) / 3_600_000;
      const left =
        hoursLeft < 0
          ? `OVERDUE by ${Math.abs(hoursLeft).toFixed(1)}h`
          : `${hoursLeft.toFixed(1)}h remaining`;
      io.log(`      due ${fmt(r.dueAt)}   ${left}`);
    } else {
      io.log(`      no due date yet: ${r.deliverable.notFromAwareness}`);
    }
    if (r.known.length) io.log(`      have    ${r.known.length}/${r.deliverable.requiredInformation.length}`);
    for (const m of r.missing) io.log(`      missing ${m}`);
    io.log('');
  }

  io.log('  Legalithm calculates these deadlines and preserves a dated local record.');
  io.log('  It does NOT notify you, and it does not submit anything. Reports are filed');
  io.log('  once, by you, through the single reporting platform under Article 16.');
  return 0;
}
