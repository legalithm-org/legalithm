/**
 * Article 14 reporting: the document a person files, and the envelope a machine
 * will file once ENISA publishes a schema.
 *
 * WHY THIS EXISTS BEFORE THE SCHEMA DOES. Article 14 applies from 11 September
 * 2026 and the single reporting platform's format is not published. Waiting for
 * it would leave us absent on the one CRA obligation that is imminent rather
 * than 2027. The hard part under a 24 hour deadline is not the form, it is
 * having a dated record of what you knew; the form is data entry. So both come
 * out of one stored record: a rendering a human can transcribe today, and a
 * structured envelope that turns the eventual SRP integration into a mapping
 * exercise rather than a rebuild.
 *
 * THIS IS NOT A SUBMISSION AND MUST NEVER READ AS ONE. Article 14(1) obliges
 * the MANUFACTURER to notify, via the platform in Article 16. A tool that
 * blurred that would be selling liability, which the research called the
 * defining failure of this market.
 *
 * TWO TRACKS, AND THEY ARE NOT THE SAME SHAPE.
 *
 *   vulnerability  Article 14(1)-(2), an actively exploited vulnerability
 *   incident       Article 14(3)-(4), a severe incident affecting the product's
 *                  security, "severe" being defined in 14(5)
 *
 * Both open with 24h and 72h notifications, which invites the assumption that
 * the rest matches. It does not, and the difference is the final report:
 *
 *   14(2)(c)  no later than 14 days after a corrective or mitigating measure
 *             IS AVAILABLE
 *   14(4)(c)  within ONE MONTH after the submission of the incident
 *             notification under point (b)
 *
 * One is anchored to a remedy that may never arrive, the other to a filing the
 * manufacturer already made. Building the second by analogy with the first
 * would have produced a deadline the Regulation does not impose, which is
 * exactly the bug fixed in the vulnerability track a commit earlier.
 */

export type ReportTrack = 'vulnerability' | 'incident';
export type ReportStage = 'early-warning' | 'vulnerability' | 'final';

export interface ReportField {
  ref: string;
  /** Verbatim from the Official Journal. */
  requirement: string;
  content: string | null;
  /** Where the content came from, when it came from the record. */
  source?: string;
  /** Set when only a person can supply this. */
  humanOnly?: boolean;
}

export interface Article14Report {
  stage: ReportStage;
  article: string;
  instrument: string;
  cve: string;
  product?: { name: string; version: string };
  /** ISO, or null when the Regulation does not start the clock yet. */
  dueAt: string | null;
  dueRule: string;
  fields: ReportField[];
  gaps: string[];
  complete: boolean;
  notice: string;
}

export interface ReportFacts {
  /** Which of Article 14's two duties this is. Defaults to the vulnerability track. */
  track?: ReportTrack;
  /** The CVE, or an incident reference on the incident track. */
  cve: string;
  product?: { name: string; version: string };
  /** When the manufacturer became aware. Starts the 24h and 72h clocks. */
  awareAt: string;
  /** Set only when a corrective or mitigating measure exists. Starts 14(2)(c). */
  remedyAvailableAt?: string;
  /**
   * When the 72h incident notification under 14(4)(b) was SUBMITTED. This, not
   * a remedy and not awareness, starts the one-month clock in 14(4)(c).
   */
  incidentNotificationSubmittedAt?: string;
  /** 14(4)(a) requires this in the 24h early warning on the incident track. */
  suspectedUnlawfulOrMalicious?: boolean;
  /** Free-text from the exploitation source, e.g. the KEV entry's own wording. */
  exploitationNote?: string;
  inKev: boolean;
  /** Member States where the product is known to be made available. */
  memberStates?: string[];
}

/** The duty is in 14(1) for a vulnerability and 14(3) for a severe incident. */
const notice = (track: ReportTrack) =>
  `THIS IS NOT A SUBMISSION. Article 14(${track === 'incident' ? '3' : '1'}) obliges the manufacturer ` +
  'to notify the CSIRT designated as coordinator and ENISA via the single reporting platform ' +
  "established under Article 16. Filing is the manufacturer's act. This document is a working " +
  'draft assembled from the evidence record; items marked GAP are not held and must be written ' +
  'by a person.';

/**
 * 24h and 72h run from awareness on BOTH tracks. The final report does not.
 *
 *   14(2)(c)  14 days after a corrective or mitigating measure is available
 *   14(4)(c)  one month after the 14(4)(b) incident notification was submitted
 */
export function dueFor(stage: ReportStage, facts: ReportFacts): { dueAt: string | null; rule: string } {
  const track: ReportTrack = facts.track ?? 'vulnerability';
  const aware = new Date(facts.awareAt);

  if (stage === 'early-warning') {
    const d = new Date(aware);
    d.setUTCHours(d.getUTCHours() + 24);
    return {
      dueAt: d.toISOString(),
      rule: `within 24 hours of the manufacturer becoming aware (Article 14(${track === 'incident' ? '4' : '2'})(a))`,
    };
  }
  if (stage === 'vulnerability') {
    const d = new Date(aware);
    d.setUTCHours(d.getUTCHours() + 72);
    return {
      dueAt: d.toISOString(),
      rule: `within 72 hours of the manufacturer becoming aware (Article 14(${track === 'incident' ? '4' : '2'})(b))`,
    };
  }

  if (track === 'incident') {
    /*
     * "within one month after the submission of the incident notification
     * under point (b)". Anchored to a filing the manufacturer already made,
     * not to awareness and not to a remedy. Until that notification is
     * submitted there is no date, and inventing one from awareness would
     * repeat the mistake this track was written to avoid.
     */
    if (!facts.incidentNotificationSubmittedAt) {
      return {
        dueAt: null,
        rule:
          'within one month after the submission of the incident notification under Article 14(4)(b). ' +
          'That notification is not recorded as submitted, so the clock has not started. ' +
          'The 24h and 72h duties are unaffected.',
      };
    }
    const d = new Date(facts.incidentNotificationSubmittedAt);
    d.setUTCMonth(d.getUTCMonth() + 1);
    return {
      dueAt: d.toISOString(),
      rule: `one month from the incident notification submitted on ${facts.incidentNotificationSubmittedAt} (Article 14(4)(c))`,
    };
  }

  /*
   * "no later than 14 days after a corrective or mitigating measure is
   * available". The clock does NOT run from awareness, and computing it that
   * way invents a deadline the Regulation does not impose: a fix that took
   * thirty days would be reported overdue on day fourteen, pushing a
   * manufacturer to file prematurely or to believe they were in breach.
   */
  if (!facts.remedyAvailableAt) {
    return {
      dueAt: null,
      rule:
        'no later than 14 days after a corrective or mitigating measure is available ' +
        '(Article 14(2)(c)). No remedy is recorded, so the clock has not started. ' +
        'That is not an extension: the 24h and 72h duties are unaffected.',
    };
  }
  const d = new Date(facts.remedyAvailableAt);
  d.setUTCDate(d.getUTCDate() + 14);
  return {
    dueAt: d.toISOString(),
    rule: `14 days from the corrective or mitigating measure becoming available on ${facts.remedyAvailableAt} (Article 14(2)(c))`,
  };
}

const HUMAN = (ref: string, requirement: string): ReportField => ({
  ref,
  requirement,
  content: null,
  humanOnly: true,
});


/**
 * Article 14(5): when an incident counts as SEVERE, verbatim.
 *
 * The duty in 14(3) only bites for a severe incident, so this is the gate, and
 * it is deliberately a two-limb OR with "or is capable of" in both limbs. An
 * incident that could have done these things qualifies even if it did not.
 * Encoding it as a checklist a person answers keeps the judgement with the
 * person while making the test itself impossible to misremember.
 */
export const SEVERITY_LIMBS = [
  {
    ref: 'Article 14(5)(a)',
    text:
      'it negatively affects or is capable of negatively affecting the ability of a product with digital elements to protect the availability, authenticity, integrity or confidentiality of sensitive or important data or functions',
  },
  {
    ref: 'Article 14(5)(b)',
    text:
      'it has led or is capable of leading to the introduction or execution of malicious code in a product with digital elements or in the network and information systems of a user of the product with digital elements',
  },
] as const;

function incidentFields(stage: ReportStage, f: ReportFacts): ReportField[] {
  const product = f.product ? `${f.product.name} ${f.product.version}` : null;

  if (stage === 'early-warning') {
    return [
      {
        ref: 'Article 14(4)(a) — incident',
        requirement:
          'an early warning notification of a severe incident having an impact on the security of the product with digital elements, without undue delay and in any event within 24 hours of the manufacturer becoming aware of it',
        content: f.cve,
        source: 'cra report --incident',
      },
      {
        ref: 'Article 14(4)(a) — product',
        requirement: 'the product with digital elements concerned',
        content: product,
        source: product ? 'cra product' : undefined,
      },
      {
        // Required in the 24h notification and easy to miss: it has no
        // counterpart on the vulnerability track.
        ref: 'Article 14(4)(a) — unlawful or malicious',
        requirement:
          'including at least whether the incident is suspected of being caused by unlawful or malicious acts',
        content:
          f.suspectedUnlawfulOrMalicious === undefined
            ? null
            : f.suspectedUnlawfulOrMalicious
              ? 'Suspected of being caused by unlawful or malicious acts.'
              : 'Not suspected of being caused by unlawful or malicious acts.',
        ...(f.suspectedUnlawfulOrMalicious === undefined
          ? { humanOnly: true }
          : { source: 'cra report --suspected-malicious / --not-suspected-malicious' }),
      },
      {
        ref: 'Article 14(4)(a) — Member States',
        requirement:
          'which shall also indicate, where applicable, the Member States on the territory of which the manufacturer is aware that their product with digital elements has been made available',
        content: f.memberStates?.length ? f.memberStates.join(', ') : null,
        ...(f.memberStates?.length ? { source: 'cra report --member-states' } : { humanOnly: true }),
      },
    ];
  }

  if (stage === 'vulnerability') {
    return [
      {
        ref: 'Article 14(4)(b) — nature',
        requirement: 'general information, where available, about the nature of the incident',
        content: null,
        humanOnly: true,
      },
      HUMAN('Article 14(4)(b) — initial assessment', 'an initial assessment of the incident'),
      HUMAN('Article 14(4)(b) — measures taken', 'any corrective or mitigating measures taken'),
      HUMAN('Article 14(4)(b) — user measures', 'corrective or mitigating measures that users can take'),
      HUMAN(
        'Article 14(4)(b) — sensitivity',
        'which shall also indicate, where applicable, how sensitive the manufacturer considers the notified information to be',
      ),
    ];
  }

  return [
    HUMAN('Article 14(4)(c)(i)', 'a detailed description of the incident, including its severity and impact'),
    HUMAN('Article 14(4)(c)(ii)', 'the type of threat or root cause that is likely to have triggered the incident'),
    HUMAN('Article 14(4)(c)(iii)', 'applied and ongoing mitigation measures'),
  ];
}

function fieldsFor(stage: ReportStage, f: ReportFacts): ReportField[] {
  if ((f.track ?? 'vulnerability') === 'incident') return incidentFields(stage, f);

  const product = f.product ? `${f.product.name} ${f.product.version}` : null;

  if (stage === 'early-warning') {
    return [
      {
        ref: 'Article 14(2)(a) — vulnerability',
        requirement:
          'an early warning notification of an actively exploited vulnerability, without undue delay and in any event within 24 hours of the manufacturer becoming aware of it',
        content: `${f.cve}${f.inKev ? ', listed in the CISA Known Exploited Vulnerabilities catalogue' : ''}.`,
        source: 'cra watch',
      },
      {
        ref: 'Article 14(2)(a) — product',
        requirement: 'the product with digital elements concerned',
        content: product,
        source: product ? 'cra product' : undefined,
      },
      {
        ref: 'Article 14(2)(a) — Member States',
        requirement:
          'indicating, where applicable, the Member States on the territory of which the manufacturer is aware that their product with digital elements has been made available',
        content: f.memberStates?.length ? f.memberStates.join(', ') : null,
        ...(f.memberStates?.length ? { source: 'cra report --member-states' } : { humanOnly: true }),
      },
    ];
  }

  if (stage === 'vulnerability') {
    return [
      {
        ref: 'Article 14(2)(b) — product',
        requirement: 'general information, as available, about the product with digital elements concerned',
        content: product,
        source: product ? 'cra product' : undefined,
      },
      {
        ref: 'Article 14(2)(b) — nature',
        requirement: 'the general nature of the exploit and of the vulnerability concerned',
        // The catalogue's own wording is a starting point, never the answer:
        // it describes the shipping product, not this manufacturer's exposure.
        content: f.exploitationNote
          ? `Reported by the exploitation source as: "${f.exploitationNote}". This describes the vulnerability as catalogued and is NOT an assessment of this product's exposure, which must be written.`
          : null,
        ...(f.exploitationNote ? { source: 'CISA KEV' } : { humanOnly: true }),
      },
      HUMAN(
        'Article 14(2)(b) — measures taken',
        'any corrective or mitigating measures taken',
      ),
      HUMAN(
        'Article 14(2)(b) — user measures',
        'corrective or mitigating measures that users can take',
      ),
      HUMAN(
        'Article 14(2)(b) — sensitivity',
        'which shall also indicate, where applicable, how sensitive the manufacturer considers the notified information to be',
      ),
    ];
  }

  return [
    HUMAN(
      'Article 14(2)(c)(i)',
      'a description of the vulnerability, including its severity and impact',
    ),
    {
      ref: 'Article 14(2)(c)(ii)',
      requirement:
        'where available, information concerning any malicious actor that has exploited or that is exploiting the vulnerability',
      content: f.inKev
        ? 'Listed in the CISA Known Exploited Vulnerabilities catalogue, which evidences exploitation in the wild but does not attribute an actor. Attribution, if any is held, must be written.'
        : null,
      ...(f.inKev ? { source: 'CISA KEV' } : { humanOnly: true }),
    },
    HUMAN(
      'Article 14(2)(c)(iii)',
      'details about the security update or other corrective measures that have been made available to remedy the vulnerability',
    ),
  ];
}

export function buildArticle14Report(stage: ReportStage, facts: ReportFacts): Article14Report {
  const fields = fieldsFor(stage, facts);
  const { dueAt, rule } = dueFor(stage, facts);
  const gaps = fields.filter((x) => x.content === null).map((x) => x.ref);
  return {
    stage,
    article: `Article 14(${(facts.track ?? 'vulnerability') === 'incident' ? '4' : '2'})(${
      stage === 'early-warning' ? 'a' : stage === 'vulnerability' ? 'b' : 'c'
    })`,
    instrument: 'Regulation (EU) 2024/2847',
    cve: facts.cve,
    ...(facts.product ? { product: facts.product } : {}),
    dueAt,
    dueRule: rule,
    fields,
    gaps,
    complete: gaps.length === 0,
    notice: notice(facts.track ?? 'vulnerability'),
  };
}

/** The envelope. Shaped to map onto the SRP schema when ENISA publishes one. */
export function reportEnvelope(report: Article14Report): Record<string, unknown> {
  return {
    schema: 'legalithm.cra.article14/v0.1',
    note:
      'Structured for mapping onto the ENISA single reporting platform format under Article 16, ' +
      'which is not published as of this writing. Field names here are OUR names and will need ' +
      'mapping; the article references are the stable part.',
    instrument: report.instrument,
    article: report.article,
    stage: report.stage,
    cve: report.cve,
    product: report.product ?? null,
    dueAt: report.dueAt,
    dueRule: report.dueRule,
    fields: report.fields.map((f) => ({
      ref: f.ref,
      requirement: f.requirement,
      value: f.content,
      status: f.content === null ? 'gap' : 'drafted',
    })),
    gaps: report.gaps,
    complete: report.complete,
    submitted: false,
    notice: report.notice,
  };
}

export function renderArticle14Markdown(r: Article14Report): string {
  const L: string[] = [];
  const incident = r.article.includes('14(4)');
  const title =
    r.stage === 'early-warning'
      ? 'Early warning notification'
      : r.stage === 'vulnerability'
        ? // 14(2)(b) calls it a vulnerability notification; 14(4)(b) calls it an
          // incident notification. Same slot, different instrument, and using
          // the wrong name on a filing is a small but real error.
          incident
          ? 'Incident notification'
          : 'Vulnerability notification'
        : 'Final report';
  L.push(`# ${title}`, '');
  L.push(`${r.instrument} ${r.article}`, '');
  L.push(`Vulnerability: ${r.cve}`);
  if (r.product) L.push(`Product: ${r.product.name} ${r.product.version}`);
  L.push(`Due: ${r.dueAt ?? 'not started'}`);
  L.push(`Rule: ${r.dueRule}`, '');
  L.push(`**${r.gaps.length} of ${r.fields.length} items are gaps.**`, '');
  for (const f of r.fields) {
    L.push(`## ${f.ref}`, '');
    L.push(`> ${f.requirement}`, '');
    L.push(f.content ?? '**GAP — not held. A person must write this.**', '');
    if (f.source) L.push(`_source: ${f.source}_`, '');
  }
  L.push('---', '', r.notice);
  return `${L.join('\n')}\n`;
}
