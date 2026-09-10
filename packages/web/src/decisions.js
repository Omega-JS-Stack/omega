/**
 * The LIVE decisions of a build (#200 Lane B). Two config-time scans do not
 * describe the config — they describe the CONTENT, and content changes while
 * the dev server runs:
 *   - which URLs the consumer's own pages claim (a framework default page at
 *     the same permalink steps aside), and
 *   - which collections the brand has real files in (the first real post ends
 *     that collection's sample corpus).
 * Baking either into the Eleventy config would put every page edit on the
 * config-reset lane, which is exactly what the incremental rebuild contract
 * forbids. So both are RESCAN captures (@omega.js/devkit/reads): the scan registers the
 * dirs it read, the dev loop re-runs just that scan when one changes, and the
 * render asks THIS object for the answer at data time.
 *
 * It also owns the permalink-collision diagnostic, because the collision is a
 * fact of the same scan: two files shipping one URL is loud in dev (re-emitted
 * on every rescan while it lasts) and fatal in a production build.
 */
const path = require('node:path');
const Logger = require('@omega.js/devkit/logger');
const reads = require('@omega.js/devkit/reads');
const { scanConsumerPages, findPermalinkCollisions } = require('./consumer-scan.js');
const { hasOwnContent } = require('./sample-content.js');
const { isProduction } = require('./mode-helpers.js');

const logger = new Logger('decisions');

/**
 * Create the decisions object for one config build. The captures run
 * IMMEDIATELY (inside the caller's capture scope — that is what records their
 * dirs), so the object answers from real state the moment it exists.
 * @param {object} options
 * @param {string} options.consumerDir - the Eleventy input dir
 * @param {string[]} options.collectionDirs - the sample-content collections ('_posts', …)
 * @param {string} [options.environment] - the build's environment (#717, read through the one surface) — production makes a collision fatal
 * @param {function} [options.log] - diagnostic sink (default: the web logger)
 * @returns {object} the live decisions
 */
function createDecisions(options) {
  const consumerDir = options.consumerDir;
  const log = options.log || ((message) => logger.error(message));
  const state = { pages: [], urls: new Set(), own: new Map(), framework: null };
  const captures = [];

  // ONE line per capture: `reads.rescan` runs it now, records every dir it
  // reads as a rescan target, and hands the dev loop this very function to
  // re-run when one of those dirs changes.
  const capture = (run) => {
    captures.push(run);
    reads.rescan(run);
  };

  capture(() => {
    state.pages = scanConsumerPages(consumerDir);
    state.urls = new Set(state.pages.map((page) => page.url));
    report();
  });

  for (const collectionDir of options.collectionDirs) {
    capture(() => state.own.set(collectionDir, hasOwnContent(consumerDir, collectionDir)));
  }

  /**
   * Emit the collision diagnostic for the CURRENT scan. A no-op until the
   * engine has handed over the framework pages (the first capture run happens
   * while they are still being collected).
   */
  function report() {
    if (!state.framework) return;

    const collisions = findPermalinkCollisions({
      pages: state.pages.map((page) => ({ label: path.relative(consumerDir, page.file), url: page.url })),
      framework: state.framework,
    });
    if (!collisions.length) return;

    const messages = collisions.map(collisionMessage);
    // A shipped site cannot have two files at one URL — one of them silently
    // wins and the other is simply gone. Dev says it loudly and keeps serving;
    // a production build stops.
    if (isProduction.call(options)) throw new Error(messages.join('\n'));
    messages.forEach((message) => log(message));
  }

  return {
    /**
     * Hand over the framework pages that RENDER (default pages, and the
     * showcase in dev) — the second half of the collision picture — and report
     * what the scan already found.
     * @param {Array<{ label: string, url: string }>} pages
     */
    framework(pages) {
      state.framework = pages.map((page) => ({ label: page.label, url: page.url, framework: true }));
      report();
    },

    /**
     * Does a consumer page claim this URL? (A framework page at the same
     * permalink steps aside.)
     * @param {string} url
     * @returns {boolean}
     */
    suppresses(url) {
      return Boolean(url) && state.urls.has(url);
    },

    /**
     * Does the brand have real content in a collection? (Its samples stop.)
     * @param {string} collectionDir
     * @returns {boolean}
     */
    hasOwn(collectionDir) {
      return state.own.get(collectionDir) === true;
    },

    /**
     * The framework URLs the consumer has taken over right now.
     * @returns {string[]}
     */
    suppressedUrls() {
      return (state.framework || []).filter((page) => this.suppresses(page.url)).map((page) => page.url);
    },

    /**
     * Re-run every capture. The dev loop's rescan watcher re-runs just the
     * affected one; this is the whole-picture refresh Eleventy runs before
     * every build, so a render can never read a decision older than its own
     * build no matter which watcher saw the file event first.
     */
    refresh() {
      captures.forEach((run) => run());
    },
  };
}

/**
 * The diagnostic for one collision: the URL, every file that claims it, and
 * the fix. A framework page in the claims means the consumer page MEANT to
 * override it and spelled the permalink differently — say so, because "use the
 * exact permalink" is the whole fix.
 * @param {{ url: string, claims: Array<{ label: string, url: string, framework?: boolean }> }} collision
 * @returns {string}
 */
function collisionMessage(collision) {
  const framework = collision.claims.find((claim) => claim.framework);
  const labels = collision.claims.map((claim) => claim.label).join(', ');
  const fix = framework
    ? `A framework default page only steps aside for the exact permalink it uses (${framework.url}) — give your page that permalink to replace it, or move your page to another URL.`
    : 'One URL, one file: change one of the permalinks.';
  return `Permalink collision at ${collision.url} — ${collision.claims.length} files claim it: ${labels}. ${fix}`;
}

module.exports = { createDecisions };
