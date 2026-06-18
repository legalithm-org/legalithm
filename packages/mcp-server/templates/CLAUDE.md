<!-- Add to your project's CLAUDE.md (Claude Code) or AGENTS.md. -->

## EU AI Act compliance (Legalithm)

This project ships AI into the EU — the EU AI Act applies. When adding/changing AI features:

- **Classify first** with the `legalithm` MCP `classify` tool (risk tier: unacceptable / high / limited / minimal).
- **Article 50:** for user-facing AI (chatbots, generated content, deepfakes, emotion recognition), add a transparency disclosure via `generate_disclosure` — don't hand-write legal text.
- Frame outputs as **checked against Regulation (EU) 2024/1689 — not legal advice**; never claim "instant compliance."
- Use `explain_obligation` for the named duties (with Article citations), not fear copy.
- `compliance/legalithm.json` is the committed record. Run `npx legalithm check` before shipping; fix drift via `init`.
