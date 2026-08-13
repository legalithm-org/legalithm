import agentDisclosureCorpus from './agent-disclosure.json';

/**
 * T6.1: agent-disclosure taxonomy corpus reader. Versioned guidance from the
 * Commission Article 50 Guidelines (20 July 2026) for AI agents under Article 50.
 * A change is a corpus edit: agent-disclosure.yml is the source of truth.
 *
 * Reads generated JSON rather than the YAML. It previously did
 * readFileSync(join(process.cwd(), 'lib', 'ai_act', 'agent-disclosure.yml')),
 * which only resolves when the process runs from the repo root — so the module
 * could not be bundled into the MCP server without throwing ENOENT on startup,
 * the same defect version.ts had before obligations-meta.json. Regenerate with
 * scripts/generate-agent-disclosure-json.ts; the drift test guards it.
 */

export interface Bilingual {
  en: string;
  de: string;
}

export interface AgentDisclosureMeta {
  version: string;
  updatedAt: string;
  guidelines_adopted: string;
  regulation: string;
  guidelines_title: string;
  reference_url: string;
}

export interface PositiveDimension {
  id: string;
  article_limb: string;
  guideline_paragraph: string;
  label: Bilingual;
  description: Bilingual;
}

export interface NegativeScopeItem {
  id: string;
  article_limb: string;
  guideline_paragraph: string;
  label: Bilingual;
  description: Bilingual;
}

export interface AgentDisclosureFootnote {
  id: string;
  label: Bilingual;
  description: Bilingual;
}

export interface AgentDisclosureCorpus {
  meta: AgentDisclosureMeta;
  positive_dimensions: PositiveDimension[];
  negative_scope: NegativeScopeItem[];
  footnotes: AgentDisclosureFootnote[];
}

const corpus = agentDisclosureCorpus as unknown as AgentDisclosureCorpus;

function load(): AgentDisclosureCorpus {
  return corpus;
}

export function getAgentDisclosureCorpus(): AgentDisclosureCorpus {
  return load();
}

export function getAgentDisclosureMeta(): AgentDisclosureMeta {
  return load().meta;
}

export function getPositiveDimensions(): PositiveDimension[] {
  return load().positive_dimensions;
}

export function getNegativeScope(): NegativeScopeItem[] {
  return load().negative_scope;
}

export function getAgentDisclosureFootnotes(): AgentDisclosureFootnote[] {
  return load().footnotes;
}

/** Expected positive dimension ids (stable contract for tests and T6.5 kit). */
export const POSITIVE_DIMENSION_IDS = [
  'artificial_nature',
  'principal_identity',
  'delegated_authority_scope',
  'multi_agent_composition',
  'architecture_level_disclosure',
  'redisclosure_triggers',
] as const;

/** Expected negative scope ids (Art 50(2) exclusions). */
export const NEGATIVE_SCOPE_IDS = [
  'intermediate_reasoning',
  'unperceived_actions',
  'backend_m2m',
  'agent_to_agent',
] as const;
