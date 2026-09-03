import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { craProduct, craIngest, craWatch } from '../cra/commands.js';
import { readStream } from '../cra/store.js';
import type { ClockBody } from '../cra/commands.js';

/**
 * The Article 14 clock runs from AWARENESS, and awareness is not command runtime.
 *
 * THE DEFECT THIS FIXES. `cra watch` computed dueAt as `now + 24h`, where `now` was when
 * the command happened to run. A team that becomes aware on Tuesday at 10:15 and runs the
 * scan on Thursday at 14:00 was told the early warning was due Friday at 14:00. The real
 * deadline was Wednesday at 10:15 — already two days gone. Wrong in the direction that
 * tells a manufacturer they have more time, which is the same direction as the Article 11
 * misfiling this corpus already had to correct once.
 *
 * WHY THERE IS NO SILENT DEFAULT. Defaulting to now makes the same wrong deadline with a
 * more explicit API: the flag is simply forgotten and the answer is confidently wrong.
 * Awareness is a fact only the customer holds, and the rest of this codebase already
 * refuses to invent those — an ambiguous legacy pin reports UNKNOWN rather than a guess,
 * a semantic change requires re-attestation rather than a materiality judgement, and
 * advisor authority comes from a delegation rather than from workspace membership. A
 * statutory deadline is the worst possible place to break that rule.
 *
 * So a real clock requires the operator to say when they knew, or to affirm that they
 * became aware now. `recordedAt` is stored beside it, because the gap between knowing and
 * recording is itself a fact worth keeping.
 */
let dir: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ cwd: dir, log: (m: string) => out.push(m), error: (m: string) => err.push(m) });

const SBOM = { bomFormat: 'CycloneDX', components: [{ name: 'libwebp', version: '1.3.1' }] };
const OSV = [
  { id: 'G1', aliases: ['CVE-2023-4863'], summary: 'heap overflow', affected: [{ package: { name: 'libwebp' }, versions: ['1.3.1'] }] },
];
const KEV = { vulnerabilities: [{ cveID: 'CVE-2023-4863', product: 'Chromium WebP', vulnerabilityName: 'x' }] };

const AWARE = '2026-09-15T10:15:00.000Z';
const RUN_AT = new Date('2026-09-17T14:00:00.000Z'); // two days later

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cra-aware-'));
  out.length = 0;
  err.length = 0;
  craProduct(io(), { name: 'Acme Gateway', version: '2.4.0' });
  writeFileSync(join(dir, 's.json'), JSON.stringify(SBOM));
  writeFileSync(join(dir, 'osv.json'), JSON.stringify(OSV));
  writeFileSync(join(dir, 'kev.json'), JSON.stringify(KEV));
  craIngest(io(), { sbom: join(dir, 's.json') });
  out.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const clocks = () => readStream<ClockBody>(dir, 'clocks').map((e) => e.body);
const runAt = () => ({ ...io(), now: () => RUN_AT });

describe('the Article 14 clock runs from awareness', () => {
  it('refuses to start a real clock without an awareness timestamp', async () => {
    const code = await craWatch(runAt(), { kev: join(dir, 'kev.json'), osv: join(dir, 'osv.json') });
    expect(code, 'a statutory clock must not start on an assumed timestamp').toBe(1);
    expect(clocks(), 'nothing may be written on a guess').toHaveLength(0);
    expect(`${err.join('\n')}`).toMatch(/became-aware/i);
  });

  it('computes the deadline from awareness, not from when the scan ran', async () => {
    await craWatch(runAt(), {
      kev: join(dir, 'kev.json'),
      osv: join(dir, 'osv.json'),
      becameAwareAt: AWARE,
    });
    const early = clocks().find((c) => c.article === '14(2)(a)');
    expect(early, 'the 24h clock should exist').toBeDefined();
    // Awareness Tuesday 10:15 -> due Wednesday 10:15. NOT Friday 14:00.
    expect(early!.dueAt).toBe('2026-09-16T10:15:00.000Z');
  });

  it('keeps recordedAt separate, so the gap between knowing and recording is visible', async () => {
    await craWatch(runAt(), {
      kev: join(dir, 'kev.json'),
      osv: join(dir, 'osv.json'),
      becameAwareAt: AWARE,
    });
    const early = clocks().find((c) => c.article === '14(2)(a)')!;
    expect(early.becameAwareAt).toBe(AWARE);
    expect(early.recordedAt).toBe(RUN_AT.toISOString());
    expect(early.becameAwareAt).not.toBe(early.recordedAt);
  });

  it('accepts an explicit affirmation that awareness is now', async () => {
    // The convenience path still exists — it just has to be chosen, not assumed.
    await craWatch(runAt(), {
      kev: join(dir, 'kev.json'),
      osv: join(dir, 'osv.json'),
      becameAwareNow: true,
    });
    const early = clocks().find((c) => c.article === '14(2)(a)')!;
    expect(early.becameAwareAt).toBe(RUN_AT.toISOString());
    expect(early.dueAt).toBe('2026-09-18T14:00:00.000Z');
  });

  it('rejects an unparseable or future awareness timestamp', async () => {
    const bad = await craWatch(runAt(), { kev: join(dir, 'kev.json'), osv: join(dir, 'osv.json'), becameAwareAt: 'last tuesday' });
    expect(bad).toBe(1);
    // You cannot have become aware of something that has not happened yet, and a future
    // timestamp would silently buy extra hours on the clock.
    const future = await craWatch(runAt(), { kev: join(dir, 'kev.json'), osv: join(dir, 'osv.json'), becameAwareAt: '2027-01-01T00:00:00.000Z' });
    expect(future).toBe(1);
    expect(clocks()).toHaveLength(0);
  });

  it('still gives 14(2)(c) no due date, which awareness does not change', async () => {
    // Regression guard on the behaviour that was already right: (c) runs from a corrective
    // measure being available, not from awareness, so it must stay null.
    await craWatch(runAt(), { kev: join(dir, 'kev.json'), osv: join(dir, 'osv.json'), becameAwareAt: AWARE });
    const final = clocks().find((c) => c.article === '14(2)(c)');
    expect(final, '14(2)(c) should still be recorded').toBeDefined();
    expect(final!.dueAt).toBeNull();
  });
});
