// Minimal fetch wrapper. Maps transport + status failures to a typed error so
// commands can exit 3 with a human message — never a false "compliant", never a stack trace.

export type HttpErrorKind = 'auth' | 'rate' | 'api' | 'network';

/**
 * Called when the API rejects a key. Annex I Part I (2)(d) asks the product to
 * "report on possible unauthorised access", and a 401 from a key this machine
 * holds is the only signal of that this product ever sees.
 *
 * A hook rather than a direct write, so this module keeps doing one thing and so
 * that a unit test of the HTTP layer does not append to the real user's log.
 */
let authFailureHook: ((url: string) => void) | null = null;
export function onAuthFailure(fn: ((url: string) => void) | null): void {
  authFailureHook = fn;
}

/**
 * The newest version the server has mentioned, for Annex I Part I (2)(c)'s
 * "notification of available updates".
 *
 * It rides on responses the CLI was already making. The alternative, polling the
 * npm registry, would have added a fifth outbound endpoint to a product whose
 * position is that your dependency list never leaves the machine, and would have
 * put a network call inside commands that are otherwise entirely offline. The
 * cost of this choice is real and is stated where it matters: a user who never
 * runs an authenticated command is never notified.
 */
let serverLatestVersion: string | null = null;
export function latestVersionSeen(): string | null {
  return serverLatestVersion;
}
export function resetLatestVersionSeen(): void {
  serverLatestVersion = null;
}

export class CliHttpError extends Error {
  constructor(
    public kind: HttpErrorKind,
    message: string,
    public status?: number,
    /**
     * The parsed error body, when the server sent one.
     *
     * The ingest endpoint refuses with a REASON — an unsupported tool version,
     * an adapter that tried to assert something its method may not. "API
     * returned 422" hides exactly the sentence the person running it needs, and
     * a CI log that says only the status code sends them to a dashboard to find
     * out what happened.
     */
    public body?: unknown,
  ) {
    super(message);
    this.name = 'CliHttpError';
  }
}

/** Read the server's error body without letting a malformed one mask the status. */
async function errorBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

export async function postJson<T>(url: string, body: unknown, apiKey: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CliHttpError('network', `Could not reach the Legalithm API at ${url}.`);
  }

  if (res.status === 401) {
    authFailureHook?.(url);
    throw new CliHttpError('auth', 'Invalid or missing API key (set LEGALITHM_API_KEY or run `legalithm login`).', 401);
  }
  if (res.status === 429) throw new CliHttpError('rate', 'Rate limit exceeded — retry in a moment.', 429);
  if (!res.ok) {
    throw new CliHttpError('api', `Legalithm API returned ${res.status}.`, res.status, await errorBody(res));
  }

  const parsed = (await res.json()) as T;

  // Read opportunistically: a server that does not send it simply never
  // notifies, which is why nothing here throws or validates hard.
  const meta = parsed as { latestVersion?: unknown } | null;
  if (meta && typeof meta === 'object' && typeof meta.latestVersion === 'string') {
    serverLatestVersion = meta.latestVersion;
  }

  return parsed;
}

export async function getJson<T>(url: string, apiKey: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${apiKey}` } });
  } catch {
    throw new CliHttpError('network', `Could not reach the Legalithm API at ${url}.`);
  }

  if (res.status === 401) {
    authFailureHook?.(url);
    throw new CliHttpError('auth', 'Invalid or missing API key (set LEGALITHM_API_KEY or run `legalithm login`).', 401);
  }
  if (res.status === 429) throw new CliHttpError('rate', 'Rate limit exceeded — retry in a moment.', 429);
  if (!res.ok) {
    throw new CliHttpError('api', `Legalithm API returned ${res.status}.`, res.status, await errorBody(res));
  }

  return (await res.json()) as T;
}
