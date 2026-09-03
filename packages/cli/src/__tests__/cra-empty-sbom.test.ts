import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { craProduct, craIngest, craWatch, NO_COMPONENTS } from '../cra/commands.js';
import { readStream } from '../cra/store.js';

/**
 * "This product has no third-party components" and "no SBOM was ever ingested"
 * are opposite states, and they were indistinguishable.
 *
 * An empty SBOM produced zero evidence rows, so `cra watch` refused with
 * "No evidence ingested. Run: legalithm cra ingest --sbom <path>" after the
 * SBOM had in fact been ingested. A product with no dependencies could not
 * produce a record at all.
 *
 * That is backwards. legalithm@0.6.1 declares no runtime dependencies, so its
 * own SBOM is legitimately empty, and having nothing to declare is the position
 * Annex I Part II rewards. The empty result is a finding, not a gap.
 */
const EMPTY_SBOM = { bomFormat: 'CycloneDX', specVersion: '1.5', components: [] };

const OSV = [
  {
    id: 'GHSA-x',
    aliases: ['CVE-2025-0001'],
    affected: [{ package: { name: 'left-pad', ecosystem: 'npm' }, versions: ['1.0.0'] }],
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
  dir = mkdtempSync(join(tmpdir(), 'cra-empty-'));
  out.length = 0;
  err.length = 0;
  craProduct(io(), { name: 'Legalithm CLI', version: '0.6.1' });
  writeFileSync(join(dir, 'empty.json'), JSON.stringify(EMPTY_SBOM));
  writeFileSync(join(dir, 'osv.json'), JSON.stringify(OSV));
  writeFileSync(join(dir, 'kev.json'), JSON.stringify({ vulnerabilities: [] }));
  out.length = 0;
  err.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('an SBOM that legitimately lists nothing', () => {
  type Ev = { component: string; assertion: string };

  it('records the empty SBOM instead of silently ingesting nothing', () => {
    const code = craIngest(io(), { sbom: join(dir, 'empty.json') });
    expect(code).toBe(0);

    const rows = readStream<Ev>(dir, 'evidence');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body.component).toBe(NO_COMPONENTS);
    expect(rows[0]!.body.assertion).toBe('contains no third-party components');
  });

  it('lets watch run, rather than claiming no SBOM was ingested', async () => {
    craIngest(io(), { sbom: join(dir, 'empty.json') });
    out.length = 0;
    err.length = 0;

    const code = await craWatch(io(), { osv: join(dir, 'osv.json'), kev: join(dir, 'kev.json'), becameAwareNow: true });

    expect(code).toBe(0);
    expect(err.join('\n')).not.toContain('No evidence ingested');
    expect(out.join('\n')).toContain('records no third-party components');
    // It must not read as a clean bill of health for the product's own code.
    expect(out.join('\n')).toContain('This is a result, not a gap');
  });

  it('does not report a component count it did not check', async () => {
    craIngest(io(), { sbom: join(dir, 'empty.json') });
    out.length = 0;
    await craWatch(io(), { osv: join(dir, 'osv.json'), kev: join(dir, 'kev.json'), becameAwareNow: true });
    // The marker occupies a slot in the evidence map but is not a component.
    expect(out.join('\n')).not.toMatch(/Checked 1 component/);
  });

  it('never looks the marker up as a package, even if an advisory bears its name', async () => {
    // Planting the trap, because otherwise this test passes whether or not the
    // filter exists: no real advisory is ever named "(no third-party
    // components)", so a missing filter would look identical to a working one.
    writeFileSync(
      join(dir, 'osv-trap.json'),
      JSON.stringify([
        {
          id: 'GHSA-trap',
          aliases: ['CVE-2025-9999'],
          // `versions: []` is the name-only path in matchOsv, which is how most
          // real advisories look: they express ranges rather than an explicit
          // version list. A populated list here would be skipped on the version
          // check before the filter was ever consulted, and the test would pass
          // whether or not the filter existed.
          affected: [{ package: { name: NO_COMPONENTS, ecosystem: 'npm' }, versions: [] }],
        },
      ]),
    );
    craIngest(io(), { sbom: join(dir, 'empty.json') });
    await craWatch(io(), { osv: join(dir, 'osv-trap.json'), kev: join(dir, 'kev.json'), becameAwareNow: true });

    expect(
      readStream<{ cve: string }>(dir, 'hypotheses').map((h) => h.body.cve),
      'the empty-SBOM marker was joined against advisory data as if it were a package',
    ).toEqual([]);
  });

  it('STILL refuses when no SBOM was ingested at all, which is the opposite state', async () => {
    // The whole point of the marker is that these two stay distinguishable.
    const code = await craWatch(io(), { osv: join(dir, 'osv.json'), kev: join(dir, 'kev.json'), becameAwareNow: true });
    expect(code).toBe(1);
    expect(err.join('\n')).toContain('No evidence ingested');
  });
});
