#!/usr/bin/env node
/**
 * legalithm — ship EU-AI-Act-compliant by default.
 *   legalithm discover  Scan the repo for AI SDKs/models, print an inventory; --push registers it
 *   legalithm init    Detect the stack, generate compliance/legalithm.json (+ Annex IV, checklist)
 *   legalithm check   Re-verify the record; fail CI on drift (risk/rule)
 *   legalithm classify  Quick risk hint for the current repo
 *   legalithm login --key lgl_...   Save an API key
 * Output is informational — not legal advice, never "compliant by default".
 */
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, relative } from 'path';
import { parseArgs, flagString, flagBool } from './args.js';
import { detectStack } from './detect.js';
import { resolveApiUrl, resolveApiKey } from './config.js';
import { postJson } from './http.js';
import { runInit } from './commands/init.js';
import { runCheck } from './commands/check.js';
import { runDiscover } from './commands/discover.js';
import { runLogin } from './commands/login.js';
import { runGuard, type HookMode } from './commands/guard.js';
import { mergeClaudeSettings, mergeMcpConfig, CURSOR_RULE, CLAUDE_MD_SNIPPET, SETUP_FILES, DEFAULT_CLI } from './commands/setup.js';
import { runMark, mimeForFile } from './commands/mark.js';
import { runVerify } from './commands/verify.js';
import { emitSurfaceActive, flushTelemetry, CLI_TELEMETRY_COMMANDS } from './telemetry.js';
import { maybePromptSaveShare } from './save-share-prompt.js';
import type { StackInput, UseCase, StoredRecord, ProviderRole, Domain, Audience } from './types.js';

const VERSION = '0.4.4';
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
  login    Save an API key:  legalithm login --key lgl_...

Flags:
  --role provider|deployer   --domain <annex-iii area>   --use-case "..."   --audience <...>
  --json                     machine-readable check output
  --fail-on risk-or-rule|risk|any|never   (check; default risk-or-rule)
  --no-prompt                skip the post-init/check save-or-share prompt

Env: LEGALITHM_API_KEY, LEGALITHM_API_URL (default https://www.legalithm.com)
Telemetry: anonymous { surface, command, repoHash } ping; opt out with DO_NOT_TRACK=1.
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

export async function main(argv: string[]): Promise<number> {
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

  if (command === 'login') {
    return runLogin(flagString(flags, 'key'));
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

  // Auto-discovery (P2-B1). Offline by default; --push needs an API key.
  if (command === 'discover') {
    const pkg = readPackageJson(cwd);
    const stack: StackInput = {
      packageJson: { name: pkg.name, version: pkg.version, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies },
      envKeys: Object.keys(process.env),
      manifests: readManifests(cwd),
      filePaths: readSourcePaths(cwd),
    };
    const wantPush = flagBool(flags, 'push');
    if (wantPush && !apiKey) {
      console.error('`legalithm discover --push` needs an API key. Run `legalithm login --key lgl_...` first.');
      return 2;
    }
    const result = await runDiscover({
      detect: () => detectStack(stack),
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
        '  legalithm login --key lgl_...        (or set LEGALITHM_API_KEY)',
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
      const res = await runCheck({
        cwd,
        failOn: flagString(flags, 'fail-on') ?? 'risk-or-rule',
        json: flagBool(flags, 'json'),
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
