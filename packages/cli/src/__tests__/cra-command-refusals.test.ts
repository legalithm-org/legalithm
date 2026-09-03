import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  craProduct, craIngest, craWatch, craClaim, craClassify,
  craAssess, craDoc, craSupport, craReport, craAdvise, craRecord,
} from '../cra/commands.js';

/**
 * The refusals, not the happy paths.
 *
 * Every CRA command has a branch that declines to do something: no product
 * registered, no evidence, an unsigned verdict, a document that belongs to
 * someone else. Those branches are the product. A compliance tool that fails
 * open, or that emits a document when it should refuse, is worse than one that
 * does nothing, and until now they were the least covered code in the package.
 */
let dir: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ cwd: dir, log: (m: string) => out.push(m), error: (m: string) => err.push(m) });
const said = () => `${out.join('\n')}\n${err.join('\n')}`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cra-ref-'));
  out.length = 0;
  err.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('commands refuse before an empty record, rather than inventing one', () => {
  it('ingest refuses with no product registered', () => {
    expect(craIngest(io(), { sbom: 'x.json' })).toBe(1);
    expect(said()).toContain('No product registered');
  });

  it('ingest refuses a missing SBOM file by name', () => {
    craProduct(io(), { name: 'p', version: '1' });
    expect(craIngest(io(), { sbom: join(dir, 'absent.json') })).toBe(1);
    expect(said()).toContain('No SBOM at');
  });

  it('ingest refuses an SBOM it cannot recognise', () => {
    craProduct(io(), { name: 'p', version: '1' });
    writeFileSync(join(dir, 'weird.json'), JSON.stringify({ notAnSbom: true }));
    expect(craIngest(io(), { sbom: join(dir, 'weird.json') })).toBe(1);
    expect(said()).toMatch(/CycloneDX|SPDX/);
  });

  it('ingest refuses a declaration with no signer', () => {
    craProduct(io(), { name: 'p', version: '1' });
    expect(craIngest(io(), { declare: 'we do X' })).toBe(1);
    expect(said()).toContain('needs a signer');
  });

  it('watch refuses with no evidence ingested', async () => {
    craProduct(io(), { name: 'p', version: '1' });
    expect(await craWatch(io(), { osv: 'x', becameAwareNow: true })).toBe(1);
    expect(said()).toContain('No evidence ingested');
  });
});

describe('claim: the only door across the machine/human boundary', () => {
  const seed = () => {
    craProduct(io(), { name: 'p', version: '1' });
    writeFileSync(join(dir, 's.json'), JSON.stringify({ bomFormat: 'CycloneDX', components: [{ name: 'libwebp', version: '1.3.1' }] }));
    craIngest(io(), { sbom: join(dir, 's.json') });
  };

  it('refuses without a verdict, a CVE, or a name', () => {
    seed();
    expect(craClaim(io(), { cve: 'CVE-1' })).toBe(1);
    expect(said()).toContain('Usage');
  });

  it('refuses under_investigation as a claim, because nobody can assert it', () => {
    seed();
    expect(craClaim(io(), { cve: 'CVE-1', verdict: 'under_investigation', by: 'P' })).toBe(1);
    expect(said()).toContain('not assertable');
  });

  it('refuses not_affected without a rationale, which VEX requires', () => {
    seed();
    expect(craClaim(io(), { cve: 'CVE-1', verdict: 'not_affected', by: 'P' })).toBe(1);
    expect(said()).toContain('needs --rationale');
  });

  it('refuses a claim about a CVE the record never saw', () => {
    seed();
    expect(craClaim(io(), { cve: 'CVE-9999-1', verdict: 'affected', by: 'P' })).toBe(1);
    expect(said()).toContain('No hypothesis');
  });
});

describe('classify states its inputs or refuses', () => {
  it('refuses an unknown kind', () => {
    expect(craClassify(io(), { kind: 'toaster' })).toBe(1);
  });

  it('refuses with no kind at all', () => {
    expect(craClassify(io(), {})).toBe(1);
    expect(said()).toContain('Usage');
  });

  it('emits json when asked, and cites articles in it', () => {
    expect(craClassify(io(), { kind: 'software', connected: true, commercial: true, json: true })).toBe(0);
    const parsed = JSON.parse(out.join('\n'));
    expect(JSON.stringify(parsed)).toContain('Article');
  });
});

describe('support: Article 13(8) refuses an undefended date', () => {
  it('reports not_set before anything is recorded', () => {
    craProduct(io(), { name: 'p', version: '1' });
    expect(craSupport(io(), {})).toBe(3);
    expect(said()).toContain('NOT SET');
  });

  it('refuses a date with no name behind it', () => {
    craProduct(io(), { name: 'p', version: '1' });
    expect(craSupport(io(), { until: '2032-01-01' })).toBe(1);
  });

  it('refuses a date with no rationale, which Annex VII (4) requires', () => {
    craProduct(io(), { name: 'p', version: '1' });
    expect(craSupport(io(), { until: '2032-01-01', by: 'Pedram Madani' })).toBe(1);
  });
});

describe('doc and assess before there is anything to say', () => {
  it('doc refuses an unknown type', () => {
    craProduct(io(), { name: 'p', version: '1' });
    expect(craDoc(io(), { type: 'nonsense' })).toBe(1);
  });

  it('assess reports every requirement unassessed rather than defaulting to met', () => {
    craProduct(io(), { name: 'p', version: '1' });
    expect(craAssess(io(), {})).toBe(3);
    expect(said()).toContain('NOT ASSESSED');
  });

  it('assess --gaps lists the work rather than a score', () => {
    craProduct(io(), { name: 'p', version: '1' });
    craAssess(io(), { gaps: true });
    expect(said()).toMatch(/Annex I/);
  });
});

describe('Article 14 commands refuse to draft from nothing', () => {
  it('report refuses without a stage', () => {
    expect(craReport(io(), { cve: 'CVE-1' })).toBe(1);
    expect(said()).toContain('Usage');
  });

  it('report refuses an unknown stage', () => {
    expect(craReport(io(), { cve: 'CVE-1', stage: 'someday' })).toBe(1);
  });

  it('report refuses a CVE with no finding behind it', () => {
    craProduct(io(), { name: 'p', version: '1' });
    expect(craReport(io(), { cve: 'CVE-9999-1', stage: 'early-warning' })).toBe(1);
    expect(said()).toContain('not from nothing');
  });

  it('advise refuses without a reference', () => {
    expect(craAdvise(io(), {})).toBe(1);
    expect(said()).toContain('Usage');
  });
});

describe('record', () => {
  it('REFUSES on an empty store rather than emitting an empty record', () => {
    // My first version asserted this returned 0 with zeroed counts. It does
    // not, and the code is right: a record with no product is not a record of
    // anything, and emitting one would be a document about nothing.
    // craRecord returns { code, record? }, not a bare exit code.
    expect(craRecord(io(), {}).code).toBe(1);
  });

  it('reports zeroed counts once a product exists', () => {
    craProduct(io(), { name: 'p', version: '1' });
    out.length = 0;
    expect(craRecord(io(), {}).code).toBe(0);
    expect(said()).toContain('claims      0');
  });

  it('emits json on request', () => {
    craProduct(io(), { name: 'p', version: '1' });
    craRecord(io(), { json: true });
    const parsed = JSON.parse(out.filter((l) => l.trim().startsWith('{') || l.includes('"')).join('\n') || '{}');
    expect(JSON.stringify(parsed)).toContain('2024/2847');
  });
});
