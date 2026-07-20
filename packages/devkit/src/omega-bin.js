/**
 * omega-bin — the context-aware dispatcher behind every framework's `omega`/`omg` bin.
 *
 * Problem: every OMEGA framework ships the same bin names (`omega`, `omg`, `mgr`).
 * In a brand monorepo with several apps, npm hoists all of them to the brand root
 * and only ONE framework's file wins the node_modules/.bin link — so the bin that
 * actually runs is arbitrary. This module makes any winner correct: it resolves
 * the context that owns the CALLER'S cwd — nearest first, walking up — and runs
 * THAT context's CLI:
 *
 *   - an APP (nearest package.json declaring a framework, including the
 *     backend's functions/ layout) → that framework's CLI
 *   - a BRAND ROOT (config/omega.json5 with no framework declared nearer)
 *     → @omega.js/manager's CLI, so `omega test` at a brand root fans out
 *     over the brand's apps instead of guessing one framework
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

function frameworkOf(pkg) {
  return frameworksOf(pkg)[0] || null;
}

/**
 * Is `dir` a brand-monorepo root? Carries a config/omega.json5 that is not
 * itself an APP of a brand above it (directly under an apps/ dir whose parent
 * also carries a brand config). Stdlib twin of @omega.js/config's
 * resolveBrandRoot rule — that module is the canonical definition; this copy
 * exists because the dispatcher cannot depend on @omega.js/config.
 */
function isBrandRoot(dir) {
  if (!fs.existsSync(path.join(dir, 'config', 'omega.json5'))) return false;

  const parent = path.dirname(dir);
  const isAppOfBrand = path.basename(parent) === 'apps'
    && fs.existsSync(path.join(path.dirname(parent), 'config', 'omega.json5'));

  return !isAppOfBrand;
}

/**
 * Walk up from startDir to the nearest dispatch context. At each level, in
 * order: the dir's own package.json declaring a framework, then
 * brand-root-ness. Framework checks come first so a standalone consumer
 * (framework dep AND its own config/omega.json5 in one dir) dispatches as
 * an app, not a brand. The CLI entry normalizes a functions/ cwd up to the
 * app root (muscle-memory `cd functions` still works).
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
      // Apps are one-framework-per-app by design — a multi-framework
      // manifest dispatches by FRAMEWORKS order, which must never be silent.
      console.error(`omega: ${dir} declares ${matches.length} frameworks (${matches.join(', ')}) — dispatching ${matches[0]}`);
    }
    const own = matches[0] || null;
    if (own) return { kind: 'framework', name: own, dir };

    if (isBrandRoot(dir)) {
      return { kind: 'brand', dir };
    }

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Resolve a dispatch target's ./cli from where it is declared, with a clear failure. */
function resolveCli(name, fromDir, hint) {
  const req = createRequire(path.join(fromDir, 'package.json'));
  try {
    return req.resolve(`${name}/cli`);
  } catch (e) {
    console.error(`omega: found ${name} context (${fromDir}) but could not resolve '${name}/cli': ${e.message}`);
    console.error(hint);
    process.exit(1);
  }
}

async function run({ hostName, hostRun }) {
  const target = findTarget(process.cwd());

  // No context — the bootstrap case (`omega setup` in a fresh directory has
  // no framework dep yet, by definition). Run the HOST framework's CLI, exactly
  // like the pre-dispatcher bins did, and say which one so a hoist-winner at a
  // brand root is never a silent mystery.
  if (!target) {
    console.error(`omega: no app context found from ${process.cwd()} — running ${hostName}`);
    return hostRun();
  }

  // A brand root — the manager owns brand-level commands (`omega test` fans
  // out over apps/*). Resolve it from the brand root and hand over.
  if (target.kind === 'brand') {
    const cliPath = resolveCli(MANAGER, target.dir,
      `Is ${MANAGER} installed? Add it to the brand root's devDependencies, or \`mgr i local\` for a monorepo link.`);
    return require(cliPath).run();
  }

  // The bin that won npm's .bin link belongs to this app's framework — run it directly.
  if (target.name === hostName) {
    return hostRun();
  }

  // The app belongs to a DIFFERENT framework — resolve its CLI from where the
  // dependency is declared and hand over.
  const cliPath = resolveCli(target.name, target.dir,
    'Is the framework installed? Try npm install, or `mgr i local` for a monorepo link.');
  return require(cliPath).run();
}

module.exports = { run, findTarget, isBrandRoot, FRAMEWORKS, MANAGER };
