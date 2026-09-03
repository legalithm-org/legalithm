import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { craProduct, craRecord, recomputeRecordHash } from '../cra/commands.js';

/**
 * The specification has to describe the artifact, or it is worse than nothing.
 *
 * `docs/CRA-RECORD-FORMAT.md` is published with an irrevocability commitment:
 * every published version stays published and keeps meaning what it says. A
 * promise like that is only worth the accuracy behind it, and prose drifts from
 * code silently — nothing type-checks a markdown table.
 *
 * So the spec is pinned here. If the record grows a field, or the hash rule
 * changes, or the schema id moves, this test fails and the document has to be
 * updated in the same change rather than months later.
 */
const SPEC = readFileSync(join(__dirname, '..', '..', '..', '..', 'docs', 'CRA-RECORD-FORMAT.md'), 'utf8');

let dir: string;
const io = () => ({
  cwd: dir,
  log: () => {},
  error: () => {},
  now: () => new Date('2026-08-16T01:00:00Z'),
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cra-spec-'));
  craProduct(io(), { name: 'Widget', version: '1.0.0' });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the published format spec matches what the tool writes', () => {
  it('documents the schema id the record actually carries', () => {
    const { record } = craRecord(io(), {});
    expect(SPEC).toContain(record!.schema);
    // And the heading names that version, not a stale one.
    expect(SPEC.split('\n').slice(0, 6).join('\n')).toContain(record!.schema);
  });

  it('names every top-level field in the document-shape TABLE', () => {
    /*
     * Checking that the name appears anywhere in the file is far too weak: the
     * first version of this test passed after `supportPeriod` was deleted from
     * the table, because one unrelated mention survived further down. A spec
     * test that a deletion can slip past is not a spec test.
     *
     * So the row must exist in the table: `| \`field\` | type | meaning |`.
     */
    const documented = new Set(
      [...SPEC.matchAll(/^\|\s*`([A-Za-z][A-Za-z0-9]*)`\s*\|/gm)].map((m) => m[1]!),
    );
    const { record } = craRecord(io(), {});

    const undocumented = Object.keys(record!).filter((k) => !documented.has(k));
    expect(
      undocumented,
      'these fields ship in the record and have no row in the published field table',
    ).toEqual([]);
  });

  it('states the hash rule the implementation actually uses', () => {
    const { record } = craRecord(io(), {});

    // The spec says three fields are excluded. Prove each one is.
    for (const excluded of ['recordHash', 'generatedAt', 'asOf']) {
      expect(SPEC).toContain(`\`${excluded}\``);
    }

    const base = recomputeRecordHash(record as unknown as Record<string, unknown>);
    expect(base).toBe(record!.recordHash);

    // Changing an excluded field must not move the hash...
    const clockMoved = { ...record, generatedAt: '2030-01-01T00:00:00Z', asOf: '2030-01-01T00:00:00Z' };
    expect(recomputeRecordHash(clockMoved as unknown as Record<string, unknown>)).toBe(base);

    // ...and changing content must.
    const contentMoved = { ...record, evidenceCount: 999 };
    expect(recomputeRecordHash(contentMoved as unknown as Record<string, unknown>)).not.toBe(base);
  });

  it('keeps the irrevocability commitment in the document', () => {
    // The whole reason to publish. If someone quietly deletes it, that is a
    // change of position and should not pass review unnoticed.
    expect(SPEC).toContain('open and irrevocable');
    expect(SPEC).toContain('will not be made proprietary');
    expect(SPEC.toLowerCase()).toContain('source-available');
  });

  it('keeps a licence on the specification', () => {
    // "Open" without a grant is a promise, not a licence. The repo carried no
    // LICENSE at all when this was first published.
    expect(SPEC).toContain('CC BY 4.0');
    expect(SPEC).toContain('creativecommons.org/licenses/by/4.0');
    // And the point that makes the choice cheap: implementing costs nothing.
    expect(SPEC).toContain('Implementing this format requires nothing from you');
  });

  it('keeps saying what a signature does NOT prove', () => {
    // The claim the product is not allowed to make.
    expect(SPEC).toContain('does **not** prove who that is');
    expect(SPEC).toContain('evidence, not a declaration of conformity');
  });
});
