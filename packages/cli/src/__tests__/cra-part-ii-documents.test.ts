/**
 * Annex I Part II asks for policies and advisories, which are documents.
 *
 * The record has to pin them for the same reason it pins the risk assessment:
 * a determination citing a document the record does not bind to is one whose
 * evidence can be rewritten after signing while the signature still verifies.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

import { craProduct, craPolicy, craRecord, POLICY_KINDS, type CraIo } from '../cra/commands.js';

let cwd: string;
let io: CraIo;
const errs: string[] = [];

const DOC = 'compliance/cra/cvd-policy.md';
const write = (rel: string, text: string) => {
  const p = join(cwd, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text, 'utf8');
};

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'cra-partii-'));
  errs.length = 0;
  io = { cwd, log: () => {}, error: (m) => errs.push(m) };
  craProduct(io, { name: 'Acme Gateway', version: '2.4.0', productClass: 'important_class_ii' });
  write(DOC, '# CVD policy\n\nAcknowledge in 24 hours.\n');
});

const record = () => {
  craRecord(io, {});
  return JSON.parse(readFileSync(join(cwd, 'compliance', 'cra', 'record.json'), 'utf8'));
};

const pin = (kind = 'cvd_policy', document = DOC) =>
  craPolicy(io, { document, kind, by: 'Dana Ruiz', summary: `${kind} for 2.4.0` });

describe('cra policy pins a Part II document', () => {
  it('records kind, path, sha256 and who recorded it', () => {
    expect(pin()).toBe(0);
    const [doc] = record().documents;
    expect(doc.kind).toBe('cvd_policy');
    expect(doc.document).toBe(DOC);
    expect(doc.declaredBy).toBe('Dana Ruiz');
    expect(doc.sha256).toBe(createHash('sha256').update(readFileSync(join(cwd, DOC))).digest('hex'));
  });

  // The whole point. If the hash does not reach recordHash, the signature says
  // nothing about which policy was in force.
  it('changes recordHash when the document changes', () => {
    pin();
    const before = record().recordHash;
    write(DOC, '# CVD policy\n\nRewritten after the fact.\n');
    pin();
    expect(record().recordHash).not.toBe(before);
  });

  it('changes recordHash when a document is recorded at all', () => {
    const before = record().recordHash;
    pin();
    expect(record().recordHash).not.toBe(before);
  });

  it('is an empty array when nothing is recorded, not a missing field', () => {
    const r = record();
    expect(Object.prototype.hasOwnProperty.call(r, 'documents')).toBe(true);
    expect(r.documents).toEqual([]);
  });

  // A superseded advisory is still an advisory that was published, and Part II
  // (4) is a duty about what WAS disclosed.
  it('keeps every row rather than the latest per kind', () => {
    write('compliance/cra/advisories/A-1.md', '# one\n');
    write('compliance/cra/advisories/A-2.md', '# two\n');
    pin('advisory', 'compliance/cra/advisories/A-1.md');
    pin('advisory', 'compliance/cra/advisories/A-2.md');
    const advisories = record().documents.filter((d: { kind: string }) => d.kind === 'advisory');
    expect(advisories).toHaveLength(2);
    expect(advisories.map((d: { document: string }) => d.document)).toEqual([
      'compliance/cra/advisories/A-1.md',
      'compliance/cra/advisories/A-2.md',
    ]);
  });

  it('scopes each document to the product version it was recorded about', () => {
    pin();
    expect(record().documents[0].staleForThisVersion).toBe(false);
    craProduct(io, { name: 'Acme Gateway', version: '2.5.0', productClass: 'important_class_ii' });
    const [doc] = record().documents;
    expect(doc.declaredForVersion).toBe('2.4.0');
    expect(doc.staleForThisVersion).toBe(true);
  });

  it('declares the schema version that has the field', () => {
    expect(record().schema).toBe('legalithm.cra.record/v0.4');
  });
});

describe('cra policy refuses what it cannot record honestly', () => {
  it('rejects an unknown kind rather than inventing a category', () => {
    expect(craPolicy(io, { document: DOC, kind: 'vibes', by: 'D', summary: 's' })).toBe(1);
    expect(errs.join('\n')).toMatch(/Unknown --kind/);
    expect(record().documents).toEqual([]);
  });

  it('rejects a document that is not there', () => {
    expect(craPolicy(io, { document: 'compliance/cra/nope.md', kind: 'advisory', by: 'D', summary: 's' })).toBe(1);
    expect(errs.join('\n')).toMatch(/No document at/);
  });

  it('will not write the policy for you, and says so', () => {
    expect(craPolicy(io, {})).toBe(1);
    expect(errs.join('\n')).toMatch(/does not write it/i);
    expect(errs.join('\n')).toContain(POLICY_KINDS.join(' | '));
  });

  // Resolving against process.cwd() instead of the store is a bug this codebase
  // has already had once, in craRisk.
  it('resolves a relative path against the store, not the process', () => {
    expect(pin()).toBe(0);
    expect(record().documents[0].document).toBe(DOC);
  });
});
