import { describe, it, expect } from 'vitest';

import { runVerify, verdictFor, inspect, type VerifyIo } from '../commands/verify.js';

interface IoState {
  logs: string[];
  errors: string[];
}

function makeIo(
  overrides: Partial<VerifyIo> = {},
  files: Record<string, Buffer> = { 'a.png': Buffer.from('img') },
): { io: VerifyIo; state: IoState } {
  const state: IoState = { logs: [], errors: [] };
  const io: VerifyIo = {
    readFile: (p) => {
      const f = files[p];
      if (!f) throw new Error('ENOENT');
      return f;
    },
    exists: (p) => p in files,
    listImages: () => Object.keys(files),
    isC2paAvailable: async () => true,
    hasManifest: async () => false,
    readWatermark: async () => ({ present: false, confidence: 0 }),
    log: (m) => state.logs.push(m),
    error: (m) => state.errors.push(m),
    ...overrides,
  };
  return { io, state };
}

describe('verdictFor', () => {
  it('marked when both layers are present', () => {
    expect(verdictFor({ c2pa: true, watermark: true })).toBe('marked');
  });
  it('partial when only C2PA is present', () => {
    expect(verdictFor({ c2pa: true, watermark: false })).toBe('partial');
  });
  it('partial when only the watermark survived', () => {
    expect(verdictFor({ c2pa: false, watermark: true })).toBe('partial');
  });
  it('unmarked when neither layer is present', () => {
    expect(verdictFor({ c2pa: false, watermark: false })).toBe('unmarked');
  });
});

describe('inspect — three C2PA states', () => {
  it('present: c2pa true and c2paAvailable true', async () => {
    const { io } = makeIo({
      hasManifest: async () => true,
      readWatermark: async () => ({ present: true, version: 1, confidence: 3.5 }),
    });
    const r = await inspect(io, 'a.png');
    expect(r).toMatchObject({
      c2paAvailable: true,
      c2pa: true,
      watermark: true,
      watermarkVersion: 1,
      verdict: 'marked',
    });
  });

  it('absent-and-checked: c2pa false and c2paAvailable true', async () => {
    const { io } = makeIo({
      isC2paAvailable: async () => true,
      hasManifest: async () => false,
    });
    const r = await inspect(io, 'a.png');
    expect(r).toMatchObject({ c2paAvailable: true, c2pa: false, verdict: 'unmarked' });
  });

  it('could-not-check: c2paAvailable false (never reports absent)', async () => {
    let hasManifestCalls = 0;
    const { io, state } = makeIo({
      isC2paAvailable: async () => false,
      hasManifest: async () => {
        hasManifestCalls += 1;
        return true;
      },
    });
    const r = await inspect(io, 'a.png');
    expect(hasManifestCalls).toBe(0);
    expect(r).toMatchObject({ c2paAvailable: false, c2pa: false, verdict: 'unmarked' });

    expect(await runVerify(io, { file: 'a.png' })).toBe(1);
    expect(state.logs.join('\n')).toContain(
      'C2PA: could not check — optional dependency not installed',
    );
    expect(state.logs.join('\n')).not.toContain('C2PA content credential : absent');

    const { io: jsonIo, state: jsonState } = makeIo({
      isC2paAvailable: async () => false,
    });
    await runVerify(jsonIo, { file: 'a.png', json: true });
    const parsed = JSON.parse(jsonState.logs[0]);
    expect(parsed).toMatchObject({ c2paAvailable: false, c2pa: false, verdict: 'unmarked' });
  });
});

describe('inspect', () => {
  it('marks a non-image as unreadable', async () => {
    const { io } = makeIo({}, { 'notes.txt': Buffer.from('x') });
    expect((await inspect(io, 'notes.txt')).verdict).toBe('unreadable');
  });

  it('treats a throwing manifest reader as absent rather than crashing when dep is available', async () => {
    const { io } = makeIo({
      hasManifest: async () => {
        throw new Error('native read failed');
      },
    });
    const r = await inspect(io, 'a.png');
    expect(r.c2paAvailable).toBe(true);
    expect(r.c2pa).toBe(false);
    expect(r.verdict).toBe('unmarked');
  });

  it('treats a throwing watermark reader as absent', async () => {
    const { io } = makeIo({
      hasManifest: async () => true,
      readWatermark: async () => {
        throw new Error('sharp missing');
      },
    });
    const r = await inspect(io, 'a.png');
    expect(r.watermark).toBe(false);
    expect(r.verdict).toBe('partial');
  });

  it('is unreadable when the file cannot be read', async () => {
    const { io } = makeIo();
    expect((await inspect(io, 'missing.png')).verdict).toBe('unreadable');
  });
});

describe('runVerify, single asset', () => {
  it('exits 0 and describes both layers when fully marked', async () => {
    const { io, state } = makeIo({
      hasManifest: async () => true,
      readWatermark: async () => ({ present: true, version: 1, confidence: 3.9 }),
    });
    expect(await runVerify(io, { file: 'a.png' })).toBe(0);
    expect(state.logs.join('\n')).toContain('both marking layers present');
    expect(state.logs.join('\n')).toContain('confidence 3.90');
    expect(state.logs.join('\n')).toContain('C2PA content credential : present');
  });

  it('exits 1 when nothing is marked (absent-and-checked)', async () => {
    const { io, state } = makeIo();
    expect(await runVerify(io, { file: 'a.png' })).toBe(1);
    expect(state.logs.join('\n')).toContain('no AI content marking found');
    expect(state.logs.join('\n')).toContain('C2PA content credential : absent');
  });

  it('warns that a manifest alone does not survive redistribution', async () => {
    const { io, state } = makeIo({ hasManifest: async () => true });
    expect(await runVerify(io, { file: 'a.png' })).toBe(0);
    expect(state.logs.join('\n')).toContain('stripped by most redistribution');
  });

  it('notes when the watermark outlived the manifest', async () => {
    const { io, state } = makeIo({
      readWatermark: async () => ({ present: true, version: 1, confidence: 3.2 }),
    });
    await runVerify(io, { file: 'a.png' });
    expect(state.logs.join('\n')).toContain('manifest was stripped in distribution');
  });

  it('emits JSON when asked', async () => {
    const { io, state } = makeIo({ hasManifest: async () => true });
    await runVerify(io, { file: 'a.png', json: true });
    const parsed = JSON.parse(state.logs[0]);
    expect(parsed).toMatchObject({
      file: 'a.png',
      c2pa: true,
      c2paAvailable: true,
      verdict: 'partial',
    });
  });

  it('exits 2 without a file argument', async () => {
    const { io, state } = makeIo();
    expect(await runVerify(io, {})).toBe(2);
    expect(state.errors.join('\n')).toContain('Usage:');
  });

  it('exits 2 when the file does not exist', async () => {
    const { io, state } = makeIo();
    expect(await runVerify(io, { file: 'nope.png' })).toBe(2);
    expect(state.errors.join('\n')).toContain('File not found');
  });
});

describe('runVerify, directory check', () => {
  it('exits 0 when every asset is marked', async () => {
    const { io, state } = makeIo(
      {
        hasManifest: async () => true,
        readWatermark: async () => ({ present: true, version: 1, confidence: 3.5 }),
      },
      { 'a.png': Buffer.from('1'), 'b.png': Buffer.from('2') },
    );
    expect(await runVerify(io, { check: '.' })).toBe(0);
    expect(state.logs.join('\n')).toContain('2 fully marked');
  });

  it('exits 1 and names unmarked assets', async () => {
    const { io, state } = makeIo({}, { 'a.png': Buffer.from('1') });
    expect(await runVerify(io, { check: '.' })).toBe(1);
    expect(state.errors.join('\n')).toContain('unmarked a.png');
  });

  it('exits 0 with --warn even when assets are unmarked', async () => {
    const { io } = makeIo({}, { 'a.png': Buffer.from('1') });
    expect(await runVerify(io, { check: '.', warnOnly: true })).toBe(0);
  });

  it('reports partial assets separately from unmarked ones', async () => {
    const { io, state } = makeIo({ hasManifest: async () => true }, { 'a.png': Buffer.from('1') });
    expect(await runVerify(io, { check: '.' })).toBe(0);
    expect(state.logs.join('\n')).toContain('partial  a.png (C2PA only)');
  });

  it('handles an empty directory', async () => {
    const { io, state } = makeIo({ listImages: () => [] }, {});
    expect(await runVerify(io, { check: 'empty' })).toBe(0);
    expect(state.logs.join('\n')).toContain('No image assets found');
  });
});
