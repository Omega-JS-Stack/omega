/**
 * Webpack Loader: strip-dev-blocks
 * Strips code between the `@dev-only:start` and `@dev-only:end` markers.
 * Runs before webpack bundles, so the source code is still clean.
 *
 * The markers and the cut itself live in ONE home (#18) — @omega.js/devkit —
 * shared with @omega.js/web's esbuild plugin and @omega.js/desktop's webpack lane.
 * This wrapper only adds the build-mode gate.
 */

const { stripDevBlocks } = require('@omega.js/devkit/strip-dev-blocks');

module.exports = function stripDevBlocksLoader(source) {
  // Only strip in build mode
  if (process.env.OMEGA_BUILD_MODE !== 'true') {
    return source;
  }

  return stripDevBlocks(source);
};
