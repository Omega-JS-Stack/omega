/**
 * The mint bridge: which files of the brand's minted identity set ship with a
 * web site, and at which site paths.
 *
 * The manager's assets service mints the set into the gitignored
 * `<brandRoot>/.omega/assets/`. Two lanes read this ONE list: the web build's
 * static phase copies each source to its site path, and the deploy snapshot
 * force-adds the sources that exist, so a CI runner builds with the same set
 * the laptop has. The rest of the mint (app icons, the full size ladders)
 * stays home.
 */

const fs = require('node:fs');
const path = require('node:path');

// Brand-root relative, posix-spelled: the snapshot hands these to git as is.
const MINT_ROOT = '.omega/assets';
// The committed logo sources, and the one the whole mint derives from.
const LOGO_SOURCES_DIR = 'assets/logo';
const BRANDMARK_SOURCE = `${LOGO_SOURCES_DIR}/brandmark.svg`;

// The site paths read by name: the head's favicon links, the visible logo's
// vector read, and the manager's live probe of the raster brandmark.
const FAVICON_DEST = 'assets/images/favicon';
const BRANDMARK_SVG_DEST = 'assets/images/brand/brandmark.svg';
const BRANDMARK_PNG_DEST = 'assets/images/brand/brandmark.png';

// Source (brand-root relative) to site path. head.html's favicon links and the
// brand.images.{brandmark,social} config URLs resolve against these dests.
const MINT_BRIDGE = [
  { src: `${MINT_ROOT}/favicon`, dest: FAVICON_DEST },
  { src: `${MINT_ROOT}/logo/brandmark/color-x.svg`, dest: BRANDMARK_SVG_DEST },
  { src: `${MINT_ROOT}/logo/brandmark/color-512.png`, dest: BRANDMARK_PNG_DEST },
  { src: `${MINT_ROOT}/social/brandmark/color-1024.png`, dest: 'assets/images/brand/social.png' },
];

/**
 * The bridge sources that exist under this brand, in bridge order.
 *
 * @param {string} brandRoot - The brand folder.
 * @returns {string[]} Brand-root relative paths.
 */
function mintBridgeSources(brandRoot) {
  return MINT_BRIDGE
    .map(({ src }) => src)
    .filter((src) => fs.existsSync(path.join(brandRoot, src)));
}

/**
 * Whether the brand has the logo source the mint needs: the assets service
 * mints only from `assets/logo/brandmark.svg`, so a brand without it has no
 * set to ship and no fix to run.
 *
 * @param {string} brandRoot - The brand folder.
 * @returns {boolean}
 */
function hasLogoSources(brandRoot) {
  return fs.existsSync(path.join(brandRoot, BRANDMARK_SOURCE));
}

module.exports = {
  MINT_ROOT,
  LOGO_SOURCES_DIR,
  BRANDMARK_SOURCE,
  MINT_BRIDGE,
  FAVICON_DEST,
  BRANDMARK_SVG_DEST,
  BRANDMARK_PNG_DEST,
  mintBridgeSources,
  hasLogoSources,
};
