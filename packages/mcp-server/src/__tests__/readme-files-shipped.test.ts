import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * legalithm-mcp-server@0.2.0 shipped a README telling users to
 *   "copy `templates/legalithm-eu-ai-act.mdc` → `.cursor/rules/`"
 * while `files` was ["dist","README.md"], so the tarball held exactly three
 * files and neither template was among them. Every MCP registry renders this
 * README, so the first instruction a reviewer read was one that could not work.
 *
 * Asserts that every repo-relative path the README tells a user to open is both
 * present on disk and covered by the `files` allowlist that npm packs.
 */
describe('README references ship in the tarball', () => {
  const pkgDir = join(__dirname, '..', '..');
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const readme = readFileSync(join(pkgDir, 'README.md'), 'utf8');

  /** Backticked paths that look like repo files, e.g. `templates/CLAUDE.md`. */
  const referenced = [...readme.matchAll(/`([A-Za-z0-9_./-]+\/[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)`/g)]
    .map((m) => m[1])
    // Paths the user creates in THEIR repo, not ones we ship.
    .filter((p) => !p.startsWith('.cursor/') && !p.startsWith('.claude/') && p !== '.mcp.json')
    .filter((p) => !p.includes('claude_desktop_config'));

  const unique = [...new Set(referenced)];

  it('finds paths to check', () => {
    expect(unique.length).toBeGreaterThan(0);
  });

  it.each(unique)('%s exists on disk', (rel) => {
    expect(existsSync(join(pkgDir, rel)), `${rel} referenced in README but missing`).toBe(true);
  });

  it.each(unique)('%s is covered by package.json "files"', (rel) => {
    const top = rel.split('/')[0];
    expect(
      (pkg.files as string[]).some((f) => f === top || f === rel),
      `${rel} referenced in README but not packed — files: ${JSON.stringify(pkg.files)}`,
    ).toBe(true);
  });
});
