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
// It IS every dist-building package's prepare script, which runs the gate and
// then prepare-package itself:
//   "prepare": "node -e \"require('../devkit/tools/prepare-guard').run()\""
// A skipped gate never loads prepare-package and exits 0, so the consumer's
// install completes normally (dist freshness stays the monorepo watch's job,
// #281).
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
// `rewire()` runs as the FIRST prepare-package `after` hook of every package
// (the manifest write is the last thing prepare-package does before its hooks,
// in the `prepare` AND `prepare:watch` lanes), ahead of the vendor hook that
// can fail, and puts the gate back. Idempotent: it writes only when the
// manifest holds prepare-package's canonical string, byte-for-byte in
// prepare-package's own formatting, so a settled package.json never churns.
//
// And the restore is not left to hook ordering: `run()` calls the same
// `ensureGuarded()` on both paths out, so the `prepare` lane ends gated whether
// the build succeeded, a hook exited nonzero (the vendor hook did, twice, which
// is how #870 was found) or prepare-package itself threw. A build that ended
// UNGATED anyway exits nonzero on its own account: npm buffers the warning away
// from a plain install, so the exit code is the only signal a lane can read. The freshness heal
// (devkit `src/local.js`) calls `ensureGuarded()` on the package it prepared for
// the one case a finally cannot reach: a prepare killed outright.

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
const GUARDED_PREPARE = 'node -e "require(\'../devkit/tools/prepare-guard\').run()"';

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
 * Wired as the first `after` hook of every dist-building package.
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

/**
 * The ONE check every lane that runs a package's prepare makes on the way out:
 * the manifest holds the gate, restored when prepare-package's own string is
 * what sits there. No lane carries a copy of the gated string, they all read
 * this one ([#870](https://github.com/Omega-JS-Stack/omega/issues/870)).
 * @param {object} [options]
 * @param {string} [options.packageDir] - The prepared package (default cwd).
 * @returns {{guarded: boolean, restored: boolean, prepare: string|undefined, warning: string|undefined}}
 *   guarded: the manifest holds the gate now; restored: this call rewrote it;
 *   prepare: the script on disk (undefined when the manifest is unreadable);
 *   warning: the loud line, when the gate is off (undefined when it is on).
 */
function ensureGuarded(options) {
  const { packageDir = process.cwd() } = options || {};
  const restored = rewire({ packageDir });

  let prepare;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    prepare = manifest.scripts ? manifest.scripts.prepare : undefined;
  } catch (e) {
    prepare = undefined;
  }

  const guarded = prepare === GUARDED_PREPARE;
  const warning = guarded
    ? undefined
    : `omega: ${packageName(packageDir)}'s scripts.prepare is not the #350 gate after its prepare (it reads ${JSON.stringify(prepare)}). Put it back by hand: ${GUARDED_PREPARE}`;
  if (warning) {
    // Only rewire's narrow refusal reaches here (a prepare string nobody owns),
    // so it is a broken invariant, not a condition to fall back on: say it.
    console.warn(warning);
  }

  return { guarded, restored, prepare, warning };
}

/**
 * The prepare script itself: the gate, then prepare-package, then the gate
 * again WHATEVER happened in between. prepare-package rewrites
 * `scripts.prepare` to its own unguarded one-liner BEFORE its `after` hooks
 * run, so a hook that fails (the vendor hook does, on a reference it cannot
 * resolve) left the manifest unguarded with the rewire hook never reached
 * ([#870](https://github.com/Omega-JS-Stack/omega/issues/870)). The failure
 * stays loud: the rejection is returned, so the script still exits nonzero, and
 * a build that ended UNGATED rejects too (C4) rather than exiting green on a
 * warning nobody sees.
 * @param {object} [options]
 * @param {string} [options.packageDir] - The package being prepared (default cwd).
 * @param {object} [options.env] - Environment to read (default process.env).
 * @returns {Promise<boolean>} Whether the build ran (false when the gate skipped it).
 */
function run(options) {
  const { packageDir = process.cwd(), env = process.env } = options || {};

  // A skipped prepare builds nothing, so nothing rewrote the manifest
  if (!guardPrepare({ packageDir, env })) {
    return Promise.resolve(false);
  }

  // Resolved from the package being prepared (whose devDependency it is), with
  // devkit's own tree as the fallback, the same two paths the vendor tool uses
  const prepare = require(require.resolve('prepare-package', { paths: [packageDir, __dirname] }));

  return Promise.resolve()
    .then(() => prepare())
    .then(
      () => {
        // A green build that left the gate off is a FAILED prepare: npm buffers
        // the warning away from a plain install, so the exit code is the only
        // signal the lanes above can act on.
        const { guarded, warning } = ensureGuarded({ packageDir });
        if (!guarded) throw new Error(warning);

        return true;
      },
      (e) => {
        ensureGuarded({ packageDir });
        throw e;
      },
    );
}

module.exports = guardPrepare;
module.exports.prepareDecision = prepareDecision;
module.exports.rewire = rewire;
module.exports.ensureGuarded = ensureGuarded;
module.exports.run = run;
module.exports.GUARDED_PREPARE = GUARDED_PREPARE;
module.exports.UNGUARDED_PREPARE = UNGUARDED_PREPARE;
