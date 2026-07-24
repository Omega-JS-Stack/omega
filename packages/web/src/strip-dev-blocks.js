/**
 * Strip code between the `@dev-only:start` and `@dev-only:end` marker
 * comments from JS at bundle time (UJM strip-dev-blocks loader parity).
 * Production builds only — dev builds keep the blocks so dev warnings and
 * simulation hooks run. Without this, dev-only code (e.g. the OAuth "may
 * fail in development" notification in core auth) ships to the live site.
 */
const fs = require('node:fs');

const START_MARKER = '/* @dev-only:start */';
const END_MARKER = '/* @dev-only:end */';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BLOCK_PATTERN = new RegExp(`${escapeRegex(START_MARKER)}[\\s\\S]*?${escapeRegex(END_MARKER)}`, 'g');

/**
 * Strip every dev-only block from a source string.
 * @param {string} source
 * @returns {string}
 */
function stripDevBlocks(source) {
  return source.replace(BLOCK_PATTERN, '');
}

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
