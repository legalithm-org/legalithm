import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main } from '../index.js';

/**
 * Run the INDEPENDENT verifier against a record this codebase just produced.
 *
 * `cra record --verify` shares a codebase with the writer, so it will agree with
 * a wrong specification exactly as readily as a right one. It cannot be the
 * evidence that docs/CRA-RECORD-FORMAT.md is sufficient, and the format is
 * published with an irrevocability commitment that is worth precisely whether
 * somebody else can implement it.
 *
 * docs/cra-record-verify.py is that somebody else: different language, different
 * JSON library, different crypto library, no shared code, written from the
 * document alone. If the record grows a field, or the canonicalisation changes,
 * or the hash rule moves and only the TypeScript is updated, this test goes red
 * and the spec has to be fixed in the same change.
 *
 * Skips when python3 or `cryptography` is unavailable rather than failing, since
 * that is an environment fact and not a defect in the record.
 */
const VERIFIER = join(__dirname, '..', '..', '..', '..', 'docs', 'cra-record-verify.py');

let pythonReady = false;
beforeAll(() => {
  const probe = spawnSync('python3', ['-c', 'import cryptography'], { encoding: 'utf8' });
  pythonReady = probe.status === 0 && existsSync(VERIFIER);
});

let dir: string;
let keyPath: string;
const craDir = () => join(dir, 'compliance', 'cra');

function runVerifier(target: string): { status: number; out: string } {
  const r = spawnSync('python3', [VERIFIER, target], { encoding: 'utf8' });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cra-indep-'));
  keyPath = join(dir, 'signing.key');
  const { privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, 'utf8');

  const cwdSpy = process.cwd;
  process.cwd = () => dir;
  try {
    await main(['cra', 'product', '--name', 'Widget', '--version', '1.0.0']);
    await main(['cra', 'record', '--sign', '--key', keyPath, '--key-id', 'indep-2026']);
  } finally {
    process.cwd = cwdSpy;
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('an implementation that shares no code with this one', () => {
  it('agrees the record is intact and the signature valid', () => {
    if (!pythonReady) return;
    const { status, out } = runVerifier(craDir());
    expect(out).toContain('integrity: OK');
    expect(out).toContain('signature: valid');
    expect(status, out).toBe(0);
  });

  it('computes the SAME hash from the spec rules alone', () => {
    if (!pythonReady) return;
    const stored = JSON.parse(readFileSync(join(craDir(), 'record.json'), 'utf8')).recordHash;
    const { out } = runVerifier(craDir());
    // If canonicalisation ever diverges, the two hashes differ and the verifier
    // prints a recomputed line. Agreement across languages is the whole point.
    expect(out).toContain(stored);
    expect(out).not.toContain('recomputed');
  });

  it('rejects a record altered after signing, and refuses to call it valid', () => {
    if (!pythonReady) return;
    const p = join(craDir(), 'record.json');
    const rec = JSON.parse(readFileSync(p, 'utf8'));
    rec.products[0].name = 'Something Else';
    writeFileSync(p, JSON.stringify(rec, null, 2), 'utf8');

    const { status, out } = runVerifier(craDir());
    expect(out).toContain('ALTERED');
    expect(out).toContain('covers the ORIGINAL');
    expect(out).not.toContain('signature: valid');
    expect(status).toBe(1);
  });

  it('refuses when the public key was never published', () => {
    if (!pythonReady) return;
    rmSync(join(craDir(), 'verification-keys.json'));
    const { status, out } = runVerifier(craDir());
    expect(out.toLowerCase()).toContain('no public key is published');
    expect(status).toBe(1);
  });

  it('is genuinely independent: it reaches into nothing this package owns', () => {
    /*
     * The property is that it shares no CODE, not that it avoids the word
     * "legalithm" — it has to name the schema ids it implements,
     * which is the format it implements. The first version of this test asserted
     * the string was absent and failed on exactly that, which would have been a
     * silly reason to weaken a good verifier.
     */
    const src = readFileSync(VERIFIER, 'utf8');

    // No reaching into the implementation it is supposed to be checking.
    expect(src).not.toContain('packages/cli');
    expect(src).not.toContain('record-core');
    // No shelling out to the CLI and calling that verification.
    expect(src).not.toMatch(/npx|subprocess|os\.system|node /);

    // Imports: stdlib plus cryptography, nothing else.
    const imports = (src.match(/^\s*(?:import|from)\s+([A-Za-z_][\w.]*)/gm) ?? [])
      .map((l) => l.trim().split(/\s+/)[1]!.split('.')[0]!);
    const allowed = new Set(['base64', 'hashlib', 'json', 'pathlib', 'sys', 'cryptography', '__future__']);
    expect([...new Set(imports)].filter((m) => !allowed.has(m))).toEqual([]);
  });
});
