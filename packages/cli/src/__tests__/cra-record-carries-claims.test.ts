import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { craProduct, craIngest, craWatch, craClaim, craRecord } from '../cra/commands.js';

/**
 * The claim is the load-bearing object and it was the thinnest thing in the
 * record.
 *
 * A hypothesis is a machine's opinion and carries no weight. A claim is a named
 * person against a verdict, and that difference is the whole design. But the
 * record surfaced only `assertion`, `declaredBy` and `declaredAt`, so the
 * verdict, the CVE, the reasoning and the link back to the hypothesis stayed in
 * the local store and never reached the signed document.
 *
 * An auditor holding the record could see that somebody asserted something, and
 * not what they concluded or why. Same shape as the Annex I determinations and
 * the support period before them: written by one command, never read back by the
 * record.
 */
const SPEC = readFileSync(join(__dirname, '..', '..', '..', '..', 'docs', 'CRA-RECORD-FORMAT.md'), 'utf8');

const OSV = [
  {
    id: 'GHSA-x',
    aliases: ['CVE-2021-23337'],
    affected: [{ package: { name: 'lodash', ecosystem: 'npm' }, versions: ['4.17.20'] }],
  },
];

let dir: string;
const io = () => ({
  cwd: dir,
  log: () => {},
  error: () => {},
  now: () => new Date('2026-08-16T01:00:00Z'),
});

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cra-claims-'));
  craProduct(io(), { name: 'Widget', version: '1.0.0' });
  writeFileSync(
    join(dir, 'sbom.json'),
    JSON.stringify({ bomFormat: 'CycloneDX', components: [{ name: 'lodash', version: '4.17.20' }] }),
  );
  craIngest(io(), { sbom: join(dir, 'sbom.json') });
  writeFileSync(join(dir, 'osv.json'), JSON.stringify(OSV));
  writeFileSync(join(dir, 'kev.json'), JSON.stringify({ vulnerabilities: [] }));
  await craWatch(io(), { osv: join(dir, 'osv.json'), kev: join(dir, 'kev.json'), becameAwareNow: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the record carries the whole claim, not a summary of it', () => {
  const sign = () =>
    craClaim(io(), {
      cve: 'CVE-2021-23337',
      verdict: 'not_affected',
      by: 'Pedram Madani',
      rationale: 'The vulnerable code path is never reached from any entry point we ship.',
    });

  it('carries the verdict, the CVE and the reasoning', () => {
    sign();
    const { record } = craRecord(io(), {});

    expect(record!.claims).toHaveLength(1);
    const c = record!.claims[0]!;
    expect(c.cve).toBe('CVE-2021-23337');
    expect(c.verdict).toBe('not_affected');
    expect(c.rationale).toContain('never reached');
    expect(c.declaredBy).toBe('Pedram Madani');
    expect(c.declaredAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('puts the claim inside the hashed content, so signing it signs the claim', () => {
    const before = craRecord(io(), {}).record!.recordHash;
    sign();
    const after = craRecord(io(), {}).record!.recordHash;

    expect(
      after,
      'recording a claim did not move the hash, so a signature would not cover it',
    ).not.toBe(before);
    // And the reasoning itself is in there, not just the fact a claim exists.
    expect(JSON.stringify(craRecord(io(), {}).record)).toContain('never reached');
  });

  it('promotes the matching hypothesis out of under_investigation', () => {
    sign();
    const { record } = craRecord(io(), {});
    const h = record!.hypotheses.find((x) => x.cve === 'CVE-2021-23337')!;

    expect(h.status).toBe('not_affected');
    expect(h.signedBy).toBe('Pedram Madani');
    // The machine's own view is kept alongside, never overwritten by the human's.
    expect(h.machineVerdict).toBe('not_assessed');
  });

  it('is documented in the published spec, field by field', () => {
    sign();
    const { record } = craRecord(io(), {});

    const documented = new Set(
      [...SPEC.matchAll(/^\|\s*`([A-Za-z][A-Za-z0-9]*)`\s*\|/gm)].map((m) => m[1]!),
    );
    const undocumented = Object.keys(record!.claims[0]!).filter((k) => !documented.has(k));
    expect(
      undocumented,
      'the claim is the object this format exists to carry; every field of it must be specified',
    ).toEqual([]);
  });
});
