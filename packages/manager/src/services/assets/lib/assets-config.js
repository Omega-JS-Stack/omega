/**
 * Assets processing rules — which logo sources produce which derived files.
 *
 * Sources live in the brand repo at `assets/logo/*.svg` (committed brand
 * collateral — omega-manager read `.brands/{id}/assets/`); derived files
 * land in `.omega/assets/` (gitignored, regenerable — omega-manager's
 * `.output/{id}/assets/`).
 *
 * Logo naming conventions:
 * - brandmark: Square icon/symbol (no text)
 * - wordmark: Text-only logo
 * - combomark: Icon + text combined
 */

const BRANDMARK_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024, 2048];
const WIDE_LOGO_SIZES = [128, 256, 512, 1024, 2048];

/**
 * Each logo source gets two variants — the SVG as-is (colors/gradients
 * preserved) and an all-black conversion — exported as SVG + PNGs at all
 * sizes.
 */
const PROCESSING_RULES = {
  brandmark: {
    source: 'assets/logo/brandmark.svg',
    outputDir: 'logo/brandmark',
    square: true,
    sizes: BRANDMARK_SIZES,
  },
  wordmark: {
    source: 'assets/logo/wordmark.svg',
    outputDir: 'logo/wordmark',
    square: false,
    sizes: WIDE_LOGO_SIZES,
  },
  combomark: {
    source: 'assets/logo/combomark.svg',
    outputDir: 'logo/combomark',
    square: false,
    sizes: WIDE_LOGO_SIZES,
  },
};

/**
 * Social profile icons — square brandmark on a white background for
 * profile pictures (YouTube, Twitter, …).
 */
const SOCIAL_ICON_CONFIG = {
  outputDir: 'social/brandmark',
  sizes: [512, 1024, 2048],
  padding: 0.15, // 15% padding on each side
  background: { r: 255, g: 255, b: 255, alpha: 1 },
};

/**
 * App icon formats per platform. The composited `icon.png` comes from the
 * PSD templates operation when it ports; until then the brandmark SVG is
 * the source.
 */
const ICON_PLATFORMS = {
  macos: { format: 'icns' },
  windows: { format: 'ico' },
};

/**
 * Web favicon set.
 */
const FAVICON_CONFIG = {
  files: [
    { name: 'favicon-16x16.png', size: 16 },
    { name: 'favicon-32x32.png', size: 32 },
    { name: 'apple-touch-icon.png', size: 180 },
    { name: 'android-chrome-192x192.png', size: 192 },
    { name: 'android-chrome-512x512.png', size: 512 },
  ],
};

module.exports = { PROCESSING_RULES, SOCIAL_ICON_CONFIG, ICON_PLATFORMS, FAVICON_CONFIG };
