/**
 * Assemble the MCPB bundle staging directory.
 *
 *   npm run build:mcpb        # then: cd mcpb && npx @anthropic-ai/mcpb pack
 *
 * WHY A STAGING DIRECTORY RATHER THAN PACKING THE PACKAGE.
 *
 * `mcpb pack` zips the directory holding manifest.json. Run from the package
 * root that is src/, dist/, tsconfig, and a 67 MB node_modules containing tsup
 * and typescript — all of it shipped to anyone who installs the bundle. `mcpb/`
 * holds exactly two files, so there is nothing to pack wrong.
 *
 * WHY THE ENTRY POINT IS REWRITTEN.
 *
 * `mcpb init` wrote `./dist/index.js`, correct relative to the package root and
 * wrong inside the bundle, where the server sits beside the manifest. A bundle
 * with a dangling entry point installs cleanly and fails at launch — the
 * failure lands on the user's machine, days later, with no way to trace it.
 *
 * The tools list and description are taken from manifest.json as authored, so
 * this script formats and relocates; it does not invent metadata.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Ask the built server what tools it has, over the real MCP protocol.
 *
 * Smithery rejects a bundle whose tools carry no `inputSchema` — six tools gave
 * six "expected object, received undefined" and a 400. `mcpb init` never asks
 * for schemas, so a hand-authored manifest cannot have them.
 *
 * They are read from the server rather than written by hand because they
 * already exist: each tool declares zod shapes that the MCP SDK converts to
 * JSON Schema. Copying that into a manifest by hand creates a second source of
 * truth which is wrong the first time a parameter changes — and the manifest is
 * what renders the public page, so nobody would notice.
 */
function toolsFromServer(entry) {
  const rpc = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'build-mcpb', version: '0' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ].map((m) => JSON.stringify(m)).join('\n');

  const r = spawnSync(process.execPath, [entry], {
    input: `${rpc}\n`,
    encoding: 'utf8',
    // The build must not emit a usage event. Telemetry from a build step would
    // show up as adoption in the product's own metrics.
    env: { ...process.env, LEGALITHM_TELEMETRY: '0', DO_NOT_TRACK: '1' },
  });

  for (const line of (r.stdout ?? '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id === 2 && Array.isArray(msg.result?.tools)) return msg.result.tools;
    } catch { /* not every line is a complete message */ }
  }
  console.error(
    'build-mcpb: the built server did not answer tools/list, so its schemas cannot be read.\n'
    + `  exit ${r.status}${r.stderr ? `\n  ${r.stderr.trim().split('\n')[0]}` : ''}`,
  );
  process.exit(2);
}

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(PKG, 'mcpb');
const ENTRY = 'index.js';

const bundled = join(OUT, ENTRY);
if (!existsSync(bundled)) {
  console.error(
    `build-mcpb: ${bundled} is missing.\n`
    + 'Run `npx tsup --config tsup.mcpb.config.ts` first — that is the build that\n'
    + 'inlines the dependencies. Packing the npm build instead produces a server\n'
    + 'that cannot start away from this machine.',
  );
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(join(PKG, 'manifest.json'), 'utf8'));

// The server's own answer is the source of truth for what tools exist and what
// they accept. The hand-authored manifest supplies only the short descriptions,
// which are editorial and better than the long protocol ones on a listing page.
const live = toolsFromServer(bundled);
const authored = new Map((manifest.tools ?? []).map((t) => [t.name, t.description]));

const tools = live.map((t) => ({
  name: t.name,
  description: authored.get(t.name) ?? t.description,
  inputSchema: t.inputSchema,
}));

// Smithery rejects a tool with no inputSchema, and rejects it with a message
// that names no tool — six tools produced six identical errors. Fail here,
// where the offending name can still be printed.
const schemaless = tools.filter((t) => !t.inputSchema || typeof t.inputSchema !== 'object');
if (schemaless.length) {
  console.error(`build-mcpb: no inputSchema for: ${schemaless.map((t) => t.name).join(', ')}`);
  process.exit(2);
}

// A tool the author described that the server does not serve. "classif" was
// typed into `mcpb init` once in this session; a typo there is invisible until
// a client asks for a tool that has never existed.
const bogus = [...authored.keys()].filter((n) => !live.some((t) => t.name === n));
if (bogus.length) {
  console.error(`build-mcpb: manifest describes tools the server does not register: ${bogus.join(', ')}`);
  process.exit(2);
}

// Version drift between package.json and the manifest would publish a bundle
// labelled as a release it is not.
const pkgVersion = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).version;
if (manifest.version !== pkgVersion) {
  console.error(`build-mcpb: manifest version ${manifest.version} != package.json ${pkgVersion}`);
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, 'manifest.json'),
  `${JSON.stringify(
    {
      ...manifest,
      server: {
        ...manifest.server,
        entry_point: `./${ENTRY}`,
        mcp_config: { ...manifest.server.mcp_config, args: [`\${__dirname}/${ENTRY}`] },
      },
      // NO inputSchema here. See below — the two consumers disagree.
      tools: tools.map(({ name, description }) => ({ name, description })),
    },
    null,
    2,
  )}\n`,
);

/**
 * THE SMITHERY BUNDLE, BUILT BY HAND, BECAUSE THE TWO SPECS CONTRADICT.
 *
 * Smithery's CLI validates each tool against the MCP `Tool` type, where
 * `inputSchema` is required — not optional. Publishing without it returns
 *
 *   400 Invalid input: expected object, received undefined   (x6, one per tool)
 *
 * naming no tool and no field.
 *
 * `mcpb pack` refuses the same field:
 *
 *   tools.0: Unrecognized key(s) in object: 'inputSchema'
 *   ERROR: Cannot pack extension with invalid manifest
 *
 * So no single manifest satisfies both, and this is an ecosystem gap rather
 * than a mistake in this repo. An .mcpb is a zip holding a manifest and a
 * server, so the Smithery artifact is assembled directly and `mcpb pack` is
 * left working for Claude Desktop, which is what item 8 of account-actions
 * wants.
 *
 * If a later mcpb release accepts inputSchema, delete this and write one
 * manifest. Check before assuming it still applies.
 */
const SMITHERY_ZIP = join(OUT, 'legalithm-eu-ai-act.mcpb');
const stage = join(OUT, '.smithery-stage');
mkdirSync(stage, { recursive: true });
writeFileSync(
  join(stage, 'manifest.json'),
  `${JSON.stringify(
    {
      ...manifest,
      server: {
        ...manifest.server,
        entry_point: `./${ENTRY}`,
        mcp_config: { ...manifest.server.mcp_config, args: [`\${__dirname}/${ENTRY}`] },
      },
      tools,
    },
    null,
    2,
  )}\n`,
);
copyFileSync(bundled, join(stage, ENTRY));

rmSync(SMITHERY_ZIP, { force: true });
const zip = spawnSync('zip', ['-q', '-r', '-X', SMITHERY_ZIP, 'manifest.json', ENTRY], { cwd: stage, encoding: 'utf8' });
if (zip.status !== 0) {
  console.error(`build-mcpb: zip failed (${zip.status})\n${zip.stderr ?? ''}`);
  process.exit(2);
}
rmSync(stage, { recursive: true, force: true });

const kb = (statSync(bundled).size / 1024).toFixed(0);
const zkb = (statSync(SMITHERY_ZIP).size / 1024).toFixed(0);
console.log(`  mcpb/ ready — manifest.json + ${ENTRY} (${kb} KB)`);
console.log(`  ${tools.length} tools, each with an inputSchema read from the running server`);
console.log('');
console.log(`  Smithery:       mcpb/legalithm-eu-ai-act.mcpb (${zkb} KB) — tools carry inputSchema`);
console.log('  Claude Desktop: cd mcpb && npx -y @anthropic-ai/mcpb pack  — tools do not, per its spec');
