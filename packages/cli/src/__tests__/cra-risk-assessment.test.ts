import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { craProduct, craAssess, craRisk, craDoc } from '../cra/commands.js';
import { readStream } from '../cra/store.js';

/**
 * Article 13(2): manufacturers shall undertake an assessment of the
 * cybersecurity risks. 13(3): it shall be DOCUMENTED and updated during the
 * support period. 13(4): it goes in the technical documentation.
 *
 * The generator knew it was missing and said so in the technical file: "A
 * cybersecurity risk assessment document is NOT held." Annex I Part I (1) was
 * determined not_met for the same reason, and it gates everything, because it is
 * the umbrella the thirteen properties instantiate.
 *
 * This records that an assessment exists and PINS ITS CONTENT. The command
 * deliberately does not write the assessment: one nobody performed is worse than
 * none, and generating it would be manufacturing evidence in the one document
 * that exists to show the manufacturer thought about this.
 *
 * The load-bearing property is the content hash. Without it the record attests
 * that a file existed at a path, which says nothing about what it said, and the
 * document could be rewritten after the record was signed.
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
const doc = join('compliance', 'cra', 'ra.md');

const record = () =>
  craRisk(io(), { document: doc, by: 'Pedram Madani', summary: 'Two risks dominate.' });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cra-risk-'));
  craProduct(io(), { name: 'Widget', version: '1.0.0' });
  writeFileSync(join(dir, 'compliance', 'cra', 'ra.md'), '# Assessment\n\nIntended purpose...\n');
  craAssess(io(), { ref: 'Annex I Part I (1)', status: 'met', by: 'Pedram Madani', rationale: 'Assessed.' });
  out.length = 0;
  err.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('recording the Article 13(2) assessment', () => {
  it('pins the document by content, not by filename', () => {
    expect(record()).toBe(0);
    const row = readStream<{ document: string; documentHash: string; productVersion: string }>(dir, 'risk')[0]!.body;

    expect(row.document).toBe(doc);
    expect(row.documentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.productVersion).toBe('1.0.0');
  });

  it('refuses when the document does not exist', () => {
    err.length = 0;
    expect(craRisk(io(), { document: 'nope.md', by: 'X', summary: 'y' })).toBe(1);
    expect(err.join('\n')).toContain('No assessment at');
  });

  it('refuses to write the assessment itself', () => {
    err.length = 0;
    expect(craRisk(io(), {})).toBe(1);
    // Generating it would be manufacturing evidence in the document that exists
    // to show a person thought about this.
    expect(err.join('\n')).toContain('an assessment nobody performed is worse than none');
  });
});

describe('the technical file cites it', () => {
  it('closes the Annex VII (3) gap, citing the hash and the assessor', () => {
    record();
    const outPath = join(dir, 'tf.md');
    craDoc(io(), { type: 'technical-file', out: outPath });

    const tf = readFileSync(outPath, 'utf8');
    const section = tf.split('## Annex VII (3)')[1]!.split('## Annex VII (4)')[0]!;
    expect(section).toContain('Cybersecurity risk assessment');
    expect(section).toContain('Pedram Madani');
    expect(section).toContain('sha256');
    expect(section).not.toContain('is NOT held');
  });
});

describe('a hash nothing checks is decoration', () => {
  it('detects a document rewritten after it was recorded', () => {
    record();
    appendFileSync(join(dir, doc), '\nAdded after the record was written.\n');
    out.length = 0;

    craDoc(io(), { type: 'technical-file', out: join(dir, 'tf.md') });
    expect(said()).toContain('no longer matches the hash recorded for it');
  });

  it('refuses to cite a drifted document, rather than citing it stale', () => {
    record();
    appendFileSync(join(dir, doc), '\ndrift\n');
    const outPath = join(dir, 'tf.md');
    craDoc(io(), { type: 'technical-file', out: outPath });

    const tf = readFileSync(outPath, 'utf8');
    const section = tf.split('## Annex VII (3)')[1]!.split('## Annex VII (4)')[0]!;
    // A stale citation is worse than a missing one: it looks like the assessment
    // says something it no longer says.
    expect(section).toContain('is NOT held');
    expect(section).not.toContain('Cybersecurity risk assessment:');
  });

  it('cites it again once it is re-recorded', () => {
    record();
    appendFileSync(join(dir, doc), '\nrevised during the support period\n');
    record(); // 13(3): updated as appropriate during the support period.

    const outPath = join(dir, 'tf.md');
    craDoc(io(), { type: 'technical-file', out: outPath });
    const tf = readFileSync(outPath, 'utf8');
    expect(tf.split('## Annex VII (3)')[1]!).toContain('Cybersecurity risk assessment');
    // Append-only: both recordings are kept, the later one governs.
    expect(readStream(dir, 'risk')).toHaveLength(2);
  });
});
