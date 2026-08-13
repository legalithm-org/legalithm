/**
 * T6.5: Agent Disclosure Kit. Taxonomy-driven disclosure copy and template
 * generation from AgentProfile fields. Refuses final artifacts when principal
 * identity or authority scope is undeclared.
 */

import {
  getAgentDisclosureMeta,
  getPositiveDimensions,
  type PositiveDimension,
} from './agent-disclosure';

export const UNDECLARED = 'not yet declared' as const;

/** Minimal AgentProfile shape for kit generation (matches Prisma / CLI stub). */
export interface AgentProfileInput {
  principalName: string | null;
  principalType: string | null;
  authorityScope: string | null;
  autonomyLevel: string | null;
  composition: unknown | null;
}

export interface AgentDisclosureTrigger {
  id: string;
  label: string;
  when: string;
}

export interface AgentDisclosureDraft {
  artificialNatureNotice: string;
  principalStatement: string;
  authorityScopeStatement: string;
  redisclosureTriggers: AgentDisclosureTrigger[];
  architectureFallback: string;
  multiAgentNote: string | null;
  missingFields: string[];
  counselNotice: string;
}

export interface AgentDisclosureArtifact extends AgentDisclosureDraft {
  /** ISO date from corpus meta.updatedAt */
  corpusVersion: string;
  guidelinesAdopted: string;
  regulation: string;
  generatedAt: string;
}

export type AgentDisclosureResult =
  | { ok: true; artifact: AgentDisclosureArtifact }
  | { ok: false; reason: 'undeclared_fields'; draft: AgentDisclosureDraft };

const REDISCLOSURE_STEPS = [
  { id: 'authorisation', when: 'at authorisation' },
  { id: 'reporting', when: 'at reporting' },
  { id: 'validation', when: 'at validation' },
  { id: 'new_interaction', when: 'at every new interaction' },
] as const;

function displayField(value: string | null): string {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : UNDECLARED;
}

function missingPrincipalFields(profile: AgentProfileInput): string[] {
  const missing: string[] = [];
  if (!(profile.principalName ?? '').trim()) missing.push('principalName');
  if (!(profile.authorityScope ?? '').trim()) missing.push('authorityScope');
  return missing;
}

function multiAgentNote(profile: AgentProfileInput): string | null {
  if (profile.composition == null) return null;
  const dim = getPositiveDimensions().find((d) => d.id === 'multi_agent_composition');
  return dim?.description.en ?? null;
}

function buildDraft(profile: AgentProfileInput): AgentDisclosureDraft {
  const missing = missingPrincipalFields(profile);
  const principalDisplay = displayField(profile.principalName);
  const authorityDisplay = displayField(profile.authorityScope);
  const principalTypeDisplay = displayField(profile.principalType);

  const artificialDim = getPositiveDimensions().find((d) => d.id === 'artificial_nature');
  const archDim = getPositiveDimensions().find((d) => d.id === 'architecture_level_disclosure');

  const redisclosureTriggers: AgentDisclosureTrigger[] = REDISCLOSURE_STEPS.map((step) => {
    const dim = getPositiveDimensions().find((d) => d.id === 'redisclosure_triggers');
    return {
      id: step.id,
      label: dim?.label.en ?? 'Re-disclosure',
      when: step.when,
    };
  });

  return {
    artificialNatureNotice:
      artificialDim?.description.en ??
      'You are interacting with an AI agent. Responses and actions are generated automatically.',
    principalStatement: `This agent acts on behalf of ${principalDisplay}${
      principalTypeDisplay !== UNDECLARED ? ` (${principalTypeDisplay})` : ''
    }.`,
    authorityScopeStatement: `Delegated authority: ${authorityDisplay}.`,
    redisclosureTriggers,
    architectureFallback:
      archDim?.description.en ??
      'Where interaction with a natural person is reasonably likely, disclose at architecture level.',
    multiAgentNote: multiAgentNote(profile),
    missingFields: missing,
    counselNotice:
      'This disclosure template is generated from Legalithm rules corpus data and has not been reviewed by counsel.',
  };
}

/**
 * Generate agent disclosure artifact. Returns refusal when principalName or
 * authorityScope is null/empty; never fabricates a principal.
 */
export function generateAgentDisclosure(
  profile: AgentProfileInput,
  asOf: string = new Date().toISOString().slice(0, 10),
): AgentDisclosureResult {
  const draft = buildDraft(profile);
  const missing = draft.missingFields;

  if (missing.length > 0) {
    return { ok: false, reason: 'undeclared_fields', draft };
  }

  const meta = getAgentDisclosureMeta();
  const artifact: AgentDisclosureArtifact = {
    ...draft,
    missingFields: [],
    corpusVersion: meta.version,
    guidelinesAdopted: meta.guidelines_adopted,
    regulation: meta.regulation,
    generatedAt: asOf,
  };

  return { ok: true, artifact };
}

/** Render a plain-text disclosure block suitable for copy-paste or CLI output. */
export function formatAgentDisclosureText(result: AgentDisclosureResult): string {
  const body = result.ok ? result.artifact : result.draft;
  const lines = [
    body.artificialNatureNotice,
    body.principalStatement,
    body.authorityScopeStatement,
    '',
    'Re-disclosure required:',
    ...body.redisclosureTriggers.map((t) => `- ${t.when}`),
    '',
    body.architectureFallback,
  ];
  if (body.multiAgentNote) {
    lines.push('', body.multiAgentNote);
  }
  if (!result.ok) {
    lines.push(
      '',
      `Cannot generate final artifact: ${body.missingFields.join(', ')} ${UNDECLARED}.`,
    );
  }
  lines.push('', body.counselNotice);
  return lines.join('\n');
}

/** Positive dimension ids required for a complete kit (taxonomy check). */
export function requiredPositiveDimensions(): PositiveDimension[] {
  return getPositiveDimensions();
}
