/**
 * `omega customize <url>` — materialize a default page into src/pages/ so it
 * can diverge (spec §8). Composition-wrapped pages prefill the theme's
 * default composition as clean one-liners (no copy inlined — sections keep
 * flowing); everything else copies the thin default page verbatim for
 * frontmatter-args customization. With no URL, lists every customizable
 * default URL and its lane.
 */
const path = require('node:path');
const Logger = require('@omega.js/devkit/logger');
const { consumerPaths, loadSiteData } = require('../consumer.js');
const { materialize, listCustomizable } = require('../customize.js');

const logger = new Logger('omega:customize');

module.exports = async function (options) {
  options = options || {};
  const paths = consumerPaths();
  const siteData = loadSiteData(paths.root);
  const url = (options._ || [])[1];

  if (!url) {
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
    return;
  }

  const result = materialize({ url, consumerDir: paths.src, siteData });
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
      throw new Error(`No default page at ${result.url}.${hint} Run \`omega customize\` to list every customizable URL.`);
    }
  }
};
