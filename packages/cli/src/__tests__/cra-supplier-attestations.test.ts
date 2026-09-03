import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { craProduct, craIngest, craSupplierRequest, craSupplierAttest, craSupplierVerify } from '../cra/commands.js';
import { readStream } from '../cra/store.js';

/**
 * Decision 9: "Supplier network is manufacturer-pays, and a supplier's response
 * is a signed reusable claim the supplier owns, not a form submission into a
 * customer tenant."
 *
 * The three properties that sentence demands, each with a test that fails if it
 * stops holding:
 *
 *   REUSABLE  the attestation names no requester, so the same file answers the
 *             next manufacturer who asks the same question.
 *   OWNS      the supplier signs with their own key, and the file verifies with
 *             nothing of ours in the path.
 *   EVIDENCE  ingesting one does NOT make it the manufacturer's claim. A
 *             supplier saying "not_affected" is a fact about what the supplier
 *             said; laundering it into your own conformity position is exactly
 *             what the hypothesis/claim boundary exists to stop, and the
 *             supplier does not carry your Article 13 obligations.
 */
let dir: string;
let supplierKey: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({
  cwd: dir,
  log: (m: string) => out.push(m),
  error: (m: string) => err.push(m),
  now: () => new Date('2026-08-16T01:00:00Z'),
});
const said = () => out.join('\n');
const errs = () => err.join('\n');

function request(): string {
  const p = join(dir, 'req.json');
  craSupplierRequest(io(), {
    component: 'lodash',
    componentVersion: '4.17.20',
    cve: 'cve-2021-23337',
    by: 'Acme GmbH',
    out: p,
  });
  return p;
}

function attest(overrides: Partial<Parameters<typeof craSupplierAttest>[1]> = {}): string {
  const p = join(dir, 'att.json');
  craSupplierAttest(io(), {
    request: request(),
    verdict: 'not_affected',
    rationale: 'The vulnerable path is unreachable in our build.',
    by: 'Jane Doe',
    org: 'Lodash Maintainers',
    key: supplierKey,
    keyId: 'lodash-maint-2026',
    out: p,
    ...overrides,
  });
  return p;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cra-supplier-'));
  supplierKey = join(dir, 'supplier.key');
  const { privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(supplierKey, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, 'utf8');
  craProduct(io(), { name: 'Acme Widget', version: '2.0.0' });
  out.length = 0;
  err.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('a supplier attestation is reusable', () => {
  it('names no requester anywhere in the file', () => {
    const raw = readFileSync(attest(), 'utf8');
    // The request knows who asked. The answer must not, or it is a form
    // submission wearing a signature and the supplier re-does the work per
    // customer forever.
    expect(raw).not.toContain('Acme');
    expect(JSON.parse(raw).body).not.toHaveProperty('requestedBy');
  });

  it('normalises the CVE, so the same answer matches however it was asked', () => {
    const a = JSON.parse(readFileSync(attest(), 'utf8'));
    expect(a.body.cve).toBe('CVE-2021-23337');
  });
});

describe('a supplier attestation is owned by the supplier', () => {
  it('verifies from the file alone, with nothing of ours in the path', () => {
    const p = attest();
    out.length = 0;
    expect(craSupplierVerify(io(), { file: p })).toBe(0);
    expect(said()).toContain('Attestation verifies');
    expect(said()).toContain('Jane Doe at Lodash Maintainers');
  });

  it('says the signature proves possession, never identity', () => {
    const p = attest();
    out.length = 0;
    craSupplierVerify(io(), { file: p });
    expect(said()).toContain('proves possession');
    expect(said()).toContain('out of band');
  });

  it('rejects an attestation altered after signing', () => {
    const p = attest();
    const a = JSON.parse(readFileSync(p, 'utf8'));
    a.body.verdict = 'affected';
    writeFileSync(p, JSON.stringify(a, null, 2));
    err.length = 0;

    expect(craSupplierVerify(io(), { file: p })).toBe(1);
    expect(errs()).toContain('Altered since it was signed');
  });

  it('refuses a verdict outside the vocabulary', () => {
    err.length = 0;
    expect(craSupplierAttest(io(), {
      request: request(),
      verdict: 'probably-fine',
      rationale: 'x',
      by: 'Jane Doe',
      org: 'Lodash Maintainers',
      key: supplierKey,
      keyId: 'lodash-maint-2026',
    })).toBe(1);
    expect(errs()).toContain('Unknown verdict');
  });
});

describe('ingesting one makes it evidence, never the manufacturer\'s claim', () => {
  type Ev = { component: string; sourceType: string; sourceIdentity: string; attestation?: { verdict: string; keyId: string } };

  it('records it as attestation evidence, attributed to a named person at a company', () => {
    const p = attest();
    out.length = 0;
    expect(craIngest(io(), { attestation: p })).toBe(0);

    const rows = readStream<Ev>(dir, 'evidence');
    expect(rows).toHaveLength(1);
    const e = rows[0]!.body;
    expect(e.sourceType).toBe('attestation');
    expect(e.sourceIdentity).toBe('Jane Doe at Lodash Maintainers');
    expect(e.attestation?.verdict).toBe('not_affected');
    expect(e.attestation?.keyId).toBe('lodash-maint-2026');
  });

  it('writes NO claim, and says a named human still has to decide', () => {
    craIngest(io(), { attestation: attest() });

    // The load-bearing assertion of this whole feature.
    expect(
      readStream(dir, 'claims'),
      'a supplier attestation must never become the manufacturer\'s own claim',
    ).toHaveLength(0);
    expect(said()).toContain('It is not your claim');
    expect(said()).toContain('cra claim');
  });

  it('refuses to ingest one that does not verify', () => {
    const p = attest();
    const a = JSON.parse(readFileSync(p, 'utf8'));
    a.body.rationale = 'Actually it is fine, trust me.';
    writeFileSync(p, JSON.stringify(a, null, 2));
    err.length = 0;

    expect(craIngest(io(), { attestation: p })).toBe(1);
    expect(errs()).toContain('Refusing to ingest');
    expect(errs()).toContain('not evidence of anything');
    expect(readStream(dir, 'evidence')).toHaveLength(0);
  });

  it('does not let an incoming attestation bind a key id in our trust store', () => {
    // An attestation carries its own public key. Registering that under the
    // claimed id would let a stranger's file decide what a key id means for
    // everything checked afterwards.
    const p = attest();
    craIngest(io(), { attestation: p });

    const a = JSON.parse(readFileSync(p, 'utf8'));
    const { privateKey } = generateKeyPairSync('ed25519');
    writeFileSync(join(dir, 'other.key'), privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, 'utf8');
    // Same key id, different key, freshly signed: must still be judged on its
    // own key rather than the one seen a moment ago.
    const second = attest({ key: join(dir, 'other.key'), out: join(dir, 'att2.json') });
    err.length = 0;
    expect(craSupplierVerify(io(), { file: second })).toBe(0);
    expect(a.signature.keyId).toBe('lodash-maint-2026');
  });
});
