# legalithm

**EU AI Act compliance in your coding loop.** Detect AI dependencies, generate a
dated, cited compliance record in your repo, and gate CI — and your AI coding agent
— on it. Checked against Regulation (EU) 2024/1689. *Not legal advice.*

## Quickstart

```bash
# 1. Wire Legalithm into Claude Code + Cursor (hooks, rules, MCP). No key needed.
npx legalithm setup

# 2. Generate the compliance record for this repo (needs a free API key).
npx legalithm login --key lgl_...
npx legalithm init        # → compliance/legalithm.json (+ annex-iv.md, checklist.md)

# 3. Re-verify in CI; non-zero exit on drift.
npx legalithm check
```

Get a key at <https://www.legalithm.com> → Settings → API Keys.

## Commands

| Command | Key? | What it does |
|---|---|---|
| `setup` | no | Wires Claude Code hooks + Cursor rules + the MCP server into the repo (idempotent, non-destructive). |
| `guard` | no | Fast **offline** gate for hooks/CI: AI deps present without a record? Exit `2` (blocks), `--warn` for a non-blocking nudge. |
| `init` | yes | Detects the stack and generates `compliance/legalithm.json` + `annex-iv.md` + `checklist.md`. |
| `check` | yes | Re-verifies the committed record; exits non-zero on input/rule/risk **drift** (for CI). |
| `classify` | yes | Quick risk hint for the current repo. |
| `login` | — | Saves an API key. |

## Make it a mandatory step

`legalithm setup` installs a Claude Code **`Stop` hook** that runs `legalithm guard`
— the agent can't finish a turn while AI code lacks a compliance record — plus a
non-blocking nudge after edits. Pair with the [GitHub Action](https://github.com/legalithm/legalithm)
as the CI backstop. `guard` is offline (no key, no network), only fires on a real AI
signal, and warns rather than blocks when the classification is uncertain.

## Exit codes (`check` / `guard`)

`0` in sync / ok · `1` drift ≥ threshold · `2` usage / no record (guard: blocking) · `3` API/auth/network.

## Stack detection

Node, Python, Go, Rust, Java, .NET, PHP, Ruby — by dependency manifest. Privacy-safe
(only dependency identifiers are read, never env values or file contents).

---
Not legal advice and not a certification — a checked, dated starting point. Verify
low-confidence results with a qualified person.
