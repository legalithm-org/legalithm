/**
 * The Article 13(2) assessment has to be inside the signed record, not beside
 * it.
 *
 * `cra risk` pinned the assessment by content and `cra doc` cited the pin, but
 * the RECORD carried neither, so `recordHash` did not cover it and a signature
 * said nothing about which assessment had been made. The determination for
 * Annex I Part I (1) asserted the document was "pinned by content hash in the
 * record" while the record it was written into had no such field.
 *
 * These assertions are on the record body and its hash, because that is the
 * artifact somebody signs and an auditor relies on.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { craProduct, craRisk, craRecord, type CraIo } from '../cra/commands.js';

let cwd: string;
let io: CraIo;

const DOC = 'risk-assessment.md';
const write = (text: string) => writeFileSync(join(cwd, DOC), text, 'utf8');

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'cra-risk-pin-'));
  io = { cwd, log: () => {}, error: () => {} };
  craProduct(io, { name: 'Acme Gateway', version: '2.4.0', productClass: 'important_class_ii' });
  write('# Assessment\n\nIntended purpose, assets, risks.\n');
});

const record = () => {
  craRecord(io, {});
  return JSON.parse(readFileSync(join(cwd, 'compliance', 'cra', 'record.json'), 'utf8'));
};

const recordRisk = (summary = 'Article 13(2) assessment of 2.4.0') =>
  craRisk(io, { document: DOC, by: 'Dana Ruiz', summary });

describe('the record carries the risk assessment pin', () => {
  it('is null when no assessment has been recorded, rather than absent', () => {
    const r = record();
    // Present-and-null: "not done" and "this format cannot express it" must not
    // look the same to a reader.
    expect(Object.prototype.hasOwnProperty.call(r, 'riskAssessment')).toBe(true);
    expect(r.riskAssessment).toBeNull();
  });

  it('carries the document, its sha256, and who assessed it', () => {
    recordRisk();
    const r = record();
    expect(r.riskAssessment.document).toBe(DOC);
    expect(r.riskAssessment.declaredBy).toBe('Dana Ruiz');
    expect(r.riskAssessment.sha256).toBe(
      createHash('sha256').update(readFileSync(join(cwd, DOC))).digest('hex'),
    );
  });

  // The point of the whole exercise. If the hash does not move, the signature
  // does not cover the assessment and the pin is decoration.
  it('changes recordHash when the assessment document changes', () => {
    recordRisk();
    const before = record().recordHash;

    write('# Assessment\n\nRewritten after the fact.\n');
    recordRisk();
    const after = record();

    expect(after.recordHash).not.toBe(before);
    expect(after.riskAssessment.sha256).toBe(
      createHash('sha256').update(readFileSync(join(cwd, DOC))).digest('hex'),
    );
  });

  it('changes recordHash when an assessment is recorded at all', () => {
    const before = record().recordHash;
    recordRisk();
    expect(record().recordHash).not.toBe(before);
  });

  // Same rule the Annex I determinations follow: a statement made about another
  // version is carried, never silently presented as current.
  it('marks an assessment made about a different version as stale', () => {
    recordRisk();
    expect(record().riskAssessment.staleForThisVersion).toBe(false);

    craProduct(io, { name: 'Acme Gateway', version: '2.5.0', productClass: 'important_class_ii' });
    const r = record();
    expect(r.riskAssessment.declaredForVersion).toBe('2.4.0');
    expect(r.riskAssessment.staleForThisVersion).toBe(true);
  });

  it('declares the schema version that has the field', () => {
    expect(record().schema).toBe('legalithm.cra.record/v0.4');
  });
});
