/**
 * Article 14(8): telling USERS. A duty owed to them, not to an authority.
 *
 * It sits after the notification paragraphs and is easy to read past, but it is
 * a separate obligation with the same trigger:
 *
 *   "After becoming aware of an actively exploited vulnerability or a severe
 *    incident ... the manufacturer shall inform the impacted users ... and
 *    where appropriate all users, of that vulnerability or incident and, where
 *    necessary, of any risk mitigation and corrective measures that the users
 *    can deploy ... where appropriate in a structured, machine-readable format
 *    that is easily automatically processable."
 *
 * THREE THINGS THAT SHAPE THIS FILE.
 *
 * It fires on BOTH tracks. Filing with the CSIRT coordinator and ENISA does not
 * discharge it, and a tool that tracked only the filings would report a
 * manufacturer as done while a live duty to users remained open.
 *
 * "Machine-readable" is in the text, so two artifacts come out: prose a user
 * reads, and structured JSON a user's tooling can consume. The obvious target
 * is CSAF 2.0, which exists for exactly this. This is NOT CSAF and does not
 * claim to be: emitting something CSAF-shaped and calling it CSAF without
 * validating against the schema would be a false claim on a compliance
 * artifact. The envelope names CSAF as the migration target instead.
 *
 * THERE IS NO FIXED DEADLINE, and that is not the same as no urgency. The text
 * says "in a timely manner" and then gives the CSIRTs a power: where the
 * manufacturer fails, the notified CSIRTs "may provide such information to the
 * users". So the consequence of silence is that someone else tells your users
 * first. An un-issued advisory therefore AGES rather than expiring, and the
 * age is what gets surfaced.
 */

export type AdvisoryTrigger = 'vulnerability' | 'incident';

export interface AdvisoryFacts {
  trigger: AdvisoryTrigger;
  /** CVE, or an incident reference. */
  reference: string;
  product?: { name: string; version: string };
  /** When the manufacturer became aware. Timeliness is measured from here. */
  awareAt: string;
  /** What users can deploy. Article 14(8) asks for this "where necessary". */
  userMitigations?: string[];
  /** Versions known to be affected, where the record holds them. */
  affectedVersions?: string[];
  /** Set once the advisory has actually been published to users. */
  issuedAt?: string;
}

export interface AdvisoryField {
  ref: string;
  requirement: string;
  content: string | null;
  humanOnly?: boolean;
}

export type Timeliness =
  | { state: 'issued'; daysToIssue: number; message: string }
  | { state: 'outstanding'; daysOpen: number; message: string };

export interface UserAdvisory {
  trigger: AdvisoryTrigger;
  basis: string;
  instrument: string;
  reference: string;
  product?: { name: string; version: string };
  fields: AdvisoryField[];
  gaps: string[];
  complete: boolean;
  timeliness: Timeliness;
  notice: string;
}

const DAY = 86_400_000;

/**
 * Article 14(8) sets no deadline, so nothing here invents one. It reports how
 * long the duty has been open, and what the Regulation says happens on delay.
 */
export function timeliness(facts: AdvisoryFacts, now: Date): Timeliness {
  const aware = new Date(facts.awareAt).getTime();
  if (facts.issuedAt) {
    const days = Math.max(0, Math.round((new Date(facts.issuedAt).getTime() - aware) / DAY));
    return {
      state: 'issued',
      daysToIssue: days,
      message: `Advisory issued ${days} day(s) after becoming aware. Article 14(8) requires informing users in a timely manner and sets no fixed period; this is the record of what was done.`,
    };
  }
  const days = Math.max(0, Math.round((now.getTime() - aware) / DAY));
  return {
    state: 'outstanding',
    daysOpen: days,
    message:
      `Users have NOT been informed, ${days} day(s) after becoming aware. Article 14(8) sets no ` +
      'fixed period, so this is not "overdue" in the way a 24 hour clock is. It is also not ' +
      'discharged by filing with the CSIRT coordinator and ENISA, which is a different duty. ' +
      'Where a manufacturer fails to inform users in a timely manner, the notified CSIRTs may ' +
      'provide the information to users themselves.',
  };
}

export function buildUserAdvisory(facts: AdvisoryFacts, now: Date): UserAdvisory {
  const product = facts.product ? `${facts.product.name} ${facts.product.version}` : null;
  const what = facts.trigger === 'incident' ? 'incident' : 'vulnerability';

  const fields: AdvisoryField[] = [
    {
      ref: 'Article 14(8) — the vulnerability or incident',
      requirement: 'inform the impacted users ... of that vulnerability or incident',
      content: `${facts.reference} affecting ${product ?? 'the product'}.`,
    },
    {
      ref: 'Article 14(8) — impacted users',
      requirement: 'the impacted users of the product with digital elements, and where appropriate all users',
      content: facts.affectedVersions?.length
        ? `Users of version(s): ${facts.affectedVersions.join(', ')}.`
        : null,
      ...(facts.affectedVersions?.length ? {} : { humanOnly: true }),
    },
    {
      ref: 'Article 14(8) — user mitigations',
      requirement:
        'where necessary, of any risk mitigation and corrective measures that the users can deploy to mitigate the impact of that vulnerability or incident',
      content: facts.userMitigations?.length ? facts.userMitigations.map((m) => `- ${m}`).join('\n') : null,
      ...(facts.userMitigations?.length ? {} : { humanOnly: true }),
    },
  ];

  const gaps = fields.filter((f) => f.content === null).map((f) => f.ref);
  return {
    trigger: facts.trigger,
    basis: 'Article 14(8)',
    instrument: 'Regulation (EU) 2024/2847',
    reference: facts.reference,
    ...(facts.product ? { product: facts.product } : {}),
    fields,
    gaps,
    complete: gaps.length === 0,
    timeliness: timeliness(facts, now),
    notice:
      `This is a draft advisory about a ${what}, for the manufacturer to publish to users under ` +
      'Article 14(8). Publishing it is the manufacturer\'s act. Informing users is a SEPARATE ' +
      'duty from notifying the CSIRT coordinator and ENISA under Article 14(1) or 14(3); doing ' +
      'either one does not discharge the other.',
  };
}

/**
 * The machine-readable half the Regulation asks for.
 *
 * Deliberately not called CSAF. CSAF 2.0 is the right target and this is not
 * it; claiming conformance without validating against the schema would be a
 * false statement on a compliance artifact.
 */
export function advisoryEnvelope(a: UserAdvisory): Record<string, unknown> {
  return {
    schema: 'legalithm.cra.user-advisory/v0.1',
    note:
      'Article 14(8) asks for "a structured, machine-readable format that is easily ' +
      'automatically processable". This satisfies that literally. It is NOT CSAF 2.0, which is ' +
      'the obvious target and the intended migration; it is not called CSAF because it has not ' +
      'been validated against that schema.',
    instrument: a.instrument,
    basis: a.basis,
    trigger: a.trigger,
    reference: a.reference,
    product: a.product ?? null,
    fields: a.fields.map((f) => ({
      ref: f.ref,
      requirement: f.requirement,
      value: f.content,
      status: f.content === null ? 'gap' : 'drafted',
    })),
    gaps: a.gaps,
    complete: a.complete,
    timeliness: a.timeliness,
    published: false,
    notice: a.notice,
  };
}

export function renderAdvisoryMarkdown(a: UserAdvisory): string {
  const L: string[] = [];
  L.push(`# Security advisory: ${a.reference}`, '');
  if (a.product) L.push(`**Product:** ${a.product.name} ${a.product.version}`, '');
  L.push(`${a.instrument} ${a.basis}`, '');
  L.push(`**${a.gaps.length} of ${a.fields.length} items are gaps.**`, '');
  for (const f of a.fields) {
    L.push(`## ${f.ref.replace('Article 14(8) — ', '')}`, '');
    L.push(`> ${f.requirement}`, '');
    L.push(f.content ?? '**GAP — not held. A person must write this before this goes to users.**', '');
  }
  L.push('---', '', a.timeliness.message, '', a.notice);
  return `${L.join('\n')}\n`;
}
