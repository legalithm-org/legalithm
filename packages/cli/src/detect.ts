// Stack auto-detection (pure). Reads already-parsed repo signals and infers AI-Act /
// DSGVO relevance + a seed UseCase. CLI-only (the web app and MCP don't need it).
// Heuristic and additive — never overrides an explicit user classification.

import type {
  StackInput,
  DetectedSignal,
  StackDetectionResult,
  StackInference,
  Framework,
  UseCase,
  Confidence,
  SignalKind,
  AiActHint,
  AiSystemCategory,
  InventoryItem,
} from './types.js';

interface DependencyRule {
  /** Exact dep names or `prefix*` globs. */
  deps: string[];
  kind: SignalKind;
  aiActHint: AiActHint;
  dsgvoHint: boolean;
  confidence: Confidence;
}

// Data, not code — adding a dependency is a one-line change.
export const DEPENDENCY_RULES: DependencyRule[] = [
  {
    deps: ['openai', '@anthropic-ai/sdk', '@google/generative-ai', '@mistralai/mistralai', 'cohere-ai', '@aws-sdk/client-bedrock-runtime', 'ollama', 'ai', '@ai-sdk/*', 'langchain', '@langchain/*', 'llamaindex'],
    kind: 'llm_sdk',
    aiActHint: 'article_50',
    dsgvoHint: false,
    confidence: 'high',
  },
  {
    deps: ['@huggingface/inference', 'replicate', 'together-ai'],
    kind: 'llm_sdk',
    aiActHint: 'article_50',
    dsgvoHint: false,
    confidence: 'medium',
  },
  {
    deps: ['@pinecone-database/*', 'pinecone-client', 'weaviate-ts-client', 'chromadb', '@qdrant/js-client-rest', 'pgvector'],
    kind: 'vector_db',
    aiActHint: 'gpai',
    dsgvoHint: false,
    confidence: 'low',
  },
  {
    deps: ['@prisma/client', 'pg', 'mongoose', 'mysql2', 'drizzle-orm', '@supabase/supabase-js'],
    kind: 'pii_handling',
    aiActHint: 'none',
    dsgvoHint: true,
    confidence: 'medium',
  },
  {
    deps: ['next-auth', '@clerk/nextjs', '@clerk/*', '@supabase/auth-helpers-nextjs', 'lucia'],
    kind: 'auth',
    aiActHint: 'none',
    dsgvoHint: true,
    confidence: 'medium',
  },
  {
    deps: ['next', 'vite', '@remix-run/react', '@remix-run/node', 'express', 'fastify'],
    kind: 'framework',
    aiActHint: 'none',
    dsgvoHint: false,
    confidence: 'high',
  },
];

const PII_ENV_RE = /(STRIPE|SMTP|TWILIO|SENDGRID|MAILGUN|RESEND|_EMAIL\b)/i;
const CHAT_PATH_RE = /(chat|assistant|copilot).*route\.(ts|js|tsx|jsx)$/i;

// Cross-ecosystem dependency tokens, matched as substrings against the raw
// text of any manifest (Python/Go/Rust/Java/.NET/PHP). Dependency identifiers
// appear verbatim in these files (e.g. go-openai, langchain4j, openai-php,
// Azure.AI.OpenAI), so a lowercase substring scan is robust without per-format
// parsing. Heuristic + additive — confirmed by the user, never escalates risk.
const AI_TOKENS = [
  'openai', 'anthropic', 'claude', 'langchain', 'llamaindex', 'llama-index', 'llama_index',
  'cohere', 'mistral', 'generativeai', 'generative-ai', 'gemini', 'huggingface', 'transformers',
  'ollama', 'bedrock', 'vertexai', 'vertex-ai', 'azure.ai.openai', 'semantic-kernel', 'replicate',
];
const VECTOR_TOKENS = ['pinecone', 'weaviate', 'qdrant', 'chromadb', 'pgvector', 'milvus', 'faiss'];
const DB_TOKENS = [
  'postgres', 'psycopg', 'mysql', 'mongodb', 'mongoose', 'sqlalchemy', 'prisma', 'gorm', 'diesel',
  'sqlx', 'hibernate', 'entityframework', 'entity framework', 'eloquent', 'sequelize', 'doctrine',
];

function matchesDep(depName: string, pattern: string): boolean {
  if (pattern.endsWith('*')) return depName.startsWith(pattern.slice(0, -1));
  return depName === pattern;
}

function detectFramework(depNames: string[]): Framework | undefined {
  if (depNames.includes('next')) return 'next';
  if (depNames.some((d) => d.startsWith('@remix-run/'))) return 'remix';
  if (depNames.includes('vite')) return 'vite';
  if (depNames.includes('express') || depNames.includes('fastify')) return 'express';
  return depNames.length > 0 ? 'other' : undefined;
}

export function detectStack(input: StackInput): StackDetectionResult {
  const deps = {
    ...(input.packageJson?.dependencies ?? {}),
    ...(input.packageJson?.devDependencies ?? {}),
  };
  const depNames = Object.keys(deps);
  const signals: DetectedSignal[] = [];

  for (const rule of DEPENDENCY_RULES) {
    const hit = depNames.find((name) => rule.deps.some((p) => matchesDep(name, p)));
    if (hit) {
      signals.push({
        kind: rule.kind,
        evidence: `${hit}@${deps[hit]}`,
        aiActHint: rule.aiActHint,
        dsgvoHint: rule.dsgvoHint,
        confidence: rule.confidence,
      });
    }
  }

  for (const key of input.envKeys ?? []) {
    if (PII_ENV_RE.test(key)) {
      signals.push({ kind: 'pii_handling', evidence: `env:${key}`, aiActHint: 'none', dsgvoHint: true, confidence: 'medium' });
    }
  }

  for (const path of input.filePaths ?? []) {
    if (CHAT_PATH_RE.test(path)) {
      signals.push({ kind: 'llm_sdk', evidence: `path:${path}`, aiActHint: 'article_50', dsgvoHint: false, confidence: 'medium' });
    }
  }

  // Cross-language manifests (Python/Go/Rust/Java/.NET/PHP).
  const corpus = Object.values(input.manifests ?? {}).join('\n').toLowerCase();
  if (corpus) {
    const ai = AI_TOKENS.find((t) => corpus.includes(t));
    if (ai) signals.push({ kind: 'llm_sdk', evidence: `manifest:${ai}`, aiActHint: 'article_50', dsgvoHint: false, confidence: 'medium' });
    const vec = VECTOR_TOKENS.find((t) => corpus.includes(t));
    if (vec) signals.push({ kind: 'vector_db', evidence: `manifest:${vec}`, aiActHint: 'gpai', dsgvoHint: false, confidence: 'low' });
    const db = DB_TOKENS.find((t) => corpus.includes(t));
    if (db) signals.push({ kind: 'pii_handling', evidence: `manifest:${db}`, aiActHint: 'none', dsgvoHint: true, confidence: 'medium' });
  }

  const inferred: StackInference = {
    usesGenAI: signals.some((s) => s.kind === 'llm_sdk'),
    likelyArticle50: signals.some((s) => s.aiActHint === 'article_50'),
    handlesPII: signals.some((s) => s.dsgvoHint),
    framework: detectFramework(depNames),
  };

  return {
    signals,
    inferred,
    useCaseSeed: toUseCaseSeed(inferred),
    disclaimer: 'Heuristic inferred from dependencies — confirm the intended purpose before relying on it.',
  };
}

/** Map inference to a conservative seed UseCase the user confirms. Never escalates risk. */
export function toUseCaseSeed(inferred: StackInference): Partial<UseCase> {
  if (inferred.likelyArticle50) {
    return {
      role: 'deployer',
      domain: 'other',
      audience: 'general',
      use_case: 'User-facing AI assistant / generative feature shipped to EU users',
    };
  }
  if (inferred.usesGenAI) {
    return { role: 'deployer', domain: 'other', audience: 'general', use_case: 'Generative-AI feature' };
  }
  return {};
}

/**
 * P2-B1: map detection signals to a conservative AI-system category. A chat/assistant
 * route is the strongest signal (chatbot); a generative SDK without one is treated as
 * content generation; otherwise "other". Heuristic — the user confirms.
 */
export function inferSystemCategory(signals: DetectedSignal[]): AiSystemCategory {
  const usesGenAI = signals.some((s) => s.kind === 'llm_sdk');
  const hasChatRoute = signals.some((s) => s.kind === 'llm_sdk' && s.evidence.startsWith('path:'));
  if (hasChatRoute) return 'chatbot';
  if (usesGenAI) return 'content_generation';
  return 'other';
}

/**
 * P2-B1: turn a stack detection into a proposed AI-system record for
 * POST /api/v1/ai-systems. One record per repo (the app itself); the signals are the
 * evidence. Deployer by default (using an AI SDK = deploying someone else's model);
 * the user adjusts role/category before relying on it.
 */
export function buildInventory(result: StackDetectionResult, name: string): InventoryItem {
  const aiEvidence = result.signals
    .filter((s) => s.kind === 'llm_sdk' || s.kind === 'vector_db')
    .map((s) => s.evidence);
  const description = aiEvidence.length
    ? `Auto-detected AI stack: ${aiEvidence.join(', ')}.`
    : 'No AI SDK detected in the manifest; registered for completeness.';
  return {
    name: name.trim() || 'app',
    role: 'deployer',
    category: inferSystemCategory(result.signals),
    purpose: result.useCaseSeed.use_case ?? 'AI feature shipped to EU users',
    description,
    ...(result.inferred.handlesPII ? { dataCategories: ['personal data'] } : {}),
  };
}
