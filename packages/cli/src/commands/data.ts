/**
 * `reset`, `data` and `security`: the three commands Annex I Part I (2) asks for
 * and this product did not have.
 *
 *   (2)(b)  reset the product to its original state          -> `legalithm reset`
 *   (2)(m)  remove or transfer all data and settings         -> `legalithm data`
 *   (2)(l)  record and monitor relevant internal activity    -> `legalithm security`
 *   (2)(d)  report on possible unauthorised access           -> `legalithm security`
 *
 * **The signing key is never touched by any of them.** `~/.config/legalithm`
 * also holds the customer's Ed25519 private key, and deleting that destroys
 * their ability to sign a record and to be believed on records they already
 * signed. It is not a setting, it is an identity, and no convenience command
 * gets to remove it. Every command here names the key's path so the user can
 * remove it deliberately, which is the only way that should ever happen.
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { credentialsPath } from '../config.js';
import { securityLogPath, readSecurityLog, recordSecurityEvent, securityLogEnabled } from '../security-log.js';

export interface DataIo {
  log?: (m: string) => void;
  error?: (m: string) => void;
  home?: string;
  env?: Partial<NodeJS.ProcessEnv>;
}

/** Where the CLI keeps the version it last heard about, for (2)(c). */
export function updateCachePath(home: string = homedir()): string {
  return join(home, '.config', 'legalithm', 'update-check.json');
}

/** The private key path, named so it can be excluded and reported, never removed. */
export function signingKeyPath(home: string = homedir()): string {
  return join(home, '.config', 'legalithm', 'cra-signing.key');
}

/**
 * Settings this product wrote and may remove. Deliberately a list, not a
 * directory sweep: a sweep would eventually delete something added later that
 * nobody thought about, and the first such file was the signing key.
 */
function removable(home: string): { label: string; path: string }[] {
  return [
    { label: 'API credentials', path: credentialsPath(home) },
    { label: 'update-check cache', path: updateCachePath(home) },
  ];
}

const say = (io: DataIo) => io.log ?? console.log;
const warn = (io: DataIo) => io.error ?? console.error;

/**
 * (2)(b): "including the possibility to reset the product to its original state".
 *
 * The security log SURVIVES a reset, on purpose. Resetting configuration is a
 * routine act; erasing the record of what happened before it is not, and a
 * product that quietly wipes its own audit trail whenever settings are restored
 * would make (2)(l) meaningless. `data --delete` is the command that removes it,
 * and it says so.
 */
export function runReset(io: DataIo = {}): number {
  const home = io.home ?? homedir();
  const log = say(io);
  const removed: string[] = [];

  for (const { label, path } of removable(home)) {
    if (!existsSync(path)) continue;
    try {
      unlinkSync(path);
      removed.push(`${label}  ${path}`);
    } catch (e) {
      warn(io)(`Could not remove ${path}: ${(e as Error).message}`);
      return 1;
    }
  }

  if (!removed.length) {
    log('Already in its original state: no credentials and no cached settings.');
  } else {
    log('Reset to original state. Removed:');
    for (const r of removed) log(`  ${r}`);
  }

  recordSecurityEvent('reset', `${removed.length} item(s)`, { path: securityLogPath(home), env: io.env });

  log('');
  log('Kept on purpose:');
  log(`  security log   ${securityLogPath(home)}   (removed only by \`legalithm data --delete\`)`);
  if (existsSync(signingKeyPath(home))) {
    log(`  signing key    ${signingKeyPath(home)}   (never removed by any command; delete it yourself)`);
  }
  return 0;
}

/**
 * (2)(m): "securely and easily remove on a permanent basis all data and settings
 * and, where such data can be transferred to other products or systems, ensure
 * that this is done in a secure manner."
 *
 * Export is the transfer limb. It writes 0600 and says what is in the file,
 * because the export contains a live API key and the user is about to move it.
 */
export function runDataExport(target: string, io: DataIo = {}): number {
  const home = io.home ?? homedir();
  const log = say(io);

  const credPath = credentialsPath(home);
  const bundle = {
    exportedAt: new Date().toISOString(),
    note:
      'Contains a live Legalithm API key in plain text. Treat this file as a secret, ' +
      'and delete it once the transfer is done. The Ed25519 signing key is NOT included.',
    credentials: existsSync(credPath) ? (JSON.parse(readFileSync(credPath, 'utf8')) as unknown) : null,
    securityLog: readSecurityLog(securityLogPath(home)),
  };

  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(bundle, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    warn(io)(`Could not write ${target}: ${(e as Error).message}`);
    return 1;
  }

  recordSecurityEvent('data_exported', target, { path: securityLogPath(home), env: io.env });

  log(`Exported to ${target} (mode 0600)`);
  log(`  credentials    ${bundle.credentials ? 'included' : 'none stored'}`);
  log(`  security log   ${bundle.securityLog.length} event(s)`);
  log(`  signing key    NOT included — it is at ${signingKeyPath(home)} and moving it is your decision`);
  log('');
  log('This file holds a live API key in plain text. Delete it once the transfer is done,');
  log('and rotate the key if it travelled over anything you do not control.');
  return 0;
}

/**
 * The delete limb of (2)(m). This removes the security log as well, which is why
 * nothing is written to that log afterwards: recording "everything was deleted"
 * into the thing that was supposed to be deleted would mean it was not. The
 * deletion is reported to the user instead, which is where a person actually
 * looks.
 */
export function runDataDelete(io: DataIo = {}): number {
  const home = io.home ?? homedir();
  const log = say(io);
  const targets = [...removable(home), { label: 'security log', path: securityLogPath(home) }];
  const removed: string[] = [];

  for (const { label, path } of targets) {
    if (!existsSync(path)) continue;
    try {
      unlinkSync(path);
      removed.push(`${label}  ${path}`);
    } catch (e) {
      warn(io)(`Could not remove ${path}: ${(e as Error).message}`);
      return 1;
    }
  }

  if (!removed.length) log('Nothing to remove: no data or settings are stored.');
  else {
    log('Permanently removed:');
    for (const r of removed) log(`  ${r}`);
  }

  log('');
  log('Not removed, because it is not a setting:');
  log(`  signing key    ${signingKeyPath(home)}${existsSync(signingKeyPath(home)) ? '' : '   (not present)'}`);
  log('  Deleting it would end your ability to sign records and to be checked on');
  log('  records you already signed. Remove it yourself if that is what you want.');
  log('');
  log('Nothing was written to the security log about this, because the log was part');
  log('of what you asked to be removed.');
  return 0;
}

/**
 * (2)(l) and (2)(d): show what was recorded, and call out failed authentication
 * separately, because "possible unauthorised access" is the half of (2)(d) that
 * this log exists to answer.
 */
export function runSecurity(io: DataIo = {}, opts: { json?: boolean } = {}): number {
  const home = io.home ?? homedir();
  const log = say(io);
  const path = securityLogPath(home);
  const events = readSecurityLog(path);
  const failures = events.filter((e) => e.event === 'auth_failed');

  if (opts.json) {
    log(JSON.stringify({ path, enabled: securityLogEnabled(io.env ?? process.env), events, failedAuth: failures.length }, null, 2));
    return 0;
  }

  if (!securityLogEnabled(io.env ?? process.env)) {
    log('Security logging is OFF (LEGALITHM_SECURITY_LOG). Existing entries are still shown.');
    log('');
  }

  if (!events.length) {
    log(`No security events recorded. The log is ${path}`);
    log('Entries appear when credentials are written or removed, when the API rejects');
    log('a key, and when the product is reset or its data exported or deleted.');
    return 0;
  }

  const mode = (() => {
    try {
      return (statSync(path).mode & 0o777).toString(8);
    } catch {
      return '?';
    }
  })();

  log(`${events.length} event(s) in ${path} (mode ${mode})`);
  log('');
  for (const e of events) log(`  ${e.at}  ${e.event.padEnd(20)}${e.detail ?? ''}`);
  log('');
  if (failures.length) {
    log(`⚠ ${failures.length} failed authentication attempt(s) recorded.`);
    log('  Each is the API rejecting a key from this machine. If you did not cause');
    log('  them, rotate the key: someone else may hold it.');
  } else {
    log('No failed authentication recorded.');
  }
  log('');
  log('This log is local. Nothing in it is transmitted, which is why DO_NOT_TRACK does');
  log('not disable it. To turn it off:  LEGALITHM_SECURITY_LOG=0');
  return 0;
}
