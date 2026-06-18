# Legalithm AI Act Check — GitHub Action

Fails your CI when the committed EU AI Act compliance record (`compliance/legalithm.json`)
drifts — either because your app changed or because the law changed under you.

## Usage

```yaml
# .github/workflows/ai-act.yml
name: AI Act
on: [pull_request]
jobs:
  ai-act:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: legalithm/legalithm/packages/action@v1
        with:
          api-key: ${{ secrets.LEGALITHM_API_KEY }}
          # fail-on: risk-or-rule   # risk-or-rule (default) | risk | any | never
```

First generate and commit the record locally:

```bash
npx legalithm init      # writes compliance/legalithm.json
git add compliance && git commit -m "chore: add AI Act compliance record"
```

## Inputs

| Input | Default | Description |
|---|---|---|
| `api-key` | — (required) | Legalithm API key (`lgl_...`), stored as a secret |
| `api-url` | `https://www.legalithm.com` | API base URL |
| `fail-on` | `risk-or-rule` | `risk-or-rule` \| `risk` \| `any` \| `never` |
| `working-directory` | `.` | Directory containing `compliance/legalithm.json` |

## Exit behaviour

| `legalithm check` exit | Action result | Annotation |
|---|---|---|
| 0 | pass | `::notice::` in sync |
| 1 | **fail** | `::error::` drift detected |
| 2 | fail | `::warning::` no record found |
| 3 | fail | `::error::` API/auth/network error |

> Output is informational — checked against Regulation (EU) 2024/1689, not legal advice.
