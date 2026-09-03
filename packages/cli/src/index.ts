#!/usr/bin/env node
/**
 * legalithm — ship EU-AI-Act-compliant by default.
 *   legalithm discover  Scan the repo for AI SDKs/models, print an inventory; --push registers it
 *   legalithm init    Detect the stack, generate compliance/legalithm.json (+ Annex IV, checklist)
 *   legalithm check   Re-verify the record; fail CI on drift (risk/rule)
 *   legalithm classify  Quick risk hint for the current repo
 *   legalithm login --key-file ./key.txt   Save an API key
 * Output is informational — not legal advice, never "compliant by default".
 */
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, relative } from 'path';
import { createHash } from 'crypto';
import { parseArgs, flagString, flagBool } from './args.js';
import { detectStack } from './detect.js';
import { resolveApiUrl, resolveApiKey } from './config.js';
import { postJson, onAuthFailure, latestVersionSeen } from './http.js';
import { recordSecurityEvent } from './security-log.js';
import { runReset, runDataExport, runDataDelete, runSecurity, updateCachePath } from './commands/data.js';
import { readUpdateCache, writeUpdateCache, updateNotice, updateNoticeEnabled } from './update-notice.js';
import { readRecord } from './record-io.js';
import { runInit } from './commands/init.js';
import { runCheck } from './commands/check.js';
import { runDiscover } from './commands/discover.js';
import { scan as sharedScan } from './discovery/scan.js';
import { runLogin } from './commands/login.js';
import { runGuard, type HookMode } from './commands/guard.js';
import { mergeClaudeSettings, mergeMcpConfig, CURSOR_RULE, CLAUDE_MD_SNIPPET, SETUP_FILES, DEFAULT_CLI } from './commands/setup.js';
import { runMark, mimeForFile } from './commands/mark.js';
import { runVerify } from './commands/verify.js';
import { runVerifyRecord, signaturePath } from './commands/verify-record.js';
import { runSignRecord } from './commands/sign-record.js';
import { RECORD_DIR, VERIFICATION_KEYS_FILE } from './record-io.js';
import { emitSurfaceActive, flushTelemetry, CLI_TELEMETRY_COMMANDS } from './telemetry.js';
import { craPush } from './cra/push.js';
import { eaaIngest, eaaClock, ADAPTERS } from './eaa/commands.js';
import { craMonitor } from './cra/monitor.js';
import { craSimulate } from './cra/simulate.js';
import { craProduct, craIngest, craWatch, craRecord, craClaim, craClassify, craAssess, craDoc, craSupport, craReport, craAdvise, craSupplierRequest, craSupplierAttest, craSupplierVerify, craSupplierDiscover, craSupplierStatus, craRisk, craPolicy, recomputeRecordHash } from './cra/commands.js';
import {
  loadSigningKey,
  signRecordHash,
  renderSignatureFile,
  publicKeyPemFor,
  parseVerificationKeys,
  renderVerificationKeys,
  type VerificationKeysFile,
} from './record-signing.js';
import {
  parseSignatureFile,
  verifyDetachedSignature,
  registerVerificationKey,
  isBuiltInKeyId,
} from './record-signature.js';
import { runApplies } from './union.js';
import { maybePromptSaveShare } from './save-share-prompt.js';
import type { StackInput, UseCase, StoredRecord, ProviderRole, Domain, Audience } from './types.js';

// Re-exported from ./version.js so cra/ can read it without importing this file.
import { VERSION } from './version.js';
const DISCLAIMER = 'Checked against Regulation (EU) 2024/1689 — not legal advice.';

interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(cwd: string): PackageJson {
  const path = join(cwd, 'package.json');
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PackageJson;
  } catch {
    return {};
  }
}

// Read non-Node dependency manifests (top-level only) for cross-language detection.
const MANIFEST_FILES = [
  'requirements.txt', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle',
  'build.gradle.kts', 'composer.json', 'Gemfile', 'pubspec.yaml',
];
function readManifests(cwd: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of MANIFEST_FILES) {
    const p = join(cwd, f);
    if (existsSync(p)) {
      try { out[f] = readFileSync(p, 'utf8'); } catch { /* ignore */ }
    }
  }
  // .NET project files have arbitrary names; scan the top level for *.csproj.
  try {
    for (const entry of readdirSync(cwd)) {
      if (entry.endsWith('.csproj')) {
        try { out[entry] = readFileSync(join(cwd, entry), 'utf8'); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  return out;
}

/** G3.2: read GitHub Actions workflows + Docker/compose files (bounded, shallow). */
function readCiIacManifests(cwd: string): Record<string, string> {
  const out: Record<string, string> = {};
  const tryRead = (rel: string) => {
    const abs = join(cwd, rel);
    try {
      if (existsSync(abs) && statSync(abs).isFile()) out[rel] = readFileSync(abs, 'utf8');
    } catch {
      /* ignore */
    }
  };

  const workflowsDir = join(cwd, '.github', 'workflows');
  try {
    if (existsSync(workflowsDir) && statSync(workflowsDir).isDirectory()) {
      for (const entry of readdirSync(workflowsDir)) {
        if (!/\.ya?ml$/i.test(entry)) continue;
        tryRead(join('.github', 'workflows', entry));
      }
    }
  } catch {
    /* ignore */
  }

  try {
    for (const entry of readdirSync(cwd)) {
      if (/^Dockerfile(\.|$)/i.test(entry) || /^docker-compose(\..+)?\.ya?ml$/i.test(entry)) {
        tryRead(entry);
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

// Bounded, shallow walk of the repo's source files (relative paths) so chat/assistant
// route files can be detected (P2-B1). Skips vendored/build dirs; capped in depth + count.
const WALK_SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo', 'vendor']);
function readSourcePaths(cwd: string, maxFiles = 4000): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 7 || out.length >= maxFiles) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      if (WALK_SKIP.has(e) || e.startsWith('.')) continue;
      const abs = join(dir, e);
      let isDir = false;
      try {
        isDir = statSync(abs).isDirectory();
      } catch {
        continue;
      }
      if (isDir) walk(abs, depth + 1);
      else out.push(relative(cwd, abs));
    }
  };
  walk(cwd, 0);
  return out;
}

/**
 * G3.1: read the three MCP config paths that `legalithm setup` writes.
 * Dotfiles are skipped by readSourcePaths; these are explicit known-path reads
 * (not an expanded walk). Bound unchanged (maxFiles still 4000).
 */
function readMcpConfigs(cwd: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of ['.mcp.json', '.cursor/mcp.json', '.claude/settings.json'] as const) {
    const abs = join(cwd, rel);
    try {
      if (!existsSync(abs) || !statSync(abs).isFile()) continue;
      out[rel] = readFileSync(abs, 'utf8');
    } catch {
      /* unreadable — skip */
    }
  }
  return out;
}

function buildUseCase(flags: Record<string, string | boolean>, seed: Partial<UseCase>, pkg: PackageJson): UseCase {
  return {
    role: (flagString(flags, 'role') ?? seed.role ?? 'deployer') as ProviderRole,
    domain: (flagString(flags, 'domain') ?? seed.domain ?? 'other') as Domain,
    use_case: flagString(flags, 'use-case') ?? seed.use_case ?? pkg.description ?? 'AI feature shipped to EU users',
    audience: (flagString(flags, 'audience') ?? seed.audience ?? 'general') as Audience,
  };
}

function readJsonSafe(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// Scaffold the Claude Code + Cursor integration. Idempotent + non-destructive.
function runSetup(cwd: string): number {
  const written: string[] = [];
  const skipped: string[] = [];
  // If the CLI is installed locally, the per-edit hook can use `npx legalithm`
  // (resolves the local bin instantly) instead of `npx -y legalithm` (which
  // re-checks the registry / cold-fetches). Otherwise fall back to the fetch form.
  const cliLocal = existsSync(join(cwd, 'node_modules', '.bin', 'legalithm'));
  const cli = cliLocal ? 'npx legalithm' : DEFAULT_CLI;
  for (const file of SETUP_FILES) {
    const abs = join(cwd, file.path);
    mkdirSync(dirname(abs), { recursive: true });

    if (file.action === 'merge-json') {
      const current = existsSync(abs) ? readJsonSafe(abs) : {};
      const merged = file.path.endsWith('settings.json') ? mergeClaudeSettings(current, cli) : mergeMcpConfig(current);
      writeFileSync(abs, `${JSON.stringify(merged, null, 2)}\n`);
      written.push(file.path);
    } else if (file.action === 'write') {
      writeFileSync(abs, CURSOR_RULE);
      written.push(file.path);
    } else if (file.action === 'append') {
      const existing = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
      if (file.marker && existing.includes(file.marker)) {
        skipped.push(`${file.path} (already present)`);
      } else {
        writeFileSync(abs, existing + CLAUDE_MD_SNIPPET);
        written.push(file.path);
      }
    }
  }

  console.log('✓ Legalithm wired into Claude Code + Cursor:');
  written.forEach((w) => console.log(`  • ${w}`));
  skipped.forEach((s) => console.log(`  – ${s}`));
  console.log('\nClaude Code hooks now run `legalithm guard` automatically:');
  console.log('  · after edits — a non-blocking nudge if AI deps appear without a record');
  console.log('  · before finishing — blocks (JSON decision) until `compliance/legalithm.json` exists');
  if (!cliLocal) {
    console.log('  · tip: `npm i -D legalithm` for zero-latency hooks (skips the npx fetch each run)');
  }
  console.log('Cursor: the .mdc rule + MCP server are registered (offline classify/explain).');
  console.log('First Claude Code session: approve the `legalithm` MCP server when prompted (project-scoped).');
  console.log('Next: `npx legalithm init` to generate the record.');
  console.log(DISCLAIMER);
  return 0;
}

function help(): void {
  console.log(`Legalithm CLI v${VERSION}

Commands:
  setup    Wire Legalithm into Claude Code + Cursor (hooks, rules, MCP) — no key needed
  guard    Fast offline check for hooks/CI: AI deps present without a record? (no key)
  init     Detect the stack and generate compliance/legalithm.json (+ annex-iv.md, checklist.md)
  check    Re-verify the committed record; exit non-zero on drift (for CI)
  classify Quick risk hint for the current repo
  mark     Mark an AI-generated image (Art 50(2)); --watermark adds a second, distribution-proof layer (no key)
  verify   Detect AI content marking on an asset: C2PA credential + pixel watermark; --check scans a directory (no key)
  verify-record  Offline integrity check for compliance/legalithm.json (+ optional .sig) (no key)
  sign-record    Sign the record with YOUR Ed25519 key, so a verifier learns who issued it (no key)
  login    Save an API key:  legalithm login  (prompts; --key-file <path> | --stdin)
  reset    Reset to the original state: remove credentials and cached settings (no key)
  data     --export <path> | --delete   your data and settings, out or gone (no key)
  security What was recorded locally: credential changes, rejected keys (no key)

  eaa      European Accessibility Act (Directive (EU) 2019/882). Applies since
           28 June 2025. Posts to the record; stores nothing locally.
             ingest    a scanner's JSON onto the record, as hypotheses
             clock     what is stale, and what is about to lapse

  cra      Cyber Resilience Act (Regulation (EU) 2024/2847). Applies from
           11 Dec 2027; Article 14 reporting from 11 SEPT 2026.
             classify  does the CRA apply, and in which class
             product   register a product version, or --third-party analysis
             ingest    SBOM or a signed declaration into the evidence store
             watch     join components to advisories, rank by exploitation
             claim     a named human signs a VEX verdict
             assess    Annex I: 22 requirements, gap report
             support   Article 13(8) support period register
             doc       Annex VII technical file / Annex V declaration draft
             report    Article 14 notifications, vulnerability or --incident
             advise    Article 14(8) advisory to USERS
             policy    a Part II policy or advisory, pinned by content
             monitor   what changed since the record was signed (exit 3 = look)
             push      snapshot the SAFE half to your account (--dry-run to see it)
             record    the dated evidence record

Flags:
  --role provider|deployer   --domain <annex-iii area>   --use-case "..."   --audience <...>
  --json                     machine-readable check output
  --sarif <path>             write SARIF 2.1.0 results (check; default legalithm-results.sarif)
  --fail-on risk-or-rule|risk|any|never   (check; default risk-or-rule)
  --no-prompt                skip the post-init/check save-or-share prompt
  --key <path> --key-id <id> (sign-record) your Ed25519 private key file, and the id an
                             auditor looks it up by. Legalithm never holds a signing key.

Env: LEGALITHM_API_KEY, LEGALITHM_API_URL (default https://www.legalithm.com)
Telemetry: anonymous { surface, command, repoHash, idBasis } ping; opt out with DO_NOT_TRACK=1.
${DISCLAIMER}`);
}

// Recursively collect image files under a directory, skipping common build/vendor dirs.
function walkImages(dir: string, acc: string[] = []): string[] {
  const SKIP = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage', 'out']);
  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name) && !e.name.startsWith('.')) walkImages(join(dir, e.name), acc);
    } else if (mimeForFile(e.name)) {
      acc.push(join(dir, e.name));
    }
  }
  return acc;
}

/**
 * Annex I Part I (2)(c) and (2)(d), wired once at the entry point.
 *
 * The notice goes to stderr, always: several commands emit JSON on stdout and a
 * friendly line in the middle of it would break every parser downstream.
 */
export async function main(argv: string[]): Promise<number> {
  onAuthFailure((url) => recordSecurityEvent('auth_failed', `API rejected the stored key (${url})`));
  const code = await runCommand(argv);

  const seen = latestVersionSeen();
  if (seen) writeUpdateCache(updateCachePath(), seen);
  if (updateNoticeEnabled()) {
    const known = seen ?? readUpdateCache(updateCachePath())?.latestVersion ?? null;
    for (const line of updateNotice(known, VERSION) ?? []) console.error(line);
  }
  return code;
}

async function runCommand(argv: string[]): Promise<number> {
  const { command, flags, positionals } = parseArgs(argv);
  const cwd = process.cwd();
  const apiUrl = resolveApiUrl();
  const apiKey = resolveApiKey();

  if (command === 'help' || flagBool(flags, 'help')) {
    help();
    return 0;
  }

  // Anonymous surface_active ping — above the API-key gate so unauthenticated
  // commands (setup/guard/mark/verify/discover/login) and authenticated ones
  // (init/check) are all measurable. Fire-and-forget; never blocks.
  if (command && (CLI_TELEMETRY_COMMANDS as readonly string[]).includes(command)) {
    emitSurfaceActive(apiUrl, command, cwd);
  }

  // Annex I Part I (2)(b), (2)(l), (2)(m). Offline, no API key, like `setup`.
  if (command === 'reset') return runReset();

  if (command === 'security') return runSecurity({}, { json: flagBool(flags, 'json') });

  if (command === 'data') {
    const target = flagString(flags, 'export');
    const wantsDelete = flagBool(flags, 'delete');
    if (target && wantsDelete) {
      console.error('Pick one: --export <path> writes your data out, --delete removes it.');
      return 2;
    }
    if (target) return runDataExport(target);
    if (wantsDelete) return runDataDelete();
    console.error('Usage: legalithm data --export <path>   write credentials and the security log out');
    console.error('       legalithm data --delete          remove them permanently');
    console.error('');
    console.error('Neither touches your Ed25519 signing key. That is an identity, not a setting.');
    return 2;
  }

  if (command === 'login') {
    // Three ways in, one of them safe by default. --key still works and warns;
    // see commands/login.ts for why it was not simply removed.
    return runLogin({
      key: flagString(flags, 'key'),
      keyFile: flagString(flags, 'key-file'),
      stdin: flagBool(flags, 'stdin'),
    });
  }

  // CRA v0.1. Entirely offline apart from an optional public KEV fetch: the
  // join of your SBOM against it never leaves this machine.
  if (command === 'applies') {
    return runApplies(
      { cwd, log: (m) => console.log(m), error: (m) => console.error(m) },
      {
        digitalElements: flagBool(flags, 'digital-elements'),
        ai: flagBool(flags, 'ai'),
        ui: flagBool(flags, 'ui'),
        role: flagString(flags, 'role'),
        json: flagBool(flags, 'json'),
      },
    );
  }

  if (command === 'eaa') {
    /**
     * The EAA CLI holds no state, unlike `cra`.
     *
     * The CRA record stays on this machine because the SBOM-to-vulnerability
     * join is sensitive. Nothing about the EAA is: a contrast failure on a
     * public page is not a secret, and the record already lives in the tenant's
     * database where the advisor screens, the statement generator and the clock
     * all read it. So these commands post and read, and store nothing here.
     */
    const io = {
      cwd,
      log: (m: string) => console.log(m),
      error: (m: string) => console.error(m),
    };
    const sub = positionals[0];
    const json = flagBool(flags, 'json');
    const subjectId = flagString(flags, 'subject');

    if (sub !== 'ingest' && sub !== 'clock') {
      console.error('Usage: legalithm eaa <ingest|clock> --subject <id> [flags]');
      return 2;
    }
    if (!subjectId) {
      console.error('`legalithm eaa` needs --subject <id>. Every EAA duty attaches to a subject.');
      return 2;
    }
    if (!apiKey) {
      console.error('`legalithm eaa` needs an API key. Run `legalithm login` first.');
      return 2;
    }

    if (sub === 'clock') {
      return eaaClock(io, {
        subjectId,
        apiUrl,
        apiKey,
        json,
        failOnLapsed: flagBool(flags, 'fail-on-lapsed'),
      });
    }

    const from = flagString(flags, 'from');
    const adapter = flagString(flags, 'adapter');
    if (!from || !adapter) {
      console.error(
        `Usage: legalithm eaa ingest --subject <id> --adapter <${ADAPTERS.join('|')}> --from <report.json>`,
      );
      return 2;
    }
    return eaaIngest(io, {
      subjectId,
      adapter,
      from,
      toolVersion: flagString(flags, 'tool-version'),
      subjectVersionLabel: flagString(flags, 'version'),
      surfaceTarget: flagString(flags, 'target'),
      observedAt: flagString(flags, 'observed-at'),
      apiUrl,
      apiKey,
      json,
      dryRun: flagBool(flags, 'dry-run'),
      failOnFinding: flagBool(flags, 'fail-on-finding'),
    });
  }

  if (command === 'cra') {
    const io = {
      cwd,
      log: (m: string) => console.log(m),
      error: (m: string) => console.error(m),
    };
    const sub = positionals[0];
    const json = flagBool(flags, 'json');

    if (sub === 'support') {
      return craSupport(io, {
        until: flagString(flags, 'until'),
        placedOn: flagString(flags, 'placed-on'),
        by: flagString(flags, 'by'),
        rationale: flagString(flags, 'rationale'),
        expectedUseShorter: flagBool(flags, 'expected-use-shorter'),
        json,
      });
    }
    if (sub === 'advise') {
      return craAdvise(io, {
        cve: flagString(flags, 'cve'),
        incident: flagBool(flags, 'incident'),
        mitigation: flagString(flags, 'mitigation'),
        affectedVersions: flagString(flags, 'affected-versions'),
        issuedAt: flagString(flags, 'issued-at'),
        out: flagString(flags, 'out'),
        json,
      });
    }
    if (sub === 'report') {
      return craReport(io, {
        cve: flagString(flags, 'cve'),
        stage: flagString(flags, 'stage'),
        out: flagString(flags, 'out'),
        remedyAt: flagString(flags, 'remedy-at'),
        memberStates: flagString(flags, 'member-states'),
        incident: flagBool(flags, 'incident'),
        notifiedAt: flagString(flags, 'notified-at'),
        ...(flagBool(flags, 'suspected-malicious')
          ? { suspectedMalicious: true }
          : flagBool(flags, 'not-suspected-malicious')
            ? { suspectedMalicious: false }
            : {}),
        json,
      });
    }
    if (sub === 'doc') {
      return craDoc(io, {
        type: flagString(flags, 'type'),
        out: flagString(flags, 'out'),
        format: (flagString(flags, 'format') as 'md' | 'html' | 'pdf' | undefined) ?? 'md',
        json,
      });
    }
    if (sub === 'assess') {
      return craAssess(io, {
        ref: flagString(flags, 'ref'),
        status: flagString(flags, 'status'),
        by: flagString(flags, 'by'),
        rationale: flagString(flags, 'rationale'),
        gaps: flagBool(flags, 'gaps'),
        json,
      });
    }
    if (sub === 'classify') {
      const tri = (name: string): boolean | undefined =>
        flagBool(flags, name) ? true : flagBool(flags, `no-${name}`) ? false : undefined;
      return craClassify(io, {
        kind: flagString(flags, 'kind'),
        connected: tri('connected'),
        commercial: tri('commercial'),
        euMarket: tri('eu-market'),
        excluded: flagString(flags, 'excluded'),
        rdpsDistance: flagBool(flags, 'rdps-distance') || undefined,
        rdpsManufacturer: flagBool(flags, 'rdps-manufacturer') || undefined,
        rdpsFunction: flagBool(flags, 'rdps-function') || undefined,
        annexIii: flagString(flags, 'annex-iii'),
        annexIv: flagBool(flags, 'annex-iv'),
        role: flagString(flags, 'role'),
        rebrands: flagBool(flags, 'rebrands'),
        json,
      });
    }
    if (sub === 'product') {
      return craProduct(io, {
        name: flagString(flags, 'name'),
        version: flagString(flags, 'version'),
        productClass: flagString(flags, 'class'),
        thirdParty: flagBool(flags, 'third-party'),
        manufacturer: flagString(flags, 'manufacturer'),
        supportUntil: flagString(flags, 'support-until'),
        json,
      });
    }
    if (sub === 'ingest') {
      return craIngest(io, {
        attestation: flagString(flags, 'attestation'),
        sbom: flagString(flags, 'sbom'),
        analysis: flagBool(flags, 'analysis'),
        declare: flagString(flags, 'declare'),
        product: flagString(flags, 'product'),
        by: flagString(flags, 'by'),
        observedAt: flagString(flags, 'observed-at'),
        json,
      });
    }
    if (sub === 'simulate') {
      // Writes nothing. The pre-deadline surface: see the Tuesday-10:15 answer without
      // waiting for a real actively exploited vulnerability.
      return craSimulate(io, {
        scenario: flagString(flags, 'scenario'),
        becameAwareAt: flagString(flags, 'became-aware-at'),
        becameAwareNow: flagBool(flags, 'became-aware-now'),
        product: flagString(flags, 'product'),
        owner: flagString(flags, 'owner'),
        json,
      });
    }
    if (sub === 'watch') {
      return craWatch(io, {
        kev: flagString(flags, 'kev'),
        product: flagString(flags, 'product'),
        json,
        // Reachability. Without these a KEV match is a presence finding.
        ir: flagString(flags, 'ir'),
        entry: flagString(flags, 'entry'),
        symbols: flagString(flags, 'symbols'),
        analyser: flagString(flags, 'analyser'),
        epss: flagString(flags, 'epss'),
        epssFetch: flagBool(flags, 'epss-fetch'),
        osv: flagString(flags, 'osv'),
        // The Article 14 clock runs from AWARENESS, not from when this command ran. One of
        // these is required before a real clock starts; there is no silent default,
        // because a forgotten flag would produce a deadline that is late in the direction
        // that tells a manufacturer they have more time.
        becameAwareAt: flagString(flags, 'became-aware-at'),
        becameAwareNow: flagBool(flags, 'became-aware-now'),
      });
    }
    if (sub === 'claim') {
      return craClaim(io, {
        cve: flagString(flags, 'cve'),
        verdict: flagString(flags, 'verdict'),
        by: flagString(flags, 'by'),
        rationale: flagString(flags, 'rationale'),
        supersedes: flagString(flags, 'supersedes'),
        json,
      });
    }
    if (sub === 'push') {
      if (!apiKey) {
        console.error('`legalithm cra push` needs an API key. Run `legalithm login` first.');
        return 2;
      }
      return craPush(
        {
          cwd,
          log: (m) => console.log(m),
          error: (m) => console.error(m),
          post: (payload) => postJson(`${apiUrl}/api/v1/cra/push`, payload, apiKey),
        },
        { dryRun: flagBool(flags, 'dry-run') },
      );
    }

    if (sub === 'monitor') {
      return craMonitor(
        { cwd, log: (m) => console.log(m) },
        { since: flagString(flags, 'since'), json },
      );
    }

    if (sub === 'policy') {
      return craPolicy(io, {
        document: flagString(flags, 'document'),
        kind: flagString(flags, 'kind'),
        by: flagString(flags, 'by'),
        summary: flagString(flags, 'summary'),
      });
    }

    if (sub === 'risk') {
      return craRisk(io, {
        document: flagString(flags, 'document'),
        by: flagString(flags, 'by'),
        summary: flagString(flags, 'summary'),
      });
    }

    if (sub === 'supplier') {
      const action = positionals[1];
      if (action === 'request') {
        return craSupplierRequest(io, {
          component: flagString(flags, 'component'),
          componentVersion: flagString(flags, 'component-version'),
          cve: flagString(flags, 'cve'),
          by: flagString(flags, 'by'),
          out: flagString(flags, 'out'),
        });
      }
      if (action === 'attest') {
        return craSupplierAttest(io, {
          request: flagString(flags, 'request'),
          verdict: flagString(flags, 'verdict'),
          rationale: flagString(flags, 'rationale'),
          by: flagString(flags, 'by'),
          org: flagString(flags, 'org'),
          key: flagString(flags, 'key') ?? process.env.LEGALITHM_SIGNING_KEY,
          keyId: flagString(flags, 'key-id'),
          out: flagString(flags, 'out'),
        });
      }
      if (action === 'discover') {
        return craSupplierDiscover(io, {
          modules: flagString(flags, 'modules'),
          product: flagString(flags, 'product'),
          json,
        });
      }
      if (action === 'status') {
        return craSupplierStatus(io, { json });
      }
      if (action === 'verify') {
        // Positional, because `verify <file>` is how every other verifier reads.
        return craSupplierVerify(io, { file: positionals[2] ?? flagString(flags, 'file') });
      }
      console.error('Usage: legalithm cra supplier <discover|request|attest|verify|status> [flags]');
      console.error('  discover ask WHO, from installed manifests. No registry lookups.');
      console.error('  request  ask a supplier about one component and one CVE');
      console.error('  attest   THEIR signed, reusable answer, signed with THEIR key');
      console.error('  verify   check one from the file alone, offline');
      console.error('  status   what was asked, what came back, what is still open');
      return 1;
    }

    if (sub === 'record' && flagBool(flags, 'verify')) {
      /*
       * Offline verification, for someone who is not us.
       *
       * `cra record --sign` existed and there was no way to check its output.
       * `verify-record` only ever looked at compliance/legalithm.json, the AI
       * Act record, so a signed CRA record could not be verified by the tool
       * that produced it, let alone by an auditor.
       *
       * Reads only files: the record, the detached signature, the published
       * public keys. No streams, no network, no API key, and nothing that
       * depends on Legalithm being reachable or solvent when someone looks.
       */
      const recPath = join(cwd, 'compliance', 'cra', 'record.json');
      if (!existsSync(recPath)) {
        console.error('No compliance/cra/record.json. Run: legalithm cra record');
        return 1;
      }
      const stored = JSON.parse(readFileSync(recPath, 'utf8')) as Record<string, unknown>;
      const recomputed = recomputeRecordHash(stored);
      const intact = recomputed === stored.recordHash;

      console.log(intact ? '✓ Record integrity OK.' : '✗ Record has been ALTERED since it was generated.');
      console.log(`  stored     ${String(stored.recordHash)}`);
      if (!intact) console.log(`  recomputed ${recomputed}`);

      const sigPath = join(cwd, 'compliance', 'cra', 'record.signature.json');
      if (!existsSync(sigPath)) {
        console.log('  No detached signature. The hash proves the record is unaltered,');
        console.log('  it does not say who issued it. Sign it with --sign to get that.');
        return intact ? 0 : 1;
      }

      const sig = parseSignatureFile(readFileSync(sigPath, 'utf8'));
      const keysPath = join(cwd, 'compliance', 'cra', VERIFICATION_KEYS_FILE);
      if (existsSync(keysPath)) {
        const published = parseVerificationKeys(readFileSync(keysPath, 'utf8'));
        for (const [id, pem] of Object.entries(published.keys)) registerVerificationKey(id, pem);
      } else if (!isBuiltInKeyId(sig.keyId)) {
        console.error(`  Signature is under "${sig.keyId}" and no public key is published for it.`);
        console.error(`  compliance/cra/${VERIFICATION_KEYS_FILE} is missing, so nobody can check this.`);
        return 1;
      }

      const valid = verifyDetachedSignature(String(stored.recordHash), sig);

      /*
       * A signature over a hash the content no longer produces is NOT a valid
       * record, and must never be printed as "valid" on its own line. The
       * signature is genuine and it covers a document that no longer exists,
       * which is the most dangerous thing to report loosely: someone skimming
       * for the word "valid" would accept an altered record.
       */
      if (!intact) {
        console.log(
          valid
            ? `  Detached signature: genuine (key "${sig.keyId}"), but it covers the ORIGINAL`
            : `  Detached signature: INVALID (key "${sig.keyId}")`,
        );
        if (valid) {
          console.log('  record, not this one. Someone signed a document, then the document');
          console.log('  changed. Treat this record as untrusted.');
        }
        return 1;
      }

      console.log(
        valid
          ? `  Detached signature: valid (key "${sig.keyId}")`
          : `  Detached signature: INVALID (key "${sig.keyId}")`,
      );
      if (valid) {
        // Say exactly what it proves, and no more.
        console.log('  This proves the record was signed by whoever holds that key.');
        console.log('  It does not prove who that is: confirm the key out of band.');
      }

      /*
       * The record pins the Article 13(2) risk assessment by content, and this
       * is the one place an auditor looks. Verifying the signature and stopping
       * would report "valid" over a record whose cited assessment has since been
       * rewritten, which is exactly the failure the pin exists to prevent. Still
       * file-only: the document sits next to the record.
       *
       * Absent is not a failure. A record and its signature can legitimately be
       * handed over without the assessment attached. Present but DIFFERENT is a
       * failure, because then the bundle contradicts itself.
       */
      const risk = stored.riskAssessment as { document?: string; sha256?: string } | null | undefined;
      const policies = Array.isArray(stored.documents)
        ? (stored.documents as { kind?: string; document?: string; sha256?: string }[])
        : [];

      /*
       * Every pinned document, not just the risk assessment. Once Part II
       * determinations rest on a disclosure policy and published advisories,
       * checking one document and reporting "valid" over the rest would leave
       * exactly the gap the pin exists to close.
       */
      const pinned = [
        ...(risk && risk.document && risk.sha256
          ? [{ label: 'risk assessment', document: risk.document, sha256: risk.sha256 }]
          : []),
        ...policies
          .filter((p) => p.document && p.sha256)
          .map((p) => ({ label: p.kind ?? 'document', document: p.document!, sha256: p.sha256! })),
      ];

      let drifted = false;
      const absent: string[] = [];
      if (valid) {
        for (const doc of pinned) {
          const docPath = join(cwd, doc.document);
          if (!existsSync(docPath)) {
            absent.push(`${doc.document} (${doc.label})`);
            continue;
          }
          const actual = createHash('sha256').update(readFileSync(docPath)).digest('hex');
          if (actual !== doc.sha256) {
            if (!drifted) console.log('');
            drifted = true;
            console.log(`  ✗ ${doc.document} no longer matches the hash this record signed.`);
            console.log(`    signed   ${doc.sha256}`);
            console.log(`    on disk  ${actual}`);
          }
        }
      }

      if (absent.length) {
        console.log(`  Note: ${absent.length} document(s) this record cites are not present here:`);
        for (const a of absent) console.log(`    ${a}`);
        console.log('  The signature covers their hashes, so it stays valid; you cannot check');
        console.log('  what they said without the documents themselves.');
      }

      if (drifted) {
        console.log('    The record and signature are intact. The documents they refer to have');
        console.log('    been rewritten since, so they are not what was assessed or published.');
        return 1;
      }

      return valid ? 0 : 1;
    }

    if (sub === 'record') {
      const { code, record } = craRecord(io, {
        asOf: flagString(flags, 'as-of'),
        json,
        signing: flagBool(flags, 'sign'),
      });
      if (code !== 0 || !record || !flagBool(flags, 'sign')) return code;

      // Signing reuses the shipped primitives. The customer holds the key and
      // Legalithm holds none, per LGL-15; a signature proves possession of a
      // key, not identity, until that key is confirmed out of band.
      const keyPath = flagString(flags, 'key') ?? process.env.LEGALITHM_SIGNING_KEY;
      const keyId = flagString(flags, 'key-id');
      if (!keyPath || !keyId) {
        console.error('Signing needs --key <path> and --key-id <your-org>.');
        return 1;
      }
      try {
        const key = loadSigningKey(readFileSync(keyPath, 'utf8'));
        const sig = signRecordHash(record.recordHash, key, keyId);
        const sigPath = join(cwd, 'compliance', 'cra', 'record.signature.json');
        writeFileSync(sigPath, renderSignatureFile(sig), 'utf8');

        /*
         * PUBLISH THE PUBLIC KEY, OR THE SIGNATURE IS DECORATION.
         *
         * This wrote the detached signature and stopped. Nobody outside this
         * machine could check it, because the only copy of the public key was
         * inside the customer's private key file. `sign-record` has always
         * written verification-keys.json for the AI Act record; the CRA path
         * never did, so `cra record --sign` produced an artifact whose entire
         * selling point, offline verifiability by anyone, did not hold.
         *
         * Rotation rule, same as sign-record: an existing id must keep its key.
         * Rebinding an id silently invalidates every record already signed under
         * it, so a new key means a new id and the old public key stays published
         * for the records that came before.
         */
        const keysPath = join(cwd, 'compliance', 'cra', VERIFICATION_KEYS_FILE);
        const publicKeyPem = publicKeyPemFor(key);
        let keys: VerificationKeysFile = { keys: {} };
        if (existsSync(keysPath)) keys = parseVerificationKeys(readFileSync(keysPath, 'utf8'));
        const existing = keys.keys[keyId];
        if (existing && existing.trim() !== publicKeyPem.trim()) {
          console.error(
            `Key id "${keyId}" is already published with a different public key. Choose a new id:`,
          );
          console.error(
            'rebinding it would invalidate every record already signed under it, without saying so.',
          );
          return 1;
        }
        keys.keys[keyId] = publicKeyPem;
        writeFileSync(keysPath, renderVerificationKeys(keys), 'utf8');

        console.log(`Signed under ${keyId}: compliance/cra/record.signature.json`);
        console.log(`Public key published: compliance/cra/${VERIFICATION_KEYS_FILE}`);
        console.log('Commit both. Never commit the private key.');
        console.log('Anyone can now check it offline: legalithm cra record --verify');
      } catch (e) {
        console.error((e as Error).message);
        return 1;
      }
      return 0;
    }

    console.error('Usage: legalithm cra <classify|product|ingest|watch|simulate|claim|report|record> [flags]');
    console.error('  report --cve <CVE> --stage <early-warning|vulnerability|final>   Article 14(1)-(2) vulnerability');
    console.error('  report --incident --cve <ref> --stage <...>                    Article 14(3)-(4) severe incident');
    console.error('  advise --cve <CVE> [--incident]                                Article 14(8) advisory to USERS');
    console.error('  classify --kind <software|hardware|component|service_only> [...]  does the CRA apply?');
    console.error('  risk     --document <path> --by "<name>" --summary "<line>"   Article 13(2) assessment');
    console.error('  support  [--until <date> --by <name> --rationale <why>]   Article 13(8) register');
    console.error('  doc      --type <technical-file|declaration> [--out <path>]   Annex VII / Annex V draft');
    console.error('  assess   [--gaps] | --ref "<Annex I ref>" --status <met|not_met|not_applicable> --by "<name>"');
    console.error('  product  --name <n> --version <v> [--class default|important_class_i|important_class_ii|critical]');
    console.error('  ingest   --sbom <path> | --declare "<statement>" --by "<name>"');
    console.error('           --sbom <path> --analysis   a FIRMWARE/binary scan, not a build');
    console.error('           --attestation <path>   a signed supplier answer, as EVIDENCE');
    console.error('  supplier <discover|request|attest|verify|status>   supplier attestations: files, no accounts');
    console.error('  watch    [--kev <path>] [--ir <dirs> --entry <fn> --symbols <map>]');
    console.error('           --became-aware-at <ISO> | --became-aware-now');
    console.error('           The Article 14 clock runs from when you became aware, not');
    console.error('           from when this runs. One of these is required; there is no');
    console.error('           default, because a forgotten flag makes the deadline late.');
    console.error('  simulate --scenario <exploited-vulnerability|severe-incident>');
    console.error('           --became-aware-at <ISO> | --became-aware-now [--owner <id>]');
    console.error('           Same clock engine, writes nothing. For practice and demos.');
    console.error('           join the SBOM against CISA KEV; with --ir, decide reachability');
    console.error('  claim    --cve <CVE> --verdict <not_affected|affected|fixed> --by "<name>"');
    console.error('           [--rationale "..."] [--supersedes <id>]   a NAMED HUMAN signs a finding');
    console.error('  record   [--as-of <iso>] [--sign --key <path> --key-id <id>]');
    console.error('           --verify   check hash + signature offline, no key or network needed');
    return 1;
  }

  // Offline commands — no API key required.
  if (command === 'setup') {
    return runSetup(cwd);
  }
  if (command === 'guard') {
    const hook = ['stop', 'posttooluse'].includes(flagString(flags, 'hook') ?? '')
      ? (flagString(flags, 'hook') as HookMode)
      : undefined;
    // Claude Code pipes the hook input (incl. stop_hook_active) on stdin. Only
    // read when piped (not a TTY) so a manual `guard --hook stop` never hangs.
    let stopHookActive = false;
    if (hook && !process.stdin.isTTY) {
      try {
        const input = readFileSync(0, 'utf8');
        stopHookActive = Boolean(JSON.parse(input).stop_hook_active);
      } catch {
        /* no/!json stdin — treat as first pass */
      }
    }
    return runGuard(
      {
        detect: () => {
          const p = readPackageJson(cwd);
          return detectStack({
            packageJson: { dependencies: p.dependencies, devDependencies: p.devDependencies },
            manifests: readManifests(cwd),
          });
        },
        recordExists: () => existsSync(join(cwd, 'compliance', 'legalithm.json')),
        log: (m) => console.log(m),
      },
      {
        warnOnly: flagBool(flags, 'warn'),
        json: flagBool(flags, 'json'),
        hook,
        stopHookActive,
      },
    );
  }

  if (command === 'mark') {
    const { markImage, hasManifest, buildLocalSigner } = await import('./mark/c2pa.js');
    const checkActive = flagBool(flags, 'check') || typeof flags.check === 'string';
    return runMark(
      {
        readFile: (p) => readFileSync(p),
        writeFile: (p, b) => {
          mkdirSync(dirname(p), { recursive: true });
          writeFileSync(p, b);
        },
        exists: (p) => existsSync(p),
        listImages: (d) => walkImages(d),
        mark: (buffer, mime, opts) =>
          markImage({ buffer, format: mime, title: opts.title, softwareAgent: opts.softwareAgent, signer: opts.signer }),
        hasManifest: (buffer, mime) => hasManifest(buffer, mime),
        buildSigner: (cert, key) => buildLocalSigner(cert, key),
        embedWatermark: async (buffer, mime) => {
          const { embedWatermark } = await import('./mark/watermark.js');
          return embedWatermark({ buffer, format: mime });
        },
        log: (m) => console.log(m),
        error: (m) => console.error(m),
      },
      {
        file: positionals[0],
        out: flagString(flags, 'out'),
        agent: flagString(flags, 'agent'),
        certPath: flagString(flags, 'cert'),
        keyPath: flagString(flags, 'key'),
        check: checkActive ? flagString(flags, 'check') ?? positionals[0] ?? '.' : undefined,
        warnOnly: flagBool(flags, 'warn'),
        watermark: flagBool(flags, 'watermark'),
      },
    );
  }

  if (command === 'verify') {
    const { hasManifest, isC2paAvailable } = await import('./mark/c2pa.js');
    const { readWatermark } = await import('./mark/watermark.js');
    const checkActive = flagBool(flags, 'check') || typeof flags.check === 'string';
    return runVerify(
      {
        readFile: (p) => readFileSync(p),
        exists: (p) => existsSync(p),
        listImages: (d) => walkImages(d),
        isC2paAvailable: () => isC2paAvailable(),
        hasManifest: (buffer, mime) => hasManifest(buffer, mime),
        readWatermark: (buffer) => readWatermark(buffer),
        log: (m) => console.log(m),
        error: (m) => console.error(m),
      },
      {
        file: positionals[0],
        json: flagBool(flags, 'json'),
        check: checkActive ? flagString(flags, 'check') ?? positionals[0] ?? '.' : undefined,
        warnOnly: flagBool(flags, 'warn'),
      },
    );
  }

  if (command === 'verify-record') {
    const { bundledEngineVersion } = await import('./engine-version.js');
    return runVerifyRecord(
      {
        readRecord: (d) => readRecord(d),
        readSignature: (d) => {
          const path = signaturePath(d);
          if (!existsSync(path)) return null;
          return readFileSync(path, 'utf8');
        },
        readVerificationKeys: (d) => {
          const path = join(d, RECORD_DIR, VERIFICATION_KEYS_FILE);
          if (!existsSync(path)) return null;
          return readFileSync(path, 'utf8');
        },
        bundledEngineVersion,
        log: (m) => console.log(m),
        error: (m) => console.error(m),
      },
      { cwd, json: flagBool(flags, 'json') },
    );
  }

  if (command === 'sign-record') {
    const keysPath = join(cwd, RECORD_DIR, VERIFICATION_KEYS_FILE);
    return runSignRecord(
      {
        readRecord: (d) => readRecord(d),
        // A path, never the key material: an argument would land in shell
        // history and in the process table.
        readKeyFile: (p) => readFileSync(p, 'utf8'),
        keyFileMode: (p) => {
          try {
            return statSync(p).mode;
          } catch {
            return null;
          }
        },
        readVerificationKeys: () => (existsSync(keysPath) ? readFileSync(keysPath, 'utf8') : null),
        writeSignature: (d, contents) => {
          const path = signaturePath(d);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, contents, 'utf8');
        },
        writeVerificationKeys: (d, contents) => {
          const path = join(d, RECORD_DIR, VERIFICATION_KEYS_FILE);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, contents, 'utf8');
        },
        log: (m) => console.log(m),
        error: (m) => console.error(m),
      },
      {
        cwd,
        keyPath: flagString(flags, 'key') ?? process.env.LEGALITHM_SIGNING_KEY,
        keyId: flagString(flags, 'key-id'),
        json: flagBool(flags, 'json'),
      },
    );
  }

  // Auto-discovery (P2-B1). Offline by default; --push needs an API key.
  if (command === 'discover') {
    const pkg = readPackageJson(cwd);
    const mcpConfigs = readMcpConfigs(cwd);
    const stack: StackInput = {
      packageJson: { name: pkg.name, version: pkg.version, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies },
      envKeys: Object.keys(process.env),
      manifests: readManifests(cwd),
      ciManifests: readCiIacManifests(cwd),
      filePaths: readSourcePaths(cwd),
      mcpConfigs,
    };
    /**
     * The file map handed to the shared engine, built from what was ALREADY
     * read for detectStack rather than walking the disk a second time.
     *
     * Source paths are passed with empty content on purpose: the engine's
     * interaction heuristic reads the path, and reading thousands of source
     * files to look for call sites would change `discover` from a fast command
     * into a slow one. A call site therefore only ever raises confidence on the
     * web, the API and MCP, where the caller chose what to send. On the CLI
     * every capability stays `possible`, which is the honest answer for a scan
     * that did not open the files.
     */
    const discoveryFiles: Record<string, string> = {
      'package.json': JSON.stringify({
        name: pkg.name,
        dependencies: pkg.dependencies ?? {},
        devDependencies: pkg.devDependencies ?? {},
      }),
      ...readManifests(cwd),
      ...readCiIacManifests(cwd),
      ...Object.fromEntries(readSourcePaths(cwd).map((rel) => [rel, ''])),
    };

    const wantPush = flagBool(flags, 'push');
    if (wantPush && !apiKey) {
      console.error('`legalithm discover --push` needs an API key. Run `legalithm login --key-file <path>` first.');
      return 2;
    }
    const result = await runDiscover({
      detect: () => detectStack(stack),
      // The shared engine answers the Article 50 question. It takes file
      // CONTENT, so the CLI hands it what it already read rather than letting it
      // touch the disk: same inputs, same answers as the web, the API and MCP.
      scan: () => sharedScan({ files: discoveryFiles }),
      name: pkg.name ?? 'app',
      push: wantPush
        ? (item) =>
            postJson(`${apiUrl}/api/v1/ai-systems/import`, item, apiKey as string).then((r) => {
              const res = r as { system?: { id?: string }; assessment?: { riskTier?: string } };
              return { id: res.system?.id, riskTier: res.assessment?.riskTier };
            })
        : undefined,
      json: flagBool(flags, 'json'),
    });
    return result.exitCode;
  }

  if (!apiKey) {
    console.error(
      [
        `No API key found for \`${command}\`.`,
        'Get a free key at https://www.legalithm.com (Settings → API Keys), then:',
        '  legalithm login --key-file ./key.txt   (or set LEGALITHM_API_KEY)',
        '  printf %s "$KEY" | legalithm login --stdin',
        'No key needed for: `legalithm setup` (wire up Claude Code/Cursor) and `legalithm guard`.',
      ].join('\n'),
    );
    return 2;
  }

  const pkg = readPackageJson(cwd);
  const stack: StackInput = {
    packageJson: { name: pkg.name, version: pkg.version, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies },
    envKeys: Object.keys(process.env),
    manifests: readManifests(cwd),
  };
  const seed = detectStack(stack).useCaseSeed;
  const system = { name: pkg.name ?? 'app', version: pkg.version ?? '0.0.0' };

  switch (command) {
    case 'classify': {
      try {
        const result = await postJson(`${apiUrl}/api/v1/classify`, buildUseCase(flags, seed, pkg), apiKey);
        console.log(JSON.stringify({ ...(result as object), disclaimer: DISCLAIMER }, null, 2));
        return 0;
      } catch (e) {
        console.error((e as Error).message);
        return 3;
      }
    }
    case 'init': {
      const res = await runInit({
        cwd,
        system,
        input: buildUseCase(flags, seed, pkg),
        generate: (sys, input) =>
          postJson<StoredRecord>(`${apiUrl}/api/v1/record/generate`, { system: sys, input, cliVersion: VERSION }, apiKey),
      });
      if (res.exitCode === 0) {
        await maybePromptSaveShare({
          apiUrl,
          command: 'init',
          cwd,
          noPrompt: flagBool(flags, 'no-prompt'),
        });
      }
      return res.exitCode;
    }
    case 'check': {
      const sarifFlag = flags.sarif;
      const sarifPath =
        sarifFlag === true
          ? 'legalithm-results.sarif'
          : typeof sarifFlag === 'string'
            ? sarifFlag
            : undefined;
      const res = await runCheck({
        cwd,
        failOn: flagString(flags, 'fail-on') ?? 'risk-or-rule',
        json: flagBool(flags, 'json'),
        sarif: sarifPath,
        toolVersion: VERSION,
        regenerate: (stored) =>
          postJson<StoredRecord>(
            `${apiUrl}/api/v1/record/generate`,
            { system: stored.system, input: stored.system.input, cliVersion: VERSION },
            apiKey,
          ),
      });
      // Successful check = we produced a report (exit 0 in-sync, 1 drift). Skip on 2/3.
      if (res.exitCode === 0 || res.exitCode === 1) {
        await maybePromptSaveShare({
          apiUrl,
          command: 'check',
          cwd,
          // --json is for machines; never mix a prompt into the stream.
          noPrompt: flagBool(flags, 'no-prompt') || flagBool(flags, 'json'),
        });
      }
      return res.exitCode;
    }
    default:
      help();
      return 1;
  }
}

// Bin entry — guarded so importing { main } in tests has no side effects.
// The same guard makes this block unreachable under vitest by construction, so
// it is excluded from coverage rather than left as a permanent shortfall that
// no test could ever close.
/* v8 ignore start */
if (!process.env.VITEST) {
  main(process.argv.slice(2)).then(
    async (code) => {
      // Let the fire-and-forget ping land before hard-exit kills the socket.
      await flushTelemetry();
      process.exit(code);
    },
    async (e) => {
      console.error(e);
      await flushTelemetry();
      process.exit(1);
    },
  );
}
/* v8 ignore stop */
