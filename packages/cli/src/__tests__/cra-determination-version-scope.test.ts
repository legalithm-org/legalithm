import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { craProduct, craAssess, craRecord } from '../cra/commands.js';
import { append } from '../cra/store.js';

/**
 * A determination is a statement about a PRODUCT VERSION, and it did not record
 * which one.
 *
 * Found by regenerating the record after publishing 0.6.2: the 22 Annex I
 * determinations declared about 0.6.1 appeared unchanged, still dated 15 August,
 * with a human's name against them. Nobody had said anything about 0.6.2.
 *
 * It happened not to matter, because 0.6.2 also declares zero dependencies. A
 * version that added some would have kept asserting Annex I (2)(j) as met while
 * being false — a signed record carrying a false statement under someone's name,
 * which is the exact failure this product exists to prevent.
 *
 * The fix is not to drop stale determinations. Deleting somebody's work is worse
 * than showing it with a warning. They are carried and flagged, so the record
 * says what is true: this was determined, about something else.
 */
let dir: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({
  cwd: dir,
  log: (m: string) => out.push(m),
  error: (m: string) => err.push(m),
  now: () => new Date('2026-08-16T02:00:00Z'),
});
const said = () => out.join('\n');

const determine = (ref: string) =>
  craAssess(io(), { ref, status: 'not_met', by: 'Pedram Madani', rationale: 'Not yet done.' });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cra-scope-'));
  out.length = 0;
  err.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('a determination records the version it is about', () => {
  it('stamps the registered product version', () => {
    craProduct(io(), { name: 'Widget', version: '1.0.0' });
    out.length = 0;
    expect(determine('Annex I Part II (5)')).toBe(0);
    expect(said()).toContain('about        Widget 1.0.0');

    const { record } = craRecord(io(), {});
    const d = record!.annexI.determined[0]!;
    expect(d.declaredForVersion).toBe('1.0.0');
    expect(d.staleForThisVersion).toBe(false);
  });

  it('refuses when no product is registered, since there is nothing to determine about', () => {
    err.length = 0;
    expect(determine('Annex I Part II (5)')).toBe(1);
    expect(err.join('\n')).toContain('nothing to determine this about');
  });
});

describe('a determination made about another version', () => {
  it('is flagged stale rather than read as current', () => {
    craProduct(io(), { name: 'Widget', version: '1.0.0' });
    determine('Annex I Part II (5)');
    // Ship a new version. Nobody has said anything about it.
    craProduct(io(), { name: 'Widget', version: '2.0.0' });
    out.length = 0;

    const { record } = craRecord(io(), {});
    const d = record!.annexI.determined.find((x) => x.ref === 'Annex I Part II (5)')!;

    expect(d.declaredForVersion).toBe('1.0.0');
    expect(
      d.staleForThisVersion,
      'a determination about 1.0.0 must not read as a statement about 2.0.0',
    ).toBe(true);
    expect(record!.annexI.determinedForAnotherVersion).toContain('Annex I Part II (5)');
  });

  it('is carried, never dropped: deleting somebody\'s work is worse', () => {
    craProduct(io(), { name: 'Widget', version: '1.0.0' });
    determine('Annex I Part II (5)');
    craProduct(io(), { name: 'Widget', version: '2.0.0' });

    const { record } = craRecord(io(), {});
    expect(record!.annexI.determined).toHaveLength(1);
    expect(record!.annexI.notAssessed).not.toContain('Annex I Part II (5)');
  });

  it('says so loudly on the console, not only in the JSON', () => {
    craProduct(io(), { name: 'Widget', version: '1.0.0' });
    determine('Annex I Part II (5)');
    craProduct(io(), { name: 'Widget', version: '2.0.0' });
    out.length = 0;

    craRecord(io(), {});
    expect(said()).toContain('made about a DIFFERENT');
    expect(said()).toContain('declared for 1.0.0');
    expect(said()).toContain('they say nothing about it');
  });

  it('clears once it is re-declared against the current version', () => {
    craProduct(io(), { name: 'Widget', version: '1.0.0' });
    determine('Annex I Part II (5)');
    craProduct(io(), { name: 'Widget', version: '2.0.0' });
    determine('Annex I Part II (5)');

    const { record } = craRecord(io(), {});
    const d = record!.annexI.determined.find((x) => x.ref === 'Annex I Part II (5)')!;
    expect(d.declaredForVersion).toBe('2.0.0');
    expect(d.staleForThisVersion).toBe(false);
    expect(record!.annexI.determinedForAnotherVersion).toEqual([]);
  });
});

describe('determinations written before this field existed', () => {
  it('are stale, not current: nobody scoped them to anything', () => {
    craProduct(io(), { name: 'Widget', version: '1.0.0' });
    // A row as the store held them before productVersion existed.
    append(dir, 'assessments', {
      ref: 'Annex I Part II (5)',
      status: 'not_met',
      declaredBy: 'Pedram Madani',
      rationale: 'Declared before determinations were version-scoped.',
    } as unknown as Parameters<typeof append>[2], { now: io().now });

    const { record } = craRecord(io(), {});
    const d = record!.annexI.determined.find((x) => x.ref === 'Annex I Part II (5)')!;

    expect(d.declaredForVersion).toBeNull();
    expect(d.staleForThisVersion).toBe(true);
    // Present and flagged. Not silently promoted, not silently deleted.
    expect(record!.annexI.determinedForAnotherVersion).toContain('Annex I Part II (5)');
  });
});
