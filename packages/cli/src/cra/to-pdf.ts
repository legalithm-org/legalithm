/**
 * Turn the print-ready HTML into a PDF using a converter the machine already has.
 *
 * `legalithm` installs one package and no third-party code. That is asserted in
 * the record as an Annex I determination and checked by installing the published
 * tarball, so bundling a PDF engine would trade a signed determination for a
 * file format.
 *
 * Instead: look for a converter that is already present, use it, and if none is
 * there say so plainly and hand over the HTML. Every browser prints to PDF, so
 * the fallback is not a dead end, and a user who never installs anything still
 * gets the document.
 *
 * Ordered by fidelity. The headless browsers honour the print CSS properly;
 * `cupsfilter` is a last resort on macOS that ignores most of it, so it is
 * reported as degraded rather than silently producing something worse.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export interface Converter {
  id: string;
  /** Executable, or an absolute path to try. */
  bin: string;
  /** Build the argv for html -> pdf. */
  args: (html: string, pdf: string) => string[];
  /** True when the converter ignores most print CSS. */
  degraded?: boolean;
}

export const CONVERTERS: Converter[] = [
  {
    id: 'chrome',
    bin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: (html, pdf) => ['--headless=new', '--disable-gpu', `--print-to-pdf=${pdf}`, '--no-pdf-header-footer', `file://${html}`],
  },
  {
    id: 'chromium',
    bin: 'chromium',
    args: (html, pdf) => ['--headless=new', '--disable-gpu', `--print-to-pdf=${pdf}`, '--no-pdf-header-footer', `file://${html}`],
  },
  { id: 'weasyprint', bin: 'weasyprint', args: (html, pdf) => [html, pdf] },
  { id: 'wkhtmltopdf', bin: 'wkhtmltopdf', args: (html, pdf) => ['--quiet', html, pdf] },
  { id: 'cupsfilter', bin: 'cupsfilter', args: (html, _pdf) => [html], degraded: true },
];

export interface ConverterIo {
  /** Injected in tests so nothing spawns a process. */
  which?: (bin: string) => boolean;
  run?: (bin: string, args: string[]) => { status: number | null; stdout: Buffer };
}

function defaultWhich(bin: string): boolean {
  if (bin.startsWith('/')) return existsSync(bin);
  const r = spawnSync('command', ['-v', bin], { shell: true, stdio: 'pipe' });
  return r.status === 0;
}

export function findConverter(io: ConverterIo = {}): Converter | null {
  const which = io.which ?? defaultWhich;
  return CONVERTERS.find((c) => which(c.bin)) ?? null;
}

export interface ConversionResult {
  ok: boolean;
  converter?: string;
  degraded?: boolean;
  reason?: string;
}

export function htmlToPdf(htmlPath: string, pdfPath: string, io: ConverterIo = {}): ConversionResult {
  const converter = findConverter(io);
  if (!converter) {
    return {
      ok: false,
      reason:
        'No HTML-to-PDF converter found. Open the .html file and print it to PDF, which every browser does, ' +
        'or install one of: weasyprint, wkhtmltopdf, chromium.',
    };
  }

  const run = io.run ?? ((bin: string, args: string[]) => spawnSync(bin, args, { stdio: 'pipe' }));
  const result = run(converter.bin, converter.args(htmlPath, pdfPath));

  if (result.status !== 0) {
    return { ok: false, converter: converter.id, reason: `${converter.id} exited ${String(result.status)}` };
  }

  // cupsfilter writes the PDF to stdout rather than to a path.
  if (converter.id === 'cupsfilter' && result.stdout?.length) {
    return { ok: true, converter: converter.id, degraded: true, reason: 'stdout' };
  }

  return { ok: true, converter: converter.id, degraded: converter.degraded };
}
