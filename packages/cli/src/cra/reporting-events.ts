/**
 * The two CRA reporting events, and what each of their deliverables needs.
 *
 * ONLY TWO, deliberately. Article 14 creates exactly two duties — actively exploited
 * vulnerabilities under 14(1)/(2) and severe incidents under 14(3)/(4) — and a generic
 * StatutoryTimerEngine with an IncidentTypeRegistry would be abstraction bought with
 * imagination rather than with a second real regime.
 *
 * THE TWO FINAL REPORTS ARE NOT THE SAME CLOCK, and this is the detail a copy-paste of
 * the 14(2) table gets wrong:
 *
 *   14(2)(c)  no later than 14 days after a corrective or mitigating measure IS AVAILABLE
 *   14(4)(c)  within one month after the SUBMISSION of the 72-hour notification
 *
 * Neither is computable from awareness, but for different reasons: the first waits on a
 * remedy existing, the second on a filing having happened. Computing either from awareness
 * invents a deadline the Regulation does not impose, and a manufacturer told they are
 * overdue files prematurely or believes they are already in breach.
 */

export type CraEventType = 'exploited-vulnerability' | 'severe-incident';

export interface ReportingDeliverable {
  article: string;
  deliverable: string;
  /** Hours from awareness, where the Regulation measures from awareness. */
  hoursFromAwareness?: number;
  /** Why this one cannot be computed from awareness, in the Regulation's own terms. */
  notFromAwareness?: string;
  /**
   * What the Regulation names as required content. Used to compute known versus missing;
   * NOT a questionnaire engine — the list comes from the article text and nowhere else.
   */
  requiredInformation: readonly string[];
}

export interface CraEventDefinition {
  type: CraEventType;
  label: string;
  /** The duty, as against the paragraph that sets its timings. */
  dutyArticle: string;
  timingArticle: string;
  recipient: string;
  deliverables: readonly ReportingDeliverable[];
}

const RECIPIENT = 'the CSIRT designated as coordinator and ENISA';

export const CRA_EVENTS: Record<CraEventType, CraEventDefinition> = {
  'exploited-vulnerability': {
    type: 'exploited-vulnerability',
    label: 'Actively exploited vulnerability',
    dutyArticle: 'Article 14(1)',
    timingArticle: 'Article 14(2)',
    recipient: RECIPIENT,
    deliverables: [
      {
        article: '14(2)(a)',
        deliverable: 'Early warning of an actively exploited vulnerability',
        hoursFromAwareness: 24,
        requiredInformation: [
          'Member States where the product has been made available, where applicable',
        ],
      },
      {
        article: '14(2)(b)',
        deliverable: 'Vulnerability notification',
        hoursFromAwareness: 72,
        requiredInformation: [
          'General information about the product with digital elements concerned',
          'The general nature of the exploit and of the vulnerability',
          'Corrective or mitigating measures taken',
          'Corrective or mitigating measures users can take',
          'How sensitive the manufacturer considers the reported information to be',
        ],
      },
      {
        article: '14(2)(c)',
        deliverable: 'Final report',
        notFromAwareness:
          'no later than 14 days after a corrective or mitigating measure is AVAILABLE, so there is no due date until one exists',
        requiredInformation: [
          'A description of the vulnerability, including severity and impact',
          'Information about any malicious actor that has exploited it, where available',
          'The security update or other corrective measure made available',
        ],
      },
    ],
  },
  'severe-incident': {
    type: 'severe-incident',
    label: 'Severe incident affecting the security of the product',
    dutyArticle: 'Article 14(3)',
    timingArticle: 'Article 14(4)',
    recipient: RECIPIENT,
    deliverables: [
      {
        article: '14(4)(a)',
        deliverable: 'Early warning of a severe incident',
        hoursFromAwareness: 24,
        requiredInformation: [
          'Whether the incident is suspected of being caused by unlawful or malicious acts',
          'Member States where the product has been made available, where applicable',
        ],
      },
      {
        article: '14(4)(b)',
        deliverable: 'Incident notification',
        hoursFromAwareness: 72,
        requiredInformation: [
          'The nature of the incident',
          'An initial assessment of the incident',
          'Corrective or mitigating measures taken',
          'Corrective or mitigating measures users can take',
          'How sensitive the manufacturer considers the reported information to be',
        ],
      },
      {
        article: '14(4)(c)',
        deliverable: 'Final report',
        // NOT the 14(2)(c) trigger. This one starts when the 72-hour notification is filed.
        notFromAwareness:
          'within one month after the SUBMISSION of the incident notification under 14(4)(b), so there is no due date until that has been filed',
        requiredInformation: [
          'A detailed description of the incident, including severity and impact',
          'The type of threat or root cause likely to have triggered it',
          'Applied and ongoing mitigation measures',
        ],
      },
    ],
  },
};

export function isCraEventType(value: string): value is CraEventType {
  return value in CRA_EVENTS;
}

/** Deadline from awareness, or null where the Regulation measures from something else. */
export function dueAtFor(deliverable: ReportingDeliverable, becameAwareAt: Date): string | null {
  if (deliverable.hoursFromAwareness === undefined) return null;
  const due = new Date(becameAwareAt);
  due.setUTCHours(due.getUTCHours() + deliverable.hoursFromAwareness);
  return due.toISOString();
}

/**
 * Split what the Regulation asks for into what has been supplied and what has not.
 *
 * Deliberately dumb: a set difference over the article's own list. The moment this becomes
 * a scoring engine it starts making judgements about sufficiency, which is the customer's
 * to make.
 */
export function informationState(
  deliverable: ReportingDeliverable,
  supplied: readonly string[],
): { known: string[]; missing: string[] } {
  const have = new Set(supplied.map((s) => s.toLowerCase().trim()));
  const known = deliverable.requiredInformation.filter((r) => have.has(r.toLowerCase().trim()));
  const missing = deliverable.requiredInformation.filter((r) => !have.has(r.toLowerCase().trim()));
  return { known, missing };
}
