# legalithm-mcp-server

[![Add to Cursor](https://img.shields.io/badge/Add%20to-Cursor-000?logo=cursor)](cursor://anysphere.cursor-deeplink/mcp/install?name=legalithm&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImxlZ2FsaXRobS1tY3Atc2VydmVyIl19)
[![npm](https://img.shields.io/npm/v/legalithm-mcp-server?logo=npm)](https://www.npmjs.com/package/legalithm-mcp-server)

EU AI Act compliance tools for **Claude Code** and **Cursor**, over MCP (stdio).
`classify`, `explain_obligation`, and `generate_disclosure` run **fully offline**
(the rule engine is bundled — no network, no API key); `check_record` reads the
public Trust Center.

## Install

**One-liner (wires both editors + the CLI):** `npx legalithm setup`

**Cursor** — click the **Add to Cursor** badge above, or add to `.cursor/mcp.json`.

**Claude Code** (`.mcp.json` in your repo, or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "legalithm": { "command": "npx", "args": ["-y", "legalithm-mcp-server"] }
  }
}
```

**Cursor** (`.cursor/mcp.json`): same block as above.

Then drop the editor rules into your repo so the agent knows to use the tools:
- Cursor: copy `templates/legalithm-eu-ai-act.mdc` → `.cursor/rules/`
- Claude Code: append `templates/CLAUDE.md` to your `CLAUDE.md`

## Tools

| Tool | Mode | Purpose |
|---|---|---|
| `classify` | offline | Risk tier (unacceptable/high/limited/minimal) + cited rationale for an AI use case |
| `explain_obligation` | offline | The obligations for a role + risk tier, each with its Article citation |
| `generate_disclosure` | offline | Article 50 transparency snippet (chatbot / genai-content / deepfake / emotion), EN or DE |
| `check_record` | online | Fetch a published Trust Center compliance record by org slug |

Set `LEGALITHM_API_URL` to point `check_record` at a non-default host.

> Output is checked against Regulation (EU) 2024/1689 — **not legal advice**.
