/**
 * Usage text for every `legalithm cra` subcommand, in one place.
 *
 * `legalithm cra report --help` printed the GLOBAL help, cut off at the
 * subcommand list, because the top-level router answered `--help` before the
 * `cra` branch ever saw the subcommand. The usage lines existed, one per
 * command, but only on the failure path (missing flags), so a person asking
 * for help got the one text that did not answer them.
 *
 * Kept as data rather than prose in each command so `--help`, the missing-flag
 * path and the tests all read the same lines.
 */

export const CRA_USAGE: Readonly<Record<string, readonly string[]>> = {
  classify: [
    'Usage: legalithm cra classify --kind <software|hardware|component|service_only> [flags]',
    '  --connected / --no-connected      Article 2(1) data connection test',
    '  --commercial / --no-commercial    Article 3(22) commercial activity',
    '  --eu-market / --no-eu-market      made available on the Union market',
    '  --excluded <medical|ivd|vehicle|aviation|marine|spare_part|defence>',
    '  --rdps-distance --rdps-manufacturer --rdps-function   Article 3(2), for service_only',
    '  --annex-iii <class_i|class_ii> | --annex-iv',
    '  --role <manufacturer|importer|distributor|...> [--rebrands]',
  ],
  product: [
    'Usage: legalithm cra product --name <name> --version <version> [--class <class>]',
    '  --support-until <YYYY-MM-DD>      Article 13(8) end date (rationale via cra support)',
    '  --third-party --manufacturer <name>   register a product you did not make',
  ],
  ingest: [
    'Usage: legalithm cra ingest --sbom <path> | --declare "<statement>" --by "<name>" | --attestation <path>',
    '  --analysis                        the SBOM came from binary analysis, not a build',
    '  --product <id>                    when more than one product is registered',
    '  --observed-at <ISO date>          when the evidence was taken',
  ],
  watch: [
    'Usage: legalithm cra watch --osv <osv-dump> [--kev <kev.json>] [--epss <csv> | --epss-fetch]',
    '  --became-aware-at <ISO timestamp> | --became-aware-now   required before an Article 14 clock starts',
    '  --ir <dirs> --entry <fn> --symbols <map> [--analyser <name>]   reachability, turns presence into exploitability',
    '  --product <id>',
  ],
  simulate: [
    'Usage: legalithm cra simulate --scenario <name> [--became-aware-at <ISO> | --became-aware-now]',
    '  --product <id> --owner "<name>"    writes nothing; shows the Article 14 clocks for a scenario',
  ],
  claim: [
    'Usage: legalithm cra claim --cve <CVE> --verdict <not_affected|affected|fixed> --by "<name>" [--rationale "..."]',
    '  --supersedes <claim id>           replace an earlier verdict rather than editing it',
  ],
  report: [
    'Usage: legalithm cra report --cve <CVE> --stage <early-warning|vulnerability|final> [--out <dir>]',
    '  --member-states "DE,FR"           Article 14(2)(a) requires these where applicable',
    '  --remedy-at <ISO date>            starts the Article 14(2)(c) 14-day clock',
    '  --incident --cve <ref>            Article 14(3) and (4) severe incident chain',
    '  --notified-at <ISO date>          when the 72-hour notification was submitted (incident final report clock)',
    '  --suspected-malicious | --not-suspected-malicious   Article 14(4)(a)',
  ],
  advise: [
    'Usage: legalithm cra advise --cve <CVE|incident-ref> [--incident]',
    '  --mitigation "a; b"               what users can deploy, semicolon separated',
    '  --affected-versions "..."         which versions users should check',
    '  --issued-at <date>                record that users HAVE been informed',
    '  --out <path>',
  ],
  record: [
    'Usage: legalithm cra record [--sign --key <path> --key-id <your-org>] | [--verify]',
    '  --sign      sign compliance/cra/record.json with YOUR Ed25519 key (read from a file, never an argument)',
    '  --verify    check the record, its detached signature and every pinned document, offline',
  ],
  support: [
    'Usage: legalithm cra support --until <YYYY-MM-DD> --by "<name>" --rationale "<what you took into account>"',
    '  --placed-on <YYYY-MM-DD>          when the product was placed on the market',
    '  --expected-use-shorter            affirm the period is under five years by design (Article 13(8))',
    '  (no flags)                        show the current support period and its status',
  ],
  doc: [
    'Usage: legalithm cra doc --type <technical-file|declaration> [--out <path>] [--format md|html|pdf]',
  ],
  assess: [
    'Usage: legalithm cra assess [--gaps] | --ref "<Annex I ref>" --status <met|not_met|not_applicable> --by "<name>" [--rationale "..."]',
  ],
  risk: [
    'Usage: legalithm cra risk --document <path> --by "<name>" --summary "<one line>"   Article 13(2) assessment, pinned by content',
  ],
  policy: [
    'Usage: legalithm cra policy --document <path> --kind <kind> --by "<name>" --summary "<one line>"',
  ],
  monitor: [
    'Usage: legalithm cra monitor [--since <ISO date>]   exit 3 when something wants a person, 0 when quiet',
  ],
  push: [
    'Usage: legalithm cra push [--dry-run]   snapshot the SAFE half to your account; needs legalithm login',
  ],
  supplier: [
    'Usage: legalithm cra supplier <discover|request|attest|verify|status> [flags]',
    '  discover ask WHO, from installed manifests. No registry lookups.',
    '  request  --component <name> --component-version <v> --cve <CVE> --by "<your org>" [--out <path>]',
    '  attest   --request <path> --verdict <not_affected|affected|fixed> --by "<name>" --org "<org>" --key <path> --key-id <id>',
    '  verify   <attestation.json>   check one from the file alone, offline',
    '  status   what was asked, what came back, what is still open',
  ],
};

const OVERVIEW: readonly string[] = [
  'Usage: legalithm cra <subcommand> [flags]        (legalithm cra <subcommand> --help for its flags)',
  '  classify  does the CRA apply, and in which class',
  '  product   register a product version, or --third-party analysis',
  '  ingest    SBOM or a signed declaration into the evidence store',
  '  watch     join components to advisories, rank by exploitation',
  '  simulate  the Article 14 clocks for a scenario, writes nothing',
  '  claim     a named human signs a VEX verdict',
  '  assess    Annex I: 22 requirements, gap report',
  '  support   Article 13(8) support period register',
  '  risk      Article 13(2) risk assessment, pinned by content',
  '  policy    a Part II policy or advisory, pinned by content',
  '  doc       Annex VII technical file / Annex V declaration draft',
  '  report    Article 14 notifications, vulnerability or --incident',
  '  advise    Article 14(8) advisory to USERS',
  '  supplier  ask a component supplier about one CVE, and verify their answer',
  '  monitor   what changed since the record was signed (exit 3 = look)',
  '  push      snapshot the SAFE half to your account (--dry-run to see it)',
  '  record    the dated evidence record; --sign and --verify',
];

/** The lines to print for `legalithm cra [<sub>] --help`. */
export function craUsageLines(sub?: string): readonly string[] {
  if (sub && CRA_USAGE[sub]) return CRA_USAGE[sub]!;
  return OVERVIEW;
}
