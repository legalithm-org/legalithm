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
| `mark` | no | Embed a C2PA "AI-generated" credential (Article 50(2)) in an image; `--watermark` adds a second layer that survives redistribution; `--check` flags unmarked assets in CI. |
| `verify` | no | Detect AI content marking on an asset (C2PA credential + pixel watermark); `--check` scans a directory. |
| `login` | — | Saves an API key. |

## Make it a mandatory step

`legalithm setup` installs a Claude Code **`Stop` hook** that runs `legalithm guard`
— the agent can't finish a turn while AI code lacks a compliance record — plus a
non-blocking nudge after edits. Pair with the [GitHub Action](https://github.com/PedramMadani/legalithm)
as the CI backstop. `guard` is offline (no key, no network), only fires on a real AI
signal, and warns rather than blocks when the classification is uncertain.

## Mark AI-generated content (Article 50)

Article 50(2) requires providers to mark AI-generated content so it is detectable as
artificial. `legalithm mark` embeds a verifiable [C2PA](https://c2pa.org) Content
Credential declaring an image AI-generated, and flags unmarked assets in CI.

Marking uses a native C2PA signer shipped as an **optionalDependency** (`c2pa-node`).
A normal `npm install legalithm` (or install from a packed tarball) tries to resolve
it; if the native build fails on your platform, marking degrades gracefully and you
can install manually:

```bash
npm i c2pa-node        # or `npm i -g c2pa-node`
```

```bash
# Sign one image → writes <name>.signed.<ext> (non-destructive; --out to override)
legalithm mark hero.png --agent "DALL-E 3"

# CI gate: fail if any image under a directory has no credential
legalithm mark --check public/     # exit 1 on unmarked assets; --warn to only warn
```

By default it signs with a bundled **test** certificate: the manifest is valid and
verifiable but not on the public C2PA trust list. For production, supply your own:

```bash
legalithm mark hero.png --cert cert.pem --key key.pem
```

### Two layers, because metadata does not survive

A C2PA manifest is metadata, and metadata is stripped by ordinary redistribution:
re-encoding, resizing, screenshots, most social platforms. That is why the EU's
Code of Practice on marking and labelling AI-generated content asks for a
**layered** approach rather than a single marker.

`--watermark` adds the second layer, a spread-spectrum watermark carried in the
pixels themselves. It needs the optional `sharp` dependency.

```bash
npm i sharp

# Both layers: pixel watermark, then a C2PA credential signed over it
legalithm mark hero.png --watermark --agent "DALL-E 3"
```

Measured on a photographic reference image, the watermark survives lossy JPEG
(down to q50), up- and down-scaling, greyscale conversion, and format changes
that destroy the manifest entirely. It is defeated by heavy cropping and
rotation. The full table, including the failures, is in
[ROBUSTNESS.md](./ROBUSTNESS.md).

**It is not an adversarial guarantee.** Generative regeneration attacks can
remove pixel-level watermarks. Treat this as resilience against ordinary
distribution loss, and do not claim more than that.

## Detect AI content marking

Article 50(2) is not only about marking your own output. The Code of Practice
also asks providers to make **detection** available, so anyone can check an
asset. `legalithm verify` reads both layers and reports what it finds.

```bash
# Inspect one asset
legalithm verify photo.jpg
legalithm verify photo.jpg --json      # machine-readable

# CI gate across a directory
legalithm verify --check public/       # exit 1 if anything is unmarked; --warn to only warn
```

A `partial` verdict is informative rather than a failure: it usually means the
asset was redistributed, the manifest was stripped, and the watermark is what
survived to prove the content is AI-generated.

## Exit codes (`check` / `guard` / `mark` / `verify`)

`0` in sync / ok · `1` drift ≥ threshold (or `mark --check` / `verify` found
unmarked assets) · `2` usage / no record (guard: blocking) ·
`3` API/auth/network/signing.

## Stack detection

Node, Python, Go, Rust, Java, .NET, PHP, Ruby — by dependency manifest. Privacy-safe
(only dependency identifiers are read, never env values or file contents).

---
Not legal advice and not a certification — a checked, dated starting point. Verify
low-confidence results with a qualified person.
