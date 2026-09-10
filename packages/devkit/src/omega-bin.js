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
 *   - an OMEGA PACKAGE'S OWN ROOT (package.json `name` is `@omega.js/*`) →
 *     that package's own CLI, or a refusal when it ships none. Checked FIRST,
 *     ahead of the dependency rule: a framework devDepends on other frameworks
 *     (extension and desktop on @omega.js/web for vendorAssets, the manager on
 *     @omega.js/backend), and reading those as a target made `omega test` in
 *     packages/extension run WEB's CLI, which scaffolded a web target into the
 *     package ([#757](https://github.com/Omega-JS-Stack/omega/issues/757))
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

// Every package in the OMEGA monorepo carries this name prefix; no consumer
// target ever does. A manifest with it IS the package, never a project built
// on top of one (#757).
const OMEGA_SCOPE = '@omega.js/';

// Dirs that are a VIEW of the target one level up, never a context of their own:
// a backend's runtime cwd (functions/) and its staged build output (dist/,
// which carries a COMPOSED config/omega.json5 that would otherwise read as a
// brand root). Stdlib twin of @omega.js/config's TARGET_SUBDIRS — that module is
// the canonical list ([#307](https://github.com/Omega-JS-Stack/omega/issues/307)).
const TARGET_SUBDIRS = ['functions', 'dist'];

// The only verbs allowed to run with NO target context. The fallback exists for
// the bootstrap case (`npx omega onboard` in a fresh clone, #276) and for verbs
// that only READ; every other verb runs its target scaffold first (#675), so a
// run in a directory that owns no target WRITES one there — that is how a stray
// `omega deploy` at a workspace root scaffolded a whole desktop target into it
// ([#699](https://github.com/Omega-JS-Stack/omega/issues/699)).
//
// Tokens, not command names: a flag-style alias (`omega --deploy`, `omega -v`)
// selects a verb too, so every spelling of an allowed verb is listed —
// onboard/help/version across the router frameworks and the manager, plus
// backend's `cwd` and desktop's `logs`, the two read-only reporters.
const CONTEXTLESS_VERBS = new Set([
  'onboard', 'create', 'new', '-o', '--onboard',
  'help', 'h', '-h', '--help',
  'version', 'v', '-v', '--version',
  'cwd',
  'logs', 'log', '--logs', 'logs:read', 'logs:tail', 'logs:stream',
]);

// The signing box's verbs. A box that hosts the Windows EV signing runner is a
// MACHINE, not a project: `omega runner` and `omega sign-windows` read their
// configuration from the runner home and run from any directory. Both belong
// to @omega.js/desktop, so with no target they go to desktop's CLI — the host
// when desktop won the bin link (a bare `npm i -g @omega.js/desktop`), else
// desktop resolved from the cwd (a monorepo checkout, a brand root) — and
// refuse naming the install when it is nowhere. They scaffold nothing
// ([#337](https://github.com/Omega-JS-Stack/omega/issues/337)).
const BOX_VERBS = new Set(['runner', 'sign-windows']);
const DESKTOP = '@omega.js/desktop';

/**
 * The signing-box verb this invocation selects, or null. The ONE reading of
 * "is this the box's", shared by the dispatcher below and by
 * @omega.js/desktop's CLI (which skips the project `.env` cascade for exactly
 * these) — two readings would drift, and the drift is a brand's token reaching
 * the box.
 *
 * Both spellings count: the bare token (`omega runner status`) and the `--`
 * flag desktop's alias table takes (`omega --runner`, `omega --sign-windows
 * --smoke`). `--help` is never one: it prints help, in every spelling. A box
 * verb sitting in an ARGUMENT position is not one either — `omega test runner`
 * runs the test verb — so the first positional has to be the box verb itself.
 *
 * @param {string[]} argv - Arguments after the bin name.
 * @returns {string|null} The box verb's canonical name, or null.
 */
function boxVerbOf(argv) {
  argv = argv || [];
  if (argv.includes('--help') || argv.includes('-h')) return null;

  const positional = argv.find((arg) => !arg.startsWith('-'));
  if (positional && BOX_VERBS.has(positional)) return positional;

  const flag = argv.find((arg) => arg.startsWith('--') && BOX_VERBS.has(arg.slice(2)));
  return flag ? flag.slice(2) : null;
}

/**
 * Boolean half of boxVerbOf — what callers that only need the yes/no ask.
 *
 * @param {string[]} argv - Arguments after the bin name.
 * @returns {boolean}
 */
function isBoxVerbArgv(argv) {
  return boxVerbOf(argv) !== null;
}

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
 * order: the dir's own package.json being an OMEGA package, then declaring a
 * framework, then brand-root-ness. IDENTITY beats dependency — a framework
 * devDepends on other frameworks, and reading those as a target dispatched a
 * framework's own root to a sibling framework's CLI (#757). Framework checks
 * then come before the brand check so a standalone consumer (framework dep AND
 * its own config/omega.json5 in one dir) dispatches as a target, not a brand.
 * The CLI entry normalizes a functions/ cwd up to the target root
 * (muscle-memory `cd functions` still works).
 *
 * The walk is BOUNDED at the nearest `.git` (that directory is still checked
 * first): past the repo boundary is somebody else's tree, never this dir's
 * dispatch context. Same bound as @omega.js/config's resolveBrandRoot and the
 * Claude plugin's inject hook.
 *
 * @returns {{ kind: 'self', name: string, dir: string }
 *   | { kind: 'framework', name: string, dir: string }
 *   | { kind: 'brand', dir: string } | null} dir = the package's own root
 *   (self) / where the framework dep is declared (framework) / the brand root
 *   (brand)
 */
function findTarget(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    const pkg = readPackage(dir);

    if (pkg && typeof pkg.name === 'string' && pkg.name.startsWith(OMEGA_SCOPE)) {
      return { kind: 'self', name: pkg.name, dir };
    }

    const matches = frameworksOf(pkg);
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

/**
 * The verb an invocation resolves to, as far as the dispatcher can see it: the
 * frameworks' own resolution rules minus their per-framework alias tables.
 * `--help`/`-h` wins outright (cli-router routes it ahead of positionals, so
 * `omega deploy --help` prints help), then the first positional token, then the
 * first flag-style alias. A bare `omega` has no verb — every CLI defaults to help.
 *
 * @param {string[]} argv - Arguments after the bin name.
 * @returns {string|null} The selecting token, or null for a bare invocation.
 */
function verbOf(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return 'help';
  return argv.find((arg) => !arg.startsWith('-')) || argv[0] || null;
}

async function run({ hostName, hostRun, argv = process.argv.slice(2) }) {
  const target = findTarget(process.cwd());

  // No context — the bootstrap case (a verb run in a fresh directory has
  // no framework dep yet, by definition). Run the HOST framework's CLI, exactly
  // like the pre-dispatcher bins did, and say which one so a hoist-winner at a
  // brand root is never a silent mystery.
  if (!target) {
    // …but ONLY for a verb that cannot write. The fallback hands a mutating verb
    // to whichever framework won npm's bin link, and that verb scaffolds its own
    // target into the cwd — a directory that owns no target is never where that
    // should land (#699). Twin of ensure-target's refusal (devkit scaffold-guard.js).
    const verb = verbOf(argv);
    const boxVerb = boxVerbOf(argv);
    if (boxVerb) {
      if (hostName === DESKTOP) return hostRun();
      const { cliPath } = tryResolveCli(DESKTOP, process.cwd());
      if (!cliPath) {
        console.error(`omega: "${boxVerb}" is ${DESKTOP}'s — a signing box runs it from any directory, but ${DESKTOP} is not installed here (from ${process.cwd()}). \`npm i -g ${DESKTOP}\`, then run it again.`);
        process.exit(1);
      }
      console.error(`omega: no target context found from ${process.cwd()} — "${boxVerb}" is a signing-box verb, running ${DESKTOP}`);
      return require(cliPath).run();
    }
    if (verb && !CONTEXTLESS_VERBS.has(verb)) {
      console.error(`omega: refusing to run "${verb}" — ${process.cwd()} is not inside an OMEGA target (no framework dependency and no config/omega.json5 above it). Nothing was scaffolded.`);
      console.error('Run it from a target directory, or `npx omega onboard` to create one here. Without a target, only onboard (create, new), help, version, cwd and logs run; the signing box\'s runner and sign-windows run through @omega.js/desktop.');
      process.exit(1);
    }

    console.error(`omega: no target context found from ${process.cwd()} — running ${hostName}`);
    return hostRun();
  }

  // An OMEGA package's OWN root — run ITS CLI, so `omega test` in
  // packages/extension runs the extension's self-test. A package is never a
  // target: nothing here may reach the host fallback, whose ensure-target would
  // scaffold a consumer project into the framework source tree (#757).
  if (target.kind === 'self') {
    if (target.name === hostName) return hostRun();

    const { cliPath, error } = tryResolveCli(target.name, target.dir);
    if (!cliPath) {
      // Two different facts share one refusal: a package that exports no
      // `./cli` at all (config, devkit, ...) versus one that declares it but
      // cannot resolve it right now (an unbuilt dist, a fresh clone before
      // `npm install`). Name the one that applies.
      const reason = error && error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED'
        ? 'which ships no CLI'
        : `whose './cli' did not resolve (${error ? error.message : 'unknown'}; an unbuilt dist? run its prepare)`;
      console.error(`omega: refusing to run — ${target.dir} is the ${target.name} package itself, ${reason}, and an OMEGA package is never a target. Nothing was scaffolded.`);
      process.exit(1);
    }
    return require(cliPath).run();
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

module.exports = { run, findTarget, isBrandRoot, verbOf, isBoxVerbArgv, TARGET_SUBDIRS, CONTEXTLESS_VERBS, BOX_VERBS, FRAMEWORKS, MANAGER };
