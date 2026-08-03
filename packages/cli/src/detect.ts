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
  AgentProfileStub,
} from './types.js';

interface DependencyRule {
  /** Exact dep names or `prefix*` globs. */
  deps: string[];
  kind: SignalKind;
  aiActHint: AiActHint;
  dsgvoHint: boolean;
  confidence: Confidence;
}

/**
 * G3.2: data-driven scan of CI/IaC file contents (same shape spirit as DEPENDENCY_RULES).
 * `paths` are simple globs against relative paths; `tokens` are lowercase substrings.
 */
export interface CiIacRule {
  paths: string[];
  tokens: string[];
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

/** AI SDK / model-endpoint tokens for CI & IaC files (G3.2). */
export const CI_IAC_RULES: CiIacRule[] = [
  {
    paths: [
      '.github/workflows/*.yml',
      '.github/workflows/*.yaml',
      'Dockerfile',
      'Dockerfile.*',
      'docker-compose.yml',
      'docker-compose.yaml',
      'docker-compose.*.yml',
      'docker-compose.*.yaml',
    ],
    tokens: [
      'openai',
      'anthropic',
      'claude',
      'langchain',
      'llamaindex',
      'mistral',
      'cohere',
      'huggingface',
      'ollama',
      'bedrock',
      'vertexai',
      'vertex-ai',
      'generativelanguage.googleapis',
      'api.openai.com',
      'api.anthropic.com',
      '@ai-sdk/',
      'vercel ai',
      'openai/openai',
      'google/generative-ai',
    ],
    kind: 'llm_sdk',
    aiActHint: 'article_50',
    dsgvoHint: false,
    confidence: 'medium',
  },
];

const PII_ENV_RE = /(STRIPE|SMTP|TWILIO|SENDGRID|MAILGUN|RESEND|_EMAIL\b)/i;
const CHAT_PATH_RE = /(chat|assistant|copilot).*route\.(ts|js|tsx|jsx)$/i;

/** MCP config paths written by `legalithm setup` (see setup.ts SETUP_FILES). */
export const MCP_CONFIG_RELATIVE_PATHS = ['.mcp.json', '.cursor/mcp.json', '.claude/settings.json'] as const;

export function isMcpConfigPath(relativePath: string): boolean {
  const n = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  return (MCP_CONFIG_RELATIVE_PATHS as readonly string[]).some(
    (p) => n === p || n.endsWith(`/${p}`),
  );
}

/** Parse mcpServers keys from an MCP / Claude settings JSON blob. Never invents names. */
export function listMcpServerNames(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const servers = (parsed as Record<string, unknown>).mcpServers;
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return [];
    return Object.keys(servers as Record<string, unknown>).filter((k) => k.trim().length > 0);
  } catch {
    return [];
  }
}

/** Honest AgentProfile stub — undeclared Art 50 fields stay null. */
export function emptyAgentProfileStub(tools: string[] = []): AgentProfileStub {
  return {
    principalName: null,
    principalType: null,
    authorityScope: null,
    tools,
    externalActions: [],
    connectedSystems: [],
    affectedPersonCategories: [],
    autonomyLevel: null,
    composition: null,
  };
}

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

/** Match relative paths against simple `*` globs (prefix/suffix/middle). */
export function matchesPathGlob(relativePath: string, pattern: string): boolean {
  const n = relativePath.replace(/\\/g, '/');
  const p = pattern.replace(/\\/g, '/');
  const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${p.split('*').map(escape).join('.*')}$`);
  if (re.test(n)) return true;
  const base = n.includes('/') ? n.slice(n.lastIndexOf('/') + 1) : n;
  return re.test(base);
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

  // MCP / agent-capability configs (shapes from setup.ts mergeMcpConfig).
  const mcpPathsSeen = new Set<string>();
  for (const [path, raw] of Object.entries(input.mcpConfigs ?? {})) {
    if (!isMcpConfigPath(path)) continue;
    mcpPathsSeen.add(path.replace(/\\/g, '/').replace(/^\.\//, ''));
    const serverNames = listMcpServerNames(raw);
    for (const server of serverNames) {
      signals.push({
        kind: 'agent_capability',
        evidence: `mcp-server:${path}#${server}`,
        aiActHint: 'article_50',
        dsgvoHint: false,
        confidence: 'high',
      });
    }
  }
  for (const path of input.filePaths ?? []) {
    if (!isMcpConfigPath(path)) continue;
    const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
    if (mcpPathsSeen.has(normalized)) continue; // contents already emitted per-server signals
    signals.push({
      kind: 'agent_capability',
      evidence: `mcp-config:${path}`,
      aiActHint: 'article_50',
      dsgvoHint: false,
      confidence: 'high',
    });
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

  // CI / IaC (G3.2) — same data-driven rule shape as DEPENDENCY_RULES.
  for (const [path, raw] of Object.entries(input.ciManifests ?? {})) {
    const lower = raw.toLowerCase();
    for (const rule of CI_IAC_RULES) {
      if (!rule.paths.some((glob) => matchesPathGlob(path, glob))) continue;
      const hit = rule.tokens.find((t) => lower.includes(t));
      if (!hit) continue;
      signals.push({
        kind: rule.kind,
        evidence: `ci-iac:${path}:${hit}`,
        aiActHint: rule.aiActHint,
        dsgvoHint: rule.dsgvoHint,
        confidence: rule.confidence,
      });
      break; // one signal per file per matching rule
    }
  }

  const inferred: StackInference = {
    usesGenAI: signals.some((s) => s.kind === 'llm_sdk'),
    likelyArticle50: signals.some((s) => s.aiActHint === 'article_50'),
    handlesPII: signals.some((s) => s.dsgvoHint),
    framework: detectFramework(depNames),
    ...(signals.some((s) => s.kind === 'agent_capability') ? { hasAgentCapability: true } : {}),
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
  if (signals.some((s) => s.kind === 'agent_capability')) return 'agent';
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
 *
 * T3.6: agent detections attach an AgentProfile stub with honest nulls for
 * principalName / authorityScope (never guessed).
 */
export function buildInventory(result: StackDetectionResult, name: string): InventoryItem {
  const category = inferSystemCategory(result.signals);
  const aiEvidence = result.signals
    .filter((s) => s.kind === 'llm_sdk' || s.kind === 'vector_db' || s.kind === 'agent_capability')
    .map((s) => s.evidence);
  const description = aiEvidence.length
    ? `Auto-detected AI stack: ${aiEvidence.join(', ')}.`
    : 'No AI SDK detected in the manifest; registered for completeness.';
  const item: InventoryItem = {
    name: name.trim() || 'app',
    role: 'deployer',
    category,
    purpose: result.useCaseSeed.use_case ?? 'AI feature shipped to EU users',
    description,
    ...(result.inferred.handlesPII ? { dataCategories: ['personal data'] } : {}),
  };
  if (category === 'agent') {
    const tools = result.signals
      .filter((s) => s.kind === 'agent_capability' && s.evidence.startsWith('mcp-server:'))
      .map((s) => {
        const hash = s.evidence.indexOf('#');
        return hash >= 0 ? s.evidence.slice(hash + 1) : '';
      })
      .filter((name) => name.length > 0);
    item.agentProfile = emptyAgentProfileStub(tools);
  }
  return item;
}
