# The CRA record format

`legalithm.cra.record/v0.2`

A dated, attributed, independently checkable statement of what a manufacturer
knew about a product version and what they decided about it, under Regulation
(EU) 2024/2847.

This document specifies the format. It is published so that a record outlives
the tool that wrote it and the company that wrote the tool.

## Licence

**This specification is licensed CC BY 4.0.**
<https://creativecommons.org/licenses/by/4.0/>

Copy it, quote it, translate it, embed it in your own documentation. The only
condition is attribution.

**Implementing this format requires nothing from you.** A licence on a document
covers the document. An implementation written from a specification is not a
derivative work of its text, so building a reader or a writer for
`legalithm.cra.record` carries no attribution obligation, no notice requirement,
and no permission to ask for. That asymmetry is deliberate: the text carries a
credit trail, the format carries none.

The reference implementation is separately MIT licensed: `packages/cli`,
published to npm as `legalithm`.

## The commitment

**This format is open and irrevocable.**

- Every published version stays published and stays documented. `v0.2` will not
  be withdrawn, relicensed, or moved behind a paid tier.
- The format will not be made proprietary. There will never be a version of this
  document that says "contact us for the specification".
- A record written under a published version stays parseable under that version
  forever. Evolution happens by publishing a new version, not by changing the
  meaning of an old one.
- The reference implementation is source-available: `packages/cli` in this
  repository, MIT licensed, published to npm as `legalithm`.

This commitment is the point. A conformity record has to be readable in 2036 by
someone with no relationship to us, possibly because we no longer exist. A format
that can be revoked is a format that cannot carry that weight.

**What is not promised:** that `v0.2` is final. It is early and it will grow.
What is promised is that growth happens in a new version and `v0.2` keeps
meaning what it means here.

### Why v0.2 and not v0.1

`v0.1` was never published as a specification. Its shape changed three times on
2026-08-15, gaining `annexI`, `supportPeriod` and hypothesis `provenance` in a
single day. Freezing that would have meant freezing something that had already
moved. `v0.2` is the first version this commitment applies to. Records written
under `v0.1` exist and remain readable; they are simply not covered by the
promise above.

## Document shape

A record is one JSON object.

| Field | Type | Meaning |
|---|---|---|
| `schema` | string | `legalithm.cra.record/v0.2`. The version this document specifies. |
| `generatedAt` | ISO 8601 | When this file was written. **Not hashed.** |
| `asOf` | ISO 8601 | The cutoff the record was built at. **Not hashed** when it defaults to generation time. |
| `instrument` | string | `Regulation (EU) 2024/2847`. |
| `products` | array | The product versions this record covers. |
| `evidenceCount` | integer | How many evidence rows the record was built from. |
| `hypotheses` | array | Machine findings. Never conclusions. |
| `claims` | array | Positions a named human has signed. |
| `usersNotInformed` | array | Article 14(8) duties to users that are still open. |
| `openClocks` | array | Article 14 reporting deadlines still running. |
| `supportPeriod` | object or null | Article 13(8). Null means not determined, which is a live obligation. |
| `annexI` | object | Annex I determinations, and what is still undetermined. |
| `notice` | string | Human-readable statement of what the record is and is not. |
| `recordHash` | hex string | SHA-256 over the content. See below. |

### `hypotheses[]`

A hypothesis is what a machine concluded. It is **never** a conformity
statement, and it stays `under_investigation` however confident the machine was,
until a named person signs it.

| Field | Meaning |
|---|---|
| `cve`, `component`, `product` | What the finding is about. |
| `machineVerdict` | `not_affected` / `affected` / `under_investigation` / `not_assessed`. What the analysis concluded. |
| `status` | `under_investigation` until signed, then the signed verdict. |
| `signedBy` | The person who signed it, or `null`. |
| `signedAt` | When, if signed. |
| `rationale`, `callPath` | Optional supporting detail. |
| `provenance` | What produced it. See below. |

`machineVerdict` and `status` are deliberately separate. Collapsing them would
throw away the analysis, or promote it to a conclusion nobody signed.

### `hypotheses[].provenance`

| Field | Meaning |
|---|---|
| `tool` | Stable id of the producing software, e.g. `legalithm-cli`. |
| `toolVersion` | The exact build. |
| `model` | Model identifier, or `null` when no model was involved. |
| `promptVersion` | Prompt version, or `null` when no model was involved. |

`model` and `promptVersion` are **present and null** for a deterministic finding,
never absent. "Produced by a rule" and "nobody recorded what produced this" are
different facts and a reader must be able to tell them apart.

There is **no timestamp here**. The row's date lives on the store envelope
(`observedAt`, `recordedAt`); a third date would be a second answer to the same
question. When reading a record rather than a store, use `generatedAt` for when
the document was produced and `signedAt` for when a human committed to a finding.

A producer of `unrecorded` means the row predates this field. It does not mean
the finding is invalid; it means its origin was never captured, and it should not
be attributed to any particular tool.

### `claims[]`

A claim is a position a **named human** has signed. It is the load-bearing object
in this format: a hypothesis is a machine's opinion and carries no weight, a
claim is somebody's name against a verdict, and the difference is the entire
design.

| Field | Meaning |
|---|---|
| `cve` | What the claim is about. |
| `verdict` | `not_affected` / `affected` / `fixed`. The position taken. |
| `assertion` | The statement in the claimant's own words. |
| `rationale` | Why. Required: a verdict with no reasoning is not evidence. |
| `declaredBy` | The person. Not a team, not a tool. |
| `declaredAt` | When they committed to it. |
| `fromHypothesisId` | The hypothesis this converted, when it came from one. |

Nothing but a human writes here. No machine verdict, however confident, becomes
a claim on its own, and there is no field that lets one. A tool may propose; a
person concludes.

A claim is never edited. The store is append-only, so revising a position means
writing a new claim, and the later one governs. Both stay in the history, because
"they concluded X on 12 March and Y on 4 June" is exactly what an auditor is
entitled to see, and overwriting it would destroy the thing this format exists
to preserve.

`declaredBy` is a string and this format does not attempt to authenticate it. A
name in a record is a name somebody typed. What binds it is the signature over
the record: the claim is inside the hashed content, so signing the record signs
the claim, and a claim cannot be altered afterwards without breaking the hash.

### `annexI`

| Field | Meaning |
|---|---|
| `determined[]` | `ref`, `status` (`met` / `not_met` / `not_applicable`), `declaredBy`, `declaredAt`, `rationale`. |
| `notAssessed[]` | Requirement refs with no determination. |

`notAssessed` is explicit rather than inferred from what is missing. "We have not
determined this yet" and "this requirement does not appear in the record" read
identically to a human and mean very different things to an auditor.

There is no automatic `met`. A requirement is `met` because a named person said
so, or it is not met.

### `supportPeriod`

`until`, `declaredBy`, `declaredAt`, and `rationale` when one was given.
`null` means no support period has been determined, which under Article 13(8) is
an outstanding obligation rather than an absent field.

## The hash

`recordHash` is SHA-256 over the record with three fields removed:

- `recordHash` itself
- `generatedAt`
- `asOf`

The two timestamps are excluded because they are "the moment you ran it".
Including either would make two runs over identical evidence produce different
hashes, which breaks offline verification and makes a signature unreproducible.

**The hash covers content, not the clock.** Identical evidence must produce an
identical hash.

Serialisation is canonical: object keys sorted, no insignificant whitespace. The
reference implementation is `contentHash` in `packages/record-core`.

## Signatures

A signature is detached, in `record.signature.json` beside the record:

```json
{ "algorithm": "Ed25519", "keyId": "your-org-2026", "signature": "base64..." }
```

It signs the `recordHash` string. The public key is published beside it in
`verification-keys.json` as `{ "keys": { "<keyId>": "<PEM>" } }`.

**The customer holds the private key. Legalithm holds none and will not issue
one.** A vendor-held key would make the record "verifiable if you trust the
vendor's key custody", which is the thing a signature is supposed to replace.

A key id is bound to one key permanently. Rebinding it would silently invalidate
every record already signed under it, so rotation means a new id, and the old
public key stays published so earlier records keep verifying.

## Verifying a record you were given

You need three files and nothing else: the record, the signature, the public
keys. No network, no account, no dependence on Legalithm existing.

A self-contained verifier ships beside this document. It needs no account, no
network and no Legalithm software:

```bash
python3 docs/cra-record-verify.py compliance/cra
```

It shares no code with the CLI, uses a different language and a different crypto
library, and was written from this document alone. That is deliberate: the CLI's
own verifier would agree with a wrong specification just as readily as a right
one, so it cannot be the evidence that this document is sufficient. The Python
one can.

The CLI can also check a record it produced:

```bash
legalithm cra record --verify
```

⚠️ `--verify` is **not in a released version yet**. The current npm release,
`legalithm@0.6.1`, does not have it. Use the Python verifier above until the
next release, or run the CLI from source.

Or implement it yourself, which is the point of publishing this:

1. Parse the record. Remove `recordHash`, `generatedAt`, `asOf`.
2. Canonically serialise the remainder and take SHA-256. Compare to `recordHash`.
   If they differ, the record has been altered since it was generated. Stop.
3. Look up `signature.keyId` in `verification-keys.json`. Verify the Ed25519
   signature over the `recordHash` string.

### What a valid signature proves, and what it does not

It proves the record is unaltered, and that it was signed by whoever holds the
private key for that key id.

It does **not** prove who that is. The public key is typically read from the same
repository being checked, so on its own the signature proves possession of a key,
not identity. Confirm the key with the organisation through some channel other
than the repository you are auditing, and the signature then carries attribution.

A signature over a hash the content no longer produces is not a valid record. The
signature may be genuine and still cover a document that no longer exists. Report
that as altered, never as valid.

## What a record is not

It is **evidence, not a declaration of conformity.** Conformity under Regulation
(EU) 2024/2847 stays with the manufacturer. Nothing in this format asserts that a
product is compliant, and no field can be set to make it do so.

Zero findings is not "not affected". It is the limit of what was searched.
