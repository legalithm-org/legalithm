/**
 * Exploitation intelligence beyond KEV: feature 4.
 *
 * KEV answers "is anyone exploiting this in the wild". It is authoritative and
 * small. Two things it cannot do: rank the rest of your findings, and tell you
 * about a vulnerability nobody has weaponised yet. EPSS and OSV cover those.
 *
 * THE RULE THAT SHAPES THIS FILE: whole dataset in, local join. Never a
 * per-item query.
 *
 * Both services offer a convenient lookup endpoint — ask EPSS about one CVE,
 * ask OSV about one package. Using them would send your CVE list or your SBOM
 * to a third party, and a list of the vulnerabilities in your product is a map
 * of how to attack it. That is precisely the artifact decision 4 says never
 * leaves the customer. So the datasets are downloaded whole (they are public
 * and reveal nothing about who fetched them) or supplied from a local path,
 * and the join happens here.
 *
 * A test asserts no per-item query URL exists in this file, because the
 * convenient thing is one line away and would be a silent privacy regression.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

/** Full daily EPSS export. Not the per-CVE lookup endpoint. */
export const EPSS_FULL_CSV = 'https://epss.empiricalsecurity.com/epss_scores-current.csv.gz';

export interface EpssScore {
  /** Probability of exploitation in the next 30 days, 0..1. */
  epss: number;
  /** Where that sits against every scored CVE, 0..1. */
  percentile: number;
}

/**
 * Parse the EPSS daily CSV. The first line is a `#model_version` comment, the
 * second is the header.
 */
export function parseEpssCsv(text: string): Map<string, EpssScore> {
  const out = new Map<string, EpssScore>();
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith('#') || l.startsWith('cve,')) continue;
    const [cve, epss, percentile] = l.split(',');
    if (!cve || !epss) continue;
    const e = Number(epss);
    const p = Number(percentile);
    if (Number.isNaN(e)) continue;
    out.set(cve.toUpperCase(), { epss: e, percentile: Number.isNaN(p) ? 0 : p });
  }
  return out;
}

export function loadEpss(path: string): Map<string, EpssScore> {
  const raw = path.endsWith('.gz') ? gunzipSync(readFileSync(path)).toString('utf8') : readFileSync(path, 'utf8');
  return parseEpssCsv(raw);
}

export async function fetchEpss(fetchImpl: typeof fetch = fetch): Promise<Map<string, EpssScore>> {
  const res = await fetchImpl(EPSS_FULL_CSV);
  if (!res.ok) throw new Error(`EPSS fetch failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return parseEpssCsv(gunzipSync(buf).toString('utf8'));
}

// ------------------------------------------------------------------- OSV ---

export interface OsvRecord {
  id: string;
  aliases?: string[];
  summary?: string;
  affected?: {
    package?: { name?: string; ecosystem?: string };
    versions?: string[];
  }[];
}

export interface OsvMatch {
  osvId: string;
  cve: string | null;
  component: string;
  version: string;
  /** exact = the version is listed as affected; name_only = version unverified. */
  confidence: 'exact' | 'name_only';
  summary?: string;
}

/** Accepts an OSV export: an array, or `{vulns: []}`, or newline-delimited JSON. */
export function parseOsvDump(text: string): OsvRecord[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) return JSON.parse(trimmed) as OsvRecord[];
  // Newline-delimited JSON also starts with '{', so a single-object parse is
  // tried first and NDJSON is the fallback. Branching on the first character
  // alone silently mis-parsed every NDJSON dump.
  if (trimmed.startsWith('{')) {
    try {
      const doc = JSON.parse(trimmed) as { vulns?: OsvRecord[] } & OsvRecord;
      return Array.isArray(doc.vulns) ? doc.vulns : [doc];
    } catch {
      // fall through to NDJSON
    }
  }
  return trimmed
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as OsvRecord);
}

export function loadOsv(path: string): OsvRecord[] {
  const raw = path.endsWith('.gz') ? gunzipSync(readFileSync(path)).toString('utf8') : readFileSync(path, 'utf8');
  return parseOsvDump(raw);
}

function cveOf(rec: OsvRecord): string | null {
  if (/^CVE-/i.test(rec.id)) return rec.id.toUpperCase();
  return (rec.aliases ?? []).find((a) => /^CVE-/i.test(a))?.toUpperCase() ?? null;
}

/**
 * Join components against an OSV dump, locally.
 *
 * Version matching is exact against the `versions` list. Range expressions are
 * NOT evaluated: doing it badly produces false negatives, and a false negative
 * here is a vulnerability you were told you did not have. A name match with an
 * unconfirmed version is reported as `name_only` so it reads as "check this",
 * never as a clean result.
 */
export function matchOsv(
  components: { component: string; version: string }[],
  records: OsvRecord[],
): OsvMatch[] {
  const byName = new Map<string, { component: string; version: string }[]>();
  for (const c of components) {
    const k = c.component.toLowerCase();
    const list = byName.get(k) ?? [];
    list.push(c);
    byName.set(k, list);
  }

  const matches: OsvMatch[] = [];
  for (const rec of records) {
    for (const aff of rec.affected ?? []) {
      const name = aff.package?.name?.toLowerCase();
      if (!name) continue;
      for (const c of byName.get(name) ?? []) {
        const listed = aff.versions ?? [];
        const exact = listed.includes(c.version);
        if (listed.length && !exact) continue;
        matches.push({
          osvId: rec.id,
          cve: cveOf(rec),
          component: c.component,
          version: c.version,
          confidence: exact ? 'exact' : 'name_only',
          ...(rec.summary ? { summary: rec.summary } : {}),
        });
      }
    }
  }
  return matches;
}

/**
 * Rank findings for the analyst queue.
 *
 * KEV first: known exploitation outranks any prediction. Then EPSS descending.
 * EPSS is a probability, not a verdict, and it never discharges anything: a low
 * score means "deprioritise", never "not affected". Only a reachability verdict
 * signed by a person does that.
 */
export function prioritise<T extends { cve: string }>(
  findings: T[],
  kev: Set<string>,
  epss: Map<string, EpssScore>,
): (T & { inKev: boolean; epss?: number; priority: number })[] {
  return findings
    .map((f) => {
      const cve = f.cve.toUpperCase();
      const inKev = kev.has(cve);
      const score = epss.get(cve)?.epss;
      return { ...f, inKev, ...(score !== undefined ? { epss: score } : {}), priority: inKev ? 1000 : (score ?? 0) };
    })
    .sort((a, b) => b.priority - a.priority);
}
