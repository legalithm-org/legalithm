import { buildInventory } from '../detect.js';
import type { StackDetectionResult, InventoryItem } from '../types.js';
import type { ScanResult } from '../discovery/scan.js';
import { daysBetween } from '../discovery/scope-map.js';

/**
 * CONVERGED ONTO THE SHARED ENGINE.
 *
 * `discover` used to answer entirely from detect.ts, whose Article 50 output
 * was `likelyArticle50: boolean` — one flag for a provision that is five duties
 * on two parties. lib/discovery/ answers the same question with capabilities,
 * limbs, dates and duty-bearers, and is vendored here byte-identically by
 * scripts/generate-cli-discovery.ts.
 *
 * detect.ts keeps the jobs the shared engine does not do: framework and PII
 * signals, agent profiles, and the inventory shape the /ai-systems API expects.
 * The split is by responsibility, not by history: one engine decides what
 * Article 50 says, and one adapter decides what the inventory record looks like.
 */

/** The subset of the created AI-system the CLI reports back. */
export interface CreatedSystem {
  id?: string;
  riskTier?: string;
  [key: string]: unknown;
}

export interface RunDiscoverDeps {
  /** Repo scan → detection (injected so it can be unit-tested without a filesystem). */
  detect: () => StackDetectionResult;
  /** The shared discovery engine's view. Optional so existing callers still work. */
  scan?: () => ScanResult;
  /** Today, injected so the day counts are testable. */
  asOf?: string;
  name: string;
  /** Present only when --push is set AND an API key exists. */
  push?: (item: InventoryItem) => Promise<CreatedSystem>;
  json: boolean;
  log?: (msg: string) => void;
}

export interface RunDiscoverResult {
  exitCode: number;
  item: InventoryItem;
  scan?: ScanResult;
}

/**
 * P2-B1: auto-discovery. Scans the repo's detected AI stack, builds a proposed
 * AI-system inventory, prints it, and (with --push) registers it via
 * POST /api/v1/ai-systems. Exit codes: 0 ok · 3 push failed.
 */
export async function runDiscover(deps: RunDiscoverDeps): Promise<RunDiscoverResult> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const detection = deps.detect();
  const item = buildInventory(detection, deps.name);
  const scanResult = deps.scan?.();
  const asOf = deps.asOf ?? new Date().toISOString().slice(0, 10);

  let created: CreatedSystem | null = null;
  let pushError: string | null = null;
  if (deps.push) {
    try {
      created = await deps.push(item);
    } catch (e) {
      pushError = (e as Error).message;
    }
  }

  if (deps.json) {
    log(
      JSON.stringify(
        {
          signals: detection.signals,
          inferred: detection.inferred,
          proposed: item,
          ...(scanResult
            ? {
                capabilities: scanResult.hypotheses,
                article50: scanResult.scope?.duties ?? [],
                requiresHumanConfirmation: true,
              }
            : {}),
          pushed: Boolean(created),
          ...(created ? { system: created } : {}),
          ...(pushError ? { error: pushError } : {}),
        },
        null,
        2,
      ),
    );
  } else {
    log('Detected AI-relevant stack:');
    if (detection.signals.length === 0) {
      log('  (none found)');
    } else {
      for (const s of detection.signals) {
        const hint = s.aiActHint !== 'none' ? `, ${s.aiActHint}` : '';
        log(`  - ${s.kind}: ${s.evidence} (${s.confidence}${hint})`);
      }
    }
    if (scanResult && scanResult.hypotheses.length > 0) {
      log('');
      log('AI capabilities this code could ship (hypotheses, not findings):');
      for (const h of scanResult.hypotheses) {
        const where = h.evidence[0];
        const at = where ? ` — ${where.file}${where.line ? `:${where.line}` : ''}` : '';
        log(`  - ${h.capability} (${h.confidence})${at}`);
      }
      const duties = scanResult.scope?.duties ?? [];
      if (duties.length > 0) {
        log('');
        log('If confirmed, these Article 50 duties attach:');
        for (const d of duties) {
          const days = daysBetween(asOf, d.appliesFrom);
          const when = days <= 0 ? 'live now' : `from ${d.appliesFrom} (${days} days)`;
          const whose =
            d.bearer === 'you' ? 'yours' : d.bearer === 'upstream_provider' ? "your vendor's" : "your customer's";
          log(`  - Art. ${d.paragraph}: ${whose}, ${when}`);
        }
      }
      log('');
      log('  Confirm each capability against what you actually ship. A dependency');
      log('  proves what this code could do, never what it does.');
    }

    log('');
    log('Proposed AI system:');
    log(`  name:     ${item.name}`);
    log(`  role:     ${item.role}`);
    log(`  category: ${item.category}`);
    log(`  purpose:  ${item.purpose ?? ''}`);
    if (item.agentProfile) {
      log('  agentProfile:');
      log(`    principalName:    ${item.agentProfile.principalName ?? 'not yet declared'}`);
      log(`    principalType:    ${item.agentProfile.principalType ?? 'not yet declared'}`);
      log(`    authorityScope:   ${item.agentProfile.authorityScope ?? 'not yet declared'}`);
      log(`    autonomyLevel:    ${item.agentProfile.autonomyLevel ?? 'not yet declared'}`);
      log(`    tools:            ${item.agentProfile.tools.length ? item.agentProfile.tools.join(', ') : '(none detected)'}`);
    }
    log(detection.disclaimer);
    if (!deps.push) {
      log('\nRun `legalithm discover --push` (with a login/API key) to add it to your Legalithm inventory.');
    } else if (created) {
      log(`\n✓ Registered "${item.name}"${created.riskTier ? ` — classified ${created.riskTier} risk` : ''}.`);
    } else if (pushError) {
      log(`\n✗ Could not register: ${pushError}`);
    }
  }

  return { exitCode: pushError ? 3 : 0, item, ...(scanResult ? { scan: scanResult } : {}) };
}
