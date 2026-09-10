/**
 * The `@dev-only` marker contract — ONE home (#18).
 *
 * Code between the markers runs in development and is cut out of every
 * PRODUCTION bundle, so dev warnings and simulation hooks never ship. Each
 * Every framework registers the strip the same way now — the esbuild plugin
 * beside this file, which `bundle.js` composes for production builds — but the
 * markers and the cut itself live here, once.
 */

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
  // Fast path — most files carry no markers at all, and this runs over every
  // module a bundle pulls in (dependencies included).
  if (!source.includes(START_MARKER)) {
    return source;
  }

  return source.replace(BLOCK_PATTERN, '');
}

module.exports = { stripDevBlocks, START_MARKER, END_MARKER };
