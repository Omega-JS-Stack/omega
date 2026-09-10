/**
 * esbuild plugin form of the `@dev-only` strip (#18, #736).
 *
 * A thin binding to the ONE cut in `strip-dev-blocks.js` (the webpack loader
 * twin was deleted with the last webpack lane in
 * [#738](https://github.com/Omega-JS-Stack/omega/issues/738)), and
 * unconditional — the lane that registers the plugin decides WHEN. `bundle.js`
 * registers it for production builds only, so a dev build keeps its warnings
 * and simulation hooks.
 */

const fs = require('node:fs');

const { stripDevBlocks, START_MARKER } = require('./strip-dev-blocks.js');

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

module.exports = { stripDevBlocksPlugin };
