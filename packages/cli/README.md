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
| `verify-record` | no | **Offline** integrity check of `compliance/legalithm.json`: recomputes its hash and confirms which rule corpus produced it. |
| `login` | — | Saves an API key. |

## Make it a mandatory step

`legalithm setup` installs a Claude Code **`Stop` hook** that runs `legalithm guard`
— the agent can't finish a turn while AI code lacks a compliance record — plus a
non-blocking nudge after edits. Pair with the [GitHub Action](https://github.com/PedramMadani/legalithm)
as the CI backstop. `guard` is offline (no key, no network), only fires on a real AI
signal, and warns rather than blocks when the classification is uncertain.

## Check a compliance record without trusting us

A compliance record is only worth what someone else can confirm about it. An
auditor, a customer, or a regulator can check yours **offline** — no API key, no
network call, and nothing that depends on Legalithm being reachable, solvent, or
honest at the moment they look.

```bash
legalithm verify-record
```

It answers two questions:

**Has this record been altered since it was generated?** `recordHash` is a
SHA-256 over the record's contents. `verify-record` recomputes it and compares.
Any edit to the classification, the inputs, or the findings changes the digest.

**Which rules produced this answer?** This is the less obvious one and it is the
part worth having. A compliance classification is only meaningful against a
specific version of the rules, and the rules move — the AI Act has been amended
once already and Commission guidance keeps arriving. The record carries an
engine version that is a hash of the exact `risk_map.json` corpus that produced
it, so "this system was rated limited-risk" becomes "this system was rated
limited-risk under *these* rules, on this date".

When the record's engine version differs from the corpus bundled in your CLI,
`verify-record` prints a warning and still **exits 0** — the record is intact,
it was simply produced under older rules, and that is a fact about the record
rather than a fault in it. Use `legalithm check` for the CI gate: that one
re-runs the classification and exits non-zero on real drift.

### What it does not prove

**It does not prove who issued the record.** A hash is tamper-*evidence*, not
attribution: anyone can write a record and compute a matching digest for it. If
the question you are being asked is "who stands behind this claim", the hash is
not the answer to it.

Say what the hash alone gives you and no more: an unaltered record, bound to a
known version of the rules, checkable by anyone, forever, with no key. To get
attribution, sign it.

## Sign the record, so it proves who issued it

`sign-record` attaches a detached Ed25519 signature. **You hold the key.
Legalithm does not have one and will not issue one**, which is the only way
"independently verifiable" means anything here: a vendor-held key would make it
"verifiable if you trust the vendor's key custody", which is the thing a
signature is supposed to replace. The options considered and the reasoning are
in [docs/RECORD-SIGNING.md](../../docs/RECORD-SIGNING.md).

```bash
# once: generate your organisation's signing key, and keep it private
openssl genpkey -algorithm ed25519 -out acme-signing.key
chmod 600 acme-signing.key

# after each init/check that rewrites the record
legalithm sign-record --key ./acme-signing.key --key-id acme-gmbh-2026
```

| File | Commit it? | What it is |
|---|---|---|
| `compliance/legalithm.json.sig` | yes | the detached signature |
| `compliance/verification-keys.json` | yes | your **public** key, so a verifier needs nothing from you |
| `acme-signing.key` | **never** | your private key. Put it in `.gitignore`. |

Anyone can then verify with no key, no account and no network:

```bash
legalithm verify-record
# ✓ Record integrity OK. recordHash=5391c151b1342179…
#   Detached signature: valid (key "acme-gmbh-2026")
```

The key is read from a file path, never from an argument, so it cannot end up in
your shell history or the process table. `LEGALITHM_SIGNING_KEY` may hold the
path in CI.

`--key-id` names the key so an auditor can look it up. Reusing an id for a
different key is refused, because it would silently invalidate every record
signed under the old one: rotate by choosing a new id, and the old public key
stays in `verification-keys.json` so earlier records still verify.

### What signing still does not prove

`verify-record` reads the public key out of the same repository it is checking.
On its own, a valid signature therefore proves the record was signed by whoever
holds that key, not who that is, and the command says so instead of letting you
assume otherwise. Confirm the key with the organisation through a channel other
than the repository you are auditing, and the signature then does carry
attribution.

`sign-record` refuses to sign a record whose body no longer matches its
`recordHash`. A signature over an edited record would launder the edit as
attested, which is worse than no signature at all.

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
