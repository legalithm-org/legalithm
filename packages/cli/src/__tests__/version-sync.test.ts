import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `legalithm --version` reads a literal in src/index.ts, not package.json, so the
 * built binary needs no runtime file read. That literal shipped as 0.4.3 while
 * the published package was 0.4.4 — every user was told the wrong version, and
 * nothing caught it: vitest does not read package.json and tsc does not compare
 * string values. This test is the thing that catches it.
 */
describe('CLI version', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
    const src = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');

    const match = src.match(/^const VERSION = '([^']+)';$/m);
    expect(match, 'could not find `const VERSION = ...` in src/index.ts').not.toBeNull();
    expect(match![1]).toBe(pkg.version);
  });
});
