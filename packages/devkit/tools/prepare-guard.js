// The monorepo checkout is READ-ONLY to consumer installs (#350).
//
// npm runs a `file:`-linked dependency's `prepare` script INSIDE the linked
// checkout, so `omega i local`, `omega dev --local` and any PLAIN `npm install`
// in a linked brand rebuild a monorepo package in place: dist purged and
// re-copied, network caches refetched (backend's prepare refetches
// disposable-domains.json), all of it while sibling processes are mid-require on
// that dist and none of it visible in `git status`. That is the interference
// #281 closed for build verbs, through the one door a CLI guard cannot see —
// npm invokes prepare, devkit never gets a say.
//
// Wired as the FIRST clause of every dist-building package's prepare script:
//   "prepare": "node -e \"require('../devkit/tools/prepare-guard')() && require('prepare-package')()\""
// A false return short-circuits the build and exits 0, so the consumer's install
// completes normally — dist freshness stays the monorepo watch's job (#281).
//
// It fires ONLY for a TREE-TOUCHING npm command whose root lies outside the
// monorepo that contains the package. Five commands re-run a file:-linked
// dependency's prepare (verified against npm 11.12.1, which reports each in
// npm_command): `install`, `ci`, `update`, `rebuild`, `dedupe`. Everything else
// builds: `pack`, `publish` (never a tree command, so the published tarball
// always carries a freshly built dist — docs/shared/publishing.md) and a manual
// `npm run prepare` (run-script). Every monorepo workflow behaves exactly as
// before, because the ROOT is what decides: the root `npm install`, workspace
// installs (`-w packages/web`), a package-local install, and an install from an
// in-repo app all name a root inside the monorepo.
//
// The gate KEEPS ITSELF WIRED. prepare-package owns `scripts.prepare`: every
// full prepare rewrites the manifest with its own canonical one-liner, which
// would drop the gate on the monorepo's next build and hand the door back. So
// `rewire()` runs as the last prepare-package `after` hook of every package
// (beside the vendor hook, after the manifest write, in the `prepare` AND
// `prepare:watch` lanes) and puts the gate back. Idempotent: it writes only when
// the manifest holds prepare-package's canonical string, byte-for-byte in
// prepare-package's own formatting, so a settled package.json never churns.

const fs = require('fs');
const path = require('path');

// Self-contained on purpose: this file loads in a checkout that has installed
// NOTHING yet (a runner's fresh clone, the playground snapshot), where neither
// devkit's node_modules link nor chalk exists, so it borrows nothing from
// src/local.js. isMonorepoRoot is the same rule that module states.

/**
 * Whether a directory is the omega monorepo root (package.json named "omega"
 * and a packages/devkit workspace).
 * @param {string} dir - Directory to test.
 * @returns {boolean}
 */
function isMonorepoRoot(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return pkg.name === 'omega' && fs.existsSync(path.join(dir, 'packages', 'devkit', 'package.json'));
  } catch (e) {
    return false;
  }
}

// npm's own commands that (re)build a dependency tree, and so reach into a
// file:-linked package and re-run its prepare. Anything else (pack, publish,
// run-script) builds.
const INSTALL_COMMANDS = new Set(['install', 'ci', 'update', 'rebuild', 'dedupe']);

// The two sides of the wiring: what prepare-package writes, and the gated form
// it must be restored to.
const UNGUARDED_PREPARE = 'node -e "require(\'prepare-package\')()"';
// The gate is required by a RELATIVE path, never through node_modules: npm runs
// a file:-linked package's prepare during reify, which can land before the
// checkout that owns that package has been installed at all, so at that moment
// the checkout holds no node_modules/@omega.js/devkit link to resolve through.
// Every dist-building package lives at <root>/packages/<name>, so ../devkit/tools
// is one hop away.
const GUARDED_PREPARE = 'node -e "require(\'../devkit/tools/prepare-guard\')() && require(\'prepare-package\')()"';

/**
 * Resolve a path to its real location, tolerating one that does not exist.
 * @param {string} target - Path to resolve.
 * @returns {string} The real path, or the resolved path when it does not exist.
 */
function realPath(target) {
  try {
    return fs.realpathSync(target);
  } catch (e) {
    return path.resolve(target);
  }
}

/**
 * Walk up from a package directory to the monorepo root that contains it.
 * @param {string} dir - Directory to start from (the package being prepared).
 * @returns {string|null} The monorepo root, or null when the package is not in one.
 */
function findMonorepoRoot(dir) {
  let current = realPath(dir);
  while (true) {
    if (isMonorepoRoot(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * Whether a directory is the given root or lives under it.
 * @param {string} root - Containing directory.
 * @param {string} dir - Directory to test.
 * @returns {boolean}
 */
function isInside(root, dir) {
  const relative = path.relative(realPath(root), realPath(dir));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Decide whether a prepare running in a package directory belongs to the
 * monorepo (build) or to a consumer install that reached into it (skip).
 * @param {object} options
 * @param {string} options.packageDir - The package being prepared (prepare's cwd).
 * @param {object} [options.env] - Environment to read (default process.env).
 * @returns {{skip: boolean, reason: string, monorepoRoot?: string, installRoot?: string}}
 *   reason: 'no-monorepo' (not a monorepo checkout), 'not-install' (pack, publish,
 *   a manual `npm run prepare`), 'no-install-root' (npm named no root), 'monorepo-uninstalled' (the checkout
 *   holds no node_modules yet: nothing to build with, skip),
 *   'monorepo-install' (the install is the monorepo's own), 'consumer-install' (skip).
 */
function prepareDecision(options) {
  const { packageDir, env = process.env } = options;

  const monorepoRoot = findMonorepoRoot(packageDir);
  if (!monorepoRoot) {
    return { skip: false, reason: 'no-monorepo' };
  }

  if (!INSTALL_COMMANDS.has(env.npm_command)) {
    return { skip: false, reason: 'not-install', monorepoRoot };
  }

  // A checkout that has installed nothing has nothing to build with: a brand's
  // install reifies its file: links, and so this prepare, while the checkout
  // those links point at is still uninstalled. The root's node_modules is the
  // marker: it exists from the first moment the monorepo's own install reaches
  // a workspace prepare (npm's hidden lockfile does not, it lands after), and
  // it is absent until then. Skipping here leaves the dist to the install that
  // owns that checkout, which builds every one of them.
  if (!fs.existsSync(path.join(monorepoRoot, 'node_modules'))) {
    return { skip: true, reason: 'monorepo-uninstalled', monorepoRoot };
  }

  // npm names the tree being installed twice: the project root it resolved
  // (local_prefix) and the directory the command was typed in (INIT_CWD). The
  // root is the truth — `npm install` in a brand's subdirectory still installs
  // the brand — and INIT_CWD is the fallback for an npm too old to set it.
  const installRoot = env.npm_config_local_prefix || env.INIT_CWD;
  if (!installRoot) {
    return { skip: false, reason: 'no-install-root', monorepoRoot };
  }

  if (isInside(monorepoRoot, installRoot)) {
    return { skip: false, reason: 'monorepo-install', monorepoRoot, installRoot: realPath(installRoot) };
  }

  return { skip: true, reason: 'consumer-install', monorepoRoot, installRoot: realPath(installRoot) };
}

/**
 * Read a package directory's name, for the notice.
 * @param {string} dir - Package directory.
 * @returns {string} The package name, or the directory's basename.
 */
function packageName(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name || path.basename(dir);
  } catch (e) {
    return path.basename(dir);
  }
}

/**
 * The prepare script's gate: true to build, false to skip (one stderr line).
 * @param {object} [options]
 * @param {string} [options.packageDir] - The package being prepared (default cwd).
 * @param {object} [options.env] - Environment to read (default process.env).
 * @returns {boolean} Whether the prepare should build.
 */
function guardPrepare(options) {
  const { packageDir = process.cwd(), env = process.env } = options || {};
  const decision = prepareDecision({ packageDir, env });
  if (!decision.skip) {
    return true;
  }

  if (decision.reason === 'monorepo-uninstalled') {
    console.warn(`omega: skipped ${packageName(packageDir)}'s prepare: the checkout at ${decision.monorepoRoot} is not installed yet, so there is nothing to build with; the install that owns that checkout builds every dist.`);
    return false;
  }

  console.warn(`omega: skipped ${packageName(packageDir)}'s prepare — the install in ${decision.installRoot} reached into the omega monorepo, which is read-only to consumers: its dist belongs to the monorepo watch (\`npm start\` in ${decision.monorepoRoot}).`);
  return false;
}

/**
 * Put the gate back into `scripts.prepare` after prepare-package overwrote it.
 * Wired as the last `after` hook of every dist-building package.
 * @param {object} [options]
 * @param {string} [options.packageDir] - The prepared package (default cwd).
 * @returns {boolean} Whether the manifest was rewritten.
 */
function rewire(options) {
  const { packageDir = process.cwd() } = options || {};
  const manifestPath = path.join(packageDir, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // Only prepare-package's own string is ours to replace: anything else is a
  // deliberate prepare, and stomping it would be the surprise this file exists
  // to prevent.
  if (!manifest.scripts || manifest.scripts.prepare !== UNGUARDED_PREPARE) {
    return false;
  }

  manifest.scripts.prepare = GUARDED_PREPARE;
  // prepare-package's own formatting, so the restored manifest is a one-key diff
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`omega: restored ${manifest.name}'s prepare gate — prepare-package rewrites scripts.prepare on every build (#350).`);
  return true;
}

module.exports = guardPrepare;
module.exports.prepareDecision = prepareDecision;
module.exports.rewire = rewire;
module.exports.GUARDED_PREPARE = GUARDED_PREPARE;
module.exports.UNGUARDED_PREPARE = UNGUARDED_PREPARE;
