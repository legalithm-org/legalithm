/**
 * The EAA CLI, and the one property it must never have.
 *
 * A CI job that could assert conformance would be the whole product's failure
 * written as a convenience flag, so the surface is checked for the absence of
 * any such flag as deliberately as it is checked for what it does.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eaaIngest, eaaClock, EXIT, ADAPTERS } from '../eaa/commands.js';
import { CliHttpError } from '../http.js';

let cwd: string;
let out: string[];
let err: string[];
const io = () => ({ cwd, log: (m: string) => out.push(m), error: (m: string) => err.push(m) });

const axeReport = (violations: unknown[] = [], version = '4.10.2') => ({
  testEngine: { name: 'axe-core', version },
  url: 'https://example.test/checkout',
  violations,
  passes: [],
  incomplete: [],
  inapplicable: [],
});

const base = { subjectId: 's1', adapter: 'axe-core', apiUrl: 'https://api.test', apiKey: 'k' };

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'eaa-cli-'));
  out = [];
  err = [];
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const writeReport = (name: string, body: unknown) => {
  writeFileSync(join(cwd, name), JSON.stringify(body));
  return name;
};

const okResponse = (hypotheses = 2) => ({
  ok: true,
  runId: 'run_1',
  subjectVersion: 'v1',
  tool: 'axe-core@4.10.2',
  contractVersion: '1',
  written: { hypotheses },
  obligationsTouched: ['Annex I Section VII (b)'],
  suppressed: [],
  notes: [],
});

describe('eaa ingest — refusing before the round trip', () => {
  it('rejects an adapter with no contract', async () => {
    const code = await eaaIngest(io(), { ...base, adapter: 'lighthouse', from: 'x.json' });
    expect(code).toBe(EXIT.usage);
    expect(err.join(' ')).toMatch(/Unknown adapter "lighthouse"/);
  });

  it('rejects a missing file and unparseable JSON', async () => {
    expect(await eaaIngest(io(), { ...base, from: 'nope.json' })).toBe(EXIT.usage);
    writeFileSync(join(cwd, 'bad.json'), 'not json');
    expect(await eaaIngest(io(), { ...base, from: 'bad.json' })).toBe(EXIT.usage);
    expect(err.join(' ')).toMatch(/not valid JSON/);
  });

  /**
   * The version gate is what stops a silent mis-parse, so inventing a version
   * here would disable the protection it exists to provide.
   */
  it('refuses rather than guessing a tool version the report does not carry', async () => {
    const from = writeReport('r.json', { violations: [] });
    const code = await eaaIngest(io(), { ...base, from });
    expect(code).toBe(EXIT.usage);
    expect(err.join(' ')).toMatch(/--tool-version/);
  });

  it('reads the version out of an axe report', async () => {
    const from = writeReport('r.json', axeReport());
    const code = await eaaIngest(io(), { ...base, from, dryRun: true });
    expect(code).toBe(EXIT.ok);
    expect(out.join('\n')).toMatch(/axe-core @ 4\.10\.2/);
    expect(out.join('\n')).toMatch(/Nothing was sent/);
  });
});

describe('eaa ingest — what it sends and what it says', () => {
  it('posts to the partner ingest endpoint with the eu-eaa pack', async () => {
    const from = writeReport('r.json', axeReport());
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(okResponse()), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const code = await eaaIngest(io(), { ...base, from });
    expect(code).toBe(EXIT.ok);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/api/v1/partner/record/ingest');
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent.packKey).toBe('eu-eaa');
    expect(sent.adapter).toBe('axe-core');
    expect(sent.toolVersion).toBe('4.10.2');
  });

  it('says plainly that nothing it wrote is a conformance claim', async () => {
    const from = writeReport('r.json', axeReport());
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(okResponse()), { status: 200 }));
    await eaaIngest(io(), { ...base, from });
    expect(out.join('\n')).toMatch(/hypotheses.*clean run asserts nothing/s);
  });

  it('exits 1 on findings only when the caller asked for a gate', async () => {
    const from = writeReport('r.json', axeReport());
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(okResponse(3)), { status: 200 }));
    expect(await eaaIngest(io(), { ...base, from })).toBe(EXIT.ok);
    expect(await eaaIngest(io(), { ...base, from, failOnFinding: true })).toBe(EXIT.findings);
  });

  it('exits 0 with a gate when the run wrote nothing', async () => {
    const from = writeReport('r.json', axeReport());
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(okResponse(0)), { status: 200 }));
    expect(await eaaIngest(io(), { ...base, from, failOnFinding: true })).toBe(EXIT.ok);
  });

  /**
   * "API returned 422" hides the sentence the person in CI needs. The server
   * refuses with a gate and a reason, so both are printed.
   */
  it('prints the server refusal reason, not the status code', async () => {
    const from = writeReport('r.json', axeReport([], '5.1.0'));
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            error: 'Ingest refused',
            gate: 'version',
            reason: 'axe-core@5.1.0 is outside the range this parser was written against',
          }),
          { status: 422 },
        ),
    );
    const code = await eaaIngest(io(), { ...base, from, toolVersion: '5.1.0' });
    expect(code).toBe(EXIT.transport);
    expect(err.join('\n')).toMatch(/gate:\s+version/);
    expect(err.join('\n')).toMatch(/outside the range/);
  });
});

describe('eaa clock — the gate nobody else has', () => {
  const clockResponse = (status: string) => ({
    ok: true,
    worst: 'aging',
    summary: { fresh: 3, aging: 1, stale: 0, unknown: 0 },
    deadlines: [
      {
        kind: 'art14_renewal',
        dueOn: '2026-01-01',
        status,
        daysRemaining: status === 'lapsed' ? -227 : 41,
        basis: 'Article 14(5)(c): renewed at least every five years.',
      },
    ],
    notes: [],
  });

  it('fails the pipeline on a lapsed duty, and only when asked', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(clockResponse('lapsed')), { status: 200 }));
    expect(await eaaClock(io(), { ...base })).toBe(EXIT.ok);
    expect(await eaaClock(io(), { ...base, failOnLapsed: true })).toBe(EXIT.findings);
    expect(out.join('\n')).toMatch(/LAPSED 227 days ago/);
  });

  it('passes when the duty is merely due soon', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(clockResponse('due_soon')), { status: 200 }));
    expect(await eaaClock(io(), { ...base, failOnLapsed: true })).toBe(EXIT.ok);
    expect(out.join('\n')).toMatch(/41 days left/);
  });
});

describe('the surface has no way to claim conformance', () => {
  /**
   * A machine writes hypotheses. Asserted on the BYTES that leave, not on the
   * source text: a grep for "--declare" trips over the comment explaining why
   * there is no --declare, and passes the moment somebody adds the flag without
   * the comment. What matters is that no claim-shaped field is ever sent.
   */
  it('never puts a claim-shaped field on the wire', async () => {
    const from = writeReport('r.json', axeReport([{ id: 'color-contrast', help: 'x', nodes: [] }]));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(okResponse()), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await eaaIngest(io(), {
      ...base,
      from,
      subjectVersionLabel: 'v2',
      surfaceTarget: 'https://example.test/checkout',
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    for (const claimField of ['assertion', 'declaredBy', 'declaredAt', 'rationale', 'signature']) {
      expect(sent, `${claimField} must never leave this CLI`).not.toHaveProperty(claimField);
    }
    // What it MAY send: the observation and where it came from.
    expect(Object.keys(sent).sort()).toEqual(
      ['adapter', 'packKey', 'payload', 'subjectId', 'subjectVersionLabel', 'surfaceTarget', 'toolVersion'].sort(),
    );
  });

  it('offers exactly the three adapters the server has contracts for', () => {
    expect(ADAPTERS).toEqual(['axe-core', 'earl', 'user-testing']);
  });

  it('maps a transport failure to exit 3, never to a silent success', async () => {
    const from = writeReport('r.json', axeReport());
    vi.stubGlobal('fetch', async () => {
      throw new CliHttpError('network', 'unreachable');
    });
    expect(await eaaIngest(io(), { ...base, from })).toBe(EXIT.transport);
  });
});
