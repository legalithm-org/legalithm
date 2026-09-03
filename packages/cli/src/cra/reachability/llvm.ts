/**
 * The LLVM IR analyser: the substrate the spike validated 3/3 on.
 *
 * Everything specific to it lives here, and nothing here is imported by the
 * assessment. Spawning python3, the `--verdict` flag, the `VEX STATUS:` line
 * and the numbered call-path format are all this analyser's private business.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type {
  AnalyserFinding,
  AnalyserQuery,
  Availability,
  ReachabilityAnalyser,
  VexStatus,
} from './analyser.js';

/** Where the analyser lives in a checkout. Absent from the published package. */
export function defaultAnalyserPath(cwd: string): string {
  return join(cwd, 'research', 'cra-reachability', 'ir_callgraph.py');
}

export interface LlvmOptions {
  /** Directories of .ll files, product first then dependencies. */
  irDirs: string[];
  analyserPath: string;
  /** Injected in tests so nothing spawns a process. */
  run?: (args: string[]) => { status: number | null; stdout: string; stderr: string };
}

function parseCallPath(stdout: string): string[] | undefined {
  const lines = stdout.split('\n');
  const start = lines.findIndex((l) => /call path, depth/.test(l));
  if (start === -1) return undefined;
  const path: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const m = /^\s*\d+\.\s+(\S+)/.exec(line);
    if (!m) break;
    path.push(m[1]!);
  }
  return path.length ? path : undefined;
}

export function llvmAnalyser(opts: LlvmOptions): ReachabilityAnalyser {
  return {
    id: 'llvm-ir',
    name: 'LLVM IR call graph',
    ecosystems: ['c', 'c++', 'cpp', 'objective-c', 'rust-llvm'],

    /**
     * The over-approximation the spike relies on. It is deliberately generous:
     * an unresolved indirect call is assumed to reach every address-taken
     * function, so the analysis errs toward `affected`. A false `affected`
     * costs review time; a false `not_affected` is a vulnerability a
     * manufacturer told an authority they did not have.
     */
    soundnessNote:
      'under the sound over-approximation in which every unresolved function pointer may ' +
      'call any address-taken function',

    available(): Availability {
      if (!existsSync(opts.analyserPath)) {
        return { ok: false, reason: `analyser not found at ${opts.analyserPath}` };
      }
      if (!opts.irDirs.length) {
        return { ok: false, reason: 'no LLVM IR directories supplied (--ir)' };
      }
      return { ok: true };
    },

    analyse(query: AnalyserQuery): AnalyserFinding {
      const args = [
        opts.analyserPath,
        '--entry',
        query.entry,
        '--target',
        query.target,
        '--verdict',
        ...opts.irDirs,
      ];
      const res = opts.run
        ? opts.run(args)
        : (() => {
            const r = spawnSync('python3', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
            return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
          })();

      const m = /VEX STATUS:\s*(not_affected|affected|under_investigation)/.exec(res.stdout);
      const status = (m?.[1] as VexStatus | undefined) ?? null;
      const callPath = parseCallPath(res.stdout);
      return { status, ...(callPath ? { callPath } : {}) };
    },
  };
}
