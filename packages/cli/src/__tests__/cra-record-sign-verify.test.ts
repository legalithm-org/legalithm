import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { main } from '../index.js';

/**
 * A signature nobody can check is decoration.
 *
 * `cra record --sign` wrote the detached signature and stopped. It never
 * published the public key, and there was no verify path for the CRA record at
 * all: `verify-record` only ever looked at compliance/legalithm.json, the AI Act
 * record. So the CRA record could be signed and then verified by nobody,
 * including the tool that signed it, while the product's own position is that a
 * record is "verifiable offline by anyone".
 *
 * Verification here reads only files: the record, the detached signature, the
 * published keys. No streams, no network, no API key. An auditor holding those
 * three files and nothing else has to be able to check it, which is why the hash
 * is recomputed from the record rather than from the evidence store they do not
 * have.
 */
let dir: string;
let keyPath: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;
const logged: string[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

const said = () => logged.join('\n');
const craDir = () => join(dir, 'compliance', 'cra');

function writeKey(path: string) {
  const { privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, 'utf8');
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cra-sign-'));
  keyPath = join(dir, 'signing.key');
  writeKey(keyPath);
  logged.length = 0;
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(dir);
  logSpy = vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logged.push(String(m)); });
  errSpy = vi.spyOn(console, 'error').mockImplementation((m?: unknown) => { logged.push(String(m)); });

  await main(['cra', 'product', '--name', 'Widget', '--version', '1.0.0']);
  logged.length = 0;
});
afterEach(() => {
  cwdSpy.mockRestore();
  logSpy.mockRestore();
  errSpy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

describe('cra record --sign publishes the key it signed with', () => {
  it('writes verification-keys.json, without which nobody can verify', async () => {
    expect(await main(['cra', 'record', '--sign', '--key', keyPath, '--key-id', 'acme-2026'])).toBe(0);

    const keysFile = join(craDir(), 'verification-keys.json');
    expect(existsSync(keysFile), 'the public key must be published').toBe(true);

    const keys = JSON.parse(readFileSync(keysFile, 'utf8')) as { keys: Record<string, string> };
    expect(keys.keys['acme-2026']).toContain('BEGIN PUBLIC KEY');
    // Never the private half.
    expect(readFileSync(keysFile, 'utf8')).not.toContain('PRIVATE KEY');
  });

  it('refuses to rebind an existing key id to a different key', async () => {
    await main(['cra', 'record', '--sign', '--key', keyPath, '--key-id', 'acme-2026']);
    logged.length = 0;

    const other = join(dir, 'other.key');
    writeKey(other);
    const code = await main(['cra', 'record', '--sign', '--key', other, '--key-id', 'acme-2026']);

    expect(code).toBe(1);
    // Rebinding silently invalidates every record signed under the old key.
    expect(said()).toContain('already published with a different public key');
  });

  it('does not repeat the "sign it" hint while signing', async () => {
    await main(['cra', 'record', '--sign', '--key', keyPath, '--key-id', 'acme-2026']);
    expect(said()).not.toContain('Sign it with your own key');
    expect(said()).toContain('Signed under acme-2026');
  });
});

describe('cra record --verify, offline and from files alone', () => {
  it('verifies an intact signed record', async () => {
    await main(['cra', 'record', '--sign', '--key', keyPath, '--key-id', 'acme-2026']);
    logged.length = 0;

    expect(await main(['cra', 'record', '--verify'])).toBe(0);
    expect(said()).toContain('Record integrity OK');
    expect(said()).toContain('valid (key "acme-2026")');
    // Says exactly what it proves and no more.
    expect(said()).toContain('does not prove who that is');
  });

  it('catches a tampered record and refuses to call the signature valid', async () => {
    await main(['cra', 'record', '--sign', '--key', keyPath, '--key-id', 'acme-2026']);

    const recPath = join(craDir(), 'record.json');
    const rec = JSON.parse(readFileSync(recPath, 'utf8')) as Record<string, unknown>;
    (rec.products as { name: string }[])[0]!.name = 'Something Else';
    writeFileSync(recPath, JSON.stringify(rec, null, 2), 'utf8');
    logged.length = 0;

    expect(await main(['cra', 'record', '--verify'])).toBe(1);
    expect(said()).toContain('ALTERED');
    /*
     * The signature IS genuine over the original hash, so a naive
     * implementation prints "Detached signature: valid" directly under
     * "ALTERED". Anyone skimming for the word valid would accept the record.
     */
    expect(said()).not.toContain('signature: valid');
    expect(said()).toContain('covers the ORIGINAL');
    expect(said()).toContain('untrusted');
  });

  it('refuses when the signing key was never published', async () => {
    await main(['cra', 'record', '--sign', '--key', keyPath, '--key-id', 'acme-2026']);
    rmSync(join(craDir(), 'verification-keys.json'));
    logged.length = 0;

    expect(await main(['cra', 'record', '--verify'])).toBe(1);
    expect(said()).toContain('no public key is published');
  });

  it('reports an unsigned record as intact but unattributed', async () => {
    await main(['cra', 'record']);
    logged.length = 0;

    expect(await main(['cra', 'record', '--verify'])).toBe(0);
    expect(said()).toContain('Record integrity OK');
    expect(said()).toContain('does not say who issued it');
  });

  it('verifies from the record alone, with the evidence store deleted', async () => {
    await main(['cra', 'record', '--sign', '--key', keyPath, '--key-id', 'acme-2026']);
    // An auditor gets three files, not a repository.
    rmSync(join(craDir(), 'products.jsonl'));
    logged.length = 0;

    expect(await main(['cra', 'record', '--verify'])).toBe(0);
    expect(said()).toContain('Record integrity OK');
  });
});

/**
 * A pin nothing checks is decoration, and `--verify` is the one place an
 * auditor looks. Reporting "signature valid" over a record whose cited risk
 * assessment has since been rewritten is the precise failure the pin exists to
 * prevent.
 */
describe('cra record --verify checks the assessment it cites', () => {
  const DOC = 'risk-assessment.md';
  const docPath = () => join(dir, DOC);

  const signedWithAssessment = async () => {
    writeFileSync(docPath(), '# Assessment\n\nAs assessed.\n', 'utf8');
    await main(['cra', 'risk', '--document', DOC, '--by', 'Dana Ruiz', '--summary', 'Article 13(2), v1.0.0']);
    await main(['cra', 'record', '--sign', '--key', keyPath, '--key-id', 'acme-2026']);
    logged.length = 0;
  };

  it('passes when the document still matches the hash it signed', async () => {
    await signedWithAssessment();
    expect(await main(['cra', 'record', '--verify'])).toBe(0);
    expect(said()).toContain('Detached signature: valid');
    expect(said()).not.toContain('no longer matches');
  });

  it('fails when the cited assessment was rewritten after signing', async () => {
    await signedWithAssessment();
    writeFileSync(docPath(), '# Assessment\n\nQuietly rewritten afterwards.\n', 'utf8');

    const code = await main(['cra', 'record', '--verify']);

    expect(code).toBe(1);
    expect(said()).toContain('no longer matches the hash this record signed');
    // The record itself is untouched, and saying otherwise would send someone
    // hunting for tampering in the wrong file.
    expect(said()).toContain('✓ Record integrity OK.');
  });

  it('stays valid when the assessment simply was not handed over', async () => {
    await signedWithAssessment();
    rmSync(docPath());

    // A record and its signature travel without the assessment attached often
    // enough that treating absence as failure would cry wolf.
    expect(await main(['cra', 'record', '--verify'])).toBe(0);
    expect(said()).toMatch(/1 document\(s\) this record cites are not present/);
    expect(said()).toContain(DOC);
    expect(said()).toContain('Detached signature: valid');
  });
});

/**
 * Once Part II determinations rest on a policy and published advisories,
 * checking only the risk assessment and reporting "valid" over the rest leaves
 * exactly the gap the pin exists to close.
 */
describe('cra record --verify checks every pinned document', () => {
  const POLICY = 'compliance/cra/cvd-policy.md';
  const ADVISORY = 'compliance/cra/advisories/LGL-1.md';

  const put = (rel: string, text: string) => {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text, 'utf8');
  };

  const signedWithDocuments = async () => {
    put(POLICY, '# CVD\n\n24 hours.\n');
    put(ADVISORY, '# LGL-1\n\nFixed in 1.0.1.\n');
    await main(['cra', 'policy', '--document', POLICY, '--kind', 'cvd_policy', '--by', 'D', '--summary', 's']);
    await main(['cra', 'policy', '--document', ADVISORY, '--kind', 'advisory', '--by', 'D', '--summary', 's']);
    await main(['cra', 'record', '--sign', '--key', keyPath, '--key-id', 'acme-2026']);
    logged.length = 0;
  };

  it('passes when every document still matches', async () => {
    await signedWithDocuments();
    expect(await main(['cra', 'record', '--verify'])).toBe(0);
    expect(said()).not.toContain('no longer matches');
  });

  // The advisory, not the risk assessment: a check that only covered the first
  // pinned document would pass this and should not.
  it('fails when a pinned ADVISORY was rewritten after signing', async () => {
    await signedWithDocuments();
    put(ADVISORY, '# LGL-1\n\nQuietly reworded.\n');

    expect(await main(['cra', 'record', '--verify'])).toBe(1);
    expect(said()).toContain(`${ADVISORY} no longer matches`);
    expect(said()).toContain('✓ Record integrity OK.');
  });

  it('names every drifted document, not just the first', async () => {
    await signedWithDocuments();
    put(POLICY, '# CVD\n\n48 hours now.\n');
    put(ADVISORY, '# LGL-1\n\nAlso changed.\n');

    expect(await main(['cra', 'record', '--verify'])).toBe(1);
    expect(said()).toContain(`${POLICY} no longer matches`);
    expect(said()).toContain(`${ADVISORY} no longer matches`);
  });

  it('stays valid when documents simply were not handed over', async () => {
    await signedWithDocuments();
    rmSync(join(dir, POLICY));
    rmSync(join(dir, ADVISORY));
    expect(await main(['cra', 'record', '--verify'])).toBe(0);
    expect(said()).toMatch(/2 document\(s\) this record cites are not present/);
  });
});
