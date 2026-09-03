import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildUserAdvisory,
  timeliness,
  renderAdvisoryMarkdown,
  advisoryEnvelope,
  type AdvisoryFacts,
} from '../cra/advisory.js';

const NOW = new Date('2026-09-30T00:00:00.000Z');
const FACTS: AdvisoryFacts = {
  trigger: 'vulnerability',
  reference: 'CVE-2023-4863',
  product: { name: 'Acme Gateway', version: '2.4.0' },
  awareAt: '2026-09-14T00:00:00.000Z',
};

describe('Article 14(8) is a separate duty, and says so', () => {
  /**
   * The reason this feature exists: the register held only 14(1), so the duty
   * to inform USERS was invisible. Filing with the CSIRT coordinator and ENISA
   * does not discharge it, and a tool tracking only filings would report a
   * manufacturer as done with a live duty outstanding.
   */
  it('states that filing with the CSIRT does not discharge it', () => {
    const a = buildUserAdvisory(FACTS, NOW);
    expect(a.notice).toContain('SEPARATE');
    expect(a.notice).toContain('does not discharge the other');
    expect(a.timeliness.message).toContain('not discharged by filing');
  });

  it('fires on the incident track too', () => {
    const a = buildUserAdvisory({ ...FACTS, trigger: 'incident' }, NOW);
    expect(a.trigger).toBe('incident');
    expect(a.notice).toContain('about a incident');
  });
});

describe('timeliness without inventing a deadline', () => {
  it('reports days open rather than an overdue date', () => {
    const t = timeliness(FACTS, NOW);
    expect(t.state).toBe('outstanding');
    if (t.state === 'outstanding') expect(t.daysOpen).toBe(16);
    // 14(8) sets no period. Inventing one would be the mistake fixed twice today.
    expect(t.message).toContain('sets no fixed period');
    expect(t.message).not.toMatch(/overdue by|due (on|at)/i);
  });

  it('names the consequence the Regulation actually attaches to delay', () => {
    // Not a penalty: the CSIRTs may tell your users themselves.
    expect(timeliness(FACTS, NOW).message).toContain('CSIRTs may provide the information to users');
  });

  it('records how long it took once issued', () => {
    const t = timeliness({ ...FACTS, issuedAt: '2026-09-17T00:00:00.000Z' }, NOW);
    expect(t.state).toBe('issued');
    if (t.state === 'issued') expect(t.daysToIssue).toBe(3);
  });

  it('never reports negative days', () => {
    const t = timeliness({ ...FACTS, awareAt: '2027-01-01T00:00:00.000Z' }, NOW);
    if (t.state === 'outstanding') expect(t.daysOpen).toBe(0);
  });
});

describe('the advisory never invents what to tell users', () => {
  it('leaves mitigations and impacted versions as gaps', () => {
    const a = buildUserAdvisory(FACTS, NOW);
    expect(a.gaps).toHaveLength(2);
    expect(a.complete).toBe(false);
    expect(renderAdvisoryMarkdown(a)).toContain('before this goes to users');
  });

  it('fills them when the record holds them', () => {
    const a = buildUserAdvisory(
      { ...FACTS, userMitigations: ['Upgrade to 2.4.1', 'Disable image preview'], affectedVersions: ['2.4.0'] },
      NOW,
    );
    expect(a.gaps).toEqual([]);
    expect(a.complete).toBe(true);
    expect(renderAdvisoryMarkdown(a)).toContain('Disable image preview');
  });
});

describe('the machine-readable half', () => {
  it('satisfies "structured, machine-readable" without claiming to be CSAF', () => {
    const e = advisoryEnvelope(buildUserAdvisory(FACTS, NOW));
    expect(String(e.note)).toContain('NOT CSAF 2.0');
    expect(String(e.note)).toContain('not been validated against that schema');
    expect(String(e.schema)).not.toMatch(/csaf/i);
  });

  it('is not marked published, because publishing is the manufacturer\'s act', () => {
    expect(advisoryEnvelope(buildUserAdvisory(FACTS, NOW)).published).toBe(false);
  });

  it('keeps the verbatim requirement beside every field', () => {
    const oj = readFileSync(join(process.cwd(), 'corpus', 'eu-cra', 'source', 'oj-excerpt.txt'), 'utf8');
    const flat = oj.replace(/\s+/g, ' ');
    for (const f of buildUserAdvisory(FACTS, NOW).fields) {
      const core = f.requirement.split(' ... ').pop()!.replace(/\s+/g, ' ').trim();
      expect(flat, `${f.ref} not verbatim`).toContain(core);
    }
  });
});

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { craProduct, craIngest, craWatch, craAdvise, craRecord } from '../cra/commands.js';
import { readStream } from '../cra/store.js';

describe('the record tracks the duty across an append-only store', () => {
  let dir: string;
  const out: string[] = [];
  const io = () => ({ cwd: dir, log: (m: string) => out.push(m), error: () => {} });

  const setup = async () => {
    dir = mkdtempSync(join(tmpdir(), 'cra-adv-'));
    out.length = 0;
    craProduct(io(), { name: 'Acme Gateway', version: '2.4.0' });
    writeFileSync(join(dir, 'sbom.json'), JSON.stringify({ bomFormat: 'CycloneDX', components: [{ name: 'libwebp', version: '1.3.1' }] }));
    craIngest(io(), { sbom: join(dir, 'sbom.json') });
    writeFileSync(join(dir, 'osv.json'), JSON.stringify([{ id: 'G', aliases: ['CVE-2023-4863'], affected: [{ package: { name: 'libwebp' }, versions: ['1.3.1'] }] }]));
    writeFileSync(join(dir, 'kev.json'), JSON.stringify({ vulnerabilities: [{ cveID: 'CVE-2023-4863', product: 'Chromium WebP', vulnerabilityName: 'x' }] }));
    await craWatch(io(), { kev: join(dir, 'kev.json'), osv: join(dir, 'osv.json'), becameAwareNow: true });
    out.length = 0;
  };

  const notInformed = (): number => {
    out.length = 0;
    craRecord(io(), {});
    const line = out.find((l) => l.includes('users not informed'))!;
    return Number(/users not informed (\d+)/.exec(line)![1]);
  };

  it('shows the duty open, then discharged, and never re-opens it', async () => {
    await setup();
    craAdvise(io(), { cve: 'CVE-2023-4863' });
    expect(notInformed(), 'a drafted advisory is not an issued one').toBe(1);

    craAdvise(io(), { cve: 'CVE-2023-4863', issuedAt: '2026-08-15' });
    expect(notInformed(), 'issuing discharges it').toBe(0);

    /*
     * The bug this pins. The store is append-only, so the draft row and the
     * issued row both persist. Counting rows without issuedAt reported the
     * duty open forever after it had been met. Once users have been informed
     * that is a historical fact; drafting again does not un-inform them.
     */
    craAdvise(io(), { cve: 'CVE-2023-4863' });
    // TWO rows, not three: the re-draft is byte-identical to the first, so
    // content addressing dedupes it. Re-running a command does not grow the log.
    expect(readStream(dir, 'advisories').length).toBe(2);
    expect(notInformed(), 'a later draft must not re-open a discharged duty').toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('tracks each reference separately', async () => {
    await setup();
    craAdvise(io(), { cve: 'CVE-2023-4863', issuedAt: '2026-08-15' });
    craAdvise(io(), { cve: 'INC-2026-002', incident: true });
    expect(notInformed()).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});
