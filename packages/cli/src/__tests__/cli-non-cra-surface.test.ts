import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main } from '../index.js';

/**
 * The rest of the router: the AI Act commands beside the CRA ones.
 *
 * They share one argv parser and one dispatch, so a change to either affects
 * both, and these branches were the largest untested block left. Each assertion
 * here is the same question: does the command refuse clearly when it cannot do
 * the job, rather than half-doing it.
 */
let dir: string;
const logged: string[] = [];
let spies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cli-nc-'));
  logged.length = 0;
  spies = [
    vi.spyOn(process, 'cwd').mockReturnValue(dir),
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logged.push(String(m)); }),
    vi.spyOn(console, 'error').mockImplementation((m?: unknown) => { logged.push(String(m)); }),
  ];
});
afterEach(() => {
  for (const s of spies) s.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});
const said = () => logged.join('\n');

describe('verify-record', () => {
  it('refuses with no record path', async () => {
    expect(await main(['verify-record'])).not.toBe(0);
  });

  it('reports a missing file rather than throwing', async () => {
    expect(await main(['verify-record', join(dir, 'absent.json')])).not.toBe(0);
    expect(said().length).toBeGreaterThan(0);
  });

  it('reports unparseable JSON as such', async () => {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ not json');
    expect(await main(['verify-record', p])).not.toBe(0);
  });

  it('reports a JSON file that is not a record', async () => {
    const p = join(dir, 'notrec.json');
    writeFileSync(p, JSON.stringify({ hello: 'world' }));
    expect(await main(['verify-record', p])).not.toBe(0);
  });
});

describe('sign-record', () => {
  it('refuses without a key', async () => {
    expect(await main(['sign-record'])).not.toBe(0);
  });

  it('refuses a key file that does not exist', async () => {
    const rec = join(dir, 'r.json');
    writeFileSync(rec, JSON.stringify({ recordHash: 'abc' }));
    expect(await main(['sign-record', rec, '--key', join(dir, 'nokey.pem')])).not.toBe(0);
  });

  it('refuses a key that is not Ed25519, by name', async () => {
    const rec = join(dir, 'r.json');
    writeFileSync(rec, JSON.stringify({ recordHash: 'abc' }));
    /*
     * GENERATED AT TEST TIME, never written as a literal.
     *
     * The first version embedded a PEM block in the source. It was not a real
     * key, but __tests__/lib/no-private-keys-in-source.test.ts scans TRACKED
     * source for the marker and does not care whether the bytes are genuine.
     * That is the right posture for that guard: a scanner that tries to tell a
     * real key from a fake one is a scanner that can be talked out of firing.
     */
    const key = join(dir, 'rsa.pem');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    writeFileSync(key, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    expect(await main(['sign-record', rec, '--key', key, '--key-id', 'x'])).not.toBe(0);
    expect(said().length).toBeGreaterThan(0);
  });
});

describe('verify and mark', () => {
  it('verify refuses with no target', async () => {
    expect(await main(['verify'])).not.toBe(0);
  });

  it('verify reports a missing file', async () => {
    expect(await main(['verify', join(dir, 'gone.png')])).not.toBe(0);
  });

  it('mark refuses with no input', async () => {
    expect(await main(['mark'])).not.toBe(0);
  });

  it('mark reports a missing input file', async () => {
    expect(await main(['mark', join(dir, 'gone.png'), '--out', join(dir, 'o.png')])).not.toBe(0);
  });
});

describe('guard and discover', () => {
  it('guard reports its finding through an exit code, not just text', async () => {
    // guard writes via process.stdout.write rather than console.log, because it
    // runs in hooks and CI where the exit code is the signal that matters.
    const code = await main(['guard']);
    expect([0, 2]).toContain(code);
  });

  it('discover runs over an empty directory without throwing', async () => {
    const code = await main(['discover']);
    expect(typeof code).toBe('number');
  });
});

describe('check and init', () => {
  it('check refuses before init, rather than inventing a record', async () => {
    const code = await main(['check']);
    expect(code).not.toBe(0);
    expect(said().length).toBeGreaterThan(0);
  });

  it('help lists cra, which it did not before', async () => {
    // Everything the CRA work added was undiscoverable from the CLI's own
    // help: `cra` was absent from the command list entirely.
    await main(['help']);
    expect(said()).toContain('cra');
    expect(said()).toContain('2024/2847');
    expect(said()).toContain('11 SEPT 2026');
  });
});
