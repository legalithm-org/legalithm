// Anonymous, opt-out usage telemetry. Sends only { surface, command, repoHash,
// idBasis } — repoHash is a one-way digest of the project identity (normalised git
// remote, else repo root, else cwd). The source value never leaves the machine.
import { createHash } from 'crypto';
import { spawnSync } from 'node:child_process';

/**
 * Off for DO_NOT_TRACK=1, or LEGALITHM_TELEMETRY set to 0 / false / no / off.
 *
 * The extra spellings are not cosmetic. MCPB user_config substitutes a boolean
 * into env as the literal string "false", so a host UI toggle that only emitted
 * "false" would have left telemetry running while telling the user it was off.
 * An opt-out that silently fails is worse than no opt-out.
 */
const TELEMETRY_OFF = new Set(['0', 'false', 'no', 'off']);

export function telemetryEnabled(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  if (env.DO_NOT_TRACK === '1') return false;
  const flag = env.LEGALITHM_TELEMETRY?.trim().toLowerCase();
  return !(flag !== undefined && TELEMETRY_OFF.has(flag));
}

/** One-way 16-hex digest. The input never leaves the machine. */
export function repoHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

/** What the identity was derived from. Sent alongside the hash. */
export type IdBasis = 'remote' | 'root' | 'cwd';

/**
 * Normalise a git remote so every clone of one repo yields one identity.
 *
 * git@github.com:foo/bar.git, https://github.com/foo/bar.git and
 * https://x-token:abc@github.com/foo/bar all become github.com/foo/bar. Without
 * this, cloning over SSH instead of HTTPS would count as a second project, and
 * rotating a token embedded in the URL would count as a third.
 *
 * Stripping credentials is also why the token in a URL is never hashed: the
 * digest stays stable across rotation, and nothing derived from a secret is
 * sent even in one-way form.
 */
export function normaliseRemote(url: string): string {
  let s = url.trim();
  if (!s) return '';
  s = s.replace(/^[a-z+]+:\/\//i, '');          // scheme
  s = s.replace(/^[^@/]*@/, '');                 // user[:password]@
  s = s.replace(/^([^/:]+):(?!\d)/, '$1/');      // scp form host:path -> host/path
  s = s.replace(/^([^/]+):\d+\//, '$1/');        // host:port/ -> host/
  // Trailing slashes first. A URL ending ".git/" leaves the suffix behind if
  // .git$ is anchored before the slash is gone, and the same repo then counts
  // twice depending on whether someone copied the URL with a slash.
  s = s.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  return s.toLowerCase();
}

function git(args: string[], cwd: string): string | null {
  try {
    const r = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 500,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (r.status !== 0) return null;
    const out = String(r.stdout ?? '').trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * A project identity that survives the directory it was run from.
 *
 * WHY THIS EXISTS. The identity used to be sha256(cwd). In CI and under npx the
 * working directory is an ephemeral temp path, so every invocation minted a new
 * one: on 5 August 2,395 CLI calls produced 2,340 distinct "repos". The adoption
 * numbers built on that denominator were counting directories, and
 * `returning_repos_30d` could not rise above noise no matter who came back.
 *
 * Order is most-stable-first:
 *   remote  the origin URL, normalised. Identical across clones, machines and
 *           CI runs, which is what "distinct project" should mean.
 *   root    the repository toplevel, for a checkout with no remote. Stable
 *           across runs in that checkout, not across machines.
 *   cwd     no git at all. The old behaviour, kept as a floor rather than
 *           dropping the ping, and now labelled so it can be excluded.
 *
 * The basis is reported with the hash. A population that is mostly `cwd` is not
 * in a git repo, which is itself the answer to whether these are developers.
 *
 * PRIVACY IS UNCHANGED IN KIND AND WIDER IN EFFECT. Still one-way, still never
 * transmitting the source value. Note that two people working on the same public
 * repo now share an identity, which is correct for counting projects and worth
 * stating plainly rather than discovering later.
 */
export function projectIdentity(cwd: string): { hash: string; basis: IdBasis } {
  const remote = git(['config', '--get', 'remote.origin.url'], cwd);
  const normalised = remote ? normaliseRemote(remote) : '';
  if (normalised) return { hash: repoHash(`remote:${normalised}`), basis: 'remote' };

  const root = git(['rev-parse', '--show-toplevel'], cwd);
  if (root) return { hash: repoHash(`root:${root}`), basis: 'root' };

  return { hash: repoHash(cwd), basis: 'cwd' };
}

/** Commands that emit surface_active (must match /^[a-z_-]{1,32}$/ on the backend). */
export const CLI_TELEMETRY_COMMANDS = [
  'setup',
  'guard',
  'mark',
  'verify',
  'verify-record',
  'sign-record',
  'discover',
  'init',
  'check',
  'login',
] as const;

const pending: Promise<unknown>[] = [];

/** True when a flush would wait on the network. */
export function hasPendingTelemetry(): boolean {
  return pending.length > 0;
}

/**
 * Drain in-flight telemetry before process.exit. No-op (zero wait) when nothing
 * is queued — including when DO_NOT_TRACK / LEGALITHM_TELEMETRY suppressed emit.
 */
export async function flushTelemetry(timeoutMs = 200): Promise<void> {
  if (pending.length === 0) return;
  const batch = Promise.allSettled(pending.splice(0, pending.length));
  await Promise.race([batch, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}

function enqueueTrack(apiUrl: string, body: object): void {
  const p = fetch(`${apiUrl}/api/v1/analytics/track`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then(
    () => {},
    () => {},
  );
  pending.push(p);
}

/** Fire-and-forget surface_active ping — never throws, never blocks the command. */
export function emitSurfaceActive(
  apiUrl: string,
  command: string,
  cwd: string,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): void {
  if (!telemetryEnabled(env)) return;
  const { hash, basis } = projectIdentity(cwd);
  enqueueTrack(apiUrl, {
    event: 'surface_active',
    metadata: { surface: 'cli', command, repoHash: hash, idBasis: basis },
  });
}

/**
 * P1 save/share probe — answer is y|n only (never free text).
 * Queued the same way as surface_active so flushTelemetry drains it.
 */
export function emitCliSaveShare(
  apiUrl: string,
  command: 'init' | 'check',
  cwd: string,
  answer: 'y' | 'n',
  env: Partial<NodeJS.ProcessEnv> = process.env,
): void {
  if (!telemetryEnabled(env)) return;
  const { hash, basis } = projectIdentity(cwd);
  enqueueTrack(apiUrl, {
    event: 'cli_save_share',
    metadata: { surface: 'cli', command, answer, repoHash: hash, idBasis: basis },
  });
}
