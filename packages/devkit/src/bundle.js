/**
 * bundle — the ONE esbuild wrapper every OMEGA framework builds through (#736,
 * part of #128).
 *
 * Bundling was three shapes for one job: web called esbuild directly with its
 * own private plugins, desktop and extension each ran webpack, and the
 * `@dev-only` strip existed once per bundler. This module is the single place
 * the SHARED parts live, so a framework's own build code is only its entries
 * and the plugins that are genuinely its own:
 *
 *   - the framework-deps resolve hook (#87/#2) — a consumer imports anything the
 *     framework declares by BARE specifier and gets the FRAMEWORK's copy
 *   - the `@dev-only` strip (#18), registered for PRODUCTION builds only
 *   - minify / sourcemap by mode, and `bundle` + `metafile` on
 *   - one timing line per build, watch rebuilds included
 *
 * esbuild is REQUIRED LAZILY, from the CALLING FRAMEWORK's installation rather
 * than devkit's. Devkit is vendored into each framework's dist at prepare time
 * (tools/vendor.js), so this file runs as `<framework>/dist/vendor/devkit/
 * bundle.js` with no node_modules of its own — and the framework is where the
 * pinned esbuild lives. Same shape as the rest of devkit's cross-package
 * resolution (`createRequire` anchored on the target's package.json, as in
 * local.js and omega-bin.js): the require happens per call, so a framework that
 * never bundles never pays for it and never needs esbuild installed.
 *
 * `frameworkRoot` is REQUIRED for the same reason — it is both where esbuild is
 * resolved from and where the declared-dependency set is read — so a missing
 * one throws instead of silently resolving out of devkit's own tree.
 */

const path = require('path');
const { createRequire } = require('module');

const Logger = require('./logger.js');
const { frameworkDependencyNames, frameworkDepsPattern } = require('./framework-deps.js');
const { stripDevBlocksPlugin } = require('./strip-dev-blocks-plugin.js');

const logger = new Logger('bundle');

// The esbuild options bundle() OWNS. Every one of them IS the composition —
// `bundle`/`metafile` are the contract callers read results through, `minify`/
// `sourcemap` are the mode rules, `plugins` is the shared chain, `entryPoints`
// is `entries` — so a caller passing its own would get a build that silently
// is not a bundle() build (an unbundled or unminified artifact that still
// looks like one). That is a programmer error, so it crashes rather than
// quietly winning: the passthrough spread cannot express "override the
// composition".
const RESERVED_OPTIONS = ['bundle', 'metafile', 'minify', 'sourcemap', 'plugins', 'entryPoints'];

// The lanes. A typo'd mode used to fall through to the one-shot branch and
// hand back a result with no `dispose`, which a watch caller only discovers
// when it tries to shut down.
const MODES = ['build', 'watch'];

/**
 * esbuild as the CALLING FRAMEWORK resolves it (see the header).
 * @param {string} frameworkRoot - the framework package's root (the dir holding its package.json)
 * @returns {object} the framework's esbuild
 */
function requireEsbuild(frameworkRoot) {
  return createRequire(path.join(frameworkRoot, 'package.json'))('esbuild');
}

/**
 * The resolve hook behind the framework-dependency contract (#2): a consumer
 * module lives outside the framework, so `import 'chart.js'` would otherwise
 * resolve from the CONSUMER's dir — failing, or shipping the library twice.
 * Re-resolving from the framework root makes the framework's copy win always:
 * one copy, one shared chunk. Anything the framework does not declare is
 * untouched and fails with esbuild's normal resolution error. Build-time-only
 * dependencies (esbuild, sass, sharp) need no exclusion — resolution happens on
 * demand, so nothing enters a bundle unless bundled code imports it by name.
 * @param {string} frameworkRoot - the framework package's root
 * @returns {object|null} the plugin, or null when the package declares no deps
 */
function frameworkDepsPlugin(frameworkRoot) {
  const names = frameworkDependencyNames(frameworkRoot);
  if (!names.length) return null;
  // A filter built from the declared names (bare specifier + subpaths) keeps
  // the hook off every other import esbuild resolves.
  const filter = frameworkDepsPattern(names);

  return {
    name: 'omega-framework-deps',
    setup(build) {
      build.onResolve({ filter }, (args) => {
        // build.resolve re-runs every onResolve hook — the marker stops the loop.
        if (args.pluginData && args.pluginData.frameworkDep) return null;
        return build.resolve(args.path, {
          kind: args.kind,
          resolveDir: frameworkRoot,
          pluginData: { frameworkDep: true },
        });
      });
    },
  };
}

/**
 * The one timing line, as a plugin rather than a stopwatch around the call:
 * watch-mode rebuilds never come back through the caller, and a lane that
 * rebuilds on every save is exactly where the number is wanted.
 * @param {string} destination - where the build writes (the outdir, or the outfile — the line names it)
 * @param {number} entryCount - how many entries the build was handed
 * @param {boolean} watching - watch mode, where a failed build has no rejection to carry its errors
 * @returns {object} the plugin
 */
function timingPlugin(destination, entryCount, watching) {
  let started = 0;

  return {
    name: 'omega-bundle-timing',
    setup(build) {
      build.onStart(() => { started = Date.now(); });
      build.onEnd((result) => {
        const seconds = ((Date.now() - started) / 1000).toFixed(2);
        const label = `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}`;
        const failed = result.errors.length ? ` — ${result.errors.length} error(s)` : '';
        logger.log(`${label} → ${path.relative(process.cwd(), destination) || destination} in ${seconds}s${failed}`);

        // esbuild's own printer is OFF (see the `logLevel` note below), so this
        // is where its findings reach a human. Warnings always: they are the
        // half of the report nothing else carries. Errors only while WATCHING —
        // a one-shot build rejects with every error already formatted, so
        // logging them here too would print each one twice.
        result.warnings.forEach((warning) => logger.warn(describe(warning)));
        if (watching) result.errors.forEach((error) => logger.error(describe(error)));
      });
    },
  };
}

/**
 * One esbuild message as a line: what, and where.
 * @param {object} message - an esbuild warning or error
 * @returns {string}
 */
function describe(message) {
  const at = message.location
    ? ` (${message.location.file}:${message.location.line}:${message.location.column})`
    : '';
  return `${message.text}${at}`;
}

/**
 * Bundle with esbuild through the shared composition.
 *
 * @param {object} options
 * @param {string} options.frameworkRoot - the calling framework's package root (required)
 * @param {string[]|Object<string, string>} options.entries - esbuild entry points
 * @param {string} [options.outdir] - output directory — one of `outdir` / `outfile` is required
 * @param {string} [options.outfile] - output FILE, for a single-entry build that owns its name
 *   (@omega.js/web's service worker must land at exactly `/service-worker.js`)
 * @param {string|string[]} [options.target] - esbuild target
 * @param {string} [options.format] - esbuild output format
 * @param {boolean} [options.splitting] - esbuild code splitting
 * @param {'build'|'watch'} [options.mode] - one-shot build (default) or a watching context
 * @param {boolean} [options.dev] - the OUTPUT rules: no minify + sourcemap + dev blocks kept.
 *   Defaults to `mode === 'watch'`, and is separate from `mode` because a dev lane is not
 *   always a watching one: @omega.js/web's `omega dev` drives one-shot rebuilds from its own
 *   source watcher (it watches layer roots the bundle graph never sees), so it is `mode: 'build'`
 *   with `dev: true`.
 * @param {object} [options.define] - esbuild define map
 * @param {object[]} [options.plugins] - the CALLER's own plugins, composed first
 * @returns {Promise<object>} in `'build'` mode, esbuild's result (metafile on). In `'watch'`
 *   mode, `{ context, dispose }` instead — the startup build is the watcher's own and lands
 *   after this resolves, so there is no result to hand back; watch results arrive through a
 *   caller plugin's `onEnd`.
 */
async function bundle(options) {
  const {
    frameworkRoot,
    entries,
    outdir,
    outfile,
    target,
    format,
    splitting,
    mode = 'build',
    dev = mode === 'watch',
    define,
    plugins = [],
    ...passthrough
  } = options || {};

  if (!frameworkRoot) {
    throw new Error('[devkit bundle] frameworkRoot is required — it is where esbuild and the declared dependency set are resolved from');
  }
  // Exactly one destination: both is unanswerable, and neither reaches esbuild
  // as a build with nowhere to write (and a timing line naming `undefined`).
  if (Boolean(outdir) === Boolean(outfile)) {
    throw new Error(`[devkit bundle] name exactly one destination — \`outdir\` (many entries) or \`outfile\` (one entry that owns its name), not ${outdir ? 'both' : 'neither'}`);
  }
  if (!MODES.includes(mode)) {
    throw new Error(`[devkit bundle] unknown mode '${mode}' — expected one of: ${MODES.join(', ')}`);
  }
  const reserved = RESERVED_OPTIONS.filter((key) => key in passthrough);
  if (reserved.length) {
    throw new Error(`[devkit bundle] ${reserved.join(', ')} ${reserved.length === 1 ? 'is' : 'are'} owned by bundle() and cannot be passed through — it composes them (see RESERVED_OPTIONS). Use \`dev\` for the minify/sourcemap rules, \`plugins\` for your own plugins, and \`entries\` for the entry points`);
  }

  const esbuild = requireEsbuild(frameworkRoot);
  const entryCount = Array.isArray(entries) ? entries.length : Object.keys(entries || {}).length;

  const config = {
    entryPoints: entries,
    bundle: true,
    metafile: true,
    minify: !dev,
    sourcemap: dev,
    // esbuild's own printer is off and the timing plugin reports its findings
    // instead, so every framework's build output is ONE voice — the devkit
    // logger, with the `[@omega.js/<package>:bundle]` tag — rather than a mix
    // of tagged lines and raw esbuild blocks. Errors still ride the rejection
    // esbuild throws, fully formatted, so nothing is swallowed.
    logLevel: 'silent',
    // The working directory, pinned PER CALL. esbuild's node API snapshots
    // `process.cwd()` once at MODULE LOAD (`defaultWD` in its lib/main.js) and
    // sends that snapshot as the working directory of every later build. This
    // module requires esbuild LAZILY (see the header), so the snapshot is
    // whatever the cwd happened to be at the process's FIRST bundle() call —
    // and a caller that builds while chdir'd into a temp project froze a
    // directory that was then deleted, after which esbuild could resolve NO
    // entry point at all, absolute ones included ([#777]). Passing it every
    // time is esbuild's own documented default ("the current working
    // directory"), actually applied. A caller with a different working
    // directory in mind still overrides it through the passthrough.
    absWorkingDir: process.cwd(),
    // The caller's plugins run FIRST — web's boot stub creates the virtual
    // entries the shared hooks then resolve through.
    plugins: [
      ...plugins,
      frameworkDepsPlugin(frameworkRoot),
      dev ? null : stripDevBlocksPlugin,
      timingPlugin(outdir || outfile, entryCount, mode === 'watch'),
    ].filter(Boolean),
    ...passthrough,
  };

  // The optional options are assigned only when they HAVE a value. esbuild
  // reads an explicitly-undefined option as absent but REJECTS an explicit null
  // ("target must be a string") — and null is exactly what an optional lookup
  // answers when it has no answer: @omega.js/desktop reads its syntax floor off
  // the pinned Electron binary and hands back `{ node: null }` when the binary
  // cannot be probed. That is the documented no-floor path, so it must build,
  // not crash.
  for (const [key, value] of Object.entries({ outdir, outfile, target, format, splitting, define })) {
    if (value != null) config[key] = value;
  }

  if (mode !== 'watch') {
    return esbuild.build(config);
  }

  // `context.watch()` performs the startup build ITSELF, asynchronously — it
  // resolves before that build finishes. So there is deliberately no
  // `rebuild()` here: awaiting one would build the whole graph TWICE on every
  // watch start, and a first build that fails would throw out of bundle(),
  // leaving the caller with no watcher and this context leaked (an undisposed
  // context keeps esbuild's child process, and the host, alive).
  //
  // A broken first build is therefore NOT an exception here: it is reported
  // through esbuild's own channel exactly as every later rebuild's is, the
  // watcher stays live, and saving the fix rebuilds. A caller that needs the
  // first build's result (a manifest pass, say) reads it from its own plugin's
  // `onEnd` — which is the only hook that sees rebuilds too.
  const context = await esbuild.context(config);
  try {
    await context.watch();
  } catch (error) {
    await context.dispose();
    throw error;
  }

  return { context, dispose: () => context.dispose() };
}

/**
 * A byte count as a build log says it (`948B`, `1.5kB`, `1.53MB`) — the ONE
 * size vocabulary every build lane prints, so a framework's "what did it
 * produce" line reads the same everywhere. It lives beside `bundle()` because
 * the metafile those lines read is what this module turns on.
 * @param {number} bytes - the size
 * @returns {string} the formatted size
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kB`;
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

module.exports = { bundle, formatBytes };
