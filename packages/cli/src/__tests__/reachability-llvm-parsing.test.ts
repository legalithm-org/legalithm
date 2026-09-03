import { describe, it, expect } from 'vitest';
import { llvmAnalyser, assessCve } from '../cra/reachability/index.js';

/**
 * The LLVM analyser's PARSING, which is where a wrong answer would come from.
 *
 * Everything about this analyser that matters happens after the subprocess
 * returns: reading `VEX STATUS:` out of stdout and lifting the call path from
 * numbered lines. Those branches sat at 35% because every test drove the happy
 * path. A parse that silently returns null reads as `under_investigation`,
 * which is safe; a parse that silently mis-reads `affected` as `not_affected`
 * would discharge a live vulnerability, which is not.
 */
const analyser = (stdout: string, status = 0) =>
  llvmAnalyser({
    irDirs: ['ll'],
    analyserPath: __filename, // exists, so `available()` passes
    run: () => ({ status, stdout, stderr: '' }),
  });

describe('availability is checked before anything is believed', () => {
  it('is unusable when the analyser file is absent', () => {
    const a = llvmAnalyser({ irDirs: ['ll'], analyserPath: '/nope/missing.py', run: () => ({ status: 0, stdout: '', stderr: '' }) });
    const av = a.available();
    expect(av.ok).toBe(false);
    if (!av.ok) expect(av.reason).toContain('not found');
  });

  it('is unusable with no IR directories, which would silently analyse nothing', () => {
    const a = llvmAnalyser({ irDirs: [], analyserPath: __filename, run: () => ({ status: 0, stdout: '', stderr: '' }) });
    const av = a.available();
    expect(av.ok).toBe(false);
    if (!av.ok) expect(av.reason).toContain('--ir');
  });

  it('is usable with both', () => {
    expect(analyser('').available()).toEqual({ ok: true });
  });
});

describe('reading the verdict out of stdout', () => {
  it.each([
    ['VEX STATUS: affected', 'affected'],
    ['VEX STATUS: not_affected', 'not_affected'],
    ['VEX STATUS: under_investigation', 'under_investigation'],
    ['noise\nVEX STATUS:   affected\nmore noise', 'affected'],
  ])('reads %s', (stdout, expected) => {
    expect(analyser(stdout).analyse({ entry: 'main', target: 't' }).status).toBe(expected);
  });

  it('returns null rather than guessing when there is no verdict line', () => {
    expect(analyser('the analyser crashed').analyse({ entry: 'main', target: 't' }).status).toBeNull();
  });

  it('returns null for a verdict word it does not recognise', () => {
    expect(analyser('VEX STATUS: probably_fine').analyse({ entry: 'main', target: 't' }).status).toBeNull();
  });
});

describe('lifting the call path', () => {
  it('reads a numbered path under the depth header', () => {
    const stdout = [
      'VEX STATUS: affected',
      'call path, depth 3:',
      '  1. main',
      '  2. decode_image',
      '  3. BuildHuffmanTable',
    ].join('\n');
    expect(analyser(stdout).analyse({ entry: 'main', target: 'x' }).callPath).toEqual([
      'main', 'decode_image', 'BuildHuffmanTable',
    ]);
  });

  it('stops at the first non-numbered line rather than swallowing trailing output', () => {
    const stdout = ['VEX STATUS: affected', 'call path, depth 2:', '  1. main', '  2. f', '', 'Summary: done'].join('\n');
    expect(analyser(stdout).analyse({ entry: 'main', target: 'x' }).callPath).toEqual(['main', 'f']);
  });

  it('omits the path entirely when there is no header', () => {
    expect(analyser('VEX STATUS: affected').analyse({ entry: 'main', target: 'x' }).callPath).toBeUndefined();
  });

  it('omits the path when the header is present but empty', () => {
    expect(
      analyser('VEX STATUS: affected\ncall path, depth 0:\n\n').analyse({ entry: 'main', target: 'x' }).callPath,
    ).toBeUndefined();
  });
});

describe('the assessment reads those results conservatively', () => {
  it('is undecided when the analyser is unusable, never not_affected', () => {
    const v = assessCve(
      {
        entry: 'main',
        symbols: { 'CVE-1': ['t'] },
        analyser: llvmAnalyser({ irDirs: [], analyserPath: __filename, run: () => ({ status: 0, stdout: '', stderr: '' }) }),
      },
      'CVE-1',
    );
    expect(v.status).toBe('under_investigation');
    expect(v.analyser).toBe('llvm-ir');
  });

  it('carries the analyser id and entry onto an affected verdict', () => {
    const v = assessCve(
      { entry: 'curl_easy_perform', symbols: { 'CVE-1': ['inflate_fast'] }, analyser: analyser('VEX STATUS: affected') },
      'CVE-1',
    );
    expect(v).toMatchObject({ status: 'affected', entry: 'curl_easy_perform', target: 'inflate_fast', analyser: 'llvm-ir' });
  });

  it('is case-insensitive about the CVE key', () => {
    const v = assessCve(
      { entry: 'main', symbols: { 'CVE-2023-4863': ['t'] }, analyser: analyser('VEX STATUS: not_affected') },
      'cve-2023-4863',
    );
    expect(v.status).toBe('not_affected');
  });
});
