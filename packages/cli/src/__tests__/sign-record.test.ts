/**
 * `legalithm sign-record` — the Option B signing path.
 *
 * The interesting cases here are the refusals. A signer that happily signs
 * anything is worse than no signer: it converts "this record was edited" into
 * "this record was edited and someone attested to it".
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { runSignRecord, type SignRecordIo } from '../commands/sign-record.js';
import { runVerifyRecord, type VerifyRecordIo } from '../commands/verify-record.js';
import { computeRecordHash } from '../record-hash.js';
import { parseSignatureFile } from '../record-signature.js';
import { signRecordHash, loadSigningKey, publicKeyPemFor } from '../record-signing.js';
import type { StoredRecord } from '../types.js';

const ENGINE = '2026.08.01';

function makeRecord(): StoredRecord {
  const record = {
    system: { name: 'test-system' },
    classification: { risk: 'limited', citations: [], confidenceScore: 0.9, reviewRequired: false },
    legalBasis: { engineVersion: ENGINE, statement: 'Regulation (EU) 2024/1689' },
    obligations: [],
  } as unknown as StoredRecord;
  (record as { recordHash?: string }).recordHash = computeRecordHash(record);
  return record;
}

function ed25519Pem(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

interface Harness {
  io: SignRecordIo;
  written: Record<string, string>;
  logs: string[];
  errors: string[];
}

function harness(record: StoredRecord | null, keyPem: string, mode = 0o600): Harness {
  const written: Record<string, string> = {};
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    written,
    logs,
    errors,
    io: {
      readRecord: () => record,
      readKeyFile: () => keyPem,
      keyFileMode: () => mode,
      readVerificationKeys: () => written['keys'] ?? null,
      writeSignature: (_d, c) => {
        written['sig'] = c;
      },
      writeVerificationKeys: (_d, c) => {
        written['keys'] = c;
      },
      log: (m) => logs.push(m),
      error: (m) => errors.push(m),
    },
  };
}

describe('sign-record', () => {
  let key: { privatePem: string; publicPem: string };
  beforeEach(() => {
    key = ed25519Pem();
  });

  it('signs a valid record and publishes the public half', () => {
    const h = harness(makeRecord(), key.privatePem);
    const code = runSignRecord(h.io, { cwd: '/x', keyPath: '/k.pem', keyId: 'acme-gmbh-2026' });

    expect(code).toBe(0);
    const sig = parseSignatureFile(h.written['sig']!);
    expect(sig.algorithm).toBe('Ed25519');
    expect(sig.keyId).toBe('acme-gmbh-2026');

    const keys = JSON.parse(h.written['keys']!) as { keys: Record<string, string> };
    expect(keys.keys['acme-gmbh-2026']?.trim()).toBe(key.publicPem.trim());
    // The private half must never be written anywhere.
    expect(JSON.stringify(h.written)).not.toContain('PRIVATE KEY');
  });

  it('REFUSES to sign a record whose body was edited after generation', () => {
    const record = makeRecord();
    (record.system as { name: string }).name = 'tampered-after-hashing';

    const h = harness(record, key.privatePem);
    const code = runSignRecord(h.io, { cwd: '/x', keyPath: '/k.pem', keyId: 'acme-gmbh-2026' });

    expect(code).toBe(1);
    expect(h.written['sig']).toBeUndefined();
    expect(h.errors.join(' ')).toMatch(/edited after generation/);
  });

  it('REFUSES to sign under a built-in Legalithm trust anchor', () => {
    const h = harness(makeRecord(), key.privatePem);
    const code = runSignRecord(h.io, {
      cwd: '/x',
      keyPath: '/k.pem',
      keyId: 'legalithm-record-v1',
    });

    expect(code).toBe(1);
    expect(h.written['sig']).toBeUndefined();
    expect(h.errors.join(' ')).toMatch(/built-in Legalithm trust anchor/);
  });

  it('REFUSES to reuse a key id for a different key', () => {
    const first = harness(makeRecord(), key.privatePem);
    expect(runSignRecord(first.io, { cwd: '/x', keyPath: '/k.pem', keyId: 'acme-2026' })).toBe(0);

    // Same id, different key: every record signed under the old key would
    // silently stop verifying.
    const rotated = ed25519Pem();
    const second = harness(makeRecord(), rotated.privatePem);
    second.written['keys'] = first.written['keys']!;
    const code = runSignRecord(second.io, { cwd: '/x', keyPath: '/k.pem', keyId: 'acme-2026' });

    expect(code).toBe(1);
    expect(second.errors.join(' ')).toMatch(/already published with a DIFFERENT public key/);
  });

  it('rejects a non-Ed25519 key by name instead of failing obscurely', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

    const h = harness(makeRecord(), rsaPem);
    const code = runSignRecord(h.io, { cwd: '/x', keyPath: '/k.pem', keyId: 'acme-2026' });

    expect(code).toBe(1);
    expect(h.errors.join(' ')).toMatch(/Ed25519/);
    expect(h.errors.join(' ')).toMatch(/openssl genpkey/);
  });

  it('warns, but still signs, when the key file is group or world readable', () => {
    const h = harness(makeRecord(), key.privatePem, 0o644);
    const code = runSignRecord(h.io, { cwd: '/x', keyPath: '/k.pem', keyId: 'acme-2026' });

    expect(code).toBe(0);
    expect(h.logs.join(' ')).toMatch(/readable by group or other/);
  });

  it('needs both a key and a key id, and says which is missing', () => {
    const noKey = harness(makeRecord(), key.privatePem);
    expect(runSignRecord(noKey.io, { cwd: '/x', keyId: 'acme-2026' })).toBe(2);
    expect(noKey.errors.join(' ')).toMatch(/--key <path>/);

    const noId = harness(makeRecord(), key.privatePem);
    expect(runSignRecord(noId.io, { cwd: '/x', keyPath: '/k.pem' })).toBe(2);
    expect(noId.errors.join(' ')).toMatch(/--key-id/);
  });
});

describe('sign-record -> verify-record round trip', () => {
  it('a signed record verifies offline, and says the key came from the repo', () => {
    const record = makeRecord();
    const key = ed25519Pem();
    const signed = harness(record, key.privatePem);
    expect(runSignRecord(signed.io, { cwd: '/x', keyPath: '/k.pem', keyId: 'acme-2026' })).toBe(0);

    const logs: string[] = [];
    const verifyIo: VerifyRecordIo = {
      readRecord: () => record,
      readSignature: () => signed.written['sig']!,
      readVerificationKeys: () => signed.written['keys']!,
      bundledEngineVersion: () => ENGINE,
      log: (m) => logs.push(m),
      error: (m) => logs.push(m),
    };

    expect(runVerifyRecord(verifyIo, { cwd: '/x' })).toBe(0);
    const out = logs.join('\n');
    expect(out).toMatch(/Detached signature: valid \(key "acme-2026"\)/);
    // The caveat is the honest part: a key read from the repo being audited
    // proves consistency, not issuer.
    expect(out).toMatch(/came from this repository/);
  });

  it('a signature made for a different record does not verify', () => {
    const record = makeRecord();
    const key = ed25519Pem();
    const signed = harness(record, key.privatePem);
    runSignRecord(signed.io, { cwd: '/x', keyPath: '/k.pem', keyId: 'acme-2026' });

    const other = makeRecord();
    (other.system as { name: string }).name = 'a-different-system';
    (other as { recordHash?: string }).recordHash = computeRecordHash(other);

    const logs: string[] = [];
    const code = runVerifyRecord(
      {
        readRecord: () => other,
        readSignature: () => signed.written['sig']!,
        readVerificationKeys: () => signed.written['keys']!,
        bundledEngineVersion: () => ENGINE,
        log: (m) => logs.push(m),
        error: (m) => logs.push(m),
      },
      { cwd: '/x' },
    );

    expect(code).toBe(1);
    expect(logs.join('\n')).toMatch(/signature does not match recordHash/);
  });

  it('a repo cannot swap the built-in trust anchor by shipping a keys file', () => {
    const record = makeRecord();
    const attacker = ed25519Pem();
    // Forge a signature and claim it is the Legalithm anchor, publishing the
    // attacker's public key under that id.
    const forged = {
      algorithm: 'Ed25519',
      keyId: 'legalithm-record-v1',
      signature: signRecordHash(
        record.recordHash as string,
        loadSigningKey(attacker.privatePem),
        'attacker-key',
      ).signature,
    };

    const logs: string[] = [];
    const code = runVerifyRecord(
      {
        readRecord: () => record,
        readSignature: () => JSON.stringify(forged),
        readVerificationKeys: () =>
          JSON.stringify({ keys: { 'legalithm-record-v1': attacker.publicPem } }),
        bundledEngineVersion: () => ENGINE,
        log: (m) => logs.push(m),
        error: (m) => logs.push(m),
      },
      { cwd: '/x' },
    );

    expect(code).toBe(1);
    expect(logs.join('\n')).toMatch(/signature does not match recordHash/);
  });
});

describe('record-signing helpers', () => {
  it('derives a public key that matches the generated pair', () => {
    const { privatePem, publicPem } = ed25519Pem();
    expect(publicKeyPemFor(loadSigningKey(privatePem)).trim()).toBe(publicPem.trim());
  });

  it('rejects key ids that are too short or contain junk', () => {
    const { privatePem } = ed25519Pem();
    const k = loadSigningKey(privatePem);
    expect(() => signRecordHash('abc', k, 'ab')).toThrow(/Invalid key id/);
    expect(() => signRecordHash('abc', k, 'acme corp')).toThrow(/Invalid key id/);
  });
});
