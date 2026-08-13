// MCP tool implementations. classify/explain/disclosure are OFFLINE (bundle the
// pure engine + data); check-record is online (reads the public Trust Center).
import { classifyUseCase } from './lib/ai_act/engine';
import type { UseCase, ProviderRole, RiskLevel } from './lib/ai_act/types';
import { RULES_ENGINE_META } from './lib/ai_act/version';
import { buildCitation } from './lib/ai_act/citation';
import {
  getCompetentAuthorities,
  getNationalImplementation,
  getSupportBodies,
  type CompetentAuthority,
  type DeployerSector,
} from './lib/ai_act/enforcement-dates';
import obligationsData from './obligations.json';
import { generateDisclosure, type DisclosureScenario } from './disclosures.js';
import {
  generateAgentDisclosure,
  formatAgentDisclosureText,
  type AgentProfileInput,
} from './lib/ai_act/agent-disclosure-kit';
import {
  getAgentDisclosureMeta,
  getPositiveDimensions,
  getNegativeScope,
} from './lib/ai_act/agent-disclosure';

/** Single disclaimer — extended with the corpus as-of date and engine version. */
export const DISCLAIMER = `Checked against Regulation (EU) 2024/1689 as of ${RULES_ENGINE_META.updatedAt} (engine ${RULES_ENGINE_META.version}) — not legal advice.`;

function withEngineMeta<T extends Record<string, unknown>>(payload: T) {
  return {
    ...payload,
    asOf: RULES_ENGINE_META.updatedAt,
    engineVersion: RULES_ENGINE_META.version,
    disclaimer: DISCLAIMER,
  };
}

export function classifyTool(input: UseCase) {
  return withEngineMeta({ ...classifyUseCase(input) });
}

export interface RawObligation {
  id: string;
  role: string;
  risk: string;
  article: string;
  annex?: string;
  title: string;
  description: string;
  evidence_type: string;
  reference_url: string;
  priority?: string;
  guidance?: string;
}

/** Map a raw obligation to a cited checklist item (priority/how_to_prove have defensive defaults). */
export function obligationToItem(o: RawObligation) {
  return {
    id: o.id,
    title: o.title,
    description: o.description,
    priority: o.priority ?? 'medium',
    how_to_prove: o.guidance ?? `Provide ${o.evidence_type} evidence demonstrating compliance with ${o.article}.`,
    citation: buildCitation({
      article: o.article,
      annex: o.annex,
      url: o.reference_url,
      label: o.title,
    }),
  };
}

/**
 * Optional jurisdiction narrowing for `explain_obligation`.
 *
 * The obligations themselves are EU-wide and identical everywhere. Only the
 * authority you answer to is national, and within a state it is sectoral, so
 * this is a separate input that changes one block of the answer and nothing
 * else.
 */
export interface JurisdictionInput {
  country?: string;
  sector?: DeployerSector;
}

/**
 * The "who enforces this" block, or undefined when the caller did not ask.
 *
 * AN UNMAPPED STATE RETURNS AN EXPLICIT `mapped: false`, NEVER SILENCE.
 *
 * Omitting the block for France and omitting it for a caller who never asked
 * would be the same response to two opposite situations, and an agent reading
 * it could reasonably conclude no authority exists there. What is true is that
 * Legalithm has not mapped France — a fact about this corpus, not about French
 * law — and the response has to say which of those it means.
 */
function enforcementBlock(j: JurisdictionInput | undefined) {
  if (!j?.country) return undefined;

  const country = j.country.toUpperCase();
  const sector = j.sector ?? 'general';
  const national = getNationalImplementation(country);

  if (!national) {
    return {
      country,
      sector,
      mapped: false as const,
      note:
        `Legalithm has not yet mapped the competent authority for ${country}. `
        + 'This means no primary source has been recorded for that member state, '
        + 'NOT that no authority is competent there. The obligations above still apply.',
    };
  }

  const describe = (a: CompetentAuthority) => ({
    name: a.name,
    shortName: a.shortName,
    appliesWhen: a.appliesWhen,
    confidence: a.confidence,
    source: a.sourceUrl,
    sourceQuote: a.sourceQuote,
  });

  return {
    country,
    sector,
    mapped: true as const,
    nationalLaw: {
      title: national.law,
      shortName: national.shortName,
      inForce: national.inForce,
      source: national.sourceUrl,
    },
    // Who a deployer in this sector actually reports to.
    competentAuthorities: getCompetentAuthorities(country, sector).map(describe),
    // Support and coordination only. Listed separately so a caller cannot read
    // it as a second place to file the same notification.
    supportBodies: getSupportBodies(country).map(describe),
  };
}

export function explainObligationTool(
  role: ProviderRole,
  risk: RiskLevel,
  jurisdiction?: JurisdictionInput,
) {
  const items = (obligationsData.obligations as RawObligation[])
    .filter((o) => o.role === role && o.risk === risk)
    .map(obligationToItem);
  const enforcement = enforcementBlock(jurisdiction);
  return withEngineMeta({
    role,
    risk,
    count: items.length,
    items,
    // Absent when the caller did not ask. Present with `mapped: false` when they
    // asked about a state we have no source for — those are different answers.
    ...(enforcement ? { enforcement } : {}),
  });
}

export function generateDisclosureTool(scenario: DisclosureScenario, locale: 'en' | 'de' = 'en') {
  return withEngineMeta({ ...generateDisclosure(scenario, locale) });
}

/**
 * Agent Disclosure Kit — Commission Article 50 Guidelines, adopted 20 Jul 2026.
 *
 * Returns ok:false with the missing field names when the principal or the
 * authority scope is undeclared, and never invents either. Para 31 requires the
 * agent to disclose both its artificial nature AND the person on whose behalf it
 * acts, so a disclosure naming a principal the caller never supplied would be
 * worse than none: it would look compliant while being false.
 */
export function generateAgentDisclosureTool(profile: AgentProfileInput) {
  const result = generateAgentDisclosure(profile);
  if (!result.ok) {
    return withEngineMeta({
      ok: false as const,
      reason: result.reason,
      missingFields: result.draft.missingFields,
      guidance:
        'Article 50(1) requires the agent to disclose who it acts for. Ask the user for these fields and call again — they cannot be inferred.',
      draft: result.draft,
      text: formatAgentDisclosureText(result),
    });
  }
  return withEngineMeta({
    ok: true as const,
    ...result.artifact,
    text: formatAgentDisclosureText(result),
  });
}

/** The taxonomy itself: what must be disclosed, and what is explicitly out of scope. */
export function agentDisclosureTaxonomyTool() {
  return withEngineMeta({
    meta: getAgentDisclosureMeta(),
    positiveDimensions: getPositiveDimensions(),
    negativeScope: getNegativeScope(),
  });
}

/**
 * Declared rather than inferred. Each branch below returns a different shape,
 * so the inferred type was a union and reading `.error` off it failed under the
 * package tsconfig — which is stricter than the root one, so `npm run typecheck`
 * stayed green while `npm run test:packages` failed on all three OSes.
 */
export interface CheckRecordResult {
  found: boolean;
  slug: string;
  /** Present when the lookup failed for a reason worth showing the caller. */
  error?: string;
  /** Present only when found. */
  record?: unknown;
}

export async function checkRecordTool(
  slug: string,
  apiUrl: string,
): Promise<CheckRecordResult & { asOf: string; engineVersion: string; disclaimer: string }> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/compliance-records/${encodeURIComponent(slug)}`);
    // A 404 is a real answer, not an error: the org has published no record.
    if (res.status === 404) return withEngineMeta({ found: false, slug });
    if (!res.ok) {
      return withEngineMeta({ found: false, slug, error: `API ${res.status}` });
    }
    return withEngineMeta({ found: true, slug, record: await res.json() });
  } catch {
    return withEngineMeta({
      found: false,
      slug,
      error: 'Could not reach the Legalithm API.',
    });
  }
}
