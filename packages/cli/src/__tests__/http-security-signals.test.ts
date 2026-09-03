/**
 * The two signals the HTTP layer carries for Annex I Part I (2)(c) and (2)(d).
 *
 * Both ride on requests the CLI already makes. Neither adds an endpoint, which
 * is the constraint the whole design was chosen under.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { postJson, onAuthFailure, latestVersionSeen, resetLatestVersionSeen, CliHttpError } from '../http.js';

const json = (body: unknown, status = 200) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetLatestVersionSeen();
  onAuthFailure(null);
});
afterEach(() => {
  fetchSpy?.mockRestore();
  onAuthFailure(null);
});

describe('(2)(d) a rejected key is reported', () => {
  it('fires the hook on 401, with the URL that rejected it', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({}, 401));
    const seen: string[] = [];
    onAuthFailure((url) => seen.push(url));

    await expect(postJson('https://api.example/x', {}, 'lgl_bad')).rejects.toBeInstanceOf(CliHttpError);
    expect(seen).toEqual(['https://api.example/x']);
  });

  it('does not fire on other failures, which are not access signals', async () => {
    const seen: string[] = [];
    onAuthFailure((url) => seen.push(url));
    for (const status of [429, 500]) {
      fetchSpy?.mockRestore();
      fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({}, status));
      await expect(postJson('https://api.example/x', {}, 'k')).rejects.toBeInstanceOf(CliHttpError);
    }
    expect(seen).toEqual([]);
  });

  // A unit test of this module must never append to the real user's log, which
  // is exactly why the write is a hook rather than an import.
  it('does nothing at all when no hook is registered', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({}, 401));
    await expect(postJson('https://api.example/x', {}, 'k')).rejects.toBeInstanceOf(CliHttpError);
  });
});

describe('(2)(c) the version rides on responses that already happen', () => {
  it('captures latestVersion from a successful response', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ risk: 'high', latestVersion: '0.7.0' }));
    const result = await postJson<{ risk: string }>('https://api.example/x', {}, 'k');
    expect(result.risk).toBe('high');
    expect(latestVersionSeen()).toBe('0.7.0');
  });

  it('ignores a server that does not send one, rather than failing the command', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ risk: 'high' }));
    await postJson('https://api.example/x', {}, 'k');
    expect(latestVersionSeen()).toBeNull();
  });

  it('ignores a non-string, because an old or hostile server is not a crash', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ latestVersion: { evil: true } }));
    await postJson('https://api.example/x', {}, 'k');
    expect(latestVersionSeen()).toBeNull();
  });
});
