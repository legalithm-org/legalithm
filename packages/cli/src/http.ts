// Minimal fetch wrapper. Maps transport + status failures to a typed error so
// commands can exit 3 with a human message — never a false "compliant", never a stack trace.

export type HttpErrorKind = 'auth' | 'rate' | 'api' | 'network';

export class CliHttpError extends Error {
  constructor(public kind: HttpErrorKind, message: string, public status?: number) {
    super(message);
    this.name = 'CliHttpError';
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

  if (res.status === 401) throw new CliHttpError('auth', 'Invalid or missing API key (set LEGALITHM_API_KEY or run `legalithm login`).', 401);
  if (res.status === 429) throw new CliHttpError('rate', 'Rate limit exceeded — retry in a moment.', 429);
  if (!res.ok) throw new CliHttpError('api', `Legalithm API returned ${res.status}.`, res.status);

  return (await res.json()) as T;
}
