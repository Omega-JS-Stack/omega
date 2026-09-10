/**
 * `omega customize` — take ownership of framework content, one piece at a time.
 *
 * - `<url>` materializes a default PAGE into src/pages/ so it can diverge (spec
 *   §8). Composition-wrapped pages prefill the theme's default composition as
 *   clean one-liners (no copy inlined — sections keep flowing); everything else
 *   copies the thin default page verbatim for frontmatter-args customization.
 * - `<path>` materializes ONE shadowable FILE (section, include, css) at the
 *   path that shadows it, with a provenance header naming the source layer (#94).
 * - `--list` prints the whole layered override map — every shadowable file, its
 *   owning layer, and whether this consumer already shadows it (#94).
 * - no argument lists the customizable default URLs and their lanes.
 */
const path = require('node:path');
const Logger = require('@omega.js/devkit/logger');
const { consumerPaths, loadSiteData } = require('../consumer.js');
const { materialize, listCustomizable } = require('../customize.js');
const { buildOverrideMap, materializeOverride } = require('../overrides.js');

const logger = new Logger('customize');

// Section/include/css entries print grouped under these headings, in this order
const KIND_HEADINGS = [
  ['page', 'Pages (omega customize <url>)'],
  ['section', 'Sections & components (entry-resolved: the layer owning section.html wins the folder)'],
  ['include', 'Includes'],
  ['css', 'Stylesheets'],
];

/**
 * Print the layered override map.
 * @param {object} options - { root, src, siteData }
 */
function printMap({ root, src, siteData }) {
  const entries = buildOverrideMap({ consumerDir: src, siteData });
  const width = entries.reduce((max, entry) => Math.max(max, entry.path.length), 0);

  logger.log('The layered override map — own a path to override it (omega customize <path>):');
  for (const [kind, heading] of KIND_HEADINGS) {
    const group = entries.filter((entry) => entry.kind === kind);
    if (!group.length) continue;

    logger.log('');
    logger.log(heading);
    for (const entry of group) {
      const state = entry.shadowed
        ? `shadowed by you${entry.target ? ` (${path.relative(root, entry.target)})` : ''}`
        : `from ${entry.layer}`;
      logger.log(`  ${entry.path.padEnd(width)}  ${state}`);
    }
  }
  logger.log('');
  logger.log('framework = the theme-agnostic core layer · theme:<id> = a theme layer · consumer = yours');
}

module.exports = async function (options) {
  options = options || {};
  const paths = consumerPaths();
  const siteData = loadSiteData(paths.root);
  const target = (options._ || [])[1];

  if (options.list) return printMap({ root: paths.root, src: paths.src, siteData });

  if (!target) {
    const entries = listCustomizable({ consumerDir: paths.src, siteData });
    logger.log('Customizable default pages (omega customize <url>):');
    for (const entry of entries) {
      const lane = entry.lane === 'composition' ? 'composition' : 'copy';
      const owned = entry.owned ? `  — already customized (${path.relative(paths.root, entry.owned)})` : '';
      logger.log(`  ${entry.url.padEnd(28)} ${lane}${owned}`);
    }
    logger.log('');
    logger.log('composition = prefills the theme\'s section one-liners (you own the order + your args)');
    logger.log('copy        = verbatim thin copy (customize via frontmatter args; everything keeps flowing)');
    logger.log('');
    logger.log('Sections, includes and stylesheets are shadowable too: omega customize --list');
    return;
  }

  // A map path names a FILE to shadow; anything else is a page URL
  const file = materializeOverride({ path: target, consumerDir: paths.src, siteData });
  if (file.status !== 'unknown') {
    const rel = path.relative(paths.root, file.target);

    if (file.status === 'exists') {
      logger.log(`Nothing to do — you already shadow ${file.path} (${rel}).`);
      return;
    }

    logger.log(`Materialized ${rel} — a copy of the ${file.layer} layer's file.`);
    if (!file.headed) logger.log('No provenance header: this format carries no comments.');
    if (file.kind === 'section' && !file.path.endsWith('.html')) {
      logger.log('Sections resolve per ENTRY — shadow the entry\'s section.html too, or declare `inherit` in its json5.');
    }
    logger.log('Delete the file to return to the framework\'s.');
    return;
  }

  const result = materialize({ url: target, consumerDir: paths.src, siteData });
  const rel = result.target ? path.relative(paths.root, result.target) : null;

  switch (result.status) {
    case 'created':
      if (result.lane === 'composition') {
        logger.log(`Materialized ${rel} — the default composition as one-liners.`);
        logger.log('Sections keep flowing from the theme; the order and any args you add are yours.');
        logger.log('Args reference: /test/sections (dev builds). Delete the file to return to the default.');
      } else {
        logger.log(`Copied ${rel} verbatim — this page's theme layout isn't a pure composition (yet).`);
        logger.log('Customize via frontmatter args; everything keeps flowing from the theme.');
      }
      break;
    case 'exists':
      logger.log(`Nothing to do — ${rel} already exists.`);
      break;
    case 'owned':
      logger.log(`Nothing to do — you already own ${result.url} (${path.relative(paths.root, result.ownedFile)}).`);
      break;
    default: {
      const near = result.known.filter((known) => known.includes(result.url.replace(/^\//, ''))).slice(0, 5);
      const hint = near.length ? ` Did you mean: ${near.join(', ')}?` : '';
      throw new Error(`No default page or shadowable file at ${target}.${hint} Run \`omega customize --list\` to list everything you can own.`);
    }
  }
};
