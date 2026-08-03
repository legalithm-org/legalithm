// Local, dependency-free types for the CLI. The classification union literals
// mirror lib/ai_act/types.ts (the API validates them with zod), kept local so the
// CLI bundle has no cross-package import of the Next app.

export type ProviderRole = 'provider' | 'deployer';
export type Domain =
  | 'biometrics'
  | 'employment'
  | 'credit'
  | 'medical'
  | 'education'
  | 'law-enforcement'
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
  /** Raw contents of non-Node dependency manifests, keyed by filename
   *  (requirements.txt, pyproject.toml, go.mod, Cargo.toml, pom.xml,
   *  build.gradle, composer.json, *.csproj). Drives cross-language detection. */
  manifests?: Record<string, string>;
}

export type SignalKind = 'llm_sdk' | 'pii_handling' | 'framework' | 'vector_db' | 'auth';
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
  'other',
] as const;
export type AiSystemCategory = (typeof AI_SYSTEM_CATEGORIES)[number];

export const AI_SYSTEM_ROLES = ['provider', 'deployer', 'importer', 'distributor'] as const;
export type AiSystemRole = (typeof AI_SYSTEM_ROLES)[number];

/** One proposed AI-system record, shaped for POST /api/v1/ai-systems. */
export interface InventoryItem {
  name: string;
  role: AiSystemRole;
  category: AiSystemCategory;
  purpose?: string;
  description?: string;
  dataCategories?: string[];
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
