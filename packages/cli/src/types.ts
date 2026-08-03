// Local, dependency-free types for the CLI. The classification union literals
// mirror lib/ai_act/types.ts (the API validates them with zod), kept local so the
// CLI bundle has no cross-package import of the Next app.

export type ProviderRole = 'provider' | 'deployer';
export type Domain =
  | 'biometrics'
  | 'employment'
  | 'essential-services'
  | 'medical'
  | 'education'
  | 'law-enforcement'
  | 'critical-infrastructure'
  | 'migration-asylum'
  | 'justice-democratic'
  | 'other';
export type Audience = 'general' | 'workers' | 'children' | 'vulnerable-groups' | 'other';

export interface UseCase {
  role: ProviderRole;
  domain: Domain;
  use_case: string;
  audience: Audience;
}

// ---- stack detection ----
export interface StackInput {
  packageJson?: {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  /** Environment variable NAMES only — never values. */
  envKeys?: string[];
  /** Relative repo paths sampled for routing heuristics. */
  filePaths?: string[];
  /**
   * Raw JSON contents of MCP config files keyed by relative path
   * (.mcp.json, .cursor/mcp.json, .claude/settings.json). Used to emit one
   * agent_capability signal per configured mcpServers entry.
   */
  mcpConfigs?: Record<string, string>;
  /** Raw contents of non-Node dependency manifests, keyed by filename
   *  (requirements.txt, pyproject.toml, go.mod, Cargo.toml, pom.xml,
   *  build.gradle, composer.json, *.csproj). Drives cross-language detection. */
  manifests?: Record<string, string>;
  /**
   * CI / IaC file contents keyed by relative path
   * (.github/workflows/*.yml, Dockerfile*, docker-compose*.yml).
   */
  ciManifests?: Record<string, string>;
}

export type SignalKind = 'llm_sdk' | 'pii_handling' | 'framework' | 'vector_db' | 'auth' | 'agent_capability';
export type AiActHint = 'article_50' | 'gpai' | 'none';
export type Confidence = 'high' | 'medium' | 'low';
export type Framework = 'next' | 'vite' | 'remix' | 'express' | 'other';

export interface DetectedSignal {
  kind: SignalKind;
  evidence: string;
  aiActHint: AiActHint;
  dsgvoHint: boolean;
  confidence: Confidence;
}

export interface StackInference {
  usesGenAI: boolean;
  likelyArticle50: boolean;
  handlesPII: boolean;
  framework?: Framework;
  /** True when MCP / agent-capability configs were found. */
  hasAgentCapability?: boolean;
}

export interface StackDetectionResult {
  signals: DetectedSignal[];
  inferred: StackInference;
  useCaseSeed: Partial<UseCase>;
  disclaimer: string;
}

// ---- inventory (P2-B1: auto-discovery → /api/v1/ai-systems) ----
// Kept in sync with the web app's AI_SYSTEM_CATEGORIES / AI_SYSTEM_ROLES
// (lib/aiact/ai-systems.ts). The CLI package is isolated, so the literals live here.
export const AI_SYSTEM_CATEGORIES = [
  'chatbot',
  'content_generation',
  'recommender',
  'hr_screening',
  'biometric',
  'agent',
  'other',
] as const;
export type AiSystemCategory = (typeof AI_SYSTEM_CATEGORIES)[number];

export const AI_SYSTEM_ROLES = ['provider', 'deployer', 'importer', 'distributor'] as const;
export type AiSystemRole = (typeof AI_SYSTEM_ROLES)[number];

/**
 * AgentProfile stub for discover → registry. Fields discover cannot know stay
 * null (rendered as "not yet declared"). Never invent a principal.
 */
export interface AgentProfileStub {
  principalName: null;
  principalType: null;
  authorityScope: null;
  tools: string[];
  externalActions: string[];
  connectedSystems: string[];
  affectedPersonCategories: string[];
  autonomyLevel: null;
  composition: null;
}

/** One proposed AI-system record, shaped for POST /api/v1/ai-systems. */
export interface InventoryItem {
  name: string;
  role: AiSystemRole;
  category: AiSystemCategory;
  purpose?: string;
  description?: string;
  dataCategories?: string[];
  /** Present when category is agent — honest nulls for undeclared Art 50 fields. */
  agentProfile?: AgentProfileStub;
}

// ---- the compliance record (only the fields the CLI reads for drift) ----
export interface StoredRecord {
  schemaVersion: string;
  recordId: string;
  inputHash: string;
  asOf: string;
  legalBasis: { engineVersion: string; statement: string };
  system: { name: string; version: string; input: UseCase };
  classification: { risk: string; confidenceScore?: number; reviewRequired?: boolean };
  [key: string]: unknown;
}
