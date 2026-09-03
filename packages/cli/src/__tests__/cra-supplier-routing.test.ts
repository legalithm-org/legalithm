import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  craProduct, craIngest, craSupplierRequest, craSupplierAttest,
  craSupplierDiscover, craSupplierStatus,
} from '../cra/commands.js';
import { contactFromManifest, summariseRequests } from '../cra/supplier.js';
import { readStream } from '../cra/store.js';

/**
 * The half of decision 9 that turns file exchange into a network without
 * turning it into a platform: knowing WHO to ask, and what is still outstanding.
 *
 * The constraint that shapes it: no registry lookups. Asking npm about each
 * component to find its maintainer would hand over the whole dependency list one
 * request at a time, which is the same leak the local OSV join exists to avoid.
 * Everything needed is already in the manifests on disk.
 */
let dir: string;
let modules: string;
let key: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({
  cwd: dir,
  log: (m: string) => out.push(m),
  error: (m: string) => err.push(m),
  now: () => new Date('2026-08-16T02:00:00Z'),
});
const said = () => out.join('\n');

function installFake(name: string, manifest: Record<string, unknown>) {
  const d = join(modules, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'package.json'), JSON.stringify({ name, ...manifest }), 'utf8');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cra-route-'));
  modules = join(dir, 'node_modules');
  key = join(dir, 'sup.key');
  const { privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(key, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, 'utf8');

  craProduct(io(), { name: 'Widget', version: '1.0.0' });
  writeFileSync(
    join(dir, 'sbom.json'),
    JSON.stringify({
      bomFormat: 'CycloneDX',
      components: [
        { name: 'semver', version: '7.8.5' },
        { name: 'node-fetch', version: '2.7.0' },
        { name: 'ghost-pkg', version: '1.0.0' },
      ],
    }),
  );
  craIngest(io(), { sbom: join(dir, 'sbom.json') });

  // Real manifest shapes, sampled from this repo's own tree.
  installFake('semver', { repository: 'git+https://github.com/npm/node-semver.git', author: 'GitHub Inc.' });
  installFake('node-fetch', {
    repository: 'https://github.com/bitinn/node-fetch.git',
    bugs: { url: 'https://github.com/bitinn/node-fetch/issues' },
    author: 'David Frank',
  });
  // ghost-pkg deliberately not installed: an unroutable component.
  out.length = 0;
  err.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('working out who to ask, from local data only', () => {
  it('prefers the issue tracker, which is where a maintainer looks', () => {
    const c = contactFromManifest('node-fetch', {
      repository: 'https://github.com/bitinn/node-fetch.git',
      bugs: { url: 'https://github.com/bitinn/node-fetch/issues' },
    });
    expect(c.route).toBe('https://github.com/bitinn/node-fetch/issues');
  });

  it('tidies the git URL forms npm manifests actually use', () => {
    const c = contactFromManifest('semver', { repository: 'git+https://github.com/npm/node-semver.git' });
    expect(c.route).toBe('https://github.com/npm/node-semver');
  });

  it('reports an unroutable component as a gap rather than guessing', () => {
    expect(craSupplierDiscover(io(), { modules })).toBe(0);
    expect(said()).toContain('2 of 3 component(s) can be routed');
    expect(said()).toContain('ghost-pkg');
    expect(said()).toContain('not installed here');
    // A wrong address looks like you asked. That is worse than no address.
    // Asserted per line, because the message wraps across two log calls.
    expect(said()).toContain('A wrong address is worse');
    expect(said()).toContain('looks like you asked');
  });

  it('says out loud that it used no network', () => {
    craSupplierDiscover(io(), { modules });
    expect(said()).toContain('No network was used');
  });

  it('refuses without manifests, and explains why it will not just ask npm', () => {
    err.length = 0;
    expect(craSupplierDiscover(io(), { modules: join(dir, 'nope') })).toBe(1);
    expect(err.join('\n')).toContain('hand your dependency list over');
  });
});

describe('tracking what is still outstanding', () => {
  const ask = (component: string) =>
    craSupplierRequest(io(), {
      component,
      componentVersion: '1.0.0',
      cve: 'CVE-2021-0000',
      by: 'Acme GmbH',
      out: join(dir, `req-${component}.json`),
    });

  it('records every request, so an unanswered one is still evidence', () => {
    ask('semver');
    expect(readStream(dir, 'requests')).toHaveLength(1);

    out.length = 0;
    craSupplierStatus(io(), {});
    expect(said()).toContain('1 asked, 0 answered, 1 outstanding');
    // "We asked and heard nothing" is due diligence, not a blank.
    expect(said()).toContain('evidence of due diligence');
  });

  it('marks one answered once the attestation is ingested', () => {
    ask('semver');
    ask('lodash');
    craSupplierAttest(io(), {
      request: join(dir, 'req-semver.json'),
      verdict: 'not_affected',
      rationale: 'Our parser never receives untrusted range strings.',
      by: 'Ana Ruiz',
      org: 'npm Inc.',
      key,
      keyId: 'npm-inc-2026',
      out: join(dir, 'att.json'),
    });
    craIngest(io(), { attestation: join(dir, 'att.json') });
    out.length = 0;

    craSupplierStatus(io(), {});
    expect(said()).toContain('2 asked, 1 answered, 1 outstanding');
    expect(said()).toContain('answered by Ana Ruiz');
  });

  it('matches answers on the component, because an attestation names no requester', () => {
    /*
     * The reusability property has a consequence here: an attestation cannot
     * point back at the request that prompted it, so the join is on
     * (component, cve). That is intended. A supplier's answer about a component
     * settles the question for anyone who asked it, including people who asked
     * later.
     */
    const rows = summariseRequests(
      [{ body: { component: 'semver', componentVersion: '7.8.5', cve: 'CVE-2021-0000', requestedBy: 'Acme' }, observedAt: '2026-08-01T00:00:00Z' }],
      [{ component: 'SemVer', cve: 'cve-2021-0000', declaredBy: 'Ana Ruiz' }],
      new Date('2026-08-16T00:00:00Z'),
    );
    expect(rows[0]!.answered).toBe(true);
    expect(rows[0]!.answeredBy).toBe('Ana Ruiz');
  });

  it('ages an outstanding request from when it was FIRST asked', () => {
    // Asking again must not reset the clock; that would hide a stale request by
    // re-sending it.
    const rows = summariseRequests(
      [
        { body: { component: 'lodash', componentVersion: '1', cve: 'CVE-1', requestedBy: 'Acme' }, observedAt: '2026-07-01T00:00:00Z' },
        { body: { component: 'lodash', componentVersion: '1', cve: 'CVE-1', requestedBy: 'Acme' }, observedAt: '2026-08-15T00:00:00Z' },
      ],
      [],
      new Date('2026-08-16T00:00:00Z'),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ageDays).toBe(46);
  });

  it('puts outstanding first, oldest first: the work list in working order', () => {
    const rows = summariseRequests(
      [
        { body: { component: 'a', componentVersion: '1', cve: 'CVE-1', requestedBy: 'x' }, observedAt: '2026-08-14T00:00:00Z' },
        { body: { component: 'b', componentVersion: '1', cve: 'CVE-2', requestedBy: 'x' }, observedAt: '2026-06-01T00:00:00Z' },
        { body: { component: 'c', componentVersion: '1', cve: 'CVE-3', requestedBy: 'x' }, observedAt: '2026-08-01T00:00:00Z' },
      ],
      [{ component: 'c', cve: 'CVE-3', declaredBy: 'Someone' }],
      new Date('2026-08-16T00:00:00Z'),
    );
    expect(rows.map((r) => r.component)).toEqual(['b', 'a', 'c']);
  });
});
