/**
 * The import specifiers web answers for consumer code, as one esbuild plugin:
 * the asset build and the test door's loadModule both bundle through it, so a
 * page module resolves the same framework files in a build and in a test.
 *
 *   __main_assets__/js/...  → the core layer (framework runtime modules)
 *   __main_assets__/themes/…→ the packaged themes dir (e.g. bootstrap js)
 *   @omega.js/client        → the @omega.js/client entry, subpaths included
 *   @omega.js/web/runtime   → the web runtime instance (runtime/omega.js)
 */
const path = require('node:path');
const { PATHS } = require('./paths.js');

/**
 * Build the consumer-alias plugin over one set of framework locations.
 * @param {object} options
 * @param {string} options.coreDir - the core layer `__main_assets__/` resolves into
 * @param {string} options.themesDir - the packaged themes dir `__main_assets__/themes/` resolves into
 * @param {string} options.clientEntry - the resolved @omega.js/client entry module
 * @returns {object} the esbuild plugin
 */
function consumerAliasPlugin({ coreDir, themesDir, clientEntry }) {
  const clientDir = path.dirname(clientEntry);

  return {
    name: 'omega-consumer-aliases',
    setup(build) {
      // Asset aliases: __main_assets__ → core layer / themes dir
      build.onResolve({ filter: /^__main_assets__\// }, (args) => {
        const rest = args.path.slice('__main_assets__/'.length);
        const target = rest.startsWith('themes/')
          ? path.join(themesDir, rest.slice('themes/'.length))
          : path.join(coreDir, rest);
        return { path: target };
      });

      // Directory alias so SUBPATH imports work too (@omega.js/client/modules/dom.js).
      // The rewritten path is absolute, so esbuild's own resolution never re-enters this hook.
      build.onResolve({ filter: /^@omega\.js\/client(\/|$)/ }, (args) => {
        const target = clientDir + args.path.slice('@omega.js/client'.length);
        return build.resolve(target, { kind: args.kind, resolveDir: args.resolveDir });
      });

      // `@omega.js/web/runtime` is this package's own file, pinned here so it
      // resolves the same in the monorepo and in a published install.
      build.onResolve({ filter: /^@omega\.js\/web\/runtime$/ }, () => ({
        path: path.join(PATHS.runtime, 'omega.js'),
      }));
    },
  };
}

module.exports = { consumerAliasPlugin };
