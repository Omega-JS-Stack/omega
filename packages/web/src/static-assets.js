/**
 * Static-asset channel: images that ship to the built site VERBATIM (no
 * bundling) — the brand's minted identity set bridged from
 * <brandRoot>/.omega/assets (manager assets service output: favicons,
 * brandmark, social image), then the consumer's own src/assets/images
 * layer, copied LAST so consumer files win collisions. Entries whose
 * source doesn't exist are skipped, so a brand with no minted assets
 * builds clean. buildSite runs the copies as its 'static' phase.
 */
const path = require('node:path');
const jetpack = require('fs-jetpack');

// <brandRoot>/.omega/assets → site paths. This is the mint contract:
// head.html's favicon links + brand.images.{brandmark,social} config URLs
// resolve against these destinations.
const MINT_BRIDGE = [
  { src: ['favicon'], dest: 'assets/images/favicon' },
  { src: ['logo', 'brandmark', 'color-x.svg'], dest: 'assets/images/brand/brandmark.svg' },
  { src: ['logo', 'brandmark', 'color-512.png'], dest: 'assets/images/brand/brandmark.png' },
  { src: ['social', 'brandmark', 'color-1024.png'], dest: 'assets/images/brand/social.png' },
];

/**
 * Resolve the ordered static copy list for a consumer build: minted brand
 * identity first, the consumer's images layer last (it wins collisions).
 * Sources that don't exist are dropped.
 * @param {object} options
 * @param {string|null} options.brandRoot - brand monorepo root (standalone apps: the app root)
 * @param {string} options.imagesDir - the consumer's src/assets/images
 * @returns {Array<{ src: string, dest: string }>}
 */
function resolveStaticDirs(options) {
  const entries = [];

  if (options.brandRoot) {
    const mintRoot = path.join(options.brandRoot, '.omega', 'assets');
    for (const { src, dest } of MINT_BRIDGE) {
      entries.push({ src: path.join(mintRoot, ...src), dest });
    }
  }

  entries.push({ src: options.imagesDir, dest: 'assets/images' });

  return entries.filter((entry) => jetpack.exists(entry.src));
}

/**
 * Whether a favicon set will ship with these static copies — the head only
 * renders its favicon/manifest links when the minted set (or a consumer-
 * authored one) actually exists, so a virgin brand serves zero dangling
 * links (cp194 wizard-rehearsal catch).
 * @param {Array<{ src: string, dest: string }>} staticDirs - From resolveStaticDirs().
 * @returns {boolean}
 */
function hasFaviconSet(staticDirs) {
  return (staticDirs || []).some(({ src, dest }) =>
    (dest === 'assets/images/favicon' && jetpack.exists(path.join(src, 'site.webmanifest')) === 'file')
    || (dest === 'assets/images' && jetpack.exists(path.join(src, 'favicon', 'site.webmanifest')) === 'file'));
}

/**
 * Copy the resolved entries into the build output, in order (later entries
 * overwrite earlier ones — that's the consumer-wins contract).
 * @param {object} options
 * @param {Array<{ src: string, dest: string }>} [options.staticDirs]
 * @param {string} options.outDir
 * @returns {{ copied: number }}
 */
function copyStaticAssets(options) {
  let copied = 0;

  for (const { src, dest } of options.staticDirs || []) {
    jetpack.copy(src, path.join(options.outDir, dest), { overwrite: true });
    copied += 1;
  }

  return { copied };
}

module.exports = { resolveStaticDirs, copyStaticAssets, hasFaviconSet };
