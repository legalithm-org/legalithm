import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What a user receives when they run `npm install legalithm`.
 *
 * `c2pa-node` and `sharp` are large native packages needed only for content
 * marking. They were declared as `optionalDependencies`, which reads as "we do
 * not install these" and means the opposite: **npm installs optionalDependencies
 * by default**, and only tolerates a build failure. On top of that,
 * `c2pa-node@0.5.26` declares its own release tooling as runtime dependencies
 * (`@changesets/cli`, `npm-run-all`, `cargo-cp-artifact`, `unzipper`,
 * `node-fetch@2`), so a plain install pulled in **274 packages**, including the
 * deprecated `fstream`, for a feature most users never touch.
 *
 * Every one of those packages is inside the CRA product boundary: it is what is
 * placed on the market, so its vulnerabilities are the manufacturer's to triage
 * under Annex I Part II, and its surface is what Annex I (2)(j) asks to be
 * limited. Declaring the dependency was the entire cost.
 *
 * As optional PEER dependencies they are not installed by default, and the
 * install footprint is 1 package. Both are already loaded lazily behind
 * `await import(...)` with a message naming the package to install, so nothing
 * else changes.
 *
 * This test exists because the defect was invisible in the source: the code was
 * correct, the docblock in mark/c2pa.ts said "the base CLI stays
 * dependency-free", and only the published manifest disagreed.
 */
const pkg = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'),
) as {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

const NATIVE = ['c2pa-node', 'sharp'] as const;

describe('install footprint of the published CLI', () => {
  it('declares no runtime dependencies at all', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });

  it('declares no optionalDependencies, which npm would install by default', () => {
    // The exact regression. `optionalDependencies` is not opt-in.
    expect(Object.keys(pkg.optionalDependencies ?? {})).toEqual([]);
  });

  it.each(NATIVE)('declares %s as an optional peer dependency', (name) => {
    expect(pkg.peerDependencies ?? {}).toHaveProperty(name);
    expect(pkg.peerDependenciesMeta?.[name]?.optional).toBe(true);
  });

  it('keeps every native package out of anything npm installs automatically', () => {
    const autoInstalled = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
      // A peer that is not marked optional is auto-installed by npm 7+.
      ...Object.keys(pkg.peerDependencies ?? {}).filter(
        (n) => !pkg.peerDependenciesMeta?.[n]?.optional,
      ),
    ]);
    expect(
      NATIVE.filter((n) => autoInstalled.has(n)),
      'these would be installed by a plain `npm install legalithm`',
    ).toEqual([]);
  });
});
