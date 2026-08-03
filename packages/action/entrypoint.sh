#!/usr/bin/env bash
# Legalithm AI Act check — composite-action body.
# CLI invocation is injectable via LEGALITHM_CLI so it can be tested with a local
# build; in production it defaults to the published package.
set -uo pipefail

CLI="${LEGALITHM_CLI:-npx -y legalithm@latest}"
FAIL_ON="${LEGALITHM_FAIL_ON:-risk-or-rule}"

set +e
OUT=$($CLI check --json --fail-on "$FAIL_ON" 2>&1)
CODE=$?
set -e

echo "$OUT"

case "$CODE" in
  0) echo "::notice::EU AI Act compliance record is in sync." ;;
  1) echo "::error::EU AI Act compliance drift detected (risk/rule changed vs the committed record). Run 'legalithm check' locally to inspect." ;;
  2) echo "::warning::No compliance/legalithm.json found. Run 'npx legalithm init' and commit it." ;;
  3) echo "::error::Could not verify compliance (API/auth/network error)." ;;
  *) echo "::error::Unexpected 'legalithm check' exit code: $CODE" ;;
esac

exit "$CODE"
