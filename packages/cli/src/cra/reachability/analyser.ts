/**
 * What a reachability analyser IS, independent of what it analyses.
 *
 * This seam exists for one reason that is not tidiness. Before it, the sentence
 *
 *     "including under the sound over-approximation in which every unresolved
 *      function pointer may call any address-taken function"
 *
 * was hardcoded into the generic `not_affected` rationale. That sentence is
 * true of an LLVM IR call graph and false of everything else. A JVM analyser
 * is unsound in completely different ways: reflection, service loaders,
 * dependency injection and dynamic proxies all create call edges no static
 * pass sees. Plugging a second substrate in without moving that sentence would
 * have printed an LLVM caveat next to a Java verdict, in a document a
 * manufacturer signs and hands to a market surveillance authority.
 *
 * So `soundnessNote` belongs to the analyser. Every analyser must state how it
 * can be wrong, and the assessment quotes it rather than inventing one.
 */

export type VexStatus = 'not_affected' | 'affected' | 'under_investigation';

/** One question: can `target` be reached from `entry`. */
export interface AnalyserQuery {
  entry: string;
  target: string;
}

export interface AnalyserFinding {
  /** null means the analyser ran but produced no verdict. NOT a pass. */
  status: VexStatus | null;
  callPath?: string[];
}

export type Availability = { ok: true } | { ok: false; reason: string };

export interface ReachabilityAnalyser {
  /** Stable id recorded in the evidence. Changing it changes the record. */
  readonly id: string;
  readonly name: string;
  /**
   * Ecosystems this claims to cover. Used to refuse honestly rather than to
   * run the wrong analyser: a C analyser pointed at a jar is not a "no
   * finding", it is an unanswered question.
   */
  readonly ecosystems: readonly string[];
  /**
   * HOW THIS ANALYSER CAN BE WRONG, in a sentence fit for a technical file.
   * Required, because a reachability verdict without its unsoundness stated is
   * an overclaim, and Annex VII expects the assumption written down.
   */
  readonly soundnessNote: string;
  /** Usable right now? On failure, say why: the gap gets stated, not guessed. */
  available(): Availability;
  analyse(query: AnalyserQuery): AnalyserFinding;
}

/**
 * Pick an analyser for an ecosystem.
 *
 * Returns a reason rather than a fallback. Running a substrate's analyser over
 * a language it does not understand yields "nothing reachable", which is the
 * most dangerous possible answer here: it reads as a discharge and is really an
 * absence of analysis.
 */
export function selectAnalyser(
  analysers: readonly ReachabilityAnalyser[],
  ecosystem: string,
): { analyser: ReachabilityAnalyser } | { reason: string } {
  const eco = ecosystem.toLowerCase();
  const match = analysers.find((a) => a.ecosystems.some((e) => e.toLowerCase() === eco));
  if (!match) {
    const known = analysers.flatMap((a) => a.ecosystems).join(', ') || 'none';
    return {
      reason:
        `No reachability analyser covers "${ecosystem}". Installed analysers cover: ${known}. ` +
        'Reachability is therefore undecided for this product, which is not the same as not affected.',
    };
  }
  const availability = match.available();
  if (!availability.ok) return { reason: `${match.name} is not usable: ${availability.reason}` };
  return { analyser: match };
}
