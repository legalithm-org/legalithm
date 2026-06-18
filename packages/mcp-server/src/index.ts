// Legalithm MCP server — EU AI Act compliance tools for Claude Code / Cursor (stdio).
// (The executable shebang is added by the tsup banner at build time.)
// classify / explain_obligation / generate_disclosure are offline; check_record is online.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { UseCase } from './lib/ai_act/types';
import { classifyTool, explainObligationTool, generateDisclosureTool, checkRecordTool } from './tools.js';

const API_URL = process.env.LEGALITHM_API_URL || 'https://www.legalithm.com';

const asText = (obj: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] });

const role = z.enum(['provider', 'deployer']);
const risk = z.enum(['unacceptable', 'high', 'limited', 'minimal']);
const domain = z.enum(['biometrics', 'employment', 'credit', 'medical', 'education', 'law-enforcement', 'other']);
const audience = z.enum(['general', 'workers', 'children', 'vulnerable-groups', 'other']);

export function createServer(): McpServer {
  const server = new McpServer({ name: 'legalithm', version: '0.1.0' });

  server.registerTool(
    'classify',
    {
      description: 'Classify an AI use case under the EU AI Act — risk tier + cited rationale. Offline; checked against Regulation (EU) 2024/1689, not legal advice.',
      inputSchema: { role, domain, use_case: z.string().min(1), audience },
    },
    async (args) => asText(classifyTool(args as UseCase)),
  );

  server.registerTool(
    'explain_obligation',
    {
      description: 'List the EU AI Act obligations for a role + risk tier, each with its Article citation. Offline.',
      inputSchema: { role, risk },
    },
    async (args) => asText(explainObligationTool(args.role, args.risk)),
  );

  server.registerTool(
    'generate_disclosure',
    {
      description: 'Generate an Article 50 transparency disclosure snippet (chatbot / genai-content / deepfake / emotion), EN or DE. Offline.',
      inputSchema: { scenario: z.enum(['chatbot', 'genai-content', 'deepfake', 'emotion']), locale: z.enum(['en', 'de']).optional() },
    },
    async (args) => asText(generateDisclosureTool(args.scenario, args.locale ?? 'en')),
  );

  server.registerTool(
    'check_record',
    {
      description: 'Fetch a published Legalithm Trust Center compliance record by org slug. Online (reads the public API).',
      inputSchema: { slug: z.string().min(1) },
    },
    async (args) => asText(await checkRecordTool(args.slug, API_URL)),
  );

  return server;
}

// Bin entry — guarded so importing { createServer } in tests has no side effects.
if (!process.env.VITEST) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
