import { writeFileSync, mkdirSync, readFileSync, existsSync, statSync } from 'fs';
import { dirname } from 'path';
import { credentialsPath } from '../config.js';
import { recordSecurityEvent } from '../security-log.js';

/**
 * Where the key comes from. At most one of these.
 *
 * `--key lgl_...` puts the secret in argv, so it is written to the shell
 * history file and, while the command runs, is readable from the process table
 * by anything else on the machine. On a shared CI runner that includes other
 * tenants' jobs.
 *
 * The product already knew this. `sign-record` takes a *path* and says so in
 * its own error text: "The key is read from a file, never from an argument, so
 * it cannot end up in shell history." The same care was never applied to the
 * API key, and the web UI's copy button handed every new user the argument
 * form. Recorded as R3 in the Article 13(2) risk assessment; this is the fix.
 *
 * `--key` still works. Removing it would break scripts and CI jobs already
 * calling it, and a broken deploy is a worse outcome than an exposure the
 * operator can now see and decide about. It warns instead, after saving.
 */
export interface LoginInput {
  /** The key itself, as an argument. Still works, now warns. */
  key?: string;
  /** Path to a file holding the key. */
  keyFile?: string;
  /** Read the key from standard input. Implied when stdin is a pipe. */
  stdin?: boolean;
}

/** Injected so tests never touch the real terminal, stdin, or home directory. */
export interface LoginIo {
  log?: (m: string) => void;
  warn?: (m: string) => void;
  path?: string;
  /** Reads all of stdin. */
  readStdin?: () => string;
  /** True when stdin is a terminal, so a person can be asked. */
  isTty?: () => boolean;
  /** Reads a secret from the terminal with echo off. */
  promptSecret?: (prompt: string) => Promise<string>;
  /** Where the Annex I Part I (2)(l) log lives. Injected so tests stay off the real one. */
  securityLogPath?: string;
}

const USAGE = [
  'Usage: legalithm login            paste your key when asked',
  '',
  '  --key-file <path>               read the key from a file',
  '  --stdin                         read the key from standard input',
  '  --key lgl_...                   pass it as an argument, and see the warning',
  '',
  'Create a key at /app/settings/api-keys, or set LEGALITHM_API_KEY in the',
  'environment and skip this command entirely.',
];

const ARGV_WARNING = [
  '',
  'Warning: that key was passed as a command-line argument. It is now in your',
  'shell history file, and while the command ran it was readable from the',
  'process table by anything else on this machine. On a shared CI runner that',
  "includes other tenants' jobs.",
  '',
  '  legalithm login                 prompts, and echoes nothing',
  '  legalithm login --key-file ...  reads it from a file',
  '',
  'The saved credentials file is 0600. Remove the history entry, and rotate the key',
  'if this machine is shared.',
];

const PROMPT = 'Paste your Legalithm API key (input is hidden): ';

/**
 * Persist an API key to ~/.config/legalithm/credentials.json (0600).
 * Returns an exit code.
 *
 * A bare string is the pre-0.6.3 signature and still means `--key`, so any
 * caller written against the old shape keeps working.
 */
export async function runLogin(
  input: LoginInput | string | undefined,
  log: (m: string) => void = console.log,
  path: string = credentialsPath(),
  io: LoginIo = {},
): Promise<number> {
  const warn = io.warn ?? console.error;
  const out = io.log ?? log;
  const dest = io.path ?? path;
  const opts: LoginInput = typeof input === 'string' ? { key: input } : (input ?? {});

  const given = [opts.key && 'key', opts.keyFile && 'key-file', opts.stdin && 'stdin'].filter(Boolean) as string[];
  if (given.length > 1) {
    warn(`Give the key one way, not ${given.length}: --${given.join(', --')}.`);
    return 2;
  }

  let apiKey: string | undefined;
  let viaArgv = false;
  const isTty = io.isTty ? io.isTty() : Boolean(process.stdin.isTTY);

  if (opts.keyFile) {
    if (!existsSync(opts.keyFile)) {
      warn(`No key file at ${opts.keyFile}`);
      return 2;
    }
    // The same complaint sign-record makes about a signing key, for the same
    // reason: a secret anyone can read is not a secret. A warning rather than a
    // refusal, because CI runners often cannot set the mode of a mounted file.
    try {
      const mode = statSync(opts.keyFile).mode;
      if ((mode & 0o077) !== 0) {
        warn(
          `Warning: ${opts.keyFile} is readable by group or other ` +
            `(mode ${(mode & 0o777).toString(8)}).  chmod 600 ${opts.keyFile}`,
        );
      }
    } catch {
      /* advisory only */
    }
    try {
      apiKey = readFileSync(opts.keyFile, 'utf8').trim();
    } catch (e) {
      warn(`Could not read ${opts.keyFile}: ${(e as Error).message}`);
      return 2;
    }
  } else if (opts.key) {
    apiKey = opts.key.trim();
    viaArgv = true;
  } else if (opts.stdin || !isTty) {
    // A pipe means --stdin whether or not it was passed. `echo "$KEY" |
    // legalithm login` is the obvious thing to try in CI, and it is safe, so it
    // should work rather than print usage.
    try {
      apiKey = (io.readStdin ? io.readStdin() : readFileSync(0, 'utf8')).trim();
    } catch (e) {
      warn(`Could not read the key from stdin: ${(e as Error).message}`);
      return 2;
    }
  } else {
    // A terminal and no flags: ask. This is the path the web UI now points at,
    // and the only one where the key touches neither argv nor a file on disk.
    try {
      const prompt = io.promptSecret ?? (await import('../secret-prompt.js')).promptSecret;
      apiKey = (await prompt(PROMPT)).trim();
    } catch (e) {
      const why = (e as Error).message;
      warn(why === 'cancelled' ? 'Cancelled.' : `Could not read the key: ${why}`);
      return 2;
    }
  }

  if (!apiKey || !apiKey.startsWith('lgl_')) {
    for (const line of USAGE) out(line);
    return 2;
  }

  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, `${JSON.stringify({ apiKey }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  out(`✓ Saved API key to ${dest}`);

  // Modification of data, in the words of Annex I Part I (2)(l). The key itself
  // is never written to the log; that a key was stored is the security-relevant
  // fact, and the value is the thing you least want in a second file.
  recordSecurityEvent('credentials_written', `via ${viaArgv ? '--key' : (opts.keyFile ? '--key-file' : (opts.stdin || !isTty ? 'stdin' : 'prompt'))}`, {
    ...(io.securityLogPath ? { path: io.securityLogPath } : {}),
  });

  // Said after the key is safely stored, so it reads as advice rather than as
  // the reason the command failed.
  if (viaArgv) for (const line of ARGV_WARNING) warn(line);

  return 0;
}
