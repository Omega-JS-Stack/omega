/**
 * `omega dev` (brand root) — ONE command boots the local stack: the website
 * dev server AND the backend emulator suite together, each spawned in its
 * own app with its own Node (web/backend pin different majors), output
 * line-prefixed per target, one Ctrl-C killing everything.
 *
 * Target selection (Ian 2026-07-16): the default set is web + backend — the
 * local web loop. GUI/watcher targets (desktop opens an Electron window,
 * extension runs a build watcher) never boot unless asked.
 *   omega dev                       web + backend
 *   omega dev --only web            one leg
 *   omega dev --only web,backend    explicit set
 *   omega dev --except backend      default minus
 *   omega dev --all                 every target with a dev leg
 *
 * Port coordination is already solved (N7): the backend leg publishes its
 * emulator ports; the web leg reads them and bakes dev.ports into pages —
 * order tolerant, but backend boots first here so the fast path wins.
 */

// Libraries
const { spawn } = require('node:child_process');
const chalk = require('chalk').default;

// Local
const { resolveBrandRoot, discoverApps } = require('../lib/brand.js');
const { resolveAppNode, nodeEnvFor } = require('../lib/node-version.js');

// Target → the npm leg that IS local dev for that app
const DEV_LEGS = {
  web: ['npm', 'run', 'start'], // omega dev — watch + serve (:4000)
  backend: ['npm', 'run', 'emulator'], // omega emulator — FULL suite + seeded personas
  desktop: ['npm', 'run', 'start'], // opt-in: opens an Electron window
  extension: ['npm', 'run', 'start'], // opt-in: extension build watcher
};

// Booted without flags — the local web loop
const DEFAULT_TARGETS = ['web', 'backend'];

/**
 * Pure target selection — which legs boot for a given flag set.
 * @param {object} input
 * @param {string[]} input.available - targets that have an app in this brand
 * @param {string} [input.only] - comma list: exact set to boot
 * @param {string} [input.except] - comma list: subtract from the set
 * @param {boolean} [input.all] - start every target with a dev leg
 * @returns {{ selected: string[], unknown: string[], missing: string[] }}
 */
function selectDevTargets({ available, only, except, all }) {
  const requested = only
    ? String(only).split(',').map((part) => part.trim()).filter(Boolean)
    : (all ? Object.keys(DEV_LEGS) : DEFAULT_TARGETS.filter((target) => available.includes(target)));
  const excluded = new Set(String(except || '').split(',').map((part) => part.trim()).filter(Boolean));

  const unknown = requested.filter((target) => !DEV_LEGS[target]);
  const kept = requested.filter((target) => DEV_LEGS[target] && !excluded.has(target));
  const selected = kept.filter((target) => available.includes(target));
  const missing = kept.filter((target) => !available.includes(target));

  // Backend first: it publishes the emulator port map the web leg reads
  selected.sort((a, b) => (a === 'backend' ? -1 : 0) - (b === 'backend' ? -1 : 0));

  return { selected, unknown, missing };
}

module.exports = async (options = {}) => {
  const brandRoot = resolveBrandRoot(process.cwd());
  if (!brandRoot) {
    console.error(chalk.red('✖ omega dev: no brand root found (looked for config/omega.json5 walking up from here)'));
    process.exit(1);
  }

  const apps = discoverApps(brandRoot).filter((app) => app.target && DEV_LEGS[app.target]);
  const { selected, unknown, missing } = selectDevTargets({
    available: apps.map((app) => app.target),
    only: options.only,
    except: options.except,
    all: options.all,
  });

  unknown.forEach((target) => {
    console.log(chalk.yellow(`⊘ unknown dev target "${target}" (know: ${Object.keys(DEV_LEGS).join(', ')})`));
  });
  missing.forEach((target) => {
    console.log(chalk.yellow(`⊘ ${target}: no app in this brand — skipped`));
  });

  if (selected.length === 0) {
    console.error(chalk.red('✖ omega dev: nothing to boot (no selected target has an app here)'));
    process.exit(1);
  }

  console.log(chalk.bold(`🚀 omega dev — booting ${selected.join(' + ')} ${chalk.dim(`(${brandRoot})`)}`));
  if (!options.only && !options.all) {
    console.log(chalk.dim('   default set is web + backend — `--only`, `--except`, `--all` filter it'));
  }

  const pad = Math.max(...selected.map((target) => target.length));
  const children = [];
  let shuttingDown = false;

  const forward = (stream, log, name) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach((line) => log(`${chalk.dim(`[${name.padEnd(pad)}]`)} ${line}`));
    });
  };

  for (const target of selected) {
    const app = apps.find((entry) => entry.target === target);
    const leg = DEV_LEGS[target];
    const node = resolveAppNode(app.path);
    if (node?.error) {
      console.log(chalk.yellow(`   ⚠ ${target}: ${node.error} — using the inherited node`));
    }

    console.log(chalk.dim(`   ${target.padEnd(pad)} → ${leg.join(' ')} in ${app.dir}${node ? ` (node ${node.major})` : ''}`));

    const child = spawn(leg[0], leg.slice(1), {
      cwd: app.path,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...nodeEnvFor(node) },
    });
    forward(child.stdout, console.log, target);
    forward(child.stderr, console.error, target);
    child.on('close', (code) => {
      if (shuttingDown) return;
      console.error(chalk.red(`✖ ${target} exited (code ${code}) — siblings stay up; Ctrl-C stops everything`));
    });
    children.push(child);
  }

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(chalk.dim('\n⏹ omega dev: stopping all targets…'));
    children.forEach((child) => {
      try {
        child.kill('SIGTERM');
      } catch {
        // already gone
      }
    });
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the orchestrator alive while any child runs
  await new Promise(() => {});
};

module.exports.selectDevTargets = selectDevTargets;
module.exports.DEV_LEGS = DEV_LEGS;
module.exports.DEFAULT_TARGETS = DEFAULT_TARGETS;
