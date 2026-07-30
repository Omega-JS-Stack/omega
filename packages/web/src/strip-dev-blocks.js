/**
 * Strip code between the `@dev-only:start` and `@dev-only:end` marker
 * comments from JS at bundle time (UJM strip-dev-blocks loader parity).
 * Production builds only — dev builds keep the blocks so dev warnings and
 * simulation hooks run. Without this, dev-only code (e.g. the OAuth "may
 * fail in development" notification in core auth) ships to the live site.
 *
 * The markers and the cut itself live in ONE home (#18) — @omega.js/devkit —
 * shared with @omega.js/extension's and @omega.js/desktop's webpack loaders.
 * This file is web's esbuild binding to them.
 */
const fs = require('node:fs');

const { stripDevBlocks, START_MARKER, END_MARKER } = require('@omega.js/devkit/strip-dev-blocks');

/**
 * esbuild plugin: strip dev-only blocks from every .js file loaded in a
 * production bundle. Registered only when the build is NOT in dev mode.
 */
const stripDevBlocksPlugin = {
  name: 'omega-strip-dev-blocks',
  setup(build) {
    build.onLoad({ filter: /\.js$/ }, (args) => {
      const source = fs.readFileSync(args.path, 'utf8');
      if (!source.includes(START_MARKER)) {
        return null; // untouched — let esbuild load it normally
      }
      return { contents: stripDevBlocks(source), loader: 'js' };
    });
  },
};

module.exports = { stripDevBlocks, stripDevBlocksPlugin, START_MARKER, END_MARKER };
