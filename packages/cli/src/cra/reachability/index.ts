/**
 * Reachability, wired into `cra watch`.
 *
 * A KEV match answers "is this component known to be actively exploited". It
 * does not answer the question Annex I Part I(1) actually asks, which is
 * whether the product ships a known EXPLOITABLE vulnerability. Roughly 2% of
 * CVEs are ever exploited, so the value is in defensibly discharging the rest,
 * and that needs reachability rather than presence.
 *
 * THE VERDICT IS A HYPOTHESIS, ALWAYS. The spike showed `not_affected` is where
 * the margin is, and decision 5 says no machine path asserts conformity. Both
 * are satisfied by writing the analyser's verdict to the hypothesis stream with
 * its evidence attached, and letting a named human convert it. The analysis is
 * the expensive part; the signature is the accountable part; they are different
 * acts by different actors.
 *
 * THE SYMBOL MAP IS THE HONEST GAP. Deciding reachability needs the vulnerable
 * function's name, and KEV does not carry one. No open dataset maps CVE to
 * symbol. So the map is supplied by the user, and a CVE with no entry returns
 * `under_investigation` with the reason stated, rather than a guess. That is
 * the market's real missing piece and this surfaces it instead of hiding it.
 *
 * NOTHING IN THIS FILE KNOWS WHAT LLVM IS. It asks a ReachabilityAnalyser
 * whether one symbol reaches another and quotes that analyser's own soundness
 * note. Adding a JVM bytecode analyser is implementing one interface, not
 * editing this logic, and crucially it cannot inherit LLVM's caveat by
 * accident.
 */
import { readFileSync } from 'node:fs';

import type { ReachabilityAnalyser, VexStatus } from './analyser.js';

export * from './analyser.js';
export { llvmAnalyser, defaultAnalyserPath, type LlvmOptions } from './llvm.js';

export interface ReachabilityVerdict {
  status: VexStatus;
  /** Why, in a sentence a person can put in a technical file. */
  rationale: string;
  entry?: string;
  target?: string;
  /** Present when the analyser produced one. */
  callPath?: string[];
  analyser?: string;
}

export interface AssessOptions {
  /** Public entry point to search from. */
  entry: string;
  /** CVE to vulnerable-symbol map. */
  symbols: Record<string, string[]>;
  analyser: ReachabilityAnalyser;
}

export function loadSymbolMap(path: string): Record<string, string[]> {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string[] | string>;
  return Object.fromEntries(
    Object.entries(raw).map(([cve, v]) => [cve.toUpperCase(), Array.isArray(v) ? v : [v]]),
  );
}

/**
 * Decide one CVE. Several vulnerable symbols may map to one CVE; the product is
 * affected if ANY of them is reachable, and only not_affected when every one is
 * unreachable. Taking the first answer would let a second entry point through.
 */
export function assessCve(opts: AssessOptions, cve: string): ReachabilityVerdict {
  const { analyser } = opts;
  const targets = opts.symbols[cve.toUpperCase()];
  if (!targets?.length) {
    return {
      status: 'under_investigation',
      rationale:
        `No vulnerable symbol is mapped for ${cve}, so reachability was not decided. ` +
        'KEV does not carry function names and no open dataset supplies them; add an ' +
        'entry to the symbol map to let this be answered.',
    };
  }

  const availability = analyser.available();
  if (!availability.ok) {
    return {
      status: 'under_investigation',
      rationale: `${analyser.name} is not usable: ${availability.reason}.`,
      analyser: analyser.id,
    };
  }

  const unreachable: string[] = [];
  for (const target of targets) {
    const { status, callPath } = analyser.analyse({ entry: opts.entry, target });
    if (status === 'affected') {
      return {
        status: 'affected',
        rationale:
          `${target} is reachable from ${opts.entry}. A call path exists, so the ` +
          'vulnerability is not discharged by reachability.',
        entry: opts.entry,
        target,
        ...(callPath ? { callPath } : {}),
        analyser: analyser.id,
      };
    }
    if (status === 'not_affected') {
      unreachable.push(target);
      continue;
    }
    return {
      status: 'under_investigation',
      rationale:
        `${analyser.name} did not return a verdict for ${target}. Treat as undecided rather ` +
        'than as not affected.',
      entry: opts.entry,
      target,
      analyser: analyser.id,
    };
  }

  return {
    status: 'not_affected',
    rationale:
      `${unreachable.join(', ')} unreachable from ${opts.entry}, including ` +
      // The analyser's OWN caveat. Hardcoding one here is how a Java verdict
      // would end up carrying an LLVM function-pointer disclaimer.
      `${analyser.soundnessNote}. State that assumption in the technical file.`,
    entry: opts.entry,
    analyser: analyser.id,
  };
}
