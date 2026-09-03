import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { craProduct, craIngest, craWatch, sbomToolName } from '../cra/commands.js';
import { readStream } from '../cra/store.js';

/**
 * Decision 3: "binary analysis by INGESTION only. In-house extraction is a later
 * 'when', never before the record model."
 *
 * ONEKEY and Finite State unpack firmware images and emit a CycloneDX SBOM. The
 * components in one are NOT the same kind of fact as the components in a build
 * SBOM: a build manifest says "I compiled this in", a firmware scan says "a tool
 * matched a fingerprint and thinks this is probably in there".
 *
 * Everything was ingested as `sourceType: 'build'`, `confidence: 'exact'`. So a
 * 0.4-confidence filename match entered the record as a fact about what the
 * product contains, and any CVE found against it read as "your product is
 * affected". The architecture's evidence primitive has always specified
 * `confidence: exact | fingerprint 0.87 | asserted`; only the middle one was
 * missing, and it is the one that carries the doubt.
 *
 * FIXTURE_REAL is the CycloneDX 1.5 `evidence.identity` shape as specified,
 * with the techniques a firmware scanner actually reports. A fixture invented to
 * match the parser would prove only that the parser is self-consistent.
 */
const FIRMWARE_SBOM = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  metadata: {
    tools: {
      components: [{ type: 'application', vendor: 'ONEKEY', name: 'Product Security Platform', version: '2.4' }],
    },
    component: { type: 'firmware', name: 'acme-router', version: '3.1.0' },
  },
  components: [
    {
      type: 'library', name: 'busybox', version: '1.35.0',
      evidence: { identity: { field: 'purl', confidence: 0.92, methods: [{ technique: 'binary-analysis', confidence: 0.92, value: '/bin/busybox' }] } },
    },
    {
      type: 'library', name: 'openssl', version: '1.1.1t',
      evidence: { identity: { field: 'version', confidence: 0.55, methods: [{ technique: 'hash-comparison', confidence: 0.55, value: 'libcrypto.so.1.1' }] } },
    },
    {
      type: 'library', name: 'dropbear', version: '2022.83',
      evidence: { identity: { field: 'name', confidence: 0.4, methods: [{ technique: 'filename', confidence: 0.4, value: '/usr/sbin/dropbear' }] } },
    },
  ],
};

/** A plain build SBOM: no evidence block at all. */
const BUILD_SBOM = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  metadata: { tools: { components: [{ type: 'application', name: 'cyclonedx-npm', version: '1.0.0' }] } },
  components: [{ type: 'library', name: 'openssl', version: '1.1.1t' }],
};

const OSV = [
  { id: 'GHSA-x', aliases: ['CVE-2023-0286'], affected: [{ package: { name: 'openssl' }, versions: ['1.1.1t'] }] },
];

let dir: string;
const out: string[] = [];
const io = () => ({
  cwd: dir,
  log: (m: string) => out.push(m),
  error: () => {},
  now: () => new Date('2026-08-16T02:00:00Z'),
});
const said = () => out.join('\n');

type Ev = { component: string; version?: string; sourceType: string; sourceIdentity: string; confidence: string; identifiedBy?: string[] };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cra-fw-'));
  out.length = 0;
  craProduct(io(), { name: 'Acme Router', version: '3.1.0' });
  writeFileSync(join(dir, 'fw.json'), JSON.stringify(FIRMWARE_SBOM));
  writeFileSync(join(dir, 'build.json'), JSON.stringify(BUILD_SBOM));
  writeFileSync(join(dir, 'osv.json'), JSON.stringify(OSV));
  writeFileSync(join(dir, 'kev.json'), JSON.stringify({ vulnerabilities: [] }));
  out.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('a firmware scan is analysis, not a build', () => {
  it('records each component with the confidence the analyser reported', () => {
    craIngest(io(), { sbom: join(dir, 'fw.json') });
    const rows = readStream<Ev>(dir, 'evidence').map((e) => e.body);

    expect(rows.map((r) => r.confidence).sort()).toEqual([
      'fingerprint 0.4', 'fingerprint 0.55', 'fingerprint 0.92',
    ]);
    // The one thing that must never happen to a fingerprint guess.
    expect(rows.every((r) => r.confidence !== 'exact')).toBe(true);
    expect(rows.every((r) => r.sourceType === 'analysis')).toBe(true);
  });

  it('names the analyser, not the tool that rendered the document', () => {
    craIngest(io(), { sbom: join(dir, 'fw.json') });
    const rows = readStream<Ev>(dir, 'evidence').map((e) => e.body);
    expect(rows[0]!.sourceIdentity).toBe('ONEKEY Product Security Platform 2.4');
    // cyclonedx-npm rendered our own SBOM; calling it the analyser would
    // misattribute the evidence.
    expect(sbomToolName(BUILD_SBOM as unknown as Record<string, unknown>)).toBeNull();
  });

  it('keeps the identification technique, so a reader knows how it was found', () => {
    craIngest(io(), { sbom: join(dir, 'fw.json') });
    const rows = readStream<Ev>(dir, 'evidence').map((e) => e.body);
    const dropbear = rows.find((r) => r.component === 'dropbear')!;
    expect(dropbear.identifiedBy).toEqual(['filename']);
  });

  it('leaves a real build SBOM exactly as it was: exact, and a build', () => {
    craIngest(io(), { sbom: join(dir, 'build.json') });
    const row = readStream<Ev>(dir, 'evidence')[0]!.body;
    expect(row.sourceType).toBe('build');
    expect(row.confidence).toBe('exact');
  });

  it('honours --analysis for a scanner that emits no evidence block', () => {
    craIngest(io(), { sbom: join(dir, 'build.json'), analysis: true, by: 'cve-bin-tool 3.3' });
    const row = readStream<Ev>(dir, 'evidence')[0]!.body;
    expect(row.sourceType).toBe('analysis');
    // No score reported, so asserted. Never exact.
    expect(row.confidence).toBe('asserted');
    expect(row.sourceIdentity).toBe('cve-bin-tool 3.3');
  });
});

describe('a finding inherits the doubt of the component it is about', () => {
  it('says the component was identified by analysis, with its confidence', async () => {
    craIngest(io(), { sbom: join(dir, 'fw.json') });
    await craWatch(io(), { osv: join(dir, 'osv.json'), kev: join(dir, 'kev.json'), becameAwareNow: true });

    const h = readStream<{ component: string; basis: string }>(dir, 'hypotheses')
      .map((x) => x.body)
      .find((x) => x.component === 'openssl')!;

    expect(h.basis).toContain('identified by analysis');
    expect(h.basis).toContain('fingerprint 0.55');
    expect(h.basis).toContain('depends on it being present');
  });

  it('says nothing of the kind for a build SBOM, where presence is known', async () => {
    craIngest(io(), { sbom: join(dir, 'build.json') });
    await craWatch(io(), { osv: join(dir, 'osv.json'), kev: join(dir, 'kev.json'), becameAwareNow: true });

    const h = readStream<{ basis: string }>(dir, 'hypotheses')[0]!.body;
    expect(h.basis).not.toContain('identified by analysis');
  });
});

describe('the version is a field, not the last word of a sentence', () => {
  it('matches OSV on the recorded version', async () => {
    // The OSV join read the version with assertion.split(' ').pop(). Rewording
    // the assertion for analysis rows made that return "analysis", and every
    // version match silently stopped working.
    craIngest(io(), { sbom: join(dir, 'fw.json') });
    const rows = readStream<Ev>(dir, 'evidence').map((e) => e.body);
    expect(rows.find((r) => r.component === 'openssl')!.version).toBe('1.1.1t');

    await craWatch(io(), { osv: join(dir, 'osv.json'), kev: join(dir, 'kev.json'), becameAwareNow: true });
    expect(
      readStream(dir, 'hypotheses'),
      'the exact-version OSV match must still fire for an analysis-sourced component',
    ).toHaveLength(1);
  });

  it('tells the user plainly that these are weaker facts', () => {
    craIngest(io(), { sbom: join(dir, 'fw.json') });
    expect(said()).toContain('ANALYSIS, not a build');
    expect(said()).toContain('findings against them inherit the doubt');
  });
});
