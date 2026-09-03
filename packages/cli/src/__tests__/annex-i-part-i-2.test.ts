/**
 * The five Annex I Part I (2) requirements this product did not implement.
 *
 * Each describe block names its requirement, because the point of these tests is
 * not that the commands work: it is that a determination in a signed record
 * stays true. If one of these goes red, the honest response is to change the
 * determination back to not_met, not to soften the test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { recordSecurityEvent, readSecurityLog, securityLogPath, securityLogEnabled } from '../security-log.js';
import { runReset, runDataExport, runDataDelete, runSecurity, signingKeyPath, updateCachePath } from '../commands/data.js';
import { isNewer, updateNotice, updateNoticeEnabled, readUpdateCache, writeUpdateCache } from '../update-notice.js';
import { runLogin } from '../commands/login.js';
import { credentialsPath } from '../config.js';

let home: string;
const said: string[] = [];
const io = () => ({ home, log: (m: string) => said.push(m), error: (m: string) => said.push(m) });
const out = () => said.join('\n');

const KEY = `lgl_${'a'.repeat(64)}`;

/**
 * Generated in memory, never written as a literal.
 *
 * The first version of this fixture pasted a PEM header into the source, which
 * tripped `no-private-keys-in-source` the moment the file became tracked — and
 * only then, because that guard reads `git grep`. A test suite run before
 * `git add` cannot see what a tracked-source scanner sees.
 */
const SIGNING_KEY_PEM = generateKeyPairSync('ed25519').privateKey.export({
  type: 'pkcs8',
  format: 'pem',
}) as string;

/** The PEM header, assembled at runtime so this file contains no such literal. */
const PEM_HEADER = ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ');

function seedEverything() {
  mkdirSync(join(home, '.config', 'legalithm'), { recursive: true });
  writeFileSync(credentialsPath(home), JSON.stringify({ apiKey: KEY }), { mode: 0o600 });
  writeFileSync(updateCachePath(home), JSON.stringify({ latestVersion: '9.9.9' }), { mode: 0o600 });
  writeFileSync(signingKeyPath(home), SIGNING_KEY_PEM, { mode: 0o600 });
  recordSecurityEvent('credentials_written', 'seed', { path: securityLogPath(home) });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'annexi-'));
  said.length = 0;
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('the log never touches the real home from a test', () => {
  /*
   * The defect this guards: every caller that did not inject a path wrote to
   * ~/.config/legalithm/security.log during `vitest`. The author's own log
   * ended up with 504 fabricated entries and one real one, in the feature whose
   * whole purpose is telling a person whether anything odd has happened.
   */
  it('refuses the default path under test, so a forgotten injection is harmless', () => {
    const real = securityLogPath();
    const before = existsSync(real) ? readFileSync(real, 'utf8').length : -1;

    recordSecurityEvent('auth_failed', 'this must never be written');

    const after = existsSync(real) ? readFileSync(real, 'utf8').length : -1;
    expect(after, 'a test wrote to the real security log').toBe(before);
  });

  it('still writes when a path is injected on purpose', () => {
    const p = securityLogPath(home);
    recordSecurityEvent('reset', 'deliberate', { path: p });
    expect(readSecurityLog(p)).toHaveLength(1);
  });
});

describe('(2)(l) recording and monitoring relevant internal activity', () => {
  it('records an event with a timestamp and reads it back', () => {
    recordSecurityEvent('credentials_written', 'via prompt', { path: securityLogPath(home) });
    const events = readSecurityLog(securityLogPath(home));
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('credentials_written');
    expect(events[0]!.detail).toBe('via prompt');
    expect(Date.parse(events[0]!.at)).not.toBeNaN();
  });

  it('writes the log 0600, because it names what happened on this machine', () => {
    recordSecurityEvent('reset', undefined, { path: securityLogPath(home) });
    expect(statSync(securityLogPath(home)).mode & 0o777).toBe(0o600);
  });

  // "with an opt-out mechanism for the user" is part of the requirement text.
  it('honours the opt-out, and the opt-out is named for what it turns off', () => {
    recordSecurityEvent('reset', undefined, { path: securityLogPath(home), env: { LEGALITHM_SECURITY_LOG: '0' } });
    expect(existsSync(securityLogPath(home))).toBe(false);
    for (const v of ['0', 'false', 'no', 'off', 'FALSE']) {
      expect(securityLogEnabled({ LEGALITHM_SECURITY_LOG: v })).toBe(false);
    }
    expect(securityLogEnabled({})).toBe(true);
  });

  // This log never leaves the machine, so the variable about being tracked by
  // someone else does not govern it. Getting this backwards would silently
  // disable a security control for every privacy-conscious user.
  it('is NOT disabled by DO_NOT_TRACK, which is about transmission', () => {
    expect(securityLogEnabled({ DO_NOT_TRACK: '1' })).toBe(true);
    recordSecurityEvent('reset', undefined, { path: securityLogPath(home), env: { DO_NOT_TRACK: '1' } });
    expect(readSecurityLog(securityLogPath(home))).toHaveLength(1);
  });

  it('never throws when the log cannot be written', () => {
    // A path under a file, which cannot be a directory.
    const blocked = join(home, 'afile');
    writeFileSync(blocked, 'x');
    expect(() => recordSecurityEvent('reset', undefined, { path: join(blocked, 'nested', 'log') })).not.toThrow();
  });

  it('drops a malformed line rather than losing the entries above it', () => {
    const p = securityLogPath(home);
    recordSecurityEvent('reset', 'good', { path: p });
    writeFileSync(p, `${readFileSync(p, 'utf8')}{"at":"broken`, { flag: 'w' });
    const events = readSecurityLog(p);
    expect(events).toHaveLength(1);
    expect(events[0]!.detail).toBe('good');
  });

  it('stays bounded instead of growing forever on an unattended machine', () => {
    const p = securityLogPath(home);
    for (let i = 0; i < 1200; i++) recordSecurityEvent('reset', `event-${i}-${'x'.repeat(60)}`, { path: p });
    const events = readSecurityLog(p);
    expect(events.length).toBeLessThanOrEqual(1000);
    // The newest survive; trimming the wrong end would keep only ancient history.
    expect(events[events.length - 1]!.detail).toContain('event-1199');
  });
});

describe('(2)(d) report on possible unauthorised access', () => {
  it('calls out failed authentication separately from ordinary activity', () => {
    recordSecurityEvent('credentials_written', 'via prompt', { path: securityLogPath(home) });
    recordSecurityEvent('auth_failed', 'API rejected the stored key', { path: securityLogPath(home) });
    expect(runSecurity(io())).toBe(0);
    expect(out()).toMatch(/1 failed authentication/i);
    expect(out()).toMatch(/rotate the key/i);
  });

  it('says so plainly when there are none', () => {
    recordSecurityEvent('reset', undefined, { path: securityLogPath(home) });
    runSecurity(io());
    expect(out()).toMatch(/No failed authentication recorded/i);
  });

  it('reports machine-readably for anything that has to act on it', () => {
    recordSecurityEvent('auth_failed', 'x', { path: securityLogPath(home) });
    runSecurity(io(), { json: true });
    const parsed = JSON.parse(out());
    expect(parsed.failedAuth).toBe(1);
    expect(parsed.events).toHaveLength(1);
  });
});

describe('(2)(b) the possibility to reset the product to its original state', () => {
  it('removes credentials and cached settings', () => {
    seedEverything();
    expect(runReset(io())).toBe(0);
    expect(existsSync(credentialsPath(home))).toBe(false);
    expect(existsSync(updateCachePath(home))).toBe(false);
  });

  // Erasing the audit trail whenever settings are restored would make (2)(l)
  // meaningless: any attacker with shell access would just run `reset`.
  it('KEEPS the security log, and records the reset in it', () => {
    seedEverything();
    runReset(io());
    const events = readSecurityLog(securityLogPath(home));
    expect(events.map((e) => e.event)).toContain('reset');
    expect(events.map((e) => e.event)).toContain('credentials_written');
  });

  it('never removes the signing key, and says where it is', () => {
    seedEverything();
    runReset(io());
    expect(existsSync(signingKeyPath(home))).toBe(true);
    expect(out()).toContain(signingKeyPath(home));
  });

  it('is honest when there was nothing to reset', () => {
    expect(runReset(io())).toBe(0);
    expect(out()).toMatch(/Already in its original state/i);
  });
});

describe('(2)(m) remove or transfer all data and settings', () => {
  it('exports credentials and the log to a 0600 file', () => {
    seedEverything();
    const target = join(home, 'out', 'bundle.json');
    expect(runDataExport(target, io())).toBe(0);
    expect(statSync(target).mode & 0o777).toBe(0o600);
    const bundle = JSON.parse(readFileSync(target, 'utf8'));
    expect(bundle.credentials.apiKey).toBe(KEY);
    expect(bundle.securityLog.length).toBeGreaterThan(0);
  });

  it('warns that the export holds a live key, because it does', () => {
    seedEverything();
    runDataExport(join(home, 'b.json'), io());
    expect(out()).toMatch(/plain text/i);
    expect(out()).toMatch(/rotate the key/i);
  });

  it('excludes the signing key from the export', () => {
    seedEverything();
    const target = join(home, 'b.json');
    runDataExport(target, io());
    expect(readFileSync(target, 'utf8')).not.toContain(PEM_HEADER);
    expect(readFileSync(target, 'utf8')).not.toContain(SIGNING_KEY_PEM.trim());
  });

  it('deletes credentials, cache AND the log, permanently', () => {
    seedEverything();
    expect(runDataDelete(io())).toBe(0);
    expect(existsSync(credentialsPath(home))).toBe(false);
    expect(existsSync(updateCachePath(home))).toBe(false);
    expect(existsSync(securityLogPath(home))).toBe(false);
  });

  // Writing "everything was deleted" into the thing that was deleted would mean
  // it was not.
  it('writes nothing back to the log after deleting it', () => {
    seedEverything();
    runDataDelete(io());
    expect(existsSync(securityLogPath(home))).toBe(false);
    expect(out()).toMatch(/log was part\s+of what you asked to be removed/i);
  });

  // The single most destructive thing this command could do, so it is the one
  // asserted hardest.
  it('NEVER deletes the signing key, and explains why', () => {
    seedEverything();
    runDataDelete(io());
    expect(existsSync(signingKeyPath(home))).toBe(true);
    expect(readFileSync(signingKeyPath(home), 'utf8')).toBe(SIGNING_KEY_PEM);
    expect(out()).toMatch(/not a setting/i);
  });
});

describe('(2)(c) notification of available updates', () => {
  it('compares versions the way a release does', () => {
    expect(isNewer('0.6.4', '0.6.3')).toBe(true);
    expect(isNewer('0.7.0', '0.6.9')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.6.3', '0.6.3')).toBe(false);
    expect(isNewer('0.6.2', '0.6.3')).toBe(false);
    // 0.6.10 is newer than 0.6.9; a string compare would say otherwise.
    expect(isNewer('0.6.10', '0.6.9')).toBe(true);
    expect(isNewer('0.6.4', '0.6.4-rc.1')).toBe(true);
    expect(isNewer('0.6.4-rc.1', '0.6.4')).toBe(false);
    expect(isNewer('garbage', '0.6.3')).toBe(false);
  });

  it('says nothing when there is nothing to say', () => {
    expect(updateNotice(null, '0.6.3')).toBeNull();
    expect(updateNotice('0.6.3', '0.6.3')).toBeNull();
    expect(updateNotice('0.6.2', '0.6.3')).toBeNull();
  });

  // The reason to update is security, and the sentence should say that rather
  // than sell a release.
  it('frames the update as how vulnerabilities reach you', () => {
    const lines = updateNotice('0.7.0', '0.6.3')!.join('\n');
    expect(lines).toContain('0.6.3 → 0.7.0');
    expect(lines).toMatch(/vulnerabilit/i);
    expect(lines).toMatch(/LEGALITHM_NO_UPDATE_NOTICE/);
  });

  it('can be silenced', () => {
    expect(updateNoticeEnabled({})).toBe(true);
    for (const v of ['1', 'true', 'yes', 'on']) {
      expect(updateNoticeEnabled({ LEGALITHM_NO_UPDATE_NOTICE: v })).toBe(false);
    }
  });

  // This is what carries the notice into the offline commands, which are most
  // of the product. Without it the notification reaches almost nobody.
  it('caches what the server said so offline runs can still notify', () => {
    const p = updateCachePath(home);
    expect(readUpdateCache(p)).toBeNull();
    writeUpdateCache(p, '0.7.0', '2026-08-16T00:00:00.000Z');
    expect(readUpdateCache(p)!.latestVersion).toBe('0.7.0');
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });

  it('survives a corrupt cache instead of failing the command', () => {
    const p = updateCachePath(home);
    mkdirSync(join(home, '.config', 'legalithm'), { recursive: true });
    writeFileSync(p, 'not json');
    expect(readUpdateCache(p)).toBeNull();
  });
});

describe('login feeds the log without feeding it the key', () => {
  it('records that a credential was stored, and by which route', async () => {
    const logPath = securityLogPath(home);
    const code = await runLogin({ key: KEY }, () => {}, credentialsPath(home), {
      warn: () => {},
      isTty: () => true,
      securityLogPath: logPath,
    });
    expect(code).toBe(0);
    const events = readSecurityLog(logPath);
    expect(events[0]!.event).toBe('credentials_written');
    expect(events[0]!.detail).toBe('via --key');
  });

  it('never writes the key itself into the log', async () => {
    const logPath = securityLogPath(home);
    await runLogin({ key: KEY }, () => {}, credentialsPath(home), {
      warn: () => {},
      isTty: () => true,
      securityLogPath: logPath,
    });
    expect(readFileSync(logPath, 'utf8')).not.toContain(KEY);
  });
});
