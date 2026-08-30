/**
 * omega-bin — the context-aware dispatcher behind every framework's `omega`/`omg` bin.
 *
 * Problem: every OMEGA framework ships the same bin names (`omega`, `omg`, `mgr`).
 * In a brand monorepo with several targets, npm hoists all of them to the brand root
 * and only ONE framework's file wins the node_modules/.bin link — so the bin that
 * actually runs is arbitrary. This module makes any winner correct: it resolves
 * the context that owns the CALLER'S cwd — nearest first, walking up — and runs
 * THAT context's CLI:
 *
 *   - a TARGET (nearest package.json declaring a framework, including the
 *     backend's functions/ layout) → that framework's CLI
 *   - a BRAND ROOT (config/omega.json5 with no framework declared nearer)
 *     → @omega.js/manager's CLI, so `omega test` at a brand root fans out
 *     over the brand's targets instead of guessing one framework
 *
 * Contract: every dispatch target exposes `exports['./cli']` → a module with
 * `run()` that parses process.argv itself. Framework bin shims call
 * `run({ hostName, hostRun })` — hostRun executes the host's own CLI via a
 * RELATIVE require (vendor-safe), so the host never resolves itself by name.
 *
 * This module stays stdlib-only (fs/path/module): it is vendored into every
 * framework dist and must never assume another package is installed.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const FRAMEWORKS = [
  '@omega.js/web',
  '@omega.js/backend',
  '@omega.js/desktop',
  '@omega.js/extension',
];

const MANAGER = '@omega.js/manager';

// Dirs that are a VIEW of the target one level up, never a context of their own:
// a backend's runtime cwd (functions/) and its staged build output (dist/,
// which carries a COMPOSED config/omega.json5 that would otherwise read as a
// brand root). Stdlib twin of @omega.js/config's TARGET_SUBDIRS — that module is
// the canonical list ([#307](https://github.com/Omega-JS-Stack/omega/issues/307)).
const TARGET_SUBDIRS = ['functions', 'dist'];

function readPackage(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch (e) {
    return null;
  }
}

function frameworksOf(pkg) {
  if (!pkg) return [];
  const declared = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
  return FRAMEWORKS.filter((name) => declared[name]);
}

/**
 * Is `dir` a brand-monorepo root? Carries a config/omega.json5 that is not
 * itself a TARGET_SUBDIR view (functions/, dist/) and not a TARGET of a brand above
 * it (directly under a targets/ dir whose parent also carries a brand config).
 * Stdlib twin of @omega.js/config's resolveBrandRoot rule — that module is the
 * canonical definition; this copy exists because the dispatcher cannot depend
 * on @omega.js/config.
 */
function isBrandRoot(dir) {
  if (TARGET_SUBDIRS.includes(path.basename(path.resolve(dir)))) return false;
  if (!fs.existsSync(path.join(dir, 'config', 'omega.json5'))) return false;

  const parent = path.dirname(dir);
  const isTargetOfBrand = path.basename(parent) === 'targets'
    && fs.existsSync(path.join(path.dirname(parent), 'config', 'omega.json5'));

  return !isTargetOfBrand;
}

/**
 * Walk up from startDir to the nearest dispatch context. At each level, in
 * order: the dir's own package.json declaring a framework, then
 * brand-root-ness. Framework checks come first so a standalone consumer
 * (framework dep AND its own config/omega.json5 in one dir) dispatches as
 * a target, not a brand. The CLI entry normalizes a functions/ cwd up to the
 * target root (muscle-memory `cd functions` still works).
 *
 * The walk is BOUNDED at the nearest `.git` (that directory is still checked
 * first): past the repo boundary is somebody else's tree, never this dir's
 * dispatch context. Same bound as @omega.js/config's resolveBrandRoot and the
 * Claude plugin's inject hook.
 *
 * @returns {{ kind: 'framework', name: string, dir: string }
 *   | { kind: 'brand', dir: string } | null} dir = where the framework dep is
 *   declared (framework) / the brand root (brand)
 */
function findTarget(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    const matches = frameworksOf(readPackage(dir));
    if (matches.length > 1) {
      // Targets are one-framework-per-target by design — a multi-framework
      // manifest dispatches by FRAMEWORKS order, which must never be silent.
      console.error(`omega: ${dir} declares ${matches.length} frameworks (${matches.join(', ')}) — dispatching ${matches[0]}`);
    }
    const own = matches[0] || null;
    if (own) return { kind: 'framework', name: own, dir };

    if (isBrandRoot(dir)) {
      return { kind: 'brand', dir };
    }

    // Repo boundary — stop here rather than statting out through the host
    // filesystem to /.
    if (fs.existsSync(path.join(dir, '.git'))) return null;

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve a dispatch target's ./cli from where it is declared.
 * @returns {{ cliPath: string } | { error: Error }} — callers decide whether an
 *   unresolvable target is fatal (cross-framework) or falls back (brand).
 */
function tryResolveCli(name, fromDir) {
  const req = createRequire(path.join(fromDir, 'package.json'));
  try {
    return { cliPath: req.resolve(`${name}/cli`) };
  } catch (e) {
    return { error: e };
  }
}

/** Resolve a dispatch target's ./cli from where it is declared, with a clear failure. */
function resolveCli(name, fromDir, hint) {
  const { cliPath, error } = tryResolveCli(name, fromDir);
  if (error) {
    console.error(`omega: found ${name} context (${fromDir}) but could not resolve '${name}/cli': ${error.message}`);
    console.error(hint);
    process.exit(1);
  }
  return cliPath;
}

async function run({ hostName, hostRun }) {
  const target = findTarget(process.cwd());

  // No context — the bootstrap case (a verb run in a fresh directory has
  // no framework dep yet, by definition). Run the HOST framework's CLI, exactly
  // like the pre-dispatcher bins did, and say which one so a hoist-winner at a
  // brand root is never a silent mystery.
  if (!target) {
    console.error(`omega: no target context found from ${process.cwd()} — running ${hostName}`);
    return hostRun();
  }

  // A brand root — the manager owns brand-level commands (`omega test` fans
  // out over targets/*). Resolve it from the brand root and hand over.
  if (target.kind === 'brand') {
    const { cliPath } = tryResolveCli(MANAGER, target.dir);

    // Brand-SHAPED is not always a brand: every verb's ensureTarget scaffolds
    // config/omega.json5 into a standalone project before its framework dep lands
    // in package.json, so the walk classifies a fresh target as a brand root. With
    // no manager installed there is no brand-level CLI to hand over to — fall
    // back to the host framework rather than dead-ending (#194). A real brand
    // root still dispatches to the manager the moment it exists.
    if (!cliPath) {
      // When the HOST is the manager itself (its own bin in a fresh template
      // clone), "install the manager" would name the thing about to run —
      // that message is for framework hosts only.
      if (hostName === MANAGER) {
        console.error(`omega: brand-shaped directory at ${target.dir} with no installed ${MANAGER} — running the bundled ${hostName} (run npm install to use the pinned version)`);
      } else {
        console.error(`omega: brand-shaped directory at ${target.dir} but ${MANAGER} is not installed — running ${hostName} instead (install ${MANAGER} at the brand root, or \`mgr i local\` for a monorepo link, if this really is a brand)`);
      }
      return hostRun();
    }
    return require(cliPath).run();
  }

  // The bin that won npm's .bin link belongs to this target's framework — run it directly.
  if (target.name === hostName) {
    return hostRun();
  }

  // The target belongs to a DIFFERENT framework — resolve its CLI from where the
  // dependency is declared and hand over.
  const cliPath = resolveCli(target.name, target.dir,
    'Is the framework installed? Try npm install, or `mgr i local` for a monorepo link.');
  return require(cliPath).run();
}

module.exports = { run, findTarget, isBrandRoot, TARGET_SUBDIRS, FRAMEWORKS, MANAGER };
