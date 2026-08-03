// Type definitions for AI Act RAG system

export type SourceType = 'eurlex' | 'explorer';

export interface AISource {
  id: string;
  source: SourceType;
  url: string;
  hash: string;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AIChunk {
  id: string;
  sourceId: string;
  article?: string;
  annex?: string;
  section?: string;
  paragraph?: string;
  path: string;
  url: string;
  lang: string;
  text: string;
  embedding?: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ChunkMetadata {
  article?: string;
  annex?: string;
  section?: string;
  paragraph?: string;
  path: string;
  url: string;
  lang?: string;
}

export interface ParsedArticle {
  articleNumber: string;
  paragraphs: Array<{
    number?: string;
    text: string;
  }>;
}

export interface SearchRequest {
  q: string;
  k?: number;
  filters?: {
    article?: string;
    annex?: string;
    lang?: string;
  };
}

export interface SearchResult {
  score: number;
  text: string;
  article?: string;
  annex?: string;
  paragraph?: string;
  url: string;
  source: SourceType;
  lang: string;
}

export interface SearchResponse {
  results: SearchResult[];
  vectorSearchEnabled: boolean;
}

export interface IngestResponse {
  success: boolean;
  chunks: number;
  sources: number;
  errors?: string[];
}

// Risk Classification Types
export type RiskLevel = 'unacceptable' | 'high' | 'limited' | 'minimal';

/** Art 3 roles. GPAI Chapter V duties gate on provider in the engine. */
export type ProviderRole = 'provider' | 'deployer' | 'importer' | 'distributor';

export const PROVIDER_ROLES = [
  'provider',
  'deployer',
  'importer',
  'distributor',
] as const satisfies readonly ProviderRole[];

/**
 * Structured assessment domains. `essential-services` is Annex III area 5
 * (broader than credit alone). Input alias `credit` still normalises here.
 */
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

export interface DeploymentContext {
  region?: string;
  publicSpace?: boolean;
  legalBasis?: string;
  specificPurpose?: string;
  dataSensitivity?: string;
}

export interface Article6_3Exceptions {
  /** System performs a narrow procedural task */
  narrowProceduralTask?: boolean;
  /** System improves the result of a previously completed human activity */
  improvesHumanActivity?: boolean;
  /** System detects decision-making patterns without replacing human assessment */
  detectsPatternsOnly?: boolean;
  /** System performs a preparatory task for an assessment in Annex III */
  preparatoryTask?: boolean;
}

export interface UseCase {
  role: ProviderRole;
  domain: Domain;
  use_case: string;
  audience: Audience;
  deployment_context?: DeploymentContext;
  /** Article 6(3) exceptions, if any apply, high-risk may be downgraded */
  article6_3_exceptions?: Article6_3Exceptions;
}

export interface Citation {
  article?: string;
  annex?: string;
  url: string;
  label: string;
  /** Corpus / rules-engine as-of date (ISO YYYY-MM-DD). */
  asOf: string;
  /** When the cited article's obligations apply, from enforcement-dates.ts. */
  appliesFrom?: string;
}

export interface RiskResult {
  risk: RiskLevel;
  confidence: 'high' | 'medium' | 'low';
  /** Numeric confidence in [0,1]. Drives the abstention / review-required signal. */
  confidenceScore?: number;
  /** True when confidenceScore is below the abstention threshold: the engine is
   *  not confident enough to assert and defers to legal review. */
  reviewRequired?: boolean;
  /** True when classified under GPAI Chapter V (Articles 51-56). */
  gpai?: boolean;
  rationale: string;
  citations: Citation[];
  matchedRules: string[];
  /** ISO application date for this classification path, when known. */
  applicableDeadline?: string | null;
  obligationsHint?: {
    count: number;
    topTitles: string[];
  };
}

