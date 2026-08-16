// webpack — three configs (main / preload / renderer), compiled in parallel.
// Each target gets `OMEGA_BUILD_JSON` injected via DefinePlugin.

const Manager = new (require('../../build.js'));
const logger = Manager.logger('webpack');
const path = require('path');
const glob = require('glob').globSync;
const webpack = require('webpack');
const jetpack = require('fs-jetpack');
const { readSiblingPorts, envPorts } = require('@omega.js/config');

const projectRoot   = Manager.getRootPath('project');
const frameworkRoot = Manager.getRootPath();
const outputRoot    = require('../../utils/dist-root.js')(projectRoot);

// Shared resolve config — lets consumer code `require()` any of @omega.js/desktop's bundled
// dependencies (fs-jetpack, @omega.js/client, etc.) without installing them directly.
// The FRAMEWORK's node_modules comes first (#87): the framework's copy wins, so a
// consumer that declares its own version of a framework dependency still bundles ONE
// copy — the framework's — exactly like @omega.js/web's esbuild half. npm nests a
// private copy under the framework only when the consumer's declaration conflicts, so
// this order finds the nested copy when there is a conflict and the shared hoisted copy
// when there is not. Accepted trade: the framework's copy also wins for TRANSITIVE
// packages it happens to carry, not just the ones it declares.
function makeSharedResolve(project, framework) {
  return {
    modules: [
      path.join(framework, 'node_modules'),
      path.join(project, 'node_modules'),
      'node_modules',
    ],
  };
}

const sharedResolve = makeSharedResolve(projectRoot, frameworkRoot);

// @dev-only strip (#18) — production bundles must not carry the dev-only blocks
// their inputs hold: @omega.js/client's src and the vendored theme assets both
// use the markers, and every one reaches a bundle here. The marker contract and
// the cut live in @omega.js/devkit (one home); this returns the module rule for
// a config, production only. No node_modules exclude — the markers arrive via
// BUNDLED dependencies, and the loader short-circuits on files without the
// start marker, so the sweep is a substring check per module.
function makeStripModule(isProd) {
  if (!isProd) return { rules: [] };
  return {
    rules: [
      {
        test: /\.js$/,
        use: [require.resolve('@omega.js/devkit/strip-dev-blocks-loader')],
      },
    ],
  };
}

module.exports = function webpackTask(done) {
  const mode = Manager.getMode();
  const isProd = mode.environment === 'production';
  const config = Manager.getConfig();

  // The renderer's @omega.js/client reads `config.dev.ports` to reach the
  // local stack (N7). A renderer has no env and no filesystem walk of its
  // own, so the map has to be BAKED — the sibling backend's published map
  // (this brand's live emulator suite) plus anything a parent injected on the
  // env channel, resolved on every build so a rebuild picks up a restarted
  // emulator ([#300](https://github.com/Omega-JS-Stack/omega/issues/300)).
  // Never in production: a packaged app has no local stack.
  const dev = isProd ? null : { ports: { ...readSiblingPorts(projectRoot), ...envPorts() } };

  // OMEGA_BUILD_JSON — frozen at build time, accessible at runtime as window/globalThis.OMEGA_BUILD_JSON.
  const buildJson = {
    config: dev ? { ...config, dev } : config,
    package: Manager.getPackage('project'),
    mode,
    builtAt: new Date().toISOString(),
  };

  logger.log(`webpack — environment=${mode.environment}`);

  const configs = [
    makeMainConfig(buildJson, isProd),
    makePreloadConfig(buildJson, isProd),
    makeRendererConfig(buildJson, isProd),
  ].filter(Boolean);

  if (configs.length === 0) {
    logger.warn('No webpack configs to run.');
    return done();
  }

  webpack(configs, (err, stats) => {
    if (err) {
      logger.error('webpack fatal:', err);
      return done(err);
    }

    const info = stats.toJson({ errors: true, warnings: true, assets: true, modules: false });

    if (info.errors?.length) {
      info.errors.forEach((e) => logger.error(e.message || e));
      return done(new Error('webpack errors'));
    }

    if (info.warnings?.length) {
      info.warnings.forEach((w) => logger.warn(w.message || w));
    }

    // Log assets per child compilation
    (info.children || [info]).forEach((child) => {
      const target = child.name || child.outputPath;
      logger.log(`built ${target}:`);
      (child.assets || []).forEach((a) => {
        logger.log(`  ${a.name} (${formatBytes(a.size)})`);
      });
    });

    done();
  });
};

// Inject OMEGA_BUILD_JSON into every bundle two ways:
// 1. DefinePlugin replaces the bare `OMEGA_BUILD_JSON` identifier with the literal at build time
//    (so framework code can reference it without globals).
// 2. BannerPlugin prepends a tiny IIFE that assigns the same value to globalThis.OMEGA_BUILD_JSON
//    (so it's reachable from DevTools and consumer code via window.OMEGA_BUILD_JSON).
//
// Also: bake build-time secrets (GOOGLE_ANALYTICS_SECRET) into the bundle as a
// DefinePlugin replacement of `process.env.GOOGLE_ANALYTICS_SECRET`. Packaged
// apps don't ship .env, so without this the analytics module would have no
// secret at runtime in production. Local dev still reads from process.env (the
// DefinePlugin replacement only fires when the build runs with the secret set;
// otherwise we leave the reference intact).
function buildJsonPlugins(buildJson) {
  const literal = JSON.stringify(buildJson);
  const definitions = {
    OMEGA_BUILD_JSON: literal,
  };
  // Bake build-time analytics secret into bundles when present in the build env.
  // Mirror @omega.js/backend's env-var name (`GOOGLE_ANALYTICS_SECRET`).
  if (process.env.GOOGLE_ANALYTICS_SECRET) {
    definitions['process.env.GOOGLE_ANALYTICS_SECRET'] = JSON.stringify(process.env.GOOGLE_ANALYTICS_SECRET);
  }
  return [
    new webpack.DefinePlugin(definitions),
    new webpack.BannerPlugin({
      banner: `(function(){var __em=${literal};if(typeof globalThis!=='undefined'){globalThis.OMEGA_BUILD_JSON=__em;}if(typeof window!=='undefined'){window.OMEGA_BUILD_JSON=__em;}})();`,
      raw:    true,
      entryOnly: true,
    }),
  ];
}

function makeMainConfig(buildJson, isProd) {
  const entry = path.join(projectRoot, 'src', 'main.js');
  if (!jetpack.exists(entry)) {
    logger.warn('No src/main.js in consumer — skipping main bundle.');
    return null;
  }

  return {
    name:    'main',
    target:  'electron-main',
    mode:    isProd ? 'production' : 'development',
    devtool: isProd ? false : 'source-map',
    entry,
    output: {
      path:     outputRoot,
      filename: 'main.bundle.js',
      libraryTarget: 'commonjs2',
      module:   false,
    },
    node: {
      __dirname:  false,
      __filename: false,
    },
    module: makeStripModule(isProd),
    externals: {
      electron: 'commonjs2 electron',
      // Native modules — consumer can extend via config.em.webpack.externals
      ...resolveNativeExternals(),
    },
    resolve: sharedResolve,
    plugins: buildJsonPlugins(buildJson),
    optimization: {
      minimize: isProd,
    },
  };
}

function makePreloadConfig(buildJson, isProd) {
  const entry = path.join(projectRoot, 'src', 'preload.js');
  if (!jetpack.exists(entry)) {
    logger.warn('No src/preload.js in consumer — skipping preload bundle.');
    return null;
  }

  return {
    name:    'preload',
    target:  'electron-preload',
    mode:    isProd ? 'production' : 'development',
    devtool: isProd ? false : 'source-map',
    entry,
    output: {
      path:     outputRoot,
      filename: 'preload.bundle.js',
      libraryTarget: 'commonjs2',
      module:   false,
    },
    module: makeStripModule(isProd),
    externals: {
      electron: 'commonjs2 electron',
    },
    resolve: sharedResolve,
    plugins: buildJsonPlugins(buildJson),
    optimization: {
      minimize: isProd,
    },
  };
}

function makeRendererConfig(buildJson, isProd) {
  const componentsDir = path.join(projectRoot, 'src', 'assets', 'js', 'components');
  if (!jetpack.exists(componentsDir)) {
    logger.warn('No src/assets/js/components/ in consumer — skipping renderer bundles.');
    return null;
  }

  // One bundle per components/<name>/index.js
  const indexFiles = glob('*/index.js', { cwd: componentsDir });
  if (indexFiles.length === 0) {
    logger.warn('No component index.js entries found.');
    return null;
  }

  const entry = {};
  indexFiles.forEach((rel) => {
    const name = rel.replace(/\/index\.js$/, '');
    entry[name] = path.join(componentsDir, rel);
  });

  // target: 'web' — the renderer with contextIsolation: true is a browser-like
  // environment without Node globals (require, process, global, etc.). 'web' tells
  // webpack to polyfill/fallback Node built-ins (fs, path, crypto, etc.) rather than
  // emitting runtime require() calls that would crash. Libraries bundled through
  // @omega.js/client (Firebase, etc.) get browser-compatible shims this way.
  return {
    name:    'renderer',
    target:  'web',
    mode:    isProd ? 'production' : 'development',
    devtool: isProd ? false : 'source-map',
    entry,
    module: makeStripModule(isProd),
    output: {
      path:         path.join(outputRoot, 'assets', 'js', 'components'),
      filename:     '[name].bundle.js',
      module:       false,
      globalObject: 'globalThis',
    },
    resolve: {
      ...sharedResolve,
      alias: {
        // Vendored core assets (#111) — mirrors the alias BXM/UJM use, so
        // renderer code imports shared core modules by a stable name:
        //   import appShell from '__main_assets__/js/core/app-shell.js';
        '__main_assets__': path.join(frameworkRoot, 'dist', 'assets'),
      },
      // For 'web' target: provide empty fallbacks for Node built-ins that libraries
      // import but don't actually use in the browser. Firebase/@omega.js/client's browser
      // builds don't need these — the imports are dead code paths for Node-only features.
      fallback: {
        fs:             false,
        path:           false,
        os:             false,
        crypto:         false,
        http:           false,
        https:          false,
        http2:          false,
        net:            false,
        tls:            false,
        dns:            false,
        child_process:  false,
        stream:         false,
        zlib:           false,
        util:           false,
        url:            false,
        assert:         false,
        events:         false,
        buffer:         false,
        querystring:    false,
        string_decoder: false,
        electron:       false,
      },
    },
    plugins: [
      ...buildJsonPlugins(buildJson),
      // Libraries like lodash/@firebase/util reference the Node-ism `global`; with
      // target 'web' webpack leaves it undefined. DefinePlugin rewrites the identifier
      // to `globalThis` textually. (ProvidePlugin is wrong here: it resolves its value
      // as a MODULE request — on case-insensitive macOS 'globalThis' silently hit the
      // unrelated `globalthis` npm package; on Linux CI it was Module-not-found.)
      new webpack.DefinePlugin({ global: 'globalThis' }),
    ],
    optimization: {
      minimize: isProd,
    },
  };
}

function resolveNativeExternals() {
  // Walk consumer's package.json for known native module names; mark them as commonjs externals
  // so electron-builder's afterPack rebuilds them out-of-bundle.
  const consumerPkg = Manager.getPackage('project');
  const all = Object.assign({}, consumerPkg.dependencies || {}, consumerPkg.devDependencies || {});

  // Conservative whitelist of *truly native* (C++) modules that need electron-builder's
  // afterPack to rebuild them out-of-bundle. electron-store is pure JS (ESM) so it bundles fine.
  // Consumer can extend via config.em.webpack.externals.
  const NATIVE = [
    'better-sqlite3',
    'keytar',
    'node-mac-permissions',
    'node-notifier',
    'sharp',
    'sqlite3',
  ];

  const externals = {};
  Object.keys(all).forEach((name) => {
    if (NATIVE.includes(name)) {
      externals[name] = `commonjs2 ${name}`;
    }
  });

  // Consumer-defined extras
  const config = Manager.getConfig();
  const extra = config.em?.webpack?.externals || [];
  extra.forEach((name) => {
    externals[name] = `commonjs2 ${name}`;
  });

  return externals;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

module.exports.makeSharedResolve = makeSharedResolve;
module.exports.makeStripModule = makeStripModule;
