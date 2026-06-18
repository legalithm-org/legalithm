// Anonymous, opt-out usage telemetry. Sends only { surface, command, repoHash } —
// repoHash is a one-way hash of the cwd path (the path never leaves the machine).
import { createHash } from 'crypto';

export function telemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DO_NOT_TRACK !== '1' && env.LEGALITHM_TELEMETRY !== '0';
}

/** Stable, anonymous per-repo id: sha256(cwd) truncated to 16 hex. */
export function repoHash(cwd: string): string {
  return createHash('sha256').update(cwd).digest('hex').slice(0, 16);
}

/** Fire-and-forget surface_active ping — never throws, never blocks the command. */
export function emitSurfaceActive(
  apiUrl: string,
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!telemetryEnabled(env)) return;
  void fetch(`${apiUrl}/api/v1/analytics/track`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event: 'surface_active', metadata: { surface: 'cli', command, repoHash: repoHash(cwd) } }),
  }).then(
    () => {},
    () => {},
  );
}
