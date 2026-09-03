/**
 * The support period register: feature 11.
 *
 * Article 13(8) is more subtle than "five years", which is how it is usually
 * repeated and how this CLI first shipped it. The Regulation says:
 *
 *   "the support period shall be at least five years. Where the product with
 *    digital elements is expected to be in use for less than five years, the
 *    support period shall correspond to the expected use time."
 *
 * So five years is a floor with a genuine exception, and a tool that enforces
 * it flatly would be wrong for short-lived products and would push a
 * manufacturer into a longer commitment than the law asks for.
 *
 * The same paragraph requires the period to REFLECT expected time in use,
 * taking account of reasonable user expectations, the nature and intended
 * purpose of the product, and relevant Union law. That reasoning is not
 * decoration: Article 13(8) requires the information used to determine it to be
 * in the technical documentation, which is Annex VII (4). So a date without a
 * rationale is an incomplete record, and this refuses to store one.
 */
export const SUPPORT_FLOOR_YEARS = 5;

export interface SupportPeriod {
  /** ISO date the support period ends. */
  until: string;
  /** ISO date the product was placed on the market. */
  placedOn?: string;
  declaredBy: string;
  /** Article 13(8): what was taken into account. Goes into Annex VII (4). */
  rationale: string;
  /** Set when the period is under five years by design. */
  expectedUseShorter?: boolean;
}

export type SupportVerdict =
  | 'ok'
  | 'below_floor_unjustified'
  | 'below_floor_justified'
  | 'expiring_soon'
  | 'expired'
  | 'not_set';

export interface SupportStatus {
  verdict: SupportVerdict;
  message: string;
  basis: string;
  until?: string;
  daysRemaining?: number;
  years?: number;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function yearsBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  return daysBetween(from, to) / 365.2425;
}

/** How close to expiry counts as worth warning about. */
export const EXPIRY_WARNING_DAYS = 180;

export function supportStatus(period: SupportPeriod | null, now: Date): SupportStatus {
  if (!period) {
    return {
      verdict: 'not_set',
      message:
        'No support period recorded. Article 13(8) requires one, and Annex II (7) requires its end date to be given to the user.',
      basis: 'Article 13(8)',
    };
  }

  const remaining = daysBetween(now, new Date(period.until));
  const span = period.placedOn ? yearsBetween(period.placedOn, period.until) : undefined;

  if (remaining < 0) {
    return {
      verdict: 'expired',
      message: `Support period ended ${period.until}, ${Math.abs(remaining)} days ago. Vulnerability handling duties under Annex I Part II ran for the support period; ending it does not erase the 10-year documentation retention.`,
      basis: 'Article 13(8)',
      until: period.until,
      daysRemaining: remaining,
      ...(span !== undefined ? { years: span } : {}),
    };
  }

  if (span !== undefined && span < SUPPORT_FLOOR_YEARS && !period.expectedUseShorter) {
    return {
      verdict: 'below_floor_unjustified',
      message: `Support period is ${span.toFixed(1)} years, under the five-year floor. That is lawful ONLY where the product is expected to be in use for less than five years, and nothing recorded says it is.`,
      basis: 'Article 13(8)',
      until: period.until,
      daysRemaining: remaining,
      years: span,
    };
  }

  if (span !== undefined && span < SUPPORT_FLOOR_YEARS) {
    return {
      verdict: 'below_floor_justified',
      message: `Support period is ${span.toFixed(1)} years, under the floor but recorded as matching a shorter expected use time, which Article 13(8) permits. The reasoning belongs in the technical documentation at Annex VII (4).`,
      basis: 'Article 13(8)',
      until: period.until,
      daysRemaining: remaining,
      years: span,
    };
  }

  if (remaining <= EXPIRY_WARNING_DAYS) {
    return {
      verdict: 'expiring_soon',
      message: `Support period ends in ${remaining} days (${period.until}). Users were told this date under Annex II (7); changing it now is a change to what they were promised.`,
      basis: 'Annex II (7)',
      until: period.until,
      daysRemaining: remaining,
      ...(span !== undefined ? { years: span } : {}),
    };
  }

  return {
    verdict: 'ok',
    message: `Support period runs to ${period.until}, ${remaining} days away${span !== undefined ? `, spanning ${span.toFixed(1)} years` : ''}.`,
    basis: 'Article 13(8)',
    until: period.until,
    daysRemaining: remaining,
    ...(span !== undefined ? { years: span } : {}),
  };
}

/** Exit codes: 0 fine, 2 a problem now, 3 needs attention. */
export function supportExitCode(status: SupportStatus): number {
  switch (status.verdict) {
    case 'expired':
    case 'below_floor_unjustified':
      return 2;
    case 'not_set':
    case 'expiring_soon':
      return 3;
    default:
      return 0;
  }
}
