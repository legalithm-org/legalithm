import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { craProduct, craIngest, craWatch } from '../cra/commands.js';
import { readStream } from '../cra/store.js';

/**
 * A CycloneDX component's `name` is not the npm package name when the package
 * is scoped. CycloneDX splits the scope into `group`, so `@babel/runtime` is
 * `{ group: "@babel", name: "runtime" }`.
 *
 * `parseSbom` read `name` alone, so a real 274 component SBOM of the published
 * `legalithm` package ingested `runtime`, `cli`, `types` and `node` as
 * component names. That breaks the OSV join in the dangerous direction: no
 * advisory for `@babel/runtime` can match a component called `runtime`, and the
 * user is told they do not have a vulnerability they do have.
 *
 * SBOM_REAL below is copied VERBATIM from the output of
 * `@cyclonedx/cyclonedx-npm` run against a clean install of legalithm@0.6.0.
 * A fixture written from memory would have put the scope in `name` and proved
 * nothing.
 */
const SBOM_REAL = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  components: [
    { type: 'library', group: '@babel', name: 'runtime', version: '7.29.7', purl: 'pkg:npm/%40babel/runtime@7.29.7' },
    { type: 'library', group: '@changesets', name: 'cli', version: '2.31.1', purl: 'pkg:npm/%40changesets/cli@2.31.1' },
    { type: 'library', name: 'semver', version: '7.8.5', purl: 'pkg:npm/semver@7.8.5' },
  ],
};

/** A real OSV record names the scoped package in full. */
const OSV_REAL = [
  {
    id: 'GHSA-968p-4wvh-cqc8',
    aliases: ['CVE-2025-27789'],
    summary: 'Babel has inefficient RegExp complexity in generated code',
    affected: [{ package: { name: '@babel/runtime', ecosystem: 'npm' }, versions: ['7.29.7'] }],
  },
];

let dir: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({
  cwd: dir,
  log: (m: string) => out.push(m),
  error: (m: string) => err.push(m),
  now: () => new Date('2026-08-15T12:00:00Z'),
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cra-scoped-'));
  out.length = 0;
  err.length = 0;
  craProduct(io(), { name: 'Legalithm CLI', version: '0.6.0' });
  writeFileSync(join(dir, 'sbom.json'), JSON.stringify(SBOM_REAL));
  writeFileSync(join(dir, 'osv.json'), JSON.stringify(OSV_REAL));
  writeFileSync(join(dir, 'kev.json'), JSON.stringify({ vulnerabilities: [] }));
  out.length = 0;
  err.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('CycloneDX scoped packages', () => {
  type Ev = { component: string; assertion: string };

  it('ingests the full package name, not the unscoped CycloneDX name', () => {
    craIngest(io(), { sbom: join(dir, 'sbom.json') });
    const components = readStream<Ev>(dir, 'evidence').map((e) => e.body.component).sort();
    expect(components).toEqual(['@babel/runtime', '@changesets/cli', 'semver']);
  });

  it('never records the bare unscoped name, which would collide with real packages', () => {
    craIngest(io(), { sbom: join(dir, 'sbom.json') });
    const components = readStream<Ev>(dir, 'evidence').map((e) => e.body.component);
    // `cli`, `runtime` and `types` are all real npm packages. Recording a scoped
    // component under a bare name risks matching an advisory for a different
    // package entirely.
    expect(components).not.toContain('runtime');
    expect(components).not.toContain('cli');
  });

  it('leaves an unscoped package exactly as it is', () => {
    craIngest(io(), { sbom: join(dir, 'sbom.json') });
    const semver = readStream<Ev>(dir, 'evidence').find((e) => e.body.component === 'semver');
    expect(semver).toBeDefined();
    expect(semver!.body.assertion).toBe('contains semver 7.8.5');
  });

  it('the OSV join then finds an advisory for the scoped package', async () => {
    craIngest(io(), { sbom: join(dir, 'sbom.json') });
    out.length = 0;
    await craWatch(io(), { osv: join(dir, 'osv.json'), kev: join(dir, 'kev.json'), becameAwareNow: true });

    const hyps = readStream<{ component: string; cve: string }>(dir, 'hypotheses');
    expect(
      hyps.map((h) => `${h.body.component} ${h.body.cve}`),
      'the advisory names @babel/runtime; under the bug the component was "runtime" and nothing matched',
    ).toEqual(['@babel/runtime CVE-2025-27789']);
  });

  it('pins the trap: the purl is authoritative even if group and name disagree', () => {
    // A generator that puts the full name in `name` as well must not produce
    // `@babel/@babel/runtime`.
    writeFileSync(
      join(dir, 'sbom2.json'),
      JSON.stringify({
        bomFormat: 'CycloneDX',
        components: [
          { type: 'library', group: '@babel', name: '@babel/runtime', version: '7.29.7', purl: 'pkg:npm/%40babel/runtime@7.29.7' },
        ],
      }),
    );
    craIngest(io(), { sbom: join(dir, 'sbom2.json') });
    const names = readStream<Ev>(dir, 'evidence').map((e) => e.body.component);
    expect(names).toContain('@babel/runtime');
    expect(names.some((n) => n.includes('@babel/@babel'))).toBe(false);
  });
});
