// @dev-only strip, extension webpack lane (#18): the loader is a thin gate over the
// ONE home (@omega.js/devkit) — it cuts only in build mode, so a watch-mode dev
// bundle keeps the dev warnings and simulation hooks.

const path = require('path');

const PACKAGE_ROOT = path.join(__dirname, '..', '..', '..', '..');
const stripDevBlocksLoader = require(path.join(PACKAGE_ROOT, 'src', 'gulp', 'loaders', 'webpack', 'strip-dev-blocks.js'));
const { START_MARKER, END_MARKER } = require('@omega.js/devkit/strip-dev-blocks');

const SOURCE = [
  'const keep = 1;',
  START_MARKER,
  'console.log("DEV_ONLY_SENTINEL");',
  END_MARKER,
  '',
].join('\n');

function withBuildMode(value, fn) {
  const previous = process.env.OMEGA_BUILD_MODE;
  if (value === undefined) {
    delete process.env.OMEGA_BUILD_MODE;
  } else {
    process.env.OMEGA_BUILD_MODE = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.OMEGA_BUILD_MODE;
    } else {
      process.env.OMEGA_BUILD_MODE = previous;
    }
  }
}

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'strip-dev-blocks — the extension loader gates the shared cut on build mode',
  tests: [
    {
      name: 'build mode cuts the dev-only block',
      run: async (ctx) => {
        const out = withBuildMode('true', () => stripDevBlocksLoader(SOURCE));
        ctx.expect(out).toContain('const keep = 1;');
        ctx.expect(out.includes('DEV_ONLY_SENTINEL')).toBe(false);
      },
    },

    {
      name: 'outside build mode the source is untouched',
      run: async (ctx) => {
        ctx.expect(withBuildMode(undefined, () => stripDevBlocksLoader(SOURCE))).toBe(SOURCE);
      },
    },
  ],
};
