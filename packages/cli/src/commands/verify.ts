/**
 * `legalithm verify <file>` — the detection side of Article 50(2) marking.
 *
 * The Code of Practice on marking and labelling AI-generated content asks
 * signatories to make detection mechanisms available, so that users and other
 * stakeholders can check whether content was generated or manipulated by AI,
 * not merely to mark their own output. This command is that mechanism: it reads
 * both marking layers and reports what it finds.
 *
 *   legalithm verify <file>            Report marking layers found on one asset.
 *   legalithm verify <file> --json     Machine-readable output.
 *   legalithm verify --check [dir]     Exit non-zero if any asset is unmarked.
 *
 * IO is injected so the command is testable without the native modules.
 */

import { mimeForFile, IMAGE_EXTENSIONS } from './mark.js';

export type VerifyVerdict = 'marked' | 'partial' | 'unmarked' | 'unreadable';

export interface VerifyLayers {
  /**
   * Whether the C2PA optional dependency was available for this check.
   * When false, `c2pa` is always false and must not be read as "absent".
   */
  c2paAvailable: boolean;
  /** A C2PA content credential is present. Survives storage, not distribution. */
  c2pa: boolean;
  /** The pixel watermark is present. Survives re-encoding and rescaling. */
  watermark: boolean;
  watermarkVersion?: number;
  watermarkConfidence?: number;
}

export interface VerifyResult extends VerifyLayers {
  file: string;
  verdict: VerifyVerdict;
}

export interface VerifyIo {
  readFile: (path: string) => Buffer;
  exists: (path: string) => boolean;
  listImages: (dir: string) => string[];
  /** False when c2pa-node cannot be loaded; verify must not report C2PA as absent. */
  isC2paAvailable: () => Promise<boolean>;
  hasManifest: (buffer: Buffer, mime: string) => Promise<boolean>;
  readWatermark: (
    buffer: Buffer,
  ) => Promise<{ present: boolean; version?: number; confidence: number }>;
  log: (m: string) => void;
  error: (m: string) => void;
}

export interface VerifyParams {
  file?: string;
  json?: boolean;
  /** Presence selects check mode; the string is the directory to scan. */
  check?: string;
  warnOnly?: boolean;
}

export function verdictFor(layers: Pick<VerifyLayers, 'c2pa' | 'watermark'>): VerifyVerdict {
  if (layers.c2pa && layers.watermark) return 'marked';
  if (layers.c2pa || layers.watermark) return 'partial';
  return 'unmarked';
}

/** Inspect a single asset for both marking layers. */
export async function inspect(io: VerifyIo, file: string): Promise<VerifyResult> {
  const mime = mimeForFile(file);
  if (!mime) {
    return { file, c2paAvailable: true, c2pa: false, watermark: false, verdict: 'unreadable' };
  }

  let buffer: Buffer;
  try {
    buffer = io.readFile(file);
  } catch {
    return { file, c2paAvailable: true, c2pa: false, watermark: false, verdict: 'unreadable' };
  }

  const c2paAvailable = await io.isC2paAvailable();
  let c2pa = false;
  if (c2paAvailable) {
    try {
      c2pa = await io.hasManifest(buffer, mime);
    } catch {
      c2pa = false;
    }
  }

  let watermark = false;
  let watermarkVersion: number | undefined;
  let watermarkConfidence: number | undefined;
  try {
    const wm = await io.readWatermark(buffer);
    watermark = wm.present;
    watermarkVersion = wm.version;
    watermarkConfidence = wm.confidence;
  } catch {
    watermark = false;
  }

  const layers: VerifyLayers = {
    c2paAvailable,
    c2pa,
    watermark,
    watermarkVersion,
    watermarkConfidence,
  };
  return { file, ...layers, verdict: verdictFor(layers) };
}

const VERDICT_TEXT: Record<VerifyVerdict, string> = {
  marked: 'AI-generated content, both marking layers present',
  partial: 'AI-generated content, only one marking layer present',
  unmarked: 'no AI content marking found',
  unreadable: 'not a supported image asset',
};

function describeC2pa(r: VerifyResult): string {
  if (!r.c2paAvailable) {
    return 'C2PA: could not check — optional dependency not installed';
  }
  return `C2PA content credential : ${r.c2pa ? 'present' : 'absent'}`;
}

function describe(io: VerifyIo, r: VerifyResult): void {
  io.log(`${r.file}: ${VERDICT_TEXT[r.verdict]}`);
  if (r.verdict === 'unreadable') return;
  io.log(`  ${describeC2pa(r)}`);
  const conf =
    r.watermarkConfidence !== undefined ? ` (confidence ${r.watermarkConfidence.toFixed(2)})` : '';
  io.log(`  Pixel watermark         : ${r.watermark ? `present, v${r.watermarkVersion}` : 'absent'}${conf}`);
  if (r.c2paAvailable && r.c2pa && !r.watermark) {
    io.log('  Note: a manifest alone is stripped by most redistribution. Re-mark with --watermark.');
  }
  if (r.watermark && !r.c2pa && r.c2paAvailable) {
    io.log('  Note: the watermark survived, but the manifest was stripped in distribution.');
  }
}

export async function runVerify(io: VerifyIo, params: VerifyParams): Promise<number> {
  if (params.check !== undefined) return runCheck(io, params);

  if (!params.file) {
    io.error('Usage: legalithm verify <image> [--json]   |   legalithm verify --check [dir]');
    return 2;
  }
  if (!io.exists(params.file)) {
    io.error(`File not found: ${params.file}`);
    return 2;
  }

  const result = await inspect(io, params.file);
  if (params.json) {
    io.log(JSON.stringify(result, null, 2));
  } else {
    describe(io, result);
  }
  if (result.verdict === 'unreadable') {
    io.error(`Unsupported file type (images only: ${IMAGE_EXTENSIONS.join(', ')})`);
    return 2;
  }
  return result.verdict === 'unmarked' ? 1 : 0;
}

async function runCheck(io: VerifyIo, params: VerifyParams): Promise<number> {
  const dir = params.check || '.';
  const images = io.listImages(dir);
  if (images.length === 0) {
    io.log(`No image assets found under ${dir}.`);
    return 0;
  }

  const results: VerifyResult[] = [];
  for (const file of images) results.push(await inspect(io, file));

  if (params.json) {
    io.log(JSON.stringify(results, null, 2));
  }

  const unmarked = results.filter((r) => r.verdict === 'unmarked');
  const partial = results.filter((r) => r.verdict === 'partial');

  if (!params.json) {
    io.log(
      `${results.length} asset(s) under ${dir}: ${
        results.filter((r) => r.verdict === 'marked').length
      } fully marked, ${partial.length} partial, ${unmarked.length} unmarked.`,
    );
    for (const r of partial) {
      const layer = !r.c2paAvailable
        ? 'C2PA unchecked'
        : r.c2pa
          ? 'C2PA only'
          : 'watermark only';
      io.log(`  partial  ${r.file} (${layer})`);
    }
    for (const r of unmarked) io.error(`  unmarked ${r.file}`);
  }

  if (unmarked.length === 0) return 0;
  if (!params.json) io.error('Mark them with: legalithm mark <file> --watermark');
  return params.warnOnly ? 0 : 1;
}
