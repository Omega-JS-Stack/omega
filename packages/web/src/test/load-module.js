/**
 * loadModule: a brand suite's way to run one of its page modules. The module is
 * bundled the way the asset build bundles it (web's own copies of its imports,
 * the same consumer aliases), then evaluated in-process over the browser
 * objects the test passes in: const { loadModule } = require('@omega.js/web/test');
 */
const path = require('node:path');
const jetpack = require('fs-jetpack');
const { bundle } = require('@omega.js/devkit/bundle');
const { consumerAliasPlugin } = require('../consumer-aliases.js');
const { PATHS, resolveClientEntry } = require('../paths.js');

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..');
// The global the runtime stub reads: the `omega` the test passes in.
const RUNTIME_GLOBAL = '__omegaLoadModuleRuntime';
// Each browser key, and the global it stands in for while the bundle evaluates.
const BROWSER_GLOBALS = { omega: RUNTIME_GLOBAL, document: 'document', window: 'window' };

// Runs before consumerAliasPlugin, so it owns `@omega.js/web/runtime`.
const runtimeStubPlugin = {
  name: 'omega-load-module-runtime',
  setup(build) {
    build.onResolve({ filter: /^@omega\.js\/web\/runtime$/ }, (args) => ({ path: args.path, namespace: 'omega-load-module' }));
    build.onLoad({ filter: /.*/, namespace: 'omega-load-module' }, () => ({
      contents: `export default globalThis.${RUNTIME_GLOBAL};`,
    }));
  },
};

// Set each passed key's global and answer the function putting them back:
// a key not passed is never touched, an absent global is deleted again.
function setBrowserGlobals(browser) {
  const saved = Object.entries(BROWSER_GLOBALS)
    .filter(([key]) => Object.hasOwn(browser, key))
    .map(([key, name]) => {
      const entry = { name, had: Object.hasOwn(globalThis, name), value: globalThis[name] };
      globalThis[name] = browser[key];
      return entry;
    });

  return () => saved.forEach(({ name, had, value }) => {
    if (had) globalThis[name] = value;
    else delete globalThis[name];
  });
}

/**
 * Bundle one consumer module and evaluate it over the passed browser objects.
 * @param {string} modulePath - the module, absolute or relative to process.cwd()
 * @param {object} [browser] - every key optional
 * @param {object} [browser.omega] - what `import omega from '@omega.js/web/runtime'` answers
 * @param {object} [browser.document] - `document` while the module evaluates
 * @param {object} [browser.window] - `window` while the module evaluates
 * @returns {Promise<object>} the module's exports (`default` carries its default export)
 */
async function loadModule(modulePath, browser = {}) {
  const dir = jetpack.tmpDir({ prefix: 'omega-load-module-' });
  try {
    const outfile = dir.path('module.js');
    await bundle({
      frameworkRoot: FRAMEWORK_ROOT,
      entries: [path.resolve(modulePath)],
      outfile,
      format: 'cjs',
      platform: 'browser',
      dev: true,
      plugins: [
        runtimeStubPlugin,
        consumerAliasPlugin({ coreDir: PATHS.core, themesDir: PATHS.themes, clientEntry: resolveClientEntry() }),
      ],
    });

    // The cache key is the real path, which a symlinked temp dir is not.
    const resolved = require.resolve(outfile);
    const restore = setBrowserGlobals(browser);
    try {
      return require(resolved);
    } finally {
      delete require.cache[resolved];
      restore();
    }
  } finally {
    dir.remove();
  }
}

module.exports = { loadModule };
