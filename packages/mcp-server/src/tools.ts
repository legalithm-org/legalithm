// MCP tool implementations. classify/explain/disclosure are OFFLINE (bundle the
// pure engine + data); check-record is online (reads the public Trust Center).
import { classifyUseCase } from './lib/ai_act/engine';
import type { UseCase, ProviderRole, RiskLevel } from './lib/ai_act/types';
import { RULES_ENGINE_META } from './lib/ai_act/version';
import { buildCitation } from './lib/ai_act/citation';
import obligationsData from './obligations.json';
import { generateDisclosure, type DisclosureScenario } from './disclosures.js';

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

export function explainObligationTool(role: ProviderRole, risk: RiskLevel) {
  const items = (obligationsData.obligations as RawObligation[])
    .filter((o) => o.role === role && o.risk === risk)
    .map(obligationToItem);
  return withEngineMeta({ role, risk, count: items.length, items });
}

export function generateDisclosureTool(scenario: DisclosureScenario, locale: 'en' | 'de' = 'en') {
  return withEngineMeta({ ...generateDisclosure(scenario, locale) });
}

export async function checkRecordTool(slug: string, apiUrl: string) {
  try {
    const res = await fetch(`${apiUrl}/api/v1/compliance-records/${encodeURIComponent(slug)}`);
    if (res.status === 404) return withEngineMeta({ found: false, slug });
    if (!res.ok) return withEngineMeta({ found: false, slug, error: `API ${res.status}` });
    return withEngineMeta({ found: true, slug, record: await res.json() });
  } catch {
    return withEngineMeta({
      found: false,
      slug,
      error: 'Could not reach the Legalithm API.',
    });
  }
}
