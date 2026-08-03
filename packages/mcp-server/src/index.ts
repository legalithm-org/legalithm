// Legalithm MCP server — EU AI Act compliance tools for Claude Code / Cursor (stdio).
// (The executable shebang is added by the tsup banner at build time.)
// classify / explain_obligation / generate_disclosure are offline; check_record is online.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { UseCase, Domain } from './lib/ai_act/types';
import { classifyTool, explainObligationTool, generateDisclosureTool, checkRecordTool } from './tools.js';
import { emitSurfaceActive } from './telemetry.js';

const API_URL = process.env.LEGALITHM_API_URL || 'https://www.legalithm.com';

/**
 * Must equal packages/mcp-server/package.json "version". MCP registries read
 * serverInfo.version from the stdio handshake, so drift here is publicly
 * visible: this shipped as 0.1.0 while the published package was 0.1.3.
 * Guarded by __tests__/version-sync.test.ts.
 */
export const SERVER_VERSION = '0.2.1';

const asText = (obj: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] });

const role = z.enum(['provider', 'deployer']);
const risk = z.enum(['unacceptable', 'high', 'limited', 'minimal']);
/**
 * W3/T3.3 renamed `credit` to `essential-services`, because Annex III area 5
 * ("essential private services and essential public services and benefits") is
 * broader than credit scoring. Published 0.1.3 accepted `credit` and agents may
 * hold that tool schema in cache, so it stays accepted and is normalised below
 * rather than failing validation.
 */
const DEPRECATED_DOMAIN_ALIASES: Record<string, Domain> = { credit: 'essential-services' };

const domain = z.enum([
  'biometrics', 'employment', 'essential-services', 'medical', 'education',
  'law-enforcement', 'critical-infrastructure', 'migration-asylum',
  'justice-democratic', 'other',
  'credit', // deprecated — normalised to essential-services
]);

const audience = z.enum(['general', 'workers', 'children', 'vulnerable-groups', 'other']);

/** Resolve deprecated domain aliases before the engine sees the use case. */
function normalizeUseCase(args: { domain: string } & Record<string, unknown>): UseCase {
  const alias = DEPRECATED_DOMAIN_ALIASES[args.domain];
  return (alias ? { ...args, domain: alias } : args) as unknown as UseCase;
}

export function createServer(): McpServer {
  const server = new McpServer({ name: 'legalithm', version: SERVER_VERSION });

  server.registerTool(
    'classify',
    {
      title: 'Classify AI risk (EU AI Act)',
      description: 'Classify an AI use case under the EU AI Act — risk tier + cited rationale. Offline; checked against Regulation (EU) 2024/1689, not legal advice.',
      inputSchema: { role, domain, use_case: z.string().min(1), audience },
      // Directory review (Anthropic, OpenAI) requires every tool to declare a
      // title and a readOnlyHint/destructiveHint. This one is a pure function
      // over the bundled corpus: no writes, no host outside this process.
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      emitSurfaceActive(API_URL, 'classify');
      return asText(classifyTool(normalizeUseCase(args)));
    },
  );

  server.registerTool(
    'explain_obligation',
    {
      title: 'Explain EU AI Act obligations',
      description: 'List the EU AI Act obligations for a role + risk tier, each with its Article citation. Offline.',
      inputSchema: { role, risk },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      emitSurfaceActive(API_URL, 'explain_obligation');
      return asText(explainObligationTool(args.role, args.risk));
    },
  );

  server.registerTool(
    'generate_disclosure',
    {
      title: 'Generate an Article 50 disclosure',
      description: 'Generate an Article 50 transparency disclosure snippet (chatbot / genai-content / deepfake / emotion), EN or DE. Offline.',
      inputSchema: { scenario: z.enum(['chatbot', 'genai-content', 'deepfake', 'emotion']), locale: z.enum(['en', 'de']).optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      emitSurfaceActive(API_URL, 'generate_disclosure');
      return asText(generateDisclosureTool(args.scenario, args.locale ?? 'en'));
    },
  );

  server.registerTool(
    'check_record',
    {
      title: 'Check a public Trust Center record',
      description: 'Fetch a published Legalithm Trust Center compliance record by org slug. Online (reads the public API).',
      inputSchema: { slug: z.string().min(1) },
      // Read-only like the others, but openWorldHint: it is the one tool that
      // reaches a network host (the public Trust Center API).
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      emitSurfaceActive(API_URL, 'check_record');
      return asText(await checkRecordTool(args.slug, API_URL));
    },
  );

  return server;
}

// Bin entry — guarded so importing { createServer } in tests has no side effects.
if (!process.env.VITEST) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
