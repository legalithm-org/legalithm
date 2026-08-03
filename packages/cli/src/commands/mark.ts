import { basename, dirname, extname, join } from 'path';

/**
 * P2-C3: `legalithm mark`.
 *   legalithm mark <image> [--out <path>] [--agent <name>] [--cert <p> --key <p>]
 *       Embed a C2PA credential declaring the image AI-generated (Article 50(2)).
 *   legalithm mark --check [dir] [--warn]
 *       Fail (or warn) when image assets under a directory carry no C2PA manifest.
 *
 * IO is injected so the command logic is testable without the native signer.
 */

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif',
};

export const IMAGE_EXTENSIONS = Object.keys(MIME_BY_EXT);

export function mimeForFile(path: string): string | null {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? null;
}

export interface MarkSignOptions {
  title: string;
  softwareAgent?: string;
  signer?: unknown;
}

export interface MarkIo {
  readFile: (path: string) => Buffer;
  writeFile: (path: string, data: Buffer) => void;
  exists: (path: string) => boolean;
  listImages: (dir: string) => string[];
  mark: (buffer: Buffer, mime: string, opts: MarkSignOptions) => Promise<Buffer>;
  hasManifest: (buffer: Buffer, mime: string) => Promise<boolean>;
  buildSigner: (cert: Buffer, key: Buffer) => unknown;
  /** Second marking layer. Optional so callers without sharp still work. */
  embedWatermark?: (buffer: Buffer, mime: string) => Promise<Buffer>;
  log: (m: string) => void;
  error: (m: string) => void;
}

export interface MarkParams {
  file?: string;
  out?: string;
  agent?: string;
  certPath?: string;
  keyPath?: string;
  /** Presence selects check mode; the string is the directory to scan. */
  check?: string;
  warnOnly?: boolean;
  /** Also embed the pixel watermark, so the marking survives redistribution. */
  watermark?: boolean;
}

function defaultOut(file: string): string {
  const ext = extname(file);
  return join(dirname(file), `${basename(file, ext)}.signed${ext}`);
}

export async function runMark(io: MarkIo, params: MarkParams): Promise<number> {
  return params.check !== undefined ? runCheck(io, params) : runSign(io, params);
}

async function runSign(io: MarkIo, params: MarkParams): Promise<number> {
  if (!params.file) {
    io.error('Usage: legalithm mark <image> [--out <path>] [--agent <name>]');
    return 2;
  }
  if (!io.exists(params.file)) {
    io.error(`File not found: ${params.file}`);
    return 2;
  }
  const mime = mimeForFile(params.file);
  if (!mime) {
    io.error(`Unsupported file type: ${params.file} (images only: ${IMAGE_EXTENSIONS.join(', ')})`);
    return 2;
  }

  let signer: unknown;
  if (params.certPath && params.keyPath) {
    signer = io.buildSigner(io.readFile(params.certPath), io.readFile(params.keyPath));
  } else {
    io.log(
      'Note: using a test signing certificate. The manifest is valid but not trust-listed. Provide --cert and --key for production.',
    );
  }

  let source = io.readFile(params.file);
  let watermarked = false;

  // The watermark rewrites pixels and re-encodes, which would invalidate a
  // manifest signed beforehand. So it goes first, and C2PA then signs the
  // watermarked pixels: both layers end up valid on the same asset.
  if (params.watermark) {
    if (!io.embedWatermark) {
      io.error('Watermarking is unavailable (the optional "sharp" dependency is not installed).');
      return 3;
    }
    try {
      source = await io.embedWatermark(source, mime);
      watermarked = true;
    } catch (e) {
      io.error((e as Error).message);
      return 3;
    }
  }

  let signed: Buffer;
  let c2paApplied = true;
  try {
    signed = await io.mark(source, mime, {
      title: basename(params.file),
      softwareAgent: params.agent,
      signer,
    });
  } catch (e) {
    // The two layers are independent. If the watermark is already embedded,
    // losing the C2PA layer (typically because the optional native signer is
    // not installed) must not throw away work the user asked for and we can
    // still deliver. Degrade to the layer we have, loudly.
    if (!watermarked) {
      io.error((e as Error).message);
      return 3;
    }
    io.error(`C2PA layer skipped: ${(e as Error).message}`);
    signed = source;
    c2paApplied = false;
  }

  const out = params.out ?? defaultOut(params.file);
  io.writeFile(out, signed);
  const layers = [c2paApplied ? 'C2PA credential' : null, watermarked ? 'pixel watermark' : null]
    .filter(Boolean)
    .join(' + ');
  io.log(`Marked ${params.file} as AI-generated (Article 50(2), ${layers}) -> ${out}`);
  if (!watermarked) {
    io.log('Tip: add --watermark for a second layer that survives redistribution.');
  }
  if (!c2paApplied) {
    io.log('Only one layer was applied. Install c2pa-node to also embed a content credential.');
  }
  return 0;
}

async function runCheck(io: MarkIo, params: MarkParams): Promise<number> {
  const dir = params.check || '.';
  const images = io.listImages(dir);
  if (images.length === 0) {
    io.log(`No image assets found under ${dir}.`);
    return 0;
  }

  const unmarked: string[] = [];
  for (const file of images) {
    const mime = mimeForFile(file);
    if (!mime) continue;
    let marked = false;
    try {
      marked = await io.hasManifest(io.readFile(file), mime);
    } catch {
      marked = false;
    }
    if (!marked) unmarked.push(file);
  }

  if (unmarked.length === 0) {
    io.log(`All ${images.length} image assets under ${dir} carry a C2PA content credential.`);
    return 0;
  }

  io.error(`${unmarked.length} of ${images.length} image assets have no C2PA content credential:`);
  for (const f of unmarked) io.error(`  ${f}`);
  io.error('Mark them with: legalithm mark <file>');
  return params.warnOnly ? 0 : 1;
}
