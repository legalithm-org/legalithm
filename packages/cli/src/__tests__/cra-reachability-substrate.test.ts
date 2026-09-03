import { describe, it, expect } from 'vitest';
import {
  assessCve,
  llvmAnalyser,
  selectAnalyser,
  type AnalyserFinding,
  type AnalyserQuery,
  type ReachabilityAnalyser,
} from '../cra/reachability/index.js';

/**
 * A second substrate that does not exist yet, standing in for the JVM analyser.
 *
 * It is here to prove the seam is real. If plugging in a non-LLVM analyser
 * required editing the assessment, or if its verdict inherited LLVM's
 * function-pointer caveat, these tests would fail and the split would be
 * decoration.
 */
function fakeJvmAnalyser(opts: {
  answers: Record<string, AnalyserFinding>;
  usable?: boolean;
}): ReachabilityAnalyser {
  return {
    id: 'jvm-bytecode',
    name: 'JVM bytecode call graph',
    ecosystems: ['java', 'kotlin', 'scala'],
    // Note how little this resembles LLVM's. Reflection and DI are the JVM's
    // unsoundness; function pointers are not a thing here at all.
    soundnessNote:
      'excluding edges created by reflection, service loaders and dependency injection, ' +
      'which static bytecode analysis cannot see',
    available: () => (opts.usable === false ? { ok: false, reason: 'no classpath supplied' } : { ok: true }),
    analyse: (q: AnalyserQuery) => opts.answers[q.target] ?? { status: null },
  };
}

const llvmStub = (stdout: string) =>
  llvmAnalyser({ irDirs: ['ll'], analyserPath: __filename, run: () => ({ status: 0, stdout, stderr: '' }) });

describe('the analyser seam', () => {
  it('carries the ANALYSER\'s soundness note, not a hardcoded one', () => {
    const v = assessCve(
      {
        entry: 'main',
        symbols: { 'CVE-1': ['com.example.Vuln.parse'] },
        analyser: fakeJvmAnalyser({ answers: { 'com.example.Vuln.parse': { status: 'not_affected' } } }),
      },
      'CVE-1',
    );
    expect(v.status).toBe('not_affected');
    expect(v.rationale).toContain('reflection, service loaders and dependency injection');
    // THE REGRESSION THIS GUARDS: before the split, every not_affected verdict
    // said this, whatever produced it. A Java verdict carrying an LLVM caveat
    // would be a false statement in a signed technical file.
    expect(v.rationale).not.toContain('function pointer');
    expect(v.rationale).not.toContain('address-taken');
  });

  it('still gives LLVM its own note, unchanged', () => {
    const v = assessCve(
      { entry: 'main', symbols: { 'CVE-1': ['a'] }, analyser: llvmStub('VEX STATUS: not_affected') },
      'CVE-1',
    );
    expect(v.rationale).toContain('every unresolved function pointer may call any address-taken function');
  });

  it('records which analyser decided it, by stable id', () => {
    const jvm = assessCve(
      { entry: 'main', symbols: { 'CVE-1': ['x'] }, analyser: fakeJvmAnalyser({ answers: { x: { status: 'not_affected' } } }) },
      'CVE-1',
    );
    expect(jvm.analyser).toBe('jvm-bytecode');
    const llvm = assessCve(
      { entry: 'main', symbols: { 'CVE-1': ['a'] }, analyser: llvmStub('VEX STATUS: not_affected') },
      'CVE-1',
    );
    expect(llvm.analyser).toBe('llvm-ir');
  });

  it('needs no change to the assessment for a new substrate to report affected', () => {
    const v = assessCve(
      {
        entry: 'com.example.Main.main',
        symbols: { 'CVE-2': ['com.example.Vuln.parse'] },
        analyser: fakeJvmAnalyser({
          answers: {
            'com.example.Vuln.parse': {
              status: 'affected',
              callPath: ['com.example.Main.main', 'com.example.Router.handle', 'com.example.Vuln.parse'],
            },
          },
        }),
      },
      'CVE-2',
    );
    expect(v.status).toBe('affected');
    expect(v.callPath).toHaveLength(3);
  });

  it('an unusable analyser is undecided, never a discharge', () => {
    const v = assessCve(
      { entry: 'main', symbols: { 'CVE-1': ['x'] }, analyser: fakeJvmAnalyser({ answers: {}, usable: false }) },
      'CVE-1',
    );
    expect(v.status).toBe('under_investigation');
    expect(v.rationale).toContain('no classpath supplied');
  });

  it('a silent analyser is undecided, never not_affected', () => {
    const v = assessCve(
      { entry: 'main', symbols: { 'CVE-1': ['x'] }, analyser: fakeJvmAnalyser({ answers: {} }) },
      'CVE-1',
    );
    expect(v.status).toBe('under_investigation');
  });
});

describe('selectAnalyser refuses rather than running the wrong substrate', () => {
  const registry = [llvmStub(''), fakeJvmAnalyser({ answers: {} })];

  it('picks by ecosystem', () => {
    const c = selectAnalyser(registry, 'C++');
    expect('analyser' in c && c.analyser.id).toBe('llvm-ir');
    const j = selectAnalyser(registry, 'java');
    expect('analyser' in j && j.analyser.id).toBe('jvm-bytecode');
  });

  it('refuses an uncovered ecosystem and says so is NOT not_affected', () => {
    const r = selectAnalyser(registry, 'python');
    expect('reason' in r).toBe(true);
    expect('reason' in r && r.reason).toContain('No reachability analyser covers "python"');
    expect('reason' in r && r.reason).toContain('not the same as not affected');
  });

  it('refuses an analyser that is present but unusable', () => {
    const r = selectAnalyser([fakeJvmAnalyser({ answers: {}, usable: false })], 'java');
    expect('reason' in r && r.reason).toContain('no classpath supplied');
  });
});
