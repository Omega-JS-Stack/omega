// Vendors @omegajs/devkit into a framework's dist/ so published tarballs are
// self-contained (devkit is a private workspace package — it never ships to npm).
//
// Wired as the framework's prepare-package `after` hook:
//   "preparePackage": { "hooks": { "after": "node -e \"require('@omegajs/devkit/vendor')()\"" } }
//
// From the framework's cwd it:
//   1. Scans dist/ for requires of @omegajs/devkit modules
//   2. Copies ONLY those modules (plus their transitive relative requires) into
//      <dist>/vendor/devkit/ — selective, so a host that uses just safe-install
//      doesn't ship the test runner or inherit its dependency requirements
//   3. Rewrites every require('@omegajs/devkit[/<subpath>]') under dist/ to a
//      relative path into that vendor dir
//   4. Fails if the host doesn't declare a runtime dependency the vendored modules
//      require — vendored code resolves e.g. chalk from the HOST's node_modules
//
// Notes:
//   - prepare-package `after` hooks are non-blocking (a failure warns but doesn't
//     stop prepare). The hard gate is CI's pack→scratch-install smoke plus its
//     "no @omegajs refs in shipped dist" check.
//   - Watch mode's single-file copies skip hooks, so a freshly-saved file can hold
//     a raw @omegajs require in dist. That's fine wherever dist is consumed from
//     the monorepo (workspace + file: installs resolve devkit up the tree); a full
//     prepare (npm install / pack / publish) always re-runs the rewrite.

const path = require('path');
const { isBuiltin } = require('node:module');
const jetpack = require('fs-jetpack');
const Logger = require('../src/logger');

const logger = new Logger('devkit-vendor');

const DEVKIT_SRC = path.join(__dirname, '..', 'src');

// Matches require('@omegajs/devkit'), require('@omegajs/devkit/<subpath>'), and the
// require.resolve(...) forms (used e.g. by runners that inline devkit module SOURCE
// into a browser context). Groups: 1 = '.resolve' | undefined, 2 = quote, 3 = subpath.
const REQUIRE_PATTERN = /require(\.resolve)?\((['"])@omegajs\/devkit(?:\/([A-Za-z0-9._/-]+))?\2\)/g;

// Matches relative requires — used to walk devkit-internal dependencies.
const RELATIVE_REQUIRE_PATTERN = /require\((['"])(\.{1,2}\/[^'"]+)\1\)/g;

// Matches bare-specifier requires (anything not starting with . or /) — used by the
// host-dependency guard on the vendored files.
const BARE_REQUIRE_PATTERN = /require\((['"])([^'"./][^'"]*)\1\)/g;

// Map a devkit subpath ('' | 'logger' | 'test/assert' | 'logger.js') to its src-relative file.
function subpathToFile(subpath) {
  const name = subpath || 'index';
  return name.endsWith('.js') ? name : `${name}.js`;
}

// Reduce a require specifier to its package name ('chalk', '@scope/pkg').
function specifierToPackageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

// From a seed set of src-relative files, follow relative requires inside devkit src
// until closure. Returns the full set of src-relative files to vendor.
function resolveNeededFiles(seeds) {
  const needed = new Set();
  const queue = [...seeds];

  while (queue.length > 0) {
    const relative = queue.pop();
    if (needed.has(relative)) continue;

    const abs = path.join(DEVKIT_SRC, relative);
    if (!jetpack.exists(abs)) {
      throw new Error(`[devkit vendor] devkit has no module '${relative}' (requested by the host or a devkit-internal require)`);
    }
    needed.add(relative);

    const contents = jetpack.read(abs) || '';
    for (const match of contents.matchAll(RELATIVE_REQUIRE_PATTERN)) {
      let dep = path.join(path.dirname(relative), match[2]).split(path.sep).join('/');
      if (!dep.endsWith('.js')) dep = `${dep}.js`;
      queue.push(dep);
    }
  }

  return needed;
}

/**
 * Vendor the devkit modules a host framework actually uses into its dist and
 * rewrite the requires.
 *
 * @param {object} [options]
 * @param {string} [options.cwd] - Host framework root (defaults to process.cwd())
 * @returns {{ rewritten: number, vendored: string[], vendorDir: string }}
 */
function vendorDevkit(options) {
  options = options || {};
  const cwd = path.resolve(options.cwd || process.cwd());

  const hostPackage = jetpack.read(path.join(cwd, 'package.json'), 'json');
  if (!hostPackage) {
    throw new Error(`[devkit vendor] No package.json found in ${cwd}`);
  }

  const output = (hostPackage.preparePackage && hostPackage.preparePackage.output) || './dist';
  const distPath = path.resolve(cwd, output);
  if (!jetpack.exists(distPath)) {
    throw new Error(`[devkit vendor] Output dir does not exist: ${distPath} — run prepare first`);
  }

  const vendorDir = path.join(distPath, 'vendor', 'devkit');

  // 1. Scan dist for devkit requires: which files need rewriting, which modules are used.
  const seeds = new Set();
  const filesToRewrite = [];
  jetpack.find(distPath, { matching: ['**/*.js', '!vendor/**'] }).forEach((file) => {
    const abs = path.resolve(file);
    const contents = jetpack.read(abs);
    if (!contents || !contents.includes('@omegajs/devkit')) {
      return;
    }
    let uses = false;
    for (const match of contents.matchAll(REQUIRE_PATTERN)) {
      seeds.add(subpathToFile(match[3]));
      uses = true;
    }
    if (uses) filesToRewrite.push(abs);
  });

  // Nothing uses devkit — clear any stale vendor dir and exit.
  if (seeds.size === 0) {
    jetpack.remove(vendorDir);
    logger.log(`No devkit requires found in ${hostPackage.name} dist — nothing to vendor`);
    return { rewritten: 0, vendored: [], vendorDir };
  }

  // 2. Selective copy: seeds + transitive relative requires, nothing else.
  const needed = resolveNeededFiles(seeds);
  jetpack.remove(vendorDir);
  for (const relative of needed) {
    jetpack.copy(path.join(DEVKIT_SRC, relative), path.join(vendorDir, relative));
  }

  // 3. Rewrite the devkit requires to relative paths into the vendor dir.
  let rewritten = 0;
  filesToRewrite.forEach((abs) => {
    const contents = jetpack.read(abs);
    const updated = contents.replace(REQUIRE_PATTERN, (match, resolveSuffix, quote, subpath) => {
      const target = path.join(vendorDir, subpathToFile(subpath));
      let relative = path.relative(path.dirname(abs), target).split(path.sep).join('/');
      if (!relative.startsWith('.')) {
        relative = `./${relative}`;
      }
      return `require${resolveSuffix || ''}(${quote}${relative}${quote})`;
    });
    if (updated !== contents) {
      jetpack.write(abs, updated);
      rewritten += 1;
    }
  });

  // 4. Guard: every bare require in the vendored modules must resolve from the host
  // at consumer runtime — i.e. live in its dependencies/peerDependencies/optionalDependencies.
  const hostRuntimeDeps = {
    ...(hostPackage.dependencies || {}),
    ...(hostPackage.peerDependencies || {}),
    ...(hostPackage.optionalDependencies || {}),
  };
  const missing = new Set();
  jetpack.find(vendorDir, { matching: '**/*.js' }).forEach((file) => {
    const contents = jetpack.read(path.resolve(file)) || '';
    for (const match of contents.matchAll(BARE_REQUIRE_PATTERN)) {
      const name = specifierToPackageName(match[2]);
      // Internal @omegajs packages are never host deps — leftover requires of them
      // in shipped dist are caught by CI's no-@omegajs-refs pack-smoke check.
      if (name.startsWith('@omegajs/')) {
        continue;
      }
      if (!isBuiltin(name) && !hostRuntimeDeps[name]) {
        missing.add(name);
      }
    }
  });
  if (missing.size > 0) {
    throw new Error(`[devkit vendor] ${hostPackage.name} must declare runtime dependencies used by vendored devkit modules: ${[...missing].join(', ')}`);
  }

  const vendored = [...needed].sort();
  logger.log(`Vendored ${vendored.length} devkit module(s) into ${path.relative(cwd, vendorDir)}, rewrote ${rewritten} file(s) in ${hostPackage.name}`);

  return { rewritten, vendored, vendorDir };
}

module.exports = vendorDevkit;
