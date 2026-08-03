# Marking robustness report: reference image (1024x590 PNG, photographic)

8 of 10 transforms preserved the watermark.

| Transform | Scenario | Expected | Measured | Confidence |
| --- | --- | --- | --- | --- |
| jpeg-q90 | Lossy re-encode at high quality (CMS or CDN pipeline) | survives | survived | 3.89 |
| jpeg-q75 | Lossy re-encode at typical web quality | survives | survived | 3.89 |
| jpeg-q50 | Aggressive compression (messaging apps) | survives | survived | 3.75 |
| resize-down-512 | Downscaled to a content width | survives | survived | 3.85 |
| resize-down-256 | Thumbnail generation | survives | survived | 3.48 |
| resize-up-1600-jpeg | Upscaled and re-encoded | survives | survived | 3.85 |
| strip-metadata-webp | Format conversion that discards all metadata (kills C2PA) | survives | survived | 3.63 |
| greyscale | Colour removed | survives | survived | 3.87 |
| crop-70pct | Heavy crop, desynchronises the block lattice | defeated | not detected | 0.84 |
| rotate-90 | Rotation, the lattice no longer aligns | defeated | not detected | 0.76 |

## Visual impact

Embedding shifts every pixel by exactly DELTA (4 of 255, about 1.6%). Measured
on the same reference image:

| Metric | Value |
| --- | --- |
| Max per-channel difference | 4 |
| Mean absolute difference | 4.00 |
| PSNR | 36.1 dB |

For context, 40 dB is the usual "visually lossless" threshold, so this sits
just below it. The shift is imperceptible on textured or noisy content and can
show as very faint blocking on large smooth gradients. That is the deliberate
trade: DELTA is what buys survival through JPEG q50, and lowering it weakens
detection. If you need a higher-fidelity mark for gradient-heavy artwork, lower
DELTA and re-run this suite, but change it in BOTH the CLI and the WordPress
plugin or marks stop being cross-readable.

## Idempotency

Embedding is idempotent. Each pass shifts luminance again, so re-marking an
already-marked asset compounded the signal (measured 3.91, then 7.82, then
11.74) and progressively degraded the image. An already-marked asset is now
returned unchanged; pass `force` to override.

Scope: this measures resilience to ordinary redistribution. It is not an
adversarial guarantee. Generative regeneration attacks can remove pixel-level
watermarks, and a motivated attacker who knows the scheme can defeat it.

Regenerate with the `robustness suite` test in `src/__tests__/watermark.test.ts`.
