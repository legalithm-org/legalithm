/**
 * Second marking layer: an invisible, spread-spectrum watermark carried in the
 * pixels themselves.
 *
 * Why this exists: a C2PA manifest is metadata, and metadata is stripped by
 * ordinary distribution (screenshots, re-encoding, most social platforms). The
 * Code of Practice on marking and labelling AI-generated content asks for a
 * *layered* approach for exactly that reason. This module is the second layer:
 * it survives the transforms that remove a manifest.
 *
 * Design. The payload is spread across a GRID x GRID lattice of blocks and
 * modulated against a deterministic +/-1 chip sequence, so every payload bit is
 * carried redundantly by many blocks and the embedded pattern is zero-mean
 * (which keeps it visually inert and lets a local neighbourhood average serve as
 * the un-watermarked baseline at extraction time). Extraction normalises to a
 * canonical resolution first, which is what makes it survive rescaling.
 *
 * HONEST LIMITS, and they matter for any compliance claim built on this:
 *   - Survives: re-encoding (incl. lossy JPEG at sane quality), rescaling,
 *     metadata stripping, format conversion.
 *   - Degrades on: heavy cropping (the block lattice loses alignment), rotation.
 *   - Does NOT survive: generative regeneration / diffusion re-synthesis, which
 *     the literature shows can provably remove pixel-level watermarks, nor a
 *     motivated adversary who knows the scheme.
 * It is a robustness layer against ordinary distribution loss, NOT an
 * adversarial guarantee. Do not describe it as one.
 *
 * sharp is a native module and is therefore an OPTIONAL dependency, loaded
 * lazily here, matching how c2pa-node is handled in ./c2pa.ts.
 */

/** Blocks per axis. 32 x 32 = 1024 blocks, so a 16-bit payload repeats 64x. */
export const GRID = 32;
/** Payload width in bits. */
export const PAYLOAD_BITS = 16;
/** Canonical extraction resolution; a multiple of GRID keeps blocks whole. */
export const CANON = GRID * 8;
/** Luminance offset applied per block, on a 0-255 scale. */
export const DELTA = 4;
/** Identifies a Legalithm AI-content watermark. */
export const MAGIC = 0xa7;
/** Payload format version. */
export const WATERMARK_VERSION = 1;
/**
 * Minimum mean |correlation| to accept a detection, in luminance units.
 *
 * Measured separation on real images: a marked asset scores ~3.5-3.9 and
 * survives lossy re-encoding and rescaling at that level, while unmarked or
 * lattice-desynchronised (cropped) input sits near ~0.7. 1.5 sits in the gap.
 * The magic byte alone would leave a 1-in-256 chance of a random match, so the
 * threshold is the second, independent guard against false positives.
 */
export const MIN_CONFIDENCE = 1.5;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadSharp(): Promise<any> {
  try {
    const mod = await import('sharp');
    return (mod as { default?: unknown }).default ?? mod;
  } catch {
    throw new Error(
      'Watermarking needs the optional dependency "sharp". Install it, e.g. `npm i sharp`.',
    );
  }
}

/**
 * Deterministic +/-1 chip sequence (xorshift32, fixed seed). Deterministic so
 * extraction can reproduce it exactly; zero-mean so the embedded pattern does
 * not shift overall image brightness.
 */
export function chipSequence(length: number, seed = 0x5eed1a7b): Int8Array {
  const chips = new Int8Array(length);
  let x = seed >>> 0;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    chips[i] = x & 1 ? 1 : -1;
  }
  return chips;
}

/** Pack the 16-bit payload: magic byte, then version byte. */
export function buildPayloadBits(version = WATERMARK_VERSION): Uint8Array {
  const bits = new Uint8Array(PAYLOAD_BITS);
  const word = ((MAGIC & 0xff) << 8) | (version & 0xff);
  for (let i = 0; i < PAYLOAD_BITS; i++) {
    // Most-significant bit first.
    bits[i] = (word >> (PAYLOAD_BITS - 1 - i)) & 1;
  }
  return bits;
}

/** Inverse of buildPayloadBits: returns null when the magic byte does not match. */
export function parsePayloadBits(bits: Uint8Array): { version: number } | null {
  if (bits.length !== PAYLOAD_BITS) return null;
  let word = 0;
  for (let i = 0; i < PAYLOAD_BITS; i++) word = (word << 1) | (bits[i] ? 1 : 0);
  if (((word >> 8) & 0xff) !== MAGIC) return null;
  return { version: word & 0xff };
}

/** Inclusive-exclusive pixel bounds of block `index` along an axis of `size` px. */
function blockBounds(index: number, size: number): [number, number] {
  const start = Math.floor((index * size) / GRID);
  const end = Math.floor(((index + 1) * size) / GRID);
  return [start, Math.max(end, start + 1)];
}

export interface EmbedOptions {
  buffer: Buffer;
  /** Output mime type; defaults to preserving the input format. */
  format?: string;
  version?: number;
  /** Re-embed even when a mark is already present. Compounds the signal. */
  force?: boolean;
}

/**
 * Embed the watermark and return the re-encoded asset.
 *
 * Applied equally to R, G and B so hue is preserved and only luminance moves.
 *
 * IDEMPOTENT. Each pass shifts block luminance by another +/-DELTA, so marking
 * an already-marked asset compounds the signal (measured: 3.91, then 7.82,
 * then 11.74) and visibly degrades the image. An asset that already carries
 * the mark is returned unchanged unless `force` is set.
 */
export async function embedWatermark(opts: EmbedOptions): Promise<Buffer> {
  if (!opts.force) {
    const existing = await readWatermark(opts.buffer);
    if (existing.present) return opts.buffer;
  }

  const sharp = await loadSharp();
  const pipeline = sharp(opts.buffer);
  const meta = await pipeline.metadata();
  const { data, info } = await sharp(opts.buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info as { width: number; height: number; channels: number };
  const bits = buildPayloadBits(opts.version ?? WATERMARK_VERSION);
  const chips = chipSequence(GRID * GRID);

  for (let by = 0; by < GRID; by++) {
    const [y0, y1] = blockBounds(by, height);
    for (let bx = 0; bx < GRID; bx++) {
      const [x0, x1] = blockBounds(bx, width);
      const k = by * GRID + bx;
      const bit = bits[k % PAYLOAD_BITS];
      const delta = chips[k] * (bit ? 1 : -1) * DELTA;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const base = (y * width + x) * channels;
          for (let c = 0; c < Math.min(channels, 3); c++) {
            const v = data[base + c] + delta;
            data[base + c] = v < 0 ? 0 : v > 255 ? 255 : v;
          }
        }
      }
    }
  }

  const out = sharp(data, { raw: { width, height, channels } });
  const format = (opts.format ?? meta.format ?? 'png').replace('image/', '');
  if (format === 'jpeg' || format === 'jpg') return out.jpeg({ quality: 92 }).toBuffer();
  if (format === 'webp') return out.webp({ quality: 92 }).toBuffer();
  return out.png().toBuffer();
}

export interface WatermarkReadResult {
  present: boolean;
  version?: number;
  /**
   * Mean |correlation| across bit positions, in luminance units. Higher is a
   * stronger detection; values near zero mean no watermark was recovered.
   */
  confidence: number;
}

/**
 * Recover the watermark.
 *
 * Normalises to CANON x CANON greyscale first, which is what gives scale
 * invariance, then correlates each block's local residual against the chip
 * sequence and accumulates per payload bit.
 */
export async function readWatermark(buffer: Buffer): Promise<WatermarkReadResult> {
  let data: Buffer;
  try {
    const sharp = await loadSharp();
    const raw = await sharp(buffer)
      .removeAlpha()
      .greyscale()
      .resize(CANON, CANON, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    data = raw.data;
  } catch {
    return { present: false, confidence: 0 };
  }

  // Block means over the canonical grid.
  const means = new Float64Array(GRID * GRID);
  const cell = CANON / GRID;
  for (let by = 0; by < GRID; by++) {
    for (let bx = 0; bx < GRID; bx++) {
      let sum = 0;
      for (let y = by * cell; y < (by + 1) * cell; y++) {
        for (let x = bx * cell; x < (bx + 1) * cell; x++) sum += data[y * CANON + x];
      }
      means[by * GRID + bx] = sum / (cell * cell);
    }
  }

  // Local baseline: mean of the 8-neighbourhood. The embedded pattern is
  // zero-mean, so neighbours approximate the unwatermarked luminance.
  const chips = chipSequence(GRID * GRID);
  const acc = new Float64Array(PAYLOAD_BITS);
  const counts = new Float64Array(PAYLOAD_BITS);
  for (let by = 0; by < GRID; by++) {
    for (let bx = 0; bx < GRID; bx++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const ny = by + dy;
          const nx = bx + dx;
          if (ny < 0 || ny >= GRID || nx < 0 || nx >= GRID) continue;
          sum += means[ny * GRID + nx];
          n++;
        }
      }
      const k = by * GRID + bx;
      const residual = means[k] - sum / n;
      acc[k % PAYLOAD_BITS] += residual * chips[k];
      counts[k % PAYLOAD_BITS] += 1;
    }
  }

  const bits = new Uint8Array(PAYLOAD_BITS);
  let strength = 0;
  for (let i = 0; i < PAYLOAD_BITS; i++) {
    const corr = acc[i] / Math.max(counts[i], 1);
    bits[i] = corr > 0 ? 1 : 0;
    strength += Math.abs(corr);
  }
  const confidence = strength / PAYLOAD_BITS;

  // Two independent guards: the payload must carry the magic byte, AND the
  // correlation must be strong enough that it is not chance.
  const parsed = parsePayloadBits(bits);
  if (!parsed || confidence < MIN_CONFIDENCE) return { present: false, confidence };
  return { present: true, version: parsed.version, confidence };
}

/** Convenience predicate mirroring hasManifest() in ./c2pa.ts. */
export async function hasWatermark(buffer: Buffer): Promise<boolean> {
  const res = await readWatermark(buffer);
  return res.present;
}
