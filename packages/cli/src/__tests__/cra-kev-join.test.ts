import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { craProduct, craIngest, craWatch } from '../cra/commands.js';
import { readStream } from '../cra/store.js';

/**
 * The regression this file exists for.
 *
 * `cra watch` used to keep a KEV entry when the component name appeared as a
 * substring of `vulnerabilityName`. The test that covered it used a fixture
 * reading 'Google Chrome libwebp Heap Buffer Overflow' — a string invented to
 * contain the component name. Real KEV never says that, so the test passed and
 * the tool reported "no component matched" for an actively exploited CVE in a
 * component the SBOM listed.
 *
 * KEV_REAL below is the VERBATIM shape of the catalogue entry as published by
 * CISA. Every KEV fixture in this file must stay that shape, because a fixture
 * shaped to the implementation proves only that the implementation is
 * self-consistent.
 */
const KEV_REAL = {
  vulnerabilities: [
    {
      cveID: 'CVE-2023-4863',
      vendorProject: 'Google',
      product: 'Chromium WebP',
      vulnerabilityName: 'Google Chromium WebP Heap-Based Buffer Overflow Vulnerability',
      dateAdded: '2023-09-13',
    },
  ],
};

const OSV_REAL = [
  {
    id: 'GHSA-j7hp-h8jx-5ppr',
    aliases: ['CVE-2023-4863'],
    summary: 'libwebp heap buffer overflow',
    affected: [{ package: { name: 'libwebp', ecosystem: 'OSS-Fuzz' }, versions: ['1.3.1'] }],
  },
];

let dir: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({
  cwd: dir,
  log: (m: string) => out.push(m),
  error: (m: string) => err.push(m),
  now: () => new Date('2026-08-14T12:00:00Z'),
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cra-kev-'));
  out.length = 0;
  err.length = 0;
  craProduct(io(), { name: 'Widget', version: '1.0.0' });
  writeFileSync(
    join(dir, 'sbom.json'),
    JSON.stringify({ bomFormat: 'CycloneDX', components: [{ name: 'libwebp', version: '1.3.1' }] }),
  );
  craIngest(io(), { sbom: join(dir, 'sbom.json') });
  writeFileSync(join(dir, 'kev.json'), JSON.stringify(KEV_REAL));
  writeFileSync(join(dir, 'osv.json'), JSON.stringify(OSV_REAL));
  out.length = 0;
  err.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the KEV join, against REAL KEV shape', () => {
  it('finds the exploited CVE in a component KEV never names', async () => {
    const code = await craWatch(io(), {
      kev: join(dir, 'kev.json'),
      osv: join(dir, 'osv.json'), becameAwareNow: true });
    const text = out.join('\n');
    expect(text).toContain('CVE-2023-4863');
    expect(text).toContain('libwebp');
    expect(text).toContain('KEV');
    expect(code).toBe(2);
  });

  it('proves the old substring match could not have worked', () => {
    const v = KEV_REAL.vulnerabilities[0]!;
    expect(v.vulnerabilityName.toLowerCase()).not.toContain('libwebp');
    expect(v.product.toLowerCase()).not.toContain('libwebp');
  });

  it('REFUSES when there is no component-to-CVE source, instead of reporting zero', async () => {
    const code = await craWatch(io(), { kev: join(dir, 'kev.json'), becameAwareNow: true });
    expect(code).toBe(1);
    const text = err.join('\n');
    expect(text).toContain('nothing to check KEV against');
    // The critical part: it must not read as a clean bill of health.
    expect(out.join('\n')).not.toContain('No component matched');
  });

  it('does not mark a finding as KEV when the CVE is not in the catalogue', async () => {
    writeFileSync(join(dir, 'kev-empty.json'), JSON.stringify({ vulnerabilities: [] }));
    const code = await craWatch(io(), {
      kev: join(dir, 'kev-empty.json'),
      osv: join(dir, 'osv.json'), becameAwareNow: true });
    // Scoped to the finding line: the word KEV also appears in the summary
    // header, which says how many catalogue entries were consulted.
    const findingLine = out.find((l) => l.includes('CVE-2023-4863'))!;
    expect(findingLine).toBeDefined();
    expect(findingLine).not.toContain('KEV');
    expect(code).toBe(2);
  });

  it('says explicitly that no findings is not "not affected"', async () => {
    writeFileSync(join(dir, 'osv-empty.json'), JSON.stringify([]));
    const code = await craWatch(io(), {
      kev: join(dir, 'kev.json'),
      osv: join(dir, 'osv-empty.json'), becameAwareNow: true });
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('NOT "not affected"');
  });

  it('never matches a component name against KEV prose, however tempting', async () => {
    // A component whose name appears in unrelated KEV descriptions. Under the
    // old logic this produced findings out of thin air.
    writeFileSync(
      join(dir, 'sbom2.json'),
      JSON.stringify({ bomFormat: 'CycloneDX', components: [{ name: 'chromium', version: '1.0.0' }] }),
    );
    craIngest(io(), { sbom: join(dir, 'sbom2.json') });
    writeFileSync(join(dir, 'osv-empty.json'), JSON.stringify([]));
    out.length = 0;
    const code = await craWatch(io(), {
      kev: join(dir, 'kev.json'),
      osv: join(dir, 'osv-empty.json'), becameAwareNow: true });
    expect(out.join('\n')).not.toContain('CVE-2023-4863');
    expect(code).toBe(0);
  });
});

describe('Article 14 clocks fire on ACTIVE EXPLOITATION, not on presence', () => {
  /**
   * Article 14(1), verbatim: "A manufacturer shall notify any ACTIVELY
   * EXPLOITED vulnerability contained in the product with digital elements".
   *
   * The clock loop used to run for every hit. That was correct while KEV was
   * the only source and every hit was by definition exploited. The OSV join
   * widened `hits` to known-but-unexploited CVEs and broke the invariant
   * silently: a real 304-component SBOM produced 138 clocks across 46
   * vulnerabilities, none in KEV.
   */
  it('starts no clock when the finding is not in KEV', async () => {
    writeFileSync(join(dir, 'kev-empty.json'), JSON.stringify({ vulnerabilities: [] }));
    await craWatch(io(), { kev: join(dir, 'kev-empty.json'), osv: join(dir, 'osv.json'), becameAwareNow: true });
    expect(readStream(dir, 'clocks')).toHaveLength(0);
    const text = out.join('\n');
    expect(text).toContain('No Article 14 clock started');
    // It must not read as a clean bill of health.
    expect(text).toContain('not a discharge, it is a different duty');
  });

  it('starts all three clocks when the finding IS actively exploited', async () => {
    await craWatch(io(), { kev: join(dir, 'kev.json'), osv: join(dir, 'osv.json'), becameAwareNow: true });
    const clocks = readStream<{ article: string }>(dir, 'clocks');
    expect(clocks.map((c) => c.body.article).sort()).toEqual(['14(2)(a)', '14(2)(b)', '14(2)(c)']);
  });

  it('starts clocks only for the exploited subset when findings are mixed', async () => {
    writeFileSync(
      join(dir, 'sbom-mixed.json'),
      JSON.stringify({
        bomFormat: 'CycloneDX',
        components: [{ name: 'libwebp', version: '1.3.1' }, { name: 'lodash', version: '4.17.20' }],
      }),
    );
    craIngest(io(), { sbom: join(dir, 'sbom-mixed.json') });
    writeFileSync(
      join(dir, 'osv-mixed.json'),
      JSON.stringify([
        ...OSV_REAL,
        {
          id: 'GHSA-lodash',
          aliases: ['CVE-2021-23337'],
          affected: [{ package: { name: 'lodash' }, versions: ['4.17.20'] }],
        },
      ]),
    );
    await craWatch(io(), { kev: join(dir, 'kev.json'), osv: join(dir, 'osv-mixed.json'), becameAwareNow: true });
    const clocked = new Set(readStream<{ cve: string }>(dir, 'clocks').map((c) => c.body.cve));
    expect(clocked).toEqual(new Set(['CVE-2023-4863'])); // in KEV
    expect(clocked.has('CVE-2021-23337')).toBe(false);   // known, not exploited
  });
});

describe('the hypothesis text must match the source that actually said it', () => {
  /**
   * The clocks above were already gated on KEV and were correct. The prose was
   * not, and the prose is the half a human signs.
   *
   * Every hypothesis was written with a hardcoded assertion, "<component>
   * appears in the CISA KEV catalogue as actively exploited", and a basis of
   * "CISA KEV <cve>", for every hit — including the OSV-only ones the join
   * deliberately widened to. Run against the real SBOM this produced 46
   * hypotheses asserting active exploitation, 0 of which were in the catalogue.
   *
   * The tests above did not catch it because they assert on stdout and on the
   * clocks stream. Nothing read the hypotheses stream, so the one artefact
   * carrying the false statement was the one nothing looked at.
   */
  type Hyp = { cve: string; component: string; assertion: string; basis: string };

  it('does NOT assert active exploitation for a CVE absent from KEV', async () => {
    writeFileSync(join(dir, 'kev-empty.json'), JSON.stringify({ vulnerabilities: [] }));
    await craWatch(io(), { kev: join(dir, 'kev-empty.json'), osv: join(dir, 'osv.json'), becameAwareNow: true });

    const hyps = readStream<Hyp>(dir, 'hypotheses');
    expect(hyps).toHaveLength(1);
    const h = hyps[0]!.body;

    expect(h.cve).toBe('CVE-2023-4863');
    // The exact false sentence that shipped.
    expect(h.assertion).not.toContain('appears in the CISA KEV catalogue as actively exploited');
    expect(h.assertion).not.toMatch(/lists as actively exploited/);
    // A basis may mention KEV only to record the ABSENCE, never as the source.
    expect(h.basis).not.toMatch(/^CISA KEV/);
    // And it must say plainly what it does not know.
    expect(h.assertion).toContain('NOT in the CISA KEV catalogue');
    expect(h.basis).toContain('OSV');
  });

  it('DOES cite KEV, with its dateAdded, when the CVE really is in the catalogue', async () => {
    await craWatch(io(), { kev: join(dir, 'kev.json'), osv: join(dir, 'osv.json'), becameAwareNow: true });

    const h = readStream<Hyp>(dir, 'hypotheses')[0]!.body;
    expect(h.assertion).toContain('actively exploited');
    expect(h.basis).toBe('CISA KEV CVE-2023-4863 added 2023-09-13');
  });

  it('holds the invariant across a mixed run: exploitation claimed only where KEV says so', async () => {
    writeFileSync(
      join(dir, 'sbom-mixed.json'),
      JSON.stringify({
        bomFormat: 'CycloneDX',
        components: [{ name: 'libwebp', version: '1.3.1' }, { name: 'lodash', version: '4.17.20' }],
      }),
    );
    craIngest(io(), { sbom: join(dir, 'sbom-mixed.json') });
    writeFileSync(
      join(dir, 'osv-mixed.json'),
      JSON.stringify([
        ...OSV_REAL,
        {
          id: 'GHSA-lodash',
          aliases: ['CVE-2021-23337'],
          affected: [{ package: { name: 'lodash' }, versions: ['4.17.20'] }],
        },
      ]),
    );
    await craWatch(io(), { kev: join(dir, 'kev.json'), osv: join(dir, 'osv-mixed.json'), becameAwareNow: true });

    const kevSet = new Set(KEV_REAL.vulnerabilities.map((v) => v.cveID));
    const hyps = readStream<Hyp>(dir, 'hypotheses');
    expect(hyps.length).toBeGreaterThan(1);

    /*
     * The invariant is asserted on `basis`, not on the assertion prose.
     *
     * Prose is the thing that changes. An invariant written against today's
     * wording only catches a regression that reuses today's wording, which is
     * no guard at all: the sentence that shipped the bug read "appears in the
     * CISA KEV catalogue as actively exploited", and a check for the current
     * phrasing would have let it straight through.
     *
     * `basis` names the source, so the rule is exact and phrasing-independent:
     * cite CISA KEV as your basis if and only if the CVE is in the catalogue
     * you were given.
     */
    for (const { body } of hyps) {
      expect(
        /^CISA KEV/.test(body.basis),
        `${body.component} ${body.cve}: basis cites CISA KEV as the source, but the catalogue does not contain it`,
      ).toBe(kevSet.has(body.cve));
    }

    // And the converse: the exploited one must not be softened into an OSV-only note.
    const exploited = hyps.map((h) => h.body).find((b) => b.cve === 'CVE-2023-4863')!;
    expect(exploited.assertion).toContain('actively exploited');
    expect(exploited.assertion).not.toContain('NOT in the CISA KEV catalogue');
  });
});
