/**
 * Build the .mcpb bundle.
 *
 *   node scripts/build-mcpb.mjs [--no-tools] [--out <dir>]
 *
 * Why this exists: Smithery publishes local stdio servers as a hosted .mcpb
 * bundle, which is the only route that does not require us to run a public
 * HTTPS endpoint. The same artifact is what Claude Desktop installs.
 *
 * The bundle must be self-contained. `tsup` externalises
 * @modelcontextprotocol/sdk and zod rather than inlining them, so dist/index.js
 * alone does not run — the bundle carries a production node_modules.
 *
 * --no-tools omits the `tools` array. It is spec-valid to include it (MCPB
 * tools are {name, description}), and Claude Desktop shows it, but Smithery's
 * CLI casts MCPB tools to registry Tool objects, which require `inputSchema`,
 * and rejects the bundle with "expected object, received undefined"
 * (smithery-ai/cli#787, open as of 2026-08-04). If publish fails that way,
 * rebuild with --no-tools. Keep it a flag: nobody should be hand-editing a
 * generated manifest under time pressure.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const INCLUDE_TOOLS = !args.includes('--no-tools');
const outIdx = args.indexOf('--out');
const OUT_DIR = resolve(outIdx === -1 ? join(PKG_DIR, 'build') : args[outIdx + 1]);
const STAGE = join(OUT_DIR, 'mcpb-stage');

const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));

const ENTRY = join(PKG_DIR, 'dist', 'index.js');
if (!existsSync(ENTRY)) {
  console.error('dist/index.js missing — run `npm run build` in packages/mcp-server first.');
  process.exit(1);
}

/**
 * Tool metadata is not duplicated here. The staged server is actually started
 * and asked, over a real stdio handshake, so the manifest cannot disagree with
 * what tools/list returns at runtime. Parsing the bundle with a regex was the
 * first attempt and it silently matched nothing once esbuild reformatted the
 * output, which is exactly the drift this is meant to prevent.
 */
function toolsFromRunningServer(serverEntry) {
  const rpc = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'build-mcpb', version: '1' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]
    .map((m) => JSON.stringify(m))
    .join('\n');

  const out = execFileSync('node', [serverEntry], {
    input: rpc + '\n',
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, LEGALITHM_TELEMETRY: '0' },
  });

  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id === 2 && msg.result?.tools) {
      return msg.result.tools.map((t) => ({ name: t.name, description: t.description }));
    }
  }
  return [];
}

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(join(STAGE, 'server'), { recursive: true });
cpSync(ENTRY, join(STAGE, 'server', 'index.js'));

// Production-only manifest for the staged install: the bundle must not carry
// tsup, vitest or anything else from the monorepo dev tree.
writeFileSync(
  join(STAGE, 'package.json'),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      private: true,
      type: 'module',
      dependencies: pkg.dependencies,
    },
    null,
    2,
  ) + '\n',
);

console.log('installing production dependencies into the bundle…');
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--silent'], {
  cwd: STAGE,
  stdio: 'inherit',
});

// Read from the STAGED copy, so what we advertise is what the bundle ships.
const tools = INCLUDE_TOOLS ? toolsFromRunningServer(join(STAGE, 'server', 'index.js')) : [];
if (INCLUDE_TOOLS && tools.length === 0) {
  console.error('could not read any tools out of dist/index.js — refusing to ship a manifest that silently claims none.');
  process.exit(1);
}

const manifest = {
  manifest_version: '0.3',
  name: pkg.name,
  display_name: 'Legalithm — EU AI Act',
  version: pkg.version,
  description: pkg.description,
  author: { name: 'Pedram Madani', email: 'hello@legalithm.com', url: 'https://www.legalithm.com' },
  homepage: 'https://www.legalithm.com',
  documentation: 'https://www.legalithm.com/en/developers',
  repository: { type: 'git', url: 'https://github.com/legalithm-org/legalithm' },
  license: pkg.license ?? 'MIT',
  keywords: ['eu-ai-act', 'ai-act', 'compliance', 'legal', 'ai-governance', 'mcp'],
  server: {
    type: 'node',
    entry_point: 'server/index.js',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/index.js'],
      env: {},
    },
  },
  ...(tools.length ? { tools } : {}),
  compatibility: {
    platforms: ['darwin', 'win32', 'linux'],
    runtimes: { node: '>=18.0.0' },
  },
};

writeFileSync(join(STAGE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`packing (${tools.length} tools declared)…`);
execFileSync('npx', ['-y', '@anthropic-ai/mcpb', 'pack', STAGE, join(OUT_DIR, 'legalithm.mcpb')], {
  stdio: 'inherit',
});

console.log(`\n✓ ${join(OUT_DIR, 'legalithm.mcpb')}`);
