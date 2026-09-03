/**
 * Monitoring, as a diff over decision time.
 *
 * Every competitor sells continuous monitoring and the scheduling half is the
 * easy half. The part worth building is the diff, and a bitemporal store answers
 * it without keeping a changelog and hoping the changelog is right.
 *
 * The failure that matters most here is a false alarm. A monitor that cries wolf
 * gets ignored, and then it is worse than not having one.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { monitor, craMonitor, daysUntil } from '../cra/monitor.js';
import { append } from '../cra/store.js';

let cwd: string;
const T = (h: number) => `2026-08-16T${String(h).padStart(2, '0')}:00:00.000Z`;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'cra-monitor-'));
  mkdirSync(join(cwd, 'compliance', 'cra'), { recursive: true });
});

const writeRecord = (generatedAt: string) =>
  writeFileSync(
    join(cwd, 'compliance', 'cra', 'record.json'),
    JSON.stringify({ schema: 'legalithm.cra.record/v0.4', generatedAt }),
  );

const pinDocument = (name: string, contents: string, at: string, stream: 'risk' | 'policy' = 'risk') => {
  writeFileSync(join(cwd, name), contents);
  append(
    cwd,
    stream,
    {
      document: name,
      documentHash: createHash('sha256').update(contents).digest('hex'),
      declaredBy: 'D',
      summary: 's',
      productVersion: '1.0.0',
      ...(stream === 'policy' ? { kind: 'cvd_policy' } : {}),
    },
    { now: () => new Date(at) },
  );
};

describe('quiet', () => {
  it('says nothing changed, and says that is a finding', () => {
    writeRecord(T(12));
    const io: string[] = [];
    const code = craMonitor({ cwd, log: (m) => io.push(m) }, { now: T(13) });
    expect(code).toBe(0);
    expect(io.join('\n')).toMatch(/Nothing changed/);
    expect(io.join('\n')).toMatch(/Quiet is a finding too/);
  });
});

describe('what it catches', () => {
  it('sees a hypothesis recorded after the record was generated', () => {
    writeRecord(T(10));
    append(cwd, 'hypotheses', { cve: 'CVE-2026-1', component: 'zlib' }, { now: () => new Date(T(11)) });
    const r = monitor(cwd, { now: T(12) });
    const kinds = r.findings.map((f) => f.kind);
    expect(kinds).toContain('hypothesis_new');
    expect(r.findings.find((f) => f.kind === 'hypothesis_new')!.detail).toContain('CVE-2026-1');
    expect(r.findings.find((f) => f.kind === 'hypothesis_new')!.actionable).toBe(true);
  });

  it('does not see what predates the window', () => {
    append(cwd, 'hypotheses', { cve: 'CVE-OLD', component: 'x' }, { now: () => new Date(T(8)) });
    writeRecord(T(10));
    const r = monitor(cwd, { now: T(12) });
    expect(r.findings.map((f) => f.detail).join()).not.toContain('CVE-OLD');
  });

  it('reports a signed claim without demanding attention for it', () => {
    writeRecord(T(10));
    append(cwd, 'claims', { cve: 'CVE-2026-2', verdict: 'not_affected', declaredBy: 'Dana' }, { now: () => new Date(T(11)) });
    const claim = monitor(cwd, { now: T(12) }).findings.find((f) => f.kind === 'claim_new')!;
    expect(claim.detail).toContain('Dana');
    // Somebody already looked. That is the opposite of needing a person.
    expect(claim.actionable).toBe(false);
  });

  it('flags a record the store has moved past', () => {
    writeRecord(T(10));
    append(cwd, 'assessments', { ref: 'Annex I Part I (1)', status: 'met' }, { now: () => new Date(T(11)) });
    const r = monitor(cwd, { now: T(12) });
    expect(r.findings.map((f) => f.kind)).toContain('record_stale');
  });
});

describe('pinned documents', () => {
  // THE BUG THIS GUARDS. The store is append-only, so re-pinning after an edit
  // leaves every earlier hash. Comparing against all of them reported five
  // drifts on a record that `cra record --verify` passes.
  it('compares only against the NEWEST pin, not every historical one', () => {
    writeRecord(T(12));
    pinDocument('policy.md', 'first version', T(8));
    pinDocument('policy.md', 'second version', T(9));
    pinDocument('policy.md', 'third version', T(10));
    // The file on disk is the third version, which is what the newest pin says.
    const r = monitor(cwd, { now: T(13) });
    expect(r.findings.filter((f) => f.kind === 'document_drifted')).toHaveLength(0);
  });

  it('catches a document edited after its newest pin', () => {
    writeRecord(T(12));
    pinDocument('policy.md', 'as pinned', T(10));
    writeFileSync(join(cwd, 'policy.md'), 'edited afterwards');
    const drift = monitor(cwd, { now: T(13) }).findings.filter((f) => f.kind === 'document_drifted');
    expect(drift).toHaveLength(1);
    expect(drift[0]!.actionable).toBe(true);
  });

  // A record and its signature travel without the documents often enough that
  // treating absence as drift would be the same cry-wolf failure.
  it('does not treat an absent document as drift', () => {
    writeRecord(T(12));
    pinDocument('gone.md', 'x', T(10));
    rmSync(join(cwd, 'gone.md'));
    expect(monitor(cwd, { now: T(13) }).findings.filter((f) => f.kind === 'document_drifted')).toHaveLength(0);
  });
});

describe('the support period', () => {
  it('warns before it ends', () => {
    writeRecord(T(12));
    append(cwd, 'support', { until: '2026-10-01', declaredBy: 'D' }, { now: () => new Date(T(9)) });
    const f = monitor(cwd, { now: T(13) }).findings.find((x) => x.kind === 'support_expiring')!;
    expect(f.detail).toMatch(/ends in \d+ days/);
    expect(f.actionable).toBe(true);
  });

  it('says plainly when it has already ended', () => {
    writeRecord(T(12));
    append(cwd, 'support', { until: '2026-01-01', declaredBy: 'D' }, { now: () => new Date(T(9)) });
    const f = monitor(cwd, { now: T(13) }).findings.find((x) => x.kind === 'support_expiring')!;
    expect(f.detail).toMatch(/ended \d+ days ago/);
  });

  it('stays quiet when it is far off', () => {
    writeRecord(T(12));
    append(cwd, 'support', { until: '2031-08-16', declaredBy: 'D' }, { now: () => new Date(T(9)) });
    expect(monitor(cwd, { now: T(13) }).findings.some((f) => f.kind === 'support_expiring')).toBe(false);
  });

  it('counts days the way a calendar does', () => {
    expect(daysUntil('2026-08-26T00:00:00.000Z', '2026-08-16T00:00:00.000Z')).toBe(10);
    expect(daysUntil('2026-08-06T00:00:00.000Z', '2026-08-16T00:00:00.000Z')).toBe(-10);
  });
});

describe('the exit code, which is what a scheduler reads', () => {
  it('is 3 only when something wants a person', () => {
    writeRecord(T(10));
    append(cwd, 'claims', { cve: 'C', verdict: 'fixed', declaredBy: 'D' }, { now: () => new Date(T(11)) });
    // A claim and a stale record: the stale record is the actionable one.
    const withStale = craMonitor({ cwd, log: () => {} }, { now: T(12) });
    expect(withStale).toBe(3);
  });

  it('is 0 when there is nothing to do', () => {
    writeRecord(T(12));
    expect(craMonitor({ cwd, log: () => {} }, { now: T(13) })).toBe(0);
  });

  it('says a record has never been generated rather than staying silent', () => {
    const r = monitor(cwd, { now: T(12) });
    expect(r.findings.find((f) => f.kind === 'record_stale')!.detail).toMatch(/never|no record/i);
  });
});
