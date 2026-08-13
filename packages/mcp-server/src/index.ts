// Legalithm MCP server — EU AI Act compliance tools for Claude Code / Cursor (stdio).
// (The executable shebang is added by the tsup banner at build time.)
// classify / explain_obligation / generate_disclosure are offline; check_record is online.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { UseCase, Domain } from './lib/ai_act/types';
import {
  classifyTool,
  explainObligationTool,
  generateDisclosureTool,
  checkRecordTool,
  generateAgentDisclosureTool,
  agentDisclosureTaxonomyTool,
} from './tools.js';
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

/**
 * Every parameter carries a .describe(). An agent choosing `domain` from an
 * eleven-value enum with no guidance is guessing, and a wrong domain produces a
 * confidently wrong tier from a correctly working tool — the failure mode this
 * server exists to prevent. The enum values alone do not say that `provider`
 * turns on Articles 8 to 17 while `deployer` turns on Article 26, nor that
 * Annex III areas are read broadly.
 */
const role = z
  .enum(['provider', 'deployer'])
  .describe(
    'Who the caller is for this system. "provider" develops or places it on the EU market under its own name and carries the Article 8 to 17 duties. "deployer" uses it under its own authority and carries Article 26. If the caller both builds and uses it, answer as provider.',
  );
const risk = z
  .enum(['unacceptable', 'high', 'limited', 'minimal'])
  .describe(
    'The risk tier, as returned by the classify tool. Do not guess it: call classify first and pass its "risk" value through, or the obligations returned will be confidently wrong.',
  );
/**
 * Jurisdiction narrowing. Optional, because the obligations are EU-wide and
 * identical everywhere — only the authority you answer to is national.
 *
 * `sector` matters more than it looks. Germany routes financial services to
 * BaFin and media to the Land, so answering with the default authority for a
 * bank is a confidently wrong answer from a tool that otherwise worked.
 */
const country = z
  .string()
  .length(2)
  .optional()
  .describe(
    'ISO 3166-1 alpha-2 code of the member state the system is placed on the market in, e.g. "DE". Optional. Supply it to get the competent national authority alongside the obligations. Only states with a recorded primary source are mapped; for any other the response says so explicitly rather than guessing, and the EU-wide obligations are unaffected either way.',
  );
const sector = z
  .enum(['general', 'financial_services', 'media'])
  .optional()
  .describe(
    'Sector of the deployer, where it changes which authority is competent. Use "financial_services" for a company under financial-services supervision, "media" for broadcasting and press, "general" otherwise. Defaults to "general". Getting this wrong names the wrong regulator: in Germany a bank answers to BaFin and a broadcaster to its Bundesland, not to the default federal authority.',
  );
/**
 * W3/T3.3 renamed `credit` to `essential-services`, because Annex III area 5
 * ("essential private services and essential public services and benefits") is
 * broader than credit scoring. Published 0.1.3 accepted `credit` and agents may
 * hold that tool schema in cache, so it stays accepted and is normalised below
 * rather than failing validation.
 */
const DEPRECATED_DOMAIN_ALIASES: Record<string, Domain> = { credit: 'essential-services' };

const domain = z
  .enum([
    'biometrics', 'employment', 'essential-services', 'medical', 'education',
    'law-enforcement', 'critical-infrastructure', 'migration-asylum',
    'justice-democratic', 'other',
    'credit', // deprecated — normalised to essential-services
  ])
  .describe(
    'The Annex III area the use case falls in, which is what drives the high-risk determination. Read these broadly: "employment" covers recruitment, CV screening, task allocation, promotion and termination. "essential-services" covers creditworthiness, insurance pricing, and access to public benefits. "biometrics" covers identification, categorisation and emotion inference. Use "other" only when none genuinely applies, since that usually yields a lower tier. "credit" is a deprecated alias kept for older clients and is normalised to essential-services.',
  );

const audience = z
  .enum(['general', 'workers', 'children', 'vulnerable-groups', 'other'])
  .describe(
    'Who is subject to or affected by the system, not who buys it. Choose "workers" for employees and candidates, "children" for under-18s, and "vulnerable-groups" where age, disability or social situation impairs the ability to object. These raise obligations, so pick the most specific one that applies rather than defaulting to "general".',
  );

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
      inputSchema: {
        role,
        domain,
        use_case: z
          .string()
          .min(1)
          .describe(
            'One or two plain sentences describing what the system actually does to or about a person, and what decision it influences. Say "screens and ranks job applicants from their CVs to shortlist candidates", not "HR tool" or a product name. Whether a human reviews the output before it takes effect matters, so state it if known.',
          ),
        audience,
      },
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
      description:
        'List the EU AI Act obligations for a role + risk tier, each with its Article citation. '
        + 'Pass country (and sector) to also get the competent national authority. Offline.',
      inputSchema: { role, risk, country, sector },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      emitSurfaceActive(API_URL, 'explain_obligation');
      return asText(
        explainObligationTool(args.role, args.risk, { country: args.country, sector: args.sector }),
      );
    },
  );

  server.registerTool(
    'generate_disclosure',
    {
      title: 'Generate an Article 50 disclosure',
      description: 'Generate an Article 50 transparency disclosure snippet (chatbot / genai-content / deepfake / emotion), EN or DE. Offline.',
      inputSchema: {
        scenario: z
          .enum(['chatbot', 'genai-content', 'deepfake', 'emotion'])
          .describe(
            'Which Article 50 duty applies. "chatbot" for a system a person interacts with directly, Article 50(1). "genai-content" for synthetic text, image, audio or video that must be machine-readably marked, Article 50(2). "emotion" for emotion recognition or biometric categorisation, Article 50(3). "deepfake" for content resembling real people, places or events, Article 50(4). Pick by the duty, not by the underlying model.',
          ),
        locale: z
          .enum(['en', 'de'])
          .optional()
          .describe('Language of the generated disclosure text. Defaults to "en". Use "de" when the system is placed on the German market, since the disclosure must be intelligible to the person seeing it.'),
      },
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
      inputSchema: {
        slug: z
          .string()
          .min(1)
          .describe(
            'The organisation slug of a published Trust Center record, as it appears in the record URL, for example "acme-gmbh". Not a company display name and not a domain. This is the only tool that makes a network call.',
          ),
      },
      // Read-only like the others, but openWorldHint: it is the one tool that
      // reaches a network host (the public Trust Center API).
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      emitSurfaceActive(API_URL, 'check_record');
      return asText(await checkRecordTool(args.slug, API_URL));
    },
  );

  server.registerTool(
    'generate_agent_disclosure',
    {
      title: 'Generate an AI agent disclosure (Article 50)',
      description:
        'Draft the Article 50(1) disclosure an AI agent owes: what it is, who it acts for, and the limits of its delegated authority. Follows the Commission Article 50 Guidelines adopted 20 July 2026. Refuses rather than inventing a principal. Offline.',
      inputSchema: {
        principal_name: z
          .string()
          .nullable()
          .describe(
            'The natural or legal person the agent acts on behalf of, exactly as it should appear to the person interacting with it, for example "Acme GmbH". Ask the user; do not infer it from the repository, the git author or the domain. Pass null if genuinely unknown and the tool will tell you what is missing rather than guess.',
          ),
        principal_type: z
          .string()
          .nullable()
          .describe(
            'Whether the principal is a "legal_person" (a company or other organisation) or a "natural_person" (an individual). This distinction drives who bears accountability for the agent\'s actions.',
          ),
        authority_scope: z
          .string()
          .nullable()
          .describe(
            'What the agent is actually authorised to do on the principal\'s behalf, in plain words, for example "schedule meetings and send calendar invitations to Acme staff". The Guidelines frame this as delegation of authority and accountability for consequences, so state the limits, not the capabilities.',
          ),
        autonomy_level: z
          .string()
          .nullable()
          .optional()
          .describe(
            'How much human involvement there is, for example "supervised" where a person approves actions, or "autonomous" where it acts without review. Affects how the re-disclosure triggers read.',
          ),
        composition: z
          .unknown()
          .nullable()
          .optional()
          .describe(
            'Set when this agent orchestrates or is orchestrated by other agents. The Guidelines cover multi-agent architectures explicitly, and composition changes what has to be disclosed at architecture level.',
          ),
      },
      // Pure function over the bundled Guidelines corpus: no writes, no network.
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      emitSurfaceActive(API_URL, 'generate_agent_disclosure');
      return asText(
        generateAgentDisclosureTool({
          principalName: args.principal_name ?? null,
          principalType: args.principal_type ?? null,
          authorityScope: args.authority_scope ?? null,
          autonomyLevel: args.autonomy_level ?? null,
          composition: args.composition ?? null,
        }),
      );
    },
  );

  server.registerTool(
    'agent_disclosure_taxonomy',
    {
      title: 'What an AI agent must disclose, and what it need not',
      description:
        'The six disclosure dimensions an AI agent owes under Article 50(1), plus the negative scope: what the Commission Guidelines confirm is NOT covered, including chain-of-thought, backend machine-to-machine calls and agent-to-agent traffic. Offline.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      emitSurfaceActive(API_URL, 'agent_disclosure_taxonomy');
      return asText(agentDisclosureTaxonomyTool());
    },
  );

  return server;
}

// Bin entry — guarded so importing { createServer } in tests has no side effects.
if (!process.env.VITEST) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
