import { buildInventory } from '../detect.js';
import type { StackDetectionResult, InventoryItem } from '../types.js';

/** The subset of the created AI-system the CLI reports back. */
export interface CreatedSystem {
  id?: string;
  riskTier?: string;
  [key: string]: unknown;
}

export interface RunDiscoverDeps {
  /** Repo scan → detection (injected so it can be unit-tested without a filesystem). */
  detect: () => StackDetectionResult;
  name: string;
  /** Present only when --push is set AND an API key exists. */
  push?: (item: InventoryItem) => Promise<CreatedSystem>;
  json: boolean;
  log?: (msg: string) => void;
}

export interface RunDiscoverResult {
  exitCode: number;
  item: InventoryItem;
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

  return { exitCode: pushError ? 3 : 0, item };
}
