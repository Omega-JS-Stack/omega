/**
 * Resolve a framework's `omega` bin FILE via the node_modules directory climb
 * from where the target declares it. A manual walk (not require.resolve) because
 * exports-restricted packages don't expose ./package.json. Shared by the
 * brand-root fan-out commands (`omega test`, `omega deploy`).
 *
 * Also the ONE place those commands decide HOW to run a verb on a target, so
 * the framework lane and the custom-target lane (#603) never drift apart:
 * a framework target dispatches through its own `omega <verb>` bin with the
 * brand's flags forwarded; a custom target runs `npm run <verb>` in its dir
 * with NO flags (a package script has no contract for them) and steps aside
 * loudly when it declares no such script.
 *
 * A backend in CUSTOM-SERVER mode (#584) takes the script lane for the verbs
 * its framework cannot serve — `omega deploy` is a Functions deploy and
 * `omega test` is the emulator lane, and both REFUSE in that mode. It stays a
 * framework target for everything else; a container host's publish command is
 * the brand's to name, and its `deploy` script is where it names it.
 */
const fs = require('node:fs');
const path = require('node:path');

const { findTarget } = require('@omega.js/devkit/omega-bin');
const { targetScripts } = require('./custom-target.js');

// The verbs @omega.js/backend serves through Firebase and therefore refuses in
// custom-server mode (#584) — the fan-outs take the script lane for these, and
// only these. `build`, `update` and the rest are mode-agnostic.
const FIREBASE_ONLY_VERBS = new Set(['deploy', 'test']);

/**
 * @param {string} fromDir - Directory to climb from (where the dep is declared)
 * @param {string} name - Framework package name ('@omega.js/web', …)
 * @returns {string|null} - Absolute bin path, or null when not installed
 */
function resolveFrameworkBin(fromDir, name) {
  let dir = path.resolve(fromDir);

  while (true) {
    const pkgDir = path.join(dir, 'node_modules', name);
    const pkgPath = path.join(pkgDir, 'package.json');

    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin || {}).omega;
      return bin ? path.join(pkgDir, bin) : null;
    }

    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * How the brand-root fan-out should run `verb` on one discovered target.
 *
 * @param {object} entry - A discoverTargets entry ({ name, dir, path, target, custom, projectType }).
 * @param {string} verb - The verb ('deploy', 'test', …).
 * @param {string[]} [forwarded] - Brand-level flags to forward (framework lane only).
 * @param {object} [options]
 * @param {boolean} [options.dryRun] - The run is a dry run.
 * @returns {{ kind: 'framework'|'custom'|'plan'|'skip'|'error', label?: string,
 *   command?: string, args?: string[], framework?: string, detail?: string }}
 */
function resolveTargetRun(entry, verb, forwarded = [], options = {}) {
  if (entry.custom || (entry.projectType === 'custom' && FIREBASE_ONLY_VERBS.has(verb))) {
    const scripts = targetScripts(entry.path);
    if (!scripts[verb]) {
      return { kind: 'skip', detail: `no "${verb}" script in ${entry.dir}/package.json` };
    }

    // A framework target honors --dry-run itself; a package script has no
    // such contract and the flag is not forwarded to it, so the dry run stops
    // HERE and reports the plan. Running a real deploy under --dry-run would
    // be the worst possible reading of the flag.
    if (options.dryRun) {
      return { kind: 'plan', detail: `would run npm run ${verb} in ${entry.dir}` };
    }

    return { kind: 'custom', command: 'npm', args: ['run', verb], label: `npm run ${verb}` };
  }

  const target = findTarget(entry.path);
  if (!target || target.kind !== 'framework') {
    return { kind: 'error', detail: 'no framework dependency detected (target-root package.json)' };
  }

  const binPath = resolveFrameworkBin(target.dir, target.name);
  if (!binPath) {
    return { kind: 'error', detail: `${target.name} is not installed (node_modules climb from ${target.dir} found no bin)` };
  }

  return {
    kind: 'framework',
    framework: target.name,
    command: process.execPath,
    args: [binPath, verb, ...forwarded],
    label: `omega ${verb} ${forwarded.join(' ')}`.trimEnd(),
  };
}

module.exports = { resolveFrameworkBin, resolveTargetRun };
