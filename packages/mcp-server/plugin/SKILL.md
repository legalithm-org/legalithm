---
name: eu-ai-act-compliance
description: Use when adding, changing or reviewing an AI feature that will be available in the EU, or when someone asks about the EU AI Act, risk tiers, Article 50 transparency, or what obligations apply. Classifies the use case and cites the Regulation rather than guessing.
---

# EU AI Act compliance

The EU AI Act (Regulation (EU) 2024/1689, as amended by Regulation (EU) 2026/1744)
applies to AI systems placed on the EU market. This skill routes the work to the
`legalithm` MCP tools, which answer from a versioned rule corpus and cite an
Article for every claim.

## When to reach for this

- A new AI feature is being added, or an existing one materially changes
- Someone asks "does the AI Act apply to us?" or "what do we have to do?"
- A customer questionnaire, tender, or investor asks about AI compliance
- A chatbot, generated content, deepfake, or emotion-recognition feature ships

## How to work

**Rule, before anything else: `classify` runs first.** Every `risk` argument you
pass to another tool must come from a `classify` result in this conversation,
never from your own reading of the case. If you have not called `classify` yet,
you do not know the tier, and calling `explain_obligation` with a guessed tier
returns a confident list of the wrong duties. Guessing "high" and being right is
not the same as knowing.

**1. Classify.** Call `classify` with the role (`provider` or `deployer`), the
domain, a plain-sentence description of the use case, and the audience. It
returns a risk tier — unacceptable, high, limited, or minimal — with a cited
rationale and a confidence. The tier determines everything downstream.

**2. Get the actual duties.** Call `explain_obligation` with the role and the
tier **as returned by `classify`**. Each obligation comes back with its Article
citation, for example Article 9 risk management or Article 10 data governance.
Use those named duties. Do not paraphrase the Act from memory and do not write
fear copy.

**3. Article 50 transparency.** If the feature is user-facing AI, generate the
disclosure with `generate_disclosure` rather than hand-writing legal text.
Scenarios are `chatbot` (Art 50(1)), `genai-content` (Art 50(2)), `deepfake`
(Art 50(4)) and `emotion` (Art 50(3)); English and German are supported. Article
50 has applied since **2 August 2026**, so this is a live obligation, not a
future one.

**4. Keep the record current.** `compliance/legalithm.json` is the committed
compliance record. Run `npx legalithm check` before shipping; if it reports
drift, re-run `init` and review the diff.

## How to talk about the results

- Frame output as **checked against Regulation (EU) 2024/1689 — not legal
  advice**. The tools give a cited starting point that a human reviews.
- Never claim "instant compliance", "compliant by default", or "guaranteed".
- Every answer carries an `asOf` date from the corpus. If the user is making a
  decision that depends on a date, surface it rather than hiding it.
- When a result is low-confidence, say so and recommend human review. A
  confident wrong answer about a legal obligation is worse than no answer.

## What runs where

`classify`, `explain_obligation` and `generate_disclosure` run entirely offline
— the rule corpus ships with the server, so no source code, prompt or result
leaves the machine. `check_record` is the only tool that makes a network call,
fetching a public Trust Center record by the org slug you give it.
