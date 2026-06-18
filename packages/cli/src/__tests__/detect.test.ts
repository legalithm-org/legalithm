import { describe, it, expect } from 'vitest';
import { detectStack, toUseCaseSeed } from '../detect.js';
import type { StackInput, StackInference } from '../types.js';

interface StackCase {
  name: string;
  input: StackInput;
  expected: StackInference;
}

const pkg = (deps: Record<string, string>): StackInput => ({
  packageJson: { name: 'fixture', version: '1.0.0', dependencies: deps },
});

// Top-N real stacks. The 90% sufficiency gate asserts ≥0.90 fully-correct over these.
const STACK_CASES: StackCase[] = [
  { name: 'Next + Vercel AI SDK + OpenAI', input: pkg({ next: '15', react: '19', ai: '4', openai: '4' }),
    expected: { usesGenAI: true, likelyArticle50: true, handlesPII: false, framework: 'next' } },
  { name: 'Next + Anthropic SDK', input: pkg({ next: '15', '@anthropic-ai/sdk': '0.3' }),
    expected: { usesGenAI: true, likelyArticle50: true, handlesPII: false, framework: 'next' } },
  { name: 'Vite + React, no AI', input: pkg({ vite: '5', react: '19' }),
    expected: { usesGenAI: false, likelyArticle50: false, handlesPII: false, framework: 'vite' } },
  { name: 'Express + LangChain + Pinecone', input: pkg({ express: '4', langchain: '0.3', '@pinecone-database/pinecone': '3' }),
    expected: { usesGenAI: true, likelyArticle50: true, handlesPII: false, framework: 'express' } },
  { name: 'Next + Prisma + next-auth (PII, no AI)', input: pkg({ next: '15', '@prisma/client': '6', 'next-auth': '4' }),
    expected: { usesGenAI: false, likelyArticle50: false, handlesPII: true, framework: 'next' } },
  { name: 'Plain node lib, no deps', input: pkg({}),
    expected: { usesGenAI: false, likelyArticle50: false, handlesPII: false, framework: undefined } },
  { name: 'Remix + Supabase', input: pkg({ '@remix-run/react': '2', '@supabase/supabase-js': '2' }),
    expected: { usesGenAI: false, likelyArticle50: false, handlesPII: true, framework: 'remix' } },
  { name: 'Next + Ollama (local LLM)', input: pkg({ next: '15', ollama: '0.5' }),
    expected: { usesGenAI: true, likelyArticle50: true, handlesPII: false, framework: 'next' } },
  { name: 'Next + Stripe env (PII, no AI)', input: { packageJson: { dependencies: { next: '15' } }, envKeys: ['STRIPE_SECRET_KEY', 'NODE_ENV'] },
    expected: { usesGenAI: false, likelyArticle50: false, handlesPII: true, framework: 'next' } },
  { name: 'LangChain scoped pkg', input: pkg({ next: '15', '@langchain/openai': '0.3' }),
    expected: { usesGenAI: true, likelyArticle50: true, handlesPII: false, framework: 'next' } },
  { name: 'Google Generative AI', input: pkg({ vite: '5', '@google/generative-ai': '0.2' }),
    expected: { usesGenAI: true, likelyArticle50: true, handlesPII: false, framework: 'vite' } },
  { name: 'Unknown framework lib', input: pkg({ lodash: '4' }),
    expected: { usesGenAI: false, likelyArticle50: false, handlesPII: false, framework: 'other' } },
];

describe('detectStack — top-N stacks (≥90% sufficiency gate)', () => {
  for (const c of STACK_CASES) {
    it(c.name, () => {
      expect(detectStack(c.input).inferred).toEqual(c.expected);
    });
  }

  it('classifies ≥90% of the top-N stacks fully correctly', () => {
    const correct = STACK_CASES.filter(
      (c) => JSON.stringify(detectStack(c.input).inferred) === JSON.stringify(c.expected),
    ).length;
    expect(STACK_CASES.length).toBeGreaterThanOrEqual(10);
    expect(correct / STACK_CASES.length).toBeGreaterThanOrEqual(0.9);
  });
});

describe('detectStack — robustness & privacy', () => {
  it('is deterministic', () => {
    const input = pkg({ next: '15', openai: '4', '@prisma/client': '6' });
    expect(detectStack(input)).toEqual(detectStack(input));
  });

  it('never throws on empty / malformed input', () => {
    expect(() => detectStack({})).not.toThrow();
    expect(() => detectStack({ packageJson: {} })).not.toThrow();
    expect(() => detectStack({ envKeys: [], filePaths: [] })).not.toThrow();
  });

  it('only ever records env KEY names as evidence, never values', () => {
    const result = detectStack({ packageJson: { dependencies: { next: '15' } }, envKeys: ['STRIPE_SECRET_KEY'] });
    const envSignals = result.signals.filter((s) => s.evidence.startsWith('env:'));
    expect(envSignals).toHaveLength(1);
    expect(envSignals[0]!.evidence).toBe('env:STRIPE_SECRET_KEY');
  });

  it('detects a chatbot route path as an Article 50 signal', () => {
    const result = detectStack({ filePaths: ['app/api/chat/route.ts'] });
    expect(result.inferred.likelyArticle50).toBe(true);
  });

  it('produces a seed UseCase that never escalates risk (no explicit override)', () => {
    expect(toUseCaseSeed({ usesGenAI: false, likelyArticle50: false, handlesPII: false })).toEqual({});
    const genai = toUseCaseSeed({ usesGenAI: true, likelyArticle50: true, handlesPII: false });
    expect(genai.role).toBe('deployer');
    expect(genai.use_case).toMatch(/assistant|generative/i);
  });

  it('seeds a generic gen-AI use case when GenAI is used without an Article 50 signal', () => {
    const seed = toUseCaseSeed({ usesGenAI: true, likelyArticle50: false, handlesPII: false });
    expect(seed.use_case).toBe('Generative-AI feature');
    expect(seed.role).toBe('deployer');
  });
});

// Cross-language detection: Python / Go / Rust / Java / .NET / PHP / Ruby.
const mani = (files: Record<string, string>): StackInput => ({ manifests: files });

interface ManifestCase {
  name: string;
  input: StackInput;
  usesGenAI: boolean;
  handlesPII: boolean;
}

const MANIFEST_CASES: ManifestCase[] = [
  { name: 'Python requirements.txt + openai + psycopg2', input: mani({ 'requirements.txt': 'fastapi==0.110\nopenai==1.30\npsycopg2-binary==2.9' }), usesGenAI: true, handlesPII: true },
  { name: 'Python pyproject + langchain', input: mani({ 'pyproject.toml': '[project]\ndependencies = ["langchain", "anthropic"]' }), usesGenAI: true, handlesPII: false },
  { name: 'Go go.mod + go-openai + gorm', input: mani({ 'go.mod': 'require (\n  github.com/sashabaranov/go-openai v1.20.0\n  gorm.io/gorm v1.25.0\n)' }), usesGenAI: true, handlesPII: true },
  { name: 'Rust Cargo.toml + async-openai + sqlx', input: mani({ 'Cargo.toml': '[dependencies]\nasync-openai = "0.18"\nsqlx = "0.7"' }), usesGenAI: true, handlesPII: true },
  { name: 'Java pom.xml + langchain4j', input: mani({ 'pom.xml': '<dependency><groupId>dev.langchain4j</groupId><artifactId>langchain4j</artifactId></dependency>' }), usesGenAI: true, handlesPII: false },
  { name: '.NET csproj + Azure.AI.OpenAI', input: mani({ 'App.csproj': '<PackageReference Include="Azure.AI.OpenAI" Version="2.0.0" />' }), usesGenAI: true, handlesPII: false },
  { name: 'PHP composer.json + openai-php + doctrine', input: mani({ 'composer.json': '{"require": {"openai-php/client": "^0.10", "doctrine/orm": "^3.0"}}' }), usesGenAI: true, handlesPII: true },
  { name: 'Go gin only — no AI/PII', input: mani({ 'go.mod': 'require github.com/gin-gonic/gin v1.10.0' }), usesGenAI: false, handlesPII: false },
  { name: 'Python pinecone (vector) + flask — not GenAI', input: mani({ 'requirements.txt': 'flask\npinecone-client==3.0' }), usesGenAI: false, handlesPII: false },
  { name: 'Ruby Gemfile + ruby-openai + pg', input: mani({ Gemfile: "gem 'ruby-openai'\ngem 'pg'\ngem 'mysql2'" }), usesGenAI: true, handlesPII: true },
];

describe('detectStack — cross-language manifests (≥90% gate)', () => {
  it('detects GenAI + PII signals across ecosystems (≥0.90 fully correct)', () => {
    let correct = 0;
    for (const c of MANIFEST_CASES) {
      const r = detectStack(c.input);
      if (r.inferred.usesGenAI === c.usesGenAI && r.inferred.handlesPII === c.handlesPII) correct += 1;
    }
    expect(MANIFEST_CASES.length).toBeGreaterThanOrEqual(10);
    expect(correct / MANIFEST_CASES.length).toBeGreaterThanOrEqual(0.9);
  });

  it('flags Article 50 for an AI manifest and seeds a non-escalating use case', () => {
    const r = detectStack(mani({ 'requirements.txt': 'openai==1.30' }));
    expect(r.inferred.likelyArticle50).toBe(true);
    expect(r.useCaseSeed.role).toBe('deployer');
    expect(r.signals.some((s) => s.evidence.startsWith('manifest:'))).toBe(true);
  });

  it('never emits raw manifest contents — evidence names only the matched token', () => {
    const r = detectStack(mani({ 'requirements.txt': 'openai==1.30\nSECRET_KEY=do-not-leak' }));
    expect(JSON.stringify(r)).not.toContain('do-not-leak');
  });
});
