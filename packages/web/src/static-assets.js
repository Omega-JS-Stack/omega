/**
 * Static-asset channel: files that ship to the built site VERBATIM (no
 * bundling) — the framework's own core images first, then the brand's
 * minted identity set bridged from <brandRoot>/.omega/assets (manager
 * assets service output: favicons, brandmark, social image), then the
 * consumer's own src/assets layer, copied LAST so consumer files win
 * collisions. Entries whose source doesn't exist are skipped, so a brand
 * with no minted assets builds clean. buildSite runs the copies as its
 * 'static' phase.
 *
 * The consumer layer is the WHOLE src/assets tree, not just images (#295):
 * audio, video, downloadable documents — a page that references
 * /assets/audio/alarm.mp3 got a 404 while the file sat in src/. The
 * pipeline-owned lanes are the exception (PIPELINE_LANES).
 *
 * The copies also mirror the shipped favicon.ico to the site ROOT, because
 * browsers probe /favicon.ico with no link tag involved (#161).
 */
const path = require('node:path');
const jetpack = require('fs-jetpack');
const { PATHS } = require('./paths.js');

// The ASSET PIPELINE owns these src/assets children — it reads them as layer
// roots (assets.js) and writes its own dist/assets/<lane> from the layered
// union: content-hashed js/css bundles, and fonts pruned to the faces some
// emitted stylesheet references. The static phase runs after it, so a verbatim
// copy would drop unbundled sources beside the bundles and undo the font prune.
const PIPELINE_LANES = new Set(['js', 'css', 'fonts']);

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
 * identity first, the consumer's own asset layer last (it wins collisions).
 * Sources that don't exist are dropped.
 * @param {object} options
 * @param {string|null} options.brandRoot - brand monorepo root (standalone projects: the target root)
 * @param {string} options.assetsDir - the consumer's src/assets
 * @param {string} [options.coreDir] - the framework core layer (default: packaged core)
 * @returns {Array<{ src: string, dest: string }>}
 */
function resolveStaticDirs(options) {
  const entries = [];

  // Framework-shipped images (core/images → /assets/images/core): the
  // packaged pictures core templates reference by fixed URL — today the
  // exit popup's social-proof faces. First, so both brand layers win.
  entries.push({ src: path.join(options.coreDir || PATHS.core, 'images'), dest: 'assets/images/core' });

  if (options.brandRoot) {
    const mintRoot = path.join(options.brandRoot, '.omega', 'assets');
    for (const { src, dest } of MINT_BRIDGE) {
      entries.push({ src: path.join(mintRoot, ...src), dest });
    }
  }

  // images/ stays its OWN entry (imagemin and the favicon probe both address
  // that destination by name); everything else the consumer keeps under
  // src/assets rides beside it, one entry per child, in a stable order.
  // Hidden entries never ride: the widened lane listed .DS_Store & co. as
  // content and shipped Finder noise to dist.
  entries.push({ src: path.join(options.assetsDir, 'images'), dest: 'assets/images' });
  for (const name of (jetpack.list(options.assetsDir) || []).sort()) {
    if (name.startsWith('.') || name === 'images' || PIPELINE_LANES.has(name)) continue;
    entries.push({ src: path.join(options.assetsDir, name), dest: `assets/${name}` });
  }

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
 * overwrite earlier ones — that's the consumer-wins contract), then mirror
 * the shipped favicon.ico to the site root.
 * @param {object} options
 * @param {Array<{ src: string, dest: string }>} [options.staticDirs]
 * @param {string} options.outDir
 * @returns {{ copied: number, rootFavicon: boolean }}
 */
function copyStaticAssets(options) {
  let copied = 0;

  for (const { src, dest } of options.staticDirs || []) {
    jetpack.copy(src, path.join(options.outDir, dest), { overwrite: true });
    copied += 1;
  }

  return { copied, rootFavicon: mirrorRootFavicon(options.outDir) };
}

/**
 * Mirror the shipped favicon set's .ico to <outDir>/favicon.ico. Browsers
 * probe /favicon.ico directly (no link tag), so the built site answers it in
 * dev and in production alike. Sourced from the COPIED set, so the
 * consumer-wins collision result is what lands at the root; no set shipped,
 * nothing to mirror.
 * @param {string} outDir
 * @returns {boolean} Whether a root favicon.ico was written.
 */
function mirrorRootFavicon(outDir) {
  const shipped = path.join(outDir, 'assets', 'images', 'favicon', 'favicon.ico');
  if (jetpack.exists(shipped) !== 'file') return false;

  jetpack.copy(shipped, path.join(outDir, 'favicon.ico'), { overwrite: true });

  return true;
}

module.exports = { resolveStaticDirs, copyStaticAssets, hasFaviconSet };
