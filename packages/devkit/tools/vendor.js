// Vendors @omegajs/devkit into a framework's dist/ so published tarballs are
// self-contained (devkit is a private workspace package — it never ships to npm).
//
// Wired as the framework's prepare-package `after` hook:
//   "preparePackage": { "hooks": { "after": "node -e \"require('@omegajs/devkit/vendor')()\"" } }
//
// From the framework's cwd it:
//   1. Copies devkit's src/ modules into <dist>/vendor/devkit/
//   2. Rewrites every require('@omegajs/devkit[/<subpath>]') under dist/ to a
//      relative path into that vendor dir
//   3. Fails if the host doesn't declare a runtime dependency the vendored modules
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

// Matches require('@omegajs/devkit') and require('@omegajs/devkit/<subpath>')
const REQUIRE_PATTERN = /require\((['"])@omegajs\/devkit(?:\/([A-Za-z0-9._/-]+))?\1\)/g;

// Matches bare-specifier requires (anything not starting with . or /) — used by the
// host-dependency guard on the vendored files.
const BARE_REQUIRE_PATTERN = /require\((['"])([^'"./][^'"]*)\1\)/g;

// Map a devkit subpath ('' | 'logger' | 'logger.js') to its vendored filename.
function subpathToFile(subpath) {
  const name = subpath || 'index';
  return name.endsWith('.js') ? name : `${name}.js`;
}

// Reduce a require specifier to its package name ('chalk', '@scope/pkg').
function specifierToPackageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Vendor devkit into the host framework's dist and rewrite requires.
 *
 * @param {object} [options]
 * @param {string} [options.cwd] - Host framework root (defaults to process.cwd())
 * @returns {{ rewritten: number, vendorDir: string }}
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

  // 1. Copy devkit src → dist/vendor/devkit
  const devkitSrc = path.join(__dirname, '..', 'src');
  const vendorDir = path.join(distPath, 'vendor', 'devkit');
  jetpack.copy(devkitSrc, vendorDir, { overwrite: true });

  // 2. Rewrite @omegajs/devkit requires under dist (skip the vendor dir itself)
  let rewritten = 0;
  jetpack.find(distPath, { matching: ['**/*.js', '!vendor/**'] }).forEach((file) => {
    const abs = path.resolve(file);
    const contents = jetpack.read(abs);
    if (!contents || !contents.includes('@omegajs/devkit')) {
      return;
    }

    const updated = contents.replace(REQUIRE_PATTERN, (match, quote, subpath) => {
      const target = path.join(vendorDir, subpathToFile(subpath));
      if (!jetpack.exists(target)) {
        throw new Error(`[devkit vendor] ${path.relative(cwd, abs)} requires '@omegajs/devkit/${subpath}' but devkit has no such module`);
      }
      let relative = path.relative(path.dirname(abs), target).split(path.sep).join('/');
      if (!relative.startsWith('.')) {
        relative = `./${relative}`;
      }
      return `require(${quote}${relative}${quote})`;
    });

    if (updated !== contents) {
      jetpack.write(abs, updated);
      rewritten += 1;
    }
  });

  // 3. Guard: every bare require in the vendored modules must resolve from the host
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

  logger.log(`Vendored devkit into ${path.relative(cwd, vendorDir)}, rewrote ${rewritten} file(s) in ${hostPackage.name}`);

  return { rewritten, vendorDir };
}

module.exports = vendorDevkit;
