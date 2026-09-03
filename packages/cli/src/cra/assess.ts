/**
 * Annex I assessment: feature 6, the last tier-1 gap.
 *
 * Article 6 makes Annex I the condition of being on the market at all, so an
 * assessment against its 22 requirements is what a technical file is built
 * around. Before this, the corpus could state all 22 and the tool could not
 * tell you where you stood on any of them.
 *
 * TWO RULES CARRIED OVER, because they are what make the output evidence
 * rather than a checklist:
 *
 *   1. A requirement is only ever `met` because a NAMED HUMAN said so. There is
 *      no automatic pass. Machines can attach evidence; they cannot conclude.
 *   2. Unanswered is `not_assessed`, never `met`. A gap report whose default is
 *      "fine" tells you nothing and would be worse than no report.
 *
 * The status of a requirement is therefore derived, not stored: it is whatever
 * the latest claim about it says, and absent a claim it is not assessed.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type RequirementStatus = 'met' | 'not_met' | 'not_applicable' | 'not_assessed';

export interface AnnexIRequirement {
  ref: string;
  part: 'I' | 'II';
  title: string;
  description: string;
  evidenceType: string;
}

interface AnnexIFile {
  instrument: string;
  corpusVersion: string;
  corpusUpdatedAt: string;
  requirements: AnnexIRequirement[];
}

/** Resolve packages/cli/data whether running from src (tsx) or dist. */
function dataDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'data');
}

let cached: AnnexIFile | null = null;

export function loadAnnexI(): AnnexIFile {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(join(dataDir(), 'cra-annex-i.json'), 'utf8')) as AnnexIFile;
  return cached;
}

export function annexIRequirements(): AnnexIRequirement[] {
  return loadAnnexI().requirements;
}

export interface RequirementAssessment {
  ref: string;
  part: 'I' | 'II';
  title: string;
  status: RequirementStatus;
  /** Who said so. Absent unless a human claimed it. */
  declaredBy?: string;
  declaredAt?: string;
  rationale?: string;
  /** Machine-attached evidence, which never decides the status. */
  evidenceCount: number;
}

export interface AnnexIReport {
  instrument: string;
  corpusVersion: string;
  total: number;
  counts: Record<RequirementStatus, number>;
  /** Requirements with no human determination. The actual work list. */
  gaps: string[];
  requirements: RequirementAssessment[];
}

export interface AnnexIClaim {
  ref: string;
  status: Exclude<RequirementStatus, 'not_assessed'>;
  declaredBy: string;
  declaredAt: string;
  rationale?: string;
}

export interface AnnexIEvidence {
  ref: string;
}

/**
 * Derive the report. `claims` are human determinations, `evidence` is anything
 * a machine or an import attached. Only the former can move a status.
 */
export function buildAnnexIReport(claims: AnnexIClaim[], evidence: AnnexIEvidence[]): AnnexIReport {
  const file = loadAnnexI();
  const latest = new Map<string, AnnexIClaim>();
  for (const c of claims) {
    const prior = latest.get(c.ref);
    if (!prior || c.declaredAt >= prior.declaredAt) latest.set(c.ref, c);
  }
  const evidenceCounts = new Map<string, number>();
  for (const e of evidence) evidenceCounts.set(e.ref, (evidenceCounts.get(e.ref) ?? 0) + 1);

  const requirements: RequirementAssessment[] = file.requirements.map((r) => {
    const claim = latest.get(r.ref);
    return {
      ref: r.ref,
      part: r.part,
      title: r.title,
      status: claim?.status ?? 'not_assessed',
      ...(claim ? { declaredBy: claim.declaredBy, declaredAt: claim.declaredAt } : {}),
      ...(claim?.rationale ? { rationale: claim.rationale } : {}),
      evidenceCount: evidenceCounts.get(r.ref) ?? 0,
    };
  });

  const counts: Record<RequirementStatus, number> = {
    met: 0,
    not_met: 0,
    not_applicable: 0,
    not_assessed: 0,
  };
  for (const r of requirements) counts[r.status] += 1;

  return {
    instrument: file.instrument,
    corpusVersion: file.corpusVersion,
    total: requirements.length,
    counts,
    gaps: requirements.filter((r) => r.status === 'not_assessed').map((r) => r.ref),
    requirements,
  };
}

/** Article 6 binds both parts, so readiness means both are fully determined. */
export function annexIComplete(report: AnnexIReport): boolean {
  return report.counts.not_assessed === 0 && report.counts.not_met === 0;
}

export function isAnnexIRef(ref: string): boolean {
  return annexIRequirements().some((r) => r.ref === ref);
}
