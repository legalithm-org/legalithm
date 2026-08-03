import { describe, it, expect } from 'vitest';

import { runMark, mimeForFile, type MarkIo } from '../commands/mark.js';

function fakeIo(over: Partial<MarkIo> = {}): { io: MarkIo; logs: string[]; errors: string[]; writes: Record<string, Buffer> } {
  const logs: string[] = [];
  const errors: string[] = [];
  const writes: Record<string, Buffer> = {};
  const io: MarkIo = {
    readFile: () => Buffer.from('img'),
    writeFile: (p, b) => {
      writes[p] = b;
    },
    exists: () => true,
    listImages: () => [],
    mark: async () => Buffer.from('signed-longer-bytes'),
    hasManifest: async () => true,
    buildSigner: () => ({ type: 'local' }),
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
    ...over,
  };
  return { io, logs, errors, writes };
}

describe('mimeForFile (P2-C3)', () => {
  it('maps image extensions and rejects non-images', () => {
    expect(mimeForFile('a.JPG')).toBe('image/jpeg');
    expect(mimeForFile('a.png')).toBe('image/png');
    expect(mimeForFile('a.txt')).toBeNull();
  });
});

describe('mark --watermark, layer independence', () => {
  const missingC2pa = async () => {
    throw new Error('C2PA marking needs the optional dependency "c2pa-node".');
  };

  it('applies both layers, watermarking before signing so C2PA covers final pixels', async () => {
    const order: string[] = [];
    const { io, logs } = fakeIo({
      embedWatermark: async (b) => {
        order.push('watermark');
        return Buffer.concat([b, Buffer.from('-wm')]);
      },
      mark: async (b) => {
        order.push('c2pa');
        // C2PA must be signing the watermarked bytes, not the original.
        expect(b.toString()).toContain('-wm');
        return Buffer.from('signed');
      },
    });
    expect(await runMark(io, { file: 'a.png', watermark: true })).toBe(0);
    expect(order).toEqual(['watermark', 'c2pa']);
    expect(logs.some((l) => l.includes('C2PA credential + pixel watermark'))).toBe(true);
  });

  // Regression: published 0.4.0 threw away the watermark when the optional C2PA
  // signer was absent, which is the DEFAULT install state.
  it('still writes the watermarked asset when the C2PA signer is unavailable', async () => {
    const { io, writes, logs, errors } = fakeIo({
      embedWatermark: async (b) => Buffer.concat([b, Buffer.from('-wm')]),
      mark: missingC2pa,
    });
    expect(await runMark(io, { file: 'a.png', watermark: true })).toBe(0);
    expect(writes['a.signed.png'].toString()).toContain('-wm');
    expect(errors.some((e) => e.includes('C2PA layer skipped'))).toBe(true);
    expect(logs.some((l) => l.includes('Only one layer was applied'))).toBe(true);
    expect(logs.some((l) => l.includes('Article 50(2), pixel watermark'))).toBe(true);
  });

  it('still fails when C2PA is unavailable and no watermark was requested', async () => {
    const { io, writes } = fakeIo({ mark: missingC2pa });
    expect(await runMark(io, { file: 'a.png' })).toBe(3);
    expect(Object.keys(writes)).toEqual([]);
  });

  it('fails cleanly when --watermark is asked for but unsupported', async () => {
    const { io, writes, errors } = fakeIo({ embedWatermark: undefined });
    expect(await runMark(io, { file: 'a.png', watermark: true })).toBe(3);
    expect(errors.some((e) => e.includes('sharp'))).toBe(true);
    expect(Object.keys(writes)).toEqual([]);
  });

  it('reports an error and writes nothing when watermarking itself fails', async () => {
    const { io, writes } = fakeIo({
      embedWatermark: async () => {
        throw new Error('corrupt image');
      },
    });
    expect(await runMark(io, { file: 'a.png', watermark: true })).toBe(3);
    expect(Object.keys(writes)).toEqual([]);
  });
});

describe('mark sign mode (P2-C3)', () => {
  it('signs an image and writes to the default .signed path', async () => {
    const { io, writes, logs } = fakeIo();
    const code = await runMark(io, { file: 'assets/pic.png' });
    expect(code).toBe(0);
    expect(Object.keys(writes)).toEqual(['assets/pic.signed.png']);
    expect(logs.some((l) => l.includes('test signing certificate'))).toBe(true);
  });

  it('honors --out and uses a real signer when cert+key are given', async () => {
    let signerUsed: unknown = null;
    const { io, writes } = fakeIo({
      mark: async (_b, _m, opts) => {
        signerUsed = opts.signer;
        return Buffer.from('signed');
      },
    });
    const code = await runMark(io, { file: 'pic.jpg', out: 'dist/pic.jpg', certPath: 'c.pem', keyPath: 'k.pem' });
    expect(code).toBe(0);
    expect(Object.keys(writes)).toEqual(['dist/pic.jpg']);
    expect(signerUsed).toEqual({ type: 'local' }); // buildSigner output passed through
  });

  it('rejects a missing file and an unsupported type', async () => {
    const missing = fakeIo({ exists: () => false });
    expect(await runMark(missing.io, { file: 'nope.png' })).toBe(2);
    const badType = fakeIo();
    expect(await runMark(badType.io, { file: 'notes.txt' })).toBe(2);
  });
});

describe('mark check mode (P2-C3)', () => {
  it('fails when an image lacks a manifest, and lists it', async () => {
    const { io, errors } = fakeIo({
      listImages: () => ['public/a.png', 'public/b.jpg'],
      hasManifest: async (_b, _m) => false, // none marked
    });
    const code = await runMark(io, { check: 'public' });
    expect(code).toBe(1);
    expect(errors.some((e) => e.includes('public/a.png'))).toBe(true);
  });

  it('passes when every image is marked', async () => {
    const { io } = fakeIo({ listImages: () => ['a.png'], hasManifest: async () => true });
    expect(await runMark(io, { check: '.' })).toBe(0);
  });

  it('--warn downgrades an unmarked failure to exit 0', async () => {
    const { io } = fakeIo({ listImages: () => ['a.png'], hasManifest: async () => false });
    expect(await runMark(io, { check: '.', warnOnly: true })).toBe(0);
  });
});
