/**
 * Resolve a framework's `omega` bin FILE through devkit's one node_modules
 * walk (`resolvePackageDir`), the path as the brand installed it.
 *
 * The ONE place the brand root decides HOW to run a verb on a target, by its
 * row: a fan-out verb runs `npm run <verb>` in every target and steps aside
 * loudly when the script is missing; only the framework's own script
 * (exactly `omega <verb>`) hears the brand's flags after `--`. A single-target
 * verb passes through to the framework's CLI with the argv as typed. And the
 * ONE place deciding WHERE a target's scaffold comes from: the framework's
 * `./ensure-target` subpath, run in-process; a custom target steps aside.
 */
const fs = require('node:fs');
const path = require('node:path');

const { findTarget, MANAGER } = require('@omega.js/devkit/omega-bin');
const { resolvePackageDir } = require('@omega.js/devkit/local');
// A verb's dryRun fact is its row in the one verb table
const { findVerb } = require('@omega.js/devkit/verbs');
const { targetScripts } = require('./custom-target.js');

/**
 * @param {string} fromDir - Directory to climb from (where the dep is declared)
 * @param {string} name - Framework package name ('@omega.js/web', …)
 * @returns {string|null} - Absolute bin path, or null when not installed
 */
function resolveFrameworkBin(fromDir, name) {
  const resolved = resolveFrameworkPackage(fromDir, name);
  if (!resolved) return null;

  const bin = typeof resolved.pkg.bin === 'string' ? resolved.pkg.bin : (resolved.pkg.bin || {}).omega;
  return bin ? path.join(resolved.dir, bin) : null;
}

/**
 * The framework package itself, via the same climb — for readers of its
 * manifest declarations (`projectScripts`, the workspace target heal).
 *
 * @param {string} fromDir - Directory to climb from (where the dep is declared)
 * @param {string} name - Framework package name ('@omega.js/web', …)
 * @returns {{ dir: string, pkg: object }|null} - null when not installed
 */
function resolveFrameworkPackage(fromDir, name) {
  const dir = resolvePackageDir(name, fromDir);
  if (!dir) return null;

  return { dir, pkg: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) };
}

/**
 * Is this target script the framework's own, the one that takes the brand's
 * flags? Exactly `omega <verb>`: anything else is the brand's own command.
 *
 * @param {string} command - The script's command.
 * @param {string} verb - The script (verb) name.
 * @returns {boolean}
 */
function isFrameworkScript(command, verb) {
  return command === `omega ${verb}`;
}

/**
 * How the brand-root fan-out should run `verb` on one discovered target: its
 * own `npm run <verb>`, the flags after `--` when the script is the framework's own.
 *
 * @param {object} entry - A discoverTargets entry ({ name, dir, path, target, custom, projectType }).
 * @param {string} verb - The verb as typed ('deploy', 'firestore:set', '--build', ...).
 * @param {string[]} [forwarded] - Brand-level flags and args, handed to the script after `--`.
 * @param {object} [options]
 * @param {boolean} [options.dryRun] - The run is a dry run: a script that cannot
 *   honor the flag returns kind:'plan' instead of a command.
 * @returns {{ kind: 'framework'|'custom'|'plan'|'skip'|'error', label?: string,
 *   command?: string, args?: string[], framework?: string, frameworkScript?: boolean, detail?: string }}
 */
function resolveTargetRun(entry, verb, forwarded = [], options = {}) {
  const row = findVerb(verb);
  // Every caller hands a fan-out verb it read from the table, so a miss is a caller's bug
  if (!row) throw new Error(`resolveTargetRun: "${verb}" has no row in @omega.js/devkit/verbs`);
  if (row.fanout !== 'each') throw new Error(`resolveTargetRun: "${verb}" is a single-target command, never a fan-out script (resolveTargetCommand runs it)`);

  // Every spelling of a fan-out verb runs the one script its row names
  const script = row.name;

  let framework;
  if (!entry.custom) {
    const target = findTarget(entry.path);
    if (!target || target.kind !== 'framework') {
      return { kind: 'error', detail: 'no framework dependency detected (target-root package.json)' };
    }
    framework = target.name;
  }

  const owner = framework ? { framework } : {};
  const command = targetScripts(entry.path)[script];
  if (!command) {
    return { kind: 'skip', ...owner, detail: `no "${script}" script in ${entry.dir}/package.json` };
  }

  // Only the framework's own `omega <verb>` honors --dry-run, and a row marked
  // dryRun is answered here for every target, so either way the run is the plan
  const frameworkScript = isFrameworkScript(command, script);
  if (options.dryRun && (row.dryRun || !frameworkScript)) {
    return { kind: 'plan', ...owner, frameworkScript, detail: `would run npm run ${script} in ${entry.dir}` };
  }

  const args = ['run', script, ...(frameworkScript && forwarded.length ? ['--', ...forwarded] : [])];
  return { kind: framework ? 'framework' : 'custom', ...owner, frameworkScript, command: 'npm', args, label: `npm ${args.join(' ')}` };
}

/**
 * How the brand root runs a single-target command (`fanout: 'none'`) on the one
 * target `--target=` picked: the target framework's own CLI, through its bin by
 * path, in the target dir, with the argv exactly as typed (an alias included).
 *
 * @param {object} entry - A discoverTargets entry ({ name, dir, path, target, custom }).
 * @param {string} verb - The verb as typed ('firestore:set', 'emulators', ...).
 * @param {string[]} argv - The whole argv the CLI receives, the verb included.
 * @param {object} [options]
 * @param {boolean} [options.dryRun] - The run is a dry run: return the plan, spawn nothing.
 * @returns {{ kind: 'framework'|'plan'|'skip'|'error', label?: string, command?: string,
 *   args?: string[], framework?: string, detail?: string }}
 */
function resolveTargetCommand(entry, verb, argv, options = {}) {
  const row = findVerb(verb);
  if (!row) throw new Error(`resolveTargetCommand: "${verb}" has no row in @omega.js/devkit/verbs`);

  // A custom target has no framework CLI: nothing to run, and nothing has failed
  if (entry.custom) {
    const owners = row.owners.filter((owner) => owner !== MANAGER).join(', ');
    return { kind: 'skip', detail: `${verb} is a ${owners} command; ${entry.name} is custom` };
  }

  const target = findTarget(entry.path);
  if (!target || target.kind !== 'framework') {
    return { kind: 'error', detail: 'no framework dependency detected (target-root package.json)' };
  }

  const binPath = resolveFrameworkBin(target.dir, target.name);
  if (!binPath) {
    return { kind: 'error', detail: `${target.name} is not installed (node_modules climb from ${target.dir} found no bin)` };
  }

  if (options.dryRun) {
    return { kind: 'plan', framework: target.name, detail: `would run ${target.name} ${argv.join(' ')} in ${entry.dir}` };
  }

  return { kind: 'framework', framework: target.name, command: process.execPath, args: [binPath, ...argv], label: `omega ${argv.join(' ')}` };
}

/**
 * The scaffold function the brand-root deploy runs on one target, IN-PROCESS
 * (#901): every framework exposes its `ensureTarget` at the one subpath
 * `@omega.js/<framework>/ensure-target`, so the fan-out composes each target's
 * workflow into the brand root before its one push without a verb to spawn.
 *
 * @param {object} entry - A discoverTargets entry ({ name, dir, path, target, custom, projectType }).
 * @returns {{ kind: 'framework'|'skip'|'error', framework?: string,
 *   ensureTarget?: Function, detail?: string }}
 */
function resolveTargetScaffold(entry) {
  return resolveTargetEntry(entry, 'ensure-target', 'ensureTarget', 'a custom target has no framework scaffold');
}

/**
 * The migration the brand-root `omega migrate` runs on one target, IN-PROCESS:
 * every framework exposes its `migrateTarget` at the one subpath
 * `@omega.js/<framework>/migrate`, so the walk never spawns a verb and never
 * special-cases a framework name.
 *
 * @param {object} entry - A discoverTargets entry ({ name, dir, path, target, custom, projectType }).
 * @returns {{ kind: 'framework'|'skip'|'error', framework?: string,
 *   migrateTarget?: Function, detail?: string }}
 */
function resolveTargetMigrate(entry) {
  return resolveTargetEntry(entry, 'migrate', 'migrateTarget', 'a custom target has no framework migration');
}

/**
 * The scripts a target in CUSTOM mode owns instead of its framework, named by
 * that framework's own scaffold entry (`@omega.js/<framework>/ensure-target`'s
 * `CUSTOM_OWNED_SCRIPTS`), so the workspace walk and the framework's scaffold
 * read one list.
 *
 * @param {object} entry - A discoverTargets entry ({ name, dir, path, target, custom, projectType }).
 * @returns {{ kind: 'framework'|'skip'|'error', framework?: string,
 *   CUSTOM_OWNED_SCRIPTS?: string[], detail?: string }}
 */
function resolveTargetCustomOwned(entry) {
  return resolveTargetEntry(entry, 'ensure-target', 'CUSTOM_OWNED_SCRIPTS', 'a custom target owns every script');
}

/**
 * Load one named export of a target's framework subpath, from where the
 * target declares the dependency. The one mechanism behind the in-process
 * entries (the scaffold, the migration), so their answers cannot drift.
 *
 * @param {object} entry - A discoverTargets entry.
 * @param {string} subpath - The framework subpath ('ensure-target', 'migrate').
 * @param {string} exported - The export to hand back, under its own name.
 * @param {string} customDetail - What a custom target's skip says.
 * @returns {object}
 */
function resolveTargetEntry(entry, subpath, exported, customDetail) {
  // A custom target is the brand's own scripts end to end: no framework wrote
  // its tree, so there is nothing to run and nothing has failed.
  if (entry.custom) {
    return { kind: 'skip', detail: customDetail };
  }

  const target = findTarget(entry.path);
  if (!target || target.kind !== 'framework') {
    return { kind: 'error', detail: 'no framework dependency detected (target-root package.json)' };
  }

  // Resolved from where the target declares the dependency, through its
  // exports map. A missing subpath (a framework out of date with its manager)
  // and a module that throws on load are both the caller's failure line, never
  // a raw stack out of the middle of a brand run.
  let resolved;
  let loaded;
  try {
    resolved = require.resolve(`${target.name}/${subpath}`, { paths: [target.dir] });
    loaded = require(resolved)[exported];
  } catch (e) {
    // `resolved` separates the two failures the one try now covers: unset means
    // the subpath itself is missing, set means the module threw on the way in.
    return resolved
      ? { kind: 'error', detail: `${target.name}/${subpath} failed to load: ${e.message}` }
      : { kind: 'error', detail: `${target.name} exposes no ${subpath} entry (update it)` };
  }

  return { kind: 'framework', framework: target.name, [exported]: loaded };
}

module.exports = { resolveFrameworkBin, resolveFrameworkPackage, isFrameworkScript, resolveTargetRun, resolveTargetCommand, resolveTargetScaffold, resolveTargetMigrate, resolveTargetCustomOwned };
