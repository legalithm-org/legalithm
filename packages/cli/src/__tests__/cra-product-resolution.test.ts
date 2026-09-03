import { describe, it, expect } from 'vitest';
import { resolveProduct } from '../cra/commands.js';
import type { StoreEvent } from '../cra/store.js';

/**
 * `--product` used to accept only a prefix of the content-addressed key, so
 * `--product "Legalithm CLI"` failed with "No product matching" for a product
 * registered seconds earlier. The readable form was the one that did not work.
 */
const ev = (name: string, version: string): StoreEvent<any> =>
  ({ id: 'x', observedAt: '', recordedAt: '', body: { name, version, productClass: 'default' } }) as never;

const ONE = [ev('Legalithm CLI', '0.6.0')];
const TWO = [ev('Legalithm CLI', '0.6.0'), ev('Legalithm CLI', '0.5.0')];

describe('resolveProduct', () => {
  it('accepts the name a human would actually type', () => {
    const r = resolveProduct(ONE, 'Legalithm CLI');
    expect('product' in r && r.product.body.version).toBe('0.6.0');
  });

  it('is case insensitive, because a name is not a hash', () => {
    expect('product' in resolveProduct(ONE, 'legalithm cli')).toBe(true);
  });

  it('accepts name@version', () => {
    const r = resolveProduct(TWO, 'Legalithm CLI@0.5.0');
    expect('product' in r && r.product.body.version).toBe('0.5.0');
  });

  it('still accepts a key prefix', () => {
    const r = resolveProduct(ONE, 'aad5ffe2');
    expect('product' in r && r.product.body.name).toBe('Legalithm CLI');
  });

  /**
   * The one that matters. The CRA's unit of obligation is the product VERSION,
   * so guessing here would attach evidence, findings and Article 14 clocks to
   * the wrong subject.
   */
  it('REFUSES an ambiguous name instead of picking the newest', () => {
    const r = resolveProduct(TWO, 'Legalithm CLI');
    expect('error' in r).toBe(true);
    if ('error' in r) {
      expect(r.error).toContain('matches 2 registered versions');
      expect(r.error).toContain('unit of obligation is the product version');
      expect(r.error).toContain('0.6.0');
      expect(r.error).toContain('0.5.0');
    }
  });

  it('lists what IS registered when nothing matches', () => {
    const r = resolveProduct(ONE, 'Nonexistent');
    expect('error' in r && r.error).toContain('Legalithm CLI 0.6.0');
  });

  it('with no query, takes the most recently registered', () => {
    const r = resolveProduct(TWO, undefined);
    expect('product' in r && r.product.body.version).toBe('0.5.0');
  });

  it('errors rather than throwing when nothing is registered', () => {
    expect('error' in resolveProduct([], undefined)).toBe(true);
  });
});
