/**
 * `omega dev` (brand root) — ONE command boots the local stack: the website
 * dev server AND the backend emulator suite together, each spawned in its
 * own target with its own Node (web/backend pin different majors), output
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
 *   omega dev --full                boot on the WHOLE manage walk, not the lane
 *
 * Boot order: the freshness sweep first (one dist check for every lane), then
 * a manage cycle — the boot lane (workspace, assets, disperse: the local
 * redistribution the legs consume), then the legs. See docs/shared/local-dev.md
 * for what refreshes when.
 *
 * Port coordination is already solved (N7): the backend leg publishes its
 * emulator ports; the web leg reads them and bakes dev.ports into pages —
 * order tolerant, but backend boots first here so the fast path wins.
 */

// Libraries
const path = require('node:path');
const { spawn } = require('node:child_process');
const chalk = require('chalk').default;
const attachLogFile = require('@omega.js/devkit/attach-log-file');
const { findTarget } = require('@omega.js/devkit/omega-bin');
const { freshnessSweep } = require('@omega.js/devkit/local');

// Local
const { runManage } = require('../manage.js');
const { resolveBrandRoot, discoverTargets } = require('../lib/brand.js');
const { resolveTargetNode, nodeEnvFor } = require('../lib/node-version.js');

// Target → the npm leg that IS local dev for that target
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
 * @param {string[]} input.available - targets that have a dir in this brand
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

/**
 * Consecutive-duplicate collapser for ONE leg output stream (#230).
 *
 * The Firebase emulator re-prints its own infra lines once per function
 * instance — "i  functions: Loaded environment variables from .env." dozens of
 * times in a row — which buries the lines a human is actually watching for.
 * Repeats of the line just emitted are swallowed and counted; the count
 * surfaces as ONE note when a different line arrives (or the stream ends, so a
 * leg that goes quiet mid-run never eats the tail). The rule is structural —
 * any consecutive duplicate on any leg — never a list of known noisy strings.
 *
 * Blank lines are exempt: a note standing in for a run of them reads louder
 * than the blanks it replaced.
 *
 * Stateful because a stream is; pure otherwise — lines in, lines out.
 * @returns {{ push: (line: string) => string[], flush: () => string[] }}
 */
function createLineDeduper() {
  let previous = null;
  let repeats = 0;

  const note = () => {
    const pending = repeats > 0 ? [`  (repeated ${repeats}×)`] : [];
    repeats = 0;
    return pending;
  };

  return {
    push(line) {
      if (line === previous && line.trim() !== '') {
        repeats += 1;
        return [];
      }
      const out = note();
      previous = line;
      out.push(line);
      return out;
    },
    flush() {
      previous = null;
      return note();
    },
  };
}

module.exports = async (options = {}) => {
  const brandRoot = resolveBrandRoot(process.cwd());
  if (!brandRoot) {
    console.error(chalk.red('✖ omega dev: no brand root found (looked for config/omega.json5 walking up from here)'));
    process.exit(1);
  }

  // Tee the brand-level fan-out — the boot manage cycle AND every leg's
  // prefixed output — to <brandRoot>/logs/dev.log (#197), its OWN file: a boot
  // used to truncate logs/manage.log and take the last service walk's record
  // with it, and the two are read for different questions (#231).
  attachLogFile(path.join(brandRoot, 'logs', 'dev.log'));

  const targets = discoverTargets(brandRoot).filter((entry) => entry.target && DEV_LEGS[entry.target]);
  const { selected, unknown, missing } = selectDevTargets({
    available: targets.map((entry) => entry.target),
    only: options.only,
    except: options.except,
    all: options.all,
  });

  unknown.forEach((target) => {
    console.log(chalk.yellow(`⊘ unknown dev target "${target}" (know: ${Object.keys(DEV_LEGS).join(', ')})`));
  });
  missing.forEach((target) => {
    console.log(chalk.yellow(`⊘ ${target}: no dir in this brand — skipped`));
  });

  if (selected.length === 0) {
    console.error(chalk.red('✖ omega dev: nothing to boot (no selected target has a dir here)'));
    process.exit(1);
  }

  console.log(chalk.bold(`🚀 omega dev — booting ${selected.join(' + ')} ${chalk.dim(`(${brandRoot})`)}`));
  if (!options.only && !options.all) {
    console.log(chalk.dim('   default set is web + backend — `--only`, `--except`, `--all` filter it'));
  }

  // Dist freshness is checked ONCE, here, for every lane at once (#340). Each
  // lane's CLI boot checks itself too — but a heal runs `npm run prepare`,
  // which PURGES dist before recopying, and a framework bin opens by requiring
  // its own `../dist/` entry. Unsynchronized, one lane's purge window is the
  // sibling lane's require: the backend leg died MODULE_NOT_FOUND dispatching
  // through the web package the web leg was mid-rebuild on. Swept first, every
  // lane's own check is a no-op.
  const hosts = [];
  for (const target of selected) {
    const entry = targets.find((item) => item.target === target);
    const found = findTarget(entry.path);
    if (found && found.kind === 'framework') {
      hosts.push({ packageName: found.name, fromDir: found.dir });
    }
  }
  const sweep = freshnessSweep({ hosts });
  if (sweep.healed.length > 0) {
    console.log(chalk.dim(`   ✔ rebuilt ${sweep.healed.join(', ')} before booting — the legs start on a complete dist`));
  }
  if (sweep.staleLinked.length > 0) {
    // The monorepo watch owns those dists (#281) — the sweep printed what is
    // unbuilt and what to start; nothing boots on top of it.
    throw new Error(`omega dev: ${sweep.staleLinked.map((entry) => entry.packageName).join(', ')} — see above; nothing booted`);
  }
  if (sweep.healFailed.length > 0) {
    // The watch is down and the sweep's own rebuild broke (#398) — the sweep
    // printed the prepare to run by hand; no leg boots on a dist nobody built.
    throw new Error(`omega dev: ${sweep.healFailed.map((entry) => entry.packageName).join(', ')} — see above; nothing booted`);
  }

  // Boot opens with a full manage cycle (#44): the target watchers see only
  // their own target, so brand-level sources — assets/logo/brandmark.svg, .env,
  // certs — reach the targets ONLY through the service walk. Without this, a
  // brand edit sits invisible until someone remembers to run `npm run manage`.
  // A broken brand fails the boot instead of serving stale output.
  // …and it never blocks on a human (#228): the boot walk runs headless, so
  // console confirms, consent flows and secret pastes step aside into the run
  // summary's ⚑ pending list instead of stalling the stack. `npm run manage`
  // keeps the full interactive walk. The switch is restored before any leg
  // spawns — the web dev server and the emulator ARE interactive surfaces.
  //
  // …and it walks only the BOOT LANE (#228): workspace + assets + disperse,
  // the local redistribution the legs actually consume. The cloud services
  // and the rebuild lane cost a minute-plus and nothing downstream of them
  // reaches a dev leg, so they belong to `npm run manage` — or `--full` here.
  const priorNonInteractive = process.env.OMEGA_NON_INTERACTIVE;
  process.env.OMEGA_NON_INTERACTIVE = '1';
  let report;
  try {
    report = await runManage(brandRoot, options.full ? {} : { lane: 'boot' });
  } finally {
    if (priorNonInteractive === undefined) {
      delete process.env.OMEGA_NON_INTERACTIVE;
    } else {
      process.env.OMEGA_NON_INTERACTIVE = priorNonInteractive;
    }
  }
  if (report.hasErrors) {
    throw new Error('omega dev: the manage cycle reported errors — fix them (see the run summary above), then boot again');
  }

  if (!options.full) {
    console.log(chalk.dim('   ⚑ boot ran the local lane only — `npm run manage` runs the full setup (or `omega dev --full`)'));
  }

  const pad = Math.max(...selected.map((target) => target.length));
  const children = [];
  let shuttingDown = false;

  // One deduper per stream, so the legs never collapse against each other.
  // Terminal and file see the SAME collapsed stream: the tee patches this
  // process' writers (#197), so there is one stream to dedup, not two.
  const forward = (stream, log, name) => {
    let buffer = '';
    const deduper = createLineDeduper();
    const emit = (lines) => lines.forEach((line) => log(`${chalk.dim(`[${name.padEnd(pad)}]`)} ${line}`));
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach((line) => emit(deduper.push(line)));
    });
    stream.on('end', () => emit(deduper.flush()));
  };

  for (const target of selected) {
    const entry = targets.find((item) => item.target === target);
    const leg = DEV_LEGS[target];
    const node = resolveTargetNode(entry.path);
    if (node?.error) {
      console.log(chalk.yellow(`   ⚠ ${target}: ${node.error} — using the inherited node`));
    }

    console.log(chalk.dim(`   ${target.padEnd(pad)} → ${leg.join(' ')} in ${entry.dir}${node ? ` (node ${node.major})` : ''}`));

    const child = spawn(leg[0], leg.slice(1), {
      cwd: entry.path,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Legs pipe their output — keep chalk colors when the parent's terminal
      // has them (the log tee strips ANSI either way)
      env: { ...process.env, ...nodeEnvFor(node), FORCE_COLOR: process.stdout.isTTY ? '1' : process.env.FORCE_COLOR || '0' },
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
module.exports.createLineDeduper = createLineDeduper;
module.exports.DEV_LEGS = DEV_LEGS;
module.exports.DEFAULT_TARGETS = DEFAULT_TARGETS;
