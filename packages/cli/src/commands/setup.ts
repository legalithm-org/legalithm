// `legalithm setup` — one command that wires Legalithm into Claude Code and Cursor
// professionally: deterministic hooks, editor rules, and the MCP server. Idempotent
// and non-destructive (merges into existing config; never clobbers other hooks/servers).

/** Default invocation (fetches from npm). `setup` swaps in a local form when the
 *  CLI is already installed, so the per-edit hook has no npx download latency. */
export const DEFAULT_CLI = 'npx -y legalithm';

type Json = Record<string, unknown>;

function containsGuard(value: unknown): boolean {
  return JSON.stringify(value ?? '').includes(' guard');
}

/**
 * Merge Legalithm hooks into a Claude Code settings.json object.
 * - PostToolUse(Write|Edit): non-blocking nudge (emits additionalContext the model sees).
 * - Stop: blocks the agent from finishing when a record is missing (JSON decision).
 * Idempotent: re-running does not duplicate the hooks; other hooks are preserved.
 * `cli` is the resolved invocation (e.g. 'npx legalithm' when installed locally).
 */
export function mergeClaudeSettings(existing: Json, cli: string = DEFAULT_CLI): Json {
  const settings: Json = { ...existing };
  const hooks: Json = { ...((settings.hooks as Json) ?? {}) };

  const post = Array.isArray(hooks.PostToolUse) ? [...(hooks.PostToolUse as unknown[])] : [];
  if (!containsGuard(post)) {
    post.push({ matcher: 'Write|Edit', hooks: [{ type: 'command', command: `${cli} guard --hook posttooluse` }] });
  }
  hooks.PostToolUse = post;

  const stop = Array.isArray(hooks.Stop) ? [...(hooks.Stop as unknown[])] : [];
  if (!containsGuard(stop)) {
    stop.push({ hooks: [{ type: 'command', command: `${cli} guard --hook stop` }] });
  }
  hooks.Stop = stop;

  settings.hooks = hooks;
  return settings;
}

/** Merge the Legalithm MCP server into an .mcp.json / .cursor/mcp.json object. Idempotent.
 *  `type: stdio` is required by Claude Code; `timeout` covers the npx cold-start fetch. */
export function mergeMcpConfig(existing: Json): Json {
  const config: Json = { ...existing };
  const servers: Json = { ...((config.mcpServers as Json) ?? {}) };
  servers.legalithm = { type: 'stdio', command: 'npx', args: ['-y', 'legalithm-mcp-server'], timeout: 60000 };
  config.mcpServers = servers;
  return config;
}

export const CURSOR_RULE = `---
description: EU AI Act compliance (Legalithm)
alwaysApply: true
---

# EU AI Act compliance (Legalithm)

When this project ships an AI feature to EU users (an LLM SDK, a chatbot, generated
content, or a high-risk use case), use the Legalithm MCP tools to check obligations
before finishing:

- \`classify\` — get the EU AI Act risk tier + cited Articles for a described use case.
- \`explain_obligation\` — the cited checklist for an obligation.
- \`generate_disclosure\` — an Article 50 transparency snippet (EN/DE).

If \`compliance/legalithm.json\` is missing, run \`npx legalithm init\`. These tools
are a starting point, not legal advice; flag low-confidence results for human review.
`;

export const CLAUDE_MD_SNIPPET = `
## EU AI Act compliance (Legalithm)

This repo is gated by Legalithm. Hooks run \`legalithm guard\` automatically:
after edits (a nudge) and before finishing a turn (blocks if AI dependencies exist
without a \`compliance/legalithm.json\`). To resolve: run \`npx legalithm init\`.
Use the Legalithm MCP tools (classify / explain_obligation / generate_disclosure)
when adding AI features. Not legal advice; verify low-confidence results.
`;

export interface SetupFile {
  path: string;
  /** 'merge-json' = read+merge+write; 'write' = create if absent; 'append' = append snippet if marker absent. */
  action: 'merge-json' | 'write' | 'append';
  marker?: string;
}

/** The files `setup` manages, in order. */
export const SETUP_FILES: SetupFile[] = [
  { path: '.claude/settings.json', action: 'merge-json' },
  { path: '.mcp.json', action: 'merge-json' },
  { path: '.cursor/mcp.json', action: 'merge-json' },
  { path: '.cursor/rules/legalithm-eu-ai-act.mdc', action: 'write' },
  { path: 'CLAUDE.md', action: 'append', marker: 'EU AI Act compliance (Legalithm)' },
];
