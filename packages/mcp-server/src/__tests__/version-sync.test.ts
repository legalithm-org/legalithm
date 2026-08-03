import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * MCP registries (Glama, Smithery, mcp.so, the official registry) read
 * serverInfo.version from the stdio handshake, and server.json is what the
 * official registry ingests. Both had drifted: serverInfo reported 0.1.0 and
 * server.json 0.1.2, while the published package was 0.1.3.
 *
 * Read from source rather than importing index.ts — importing it would pull in
 * @modelcontextprotocol/sdk, which is a package-level dependency and is not
 * installed at the monorepo root where the shared vitest config runs.
 */
describe('MCP server version', () => {
  const pkgDir = join(__dirname, '..', '..');
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

  it('SERVER_VERSION in src/index.ts matches package.json', () => {
    const src = readFileSync(join(pkgDir, 'src', 'index.ts'), 'utf8');
    const match = src.match(/^export const SERVER_VERSION = '([^']+)';$/m);
    expect(match, 'could not find `export const SERVER_VERSION = ...`').not.toBeNull();
    expect(match![1]).toBe(pkg.version);
  });

  it('the McpServer constructor uses SERVER_VERSION, not a literal', () => {
    const src = readFileSync(join(pkgDir, 'src', 'index.ts'), 'utf8');
    expect(src).toMatch(/new McpServer\(\{[^}]*version:\s*SERVER_VERSION/);
  });

  it('server.json matches package.json', () => {
    const server = JSON.parse(readFileSync(join(pkgDir, 'server.json'), 'utf8'));
    if (server.version) expect(server.version).toBe(pkg.version);
    for (const entry of server.packages ?? []) {
      if (entry.version) expect(entry.version).toBe(pkg.version);
    }
  });
});
