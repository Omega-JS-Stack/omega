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
const { freshnessSweep, resolveLinkedMonorepo, startMonorepoWatch } = require('@omega.js/devkit/local');

// Local
const { runManage } = require('../manage.js');
const { resolveBrandRoot, discoverTargets } = require('../lib/brand.js');
const { targetScripts } = require('../lib/custom-target.js');
const { resolveTargetNode, nodeEnvFor } = require('../lib/node-version.js');

// Target → the npm leg that IS local dev for that target
const DEV_LEGS = {
  web: ['npm', 'run', 'start'], // omega dev — watch + serve (:4000)
  backend: ['npm', 'run', 'emulator'], // omega emulator — FULL suite + seeded personas
  desktop: ['npm', 'run', 'start'], // opt-in: opens an Electron window
  extension: ['npm', 'run', 'start'], // opt-in: extension build watcher
};

// Every custom target's leg is the same one: its own `start` script (#603)
const CUSTOM_DEV_LEG = ['npm', 'run', 'start'];

/**
 * The leg that IS local dev for one discovered target.
 *
 * A backend in custom-server mode (#584) has no Cloud Functions to emulate, so
 * its leg is its own `start` — the same script a custom target boots with. Its
 * server is the local stack's API either way, so it keeps the backend's place
 * in the default set and its boot-first ordering.
 *
 * @param {{ target: string, custom?: boolean, projectType?: string }} entry
 * @returns {string[]} argv for the leg
 */
function devLegFor(entry) {
  if (entry.custom || entry.projectType === 'custom') return CUSTOM_DEV_LEG;
  return DEV_LEGS[entry.target] || CUSTOM_DEV_LEG;
}

/**
 * Stop one dev leg. A leg is a CHAIN (npm run <leg> → the real server), so the
 * SIGTERM goes to the leg's process group — signaling only the direct npm
 * child leaves the grandchild (a firebase emulator) orphaned on pid 1, still
 * holding its ports (#690). The direct kill is the fallback for a leg whose
 * group is already gone.
 */
const stopChild = (child, killGroup = (pid, signal) => process.kill(pid, signal)) => {
  try {
    killGroup(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // already gone
    }
  }
};

// Booted without flags — the local web loop
const DEFAULT_TARGETS = ['web', 'backend'];

/**
 * Pure target selection — which legs boot for a given flag set.
 *
 * Custom targets (#603) join the same fan-out: their leg is `npm run start`,
 * and a custom target only reaches `custom` at all when its package.json
 * declares that script — no script, no dev leg.
 *
 * @param {object} input
 * @param {string[]} input.available - targets that have a dir in this brand
 * @param {string[]} [input.custom] - custom target names with a `start` script
 * @param {string} [input.only] - comma list: exact set to boot
 * @param {string} [input.except] - comma list: subtract from the set
 * @param {boolean} [input.all] - start every target with a dev leg
 * @returns {{ selected: string[], unknown: string[], missing: string[] }}
 */
function selectDevTargets({ available, custom = [], only, except, all }) {
  // A custom target is a first-class leg once it has a start script — the
  // default set boots it beside web + backend (it is part of the local stack,
  // never an opt-in GUI surface)
  const hasLeg = (target) => Boolean(DEV_LEGS[target]) || custom.includes(target);
  const defaults = [...DEFAULT_TARGETS, ...custom].filter((target) => available.includes(target));

  const requested = only
    ? String(only).split(',').map((part) => part.trim()).filter(Boolean)
    : (all ? [...Object.keys(DEV_LEGS), ...custom] : defaults);
  const excluded = new Set(String(except || '').split(',').map((part) => part.trim()).filter(Boolean));

  const unknown = requested.filter((target) => !hasLeg(target));
  const kept = requested.filter((target) => hasLeg(target) && !excluded.has(target));
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

  // A custom target (#603) joins the fan-out under its own NAME, and only
  // when its package.json declares a `start` script — the manager never
  // invents a leg for it.
  const discovered = discoverTargets(brandRoot);
  const customLegs = discovered.filter((entry) => entry.custom && targetScripts(entry.path).start);
  const targets = [
    ...discovered.filter((entry) => entry.target && DEV_LEGS[entry.target]),
    ...customLegs.map((entry) => ({ ...entry, target: entry.name })),
  ];

  const custom = customLegs.map((entry) => entry.name);
  const { selected, unknown, missing } = selectDevTargets({
    available: targets.map((entry) => entry.target),
    custom,
    only: options.only,
    except: options.except,
    all: options.all,
  });

  unknown.forEach((target) => {
    console.log(chalk.yellow(`⊘ unknown dev target "${target}" (know: ${[...Object.keys(DEV_LEGS), ...custom].join(', ')})`));
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

  // The one-terminal rule covers FRAMEWORK edits too (#587). A brand whose
  // @omega.js deps resolve into a monorepo checkout has no src→dist rebuild
  // without that monorepo's watch, so this boot starts it as a session child —
  // the same mechanism the website target's `--local` prelude uses, one
  // implementation in devkit. Lock-aware: a watch already running is reused.
  // AFTER the sweep on purpose: the sweep's verdict depends on whether a watch
  // holds the lock (#281/#398), so starting one first would change the answer
  // it just gave.
  const linkedMonorepo = resolveLinkedMonorepo(brandRoot);
  if (linkedMonorepo) {
    const watch = startMonorepoWatch({ monorepoRoot: linkedMonorepo, logger: { log: (line) => console.log(chalk.dim(`   ${line}`)) } });

    // A fresh watch's initial prepare rewrites every package's dist, and a
    // target booting into that rewrite loads a half-written CLI (#670). The
    // legs wait for the pass to land; an already-running watch has none.
    if (!watch.alreadyRunning) {
      const outcome = await watch.ready;
      if (outcome === 'ready') {
        console.log(chalk.dim('   monorepo watch: initial prepare done'));
      }
    }
  } else {
    console.log(chalk.dim('   ⚑ frameworks come from the registry — no monorepo watch to run (a linked brand starts one here)'));
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
    const leg = devLegFor(entry);
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
      // Own process group per leg (#690): a leg is a chain (npm run <leg> →
      // the real server), and shutdown signals the GROUP — a same-group leg
      // would get only npm killed, orphaning the emulator on its ports.
      detached: true,
    });
    forward(child.stdout, console.log, target);
    forward(child.stderr, console.error, target);
    child.on('close', (code) => {
      if (shuttingDown) return;
      console.error(chalk.red(`✖ ${target} exited (code ${code}) — siblings stay up; Ctrl-C stops everything`));
    });
    children.push(child);
  }

  // The legs are detached (their own process groups), so the terminal's own
  // Ctrl-C never reaches them — every escalation is this process' to deliver.
  const forceKill = () => {
    children.forEach((child) => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    });
    process.exit(0);
  };
  const shutdown = () => {
    if (shuttingDown) return forceKill(); // second Ctrl-C = force kill
    shuttingDown = true;
    console.log(chalk.dim('\n⏹ omega dev: stopping all targets… (Ctrl-C again to force kill)'));
    children.forEach((child) => stopChild(child));
    // Exit only when every leg is GONE: the backend leg's own teardown (the
    // emulator group-kill + orphan sweep, seconds of work) logs through this
    // process' pipes, and exiting under it cuts the sweep off mid-run (#690).
    // The cap matches the 20s the journey/e2e harnesses allow that teardown,
    // and expiry escalates so a wedged leg cannot keep its ports.
    const cap = setTimeout(forceKill, 20000);
    Promise.all(children.map((child) => new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode) return resolve();
      child.once('close', resolve);
    }))).then(() => {
      clearTimeout(cap);
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the orchestrator alive while any child runs
  await new Promise(() => {});
};

module.exports.selectDevTargets = selectDevTargets;
module.exports.devLegFor = devLegFor;
module.exports.createLineDeduper = createLineDeduper;
module.exports.stopChild = stopChild;
module.exports.DEV_LEGS = DEV_LEGS;
module.exports.DEFAULT_TARGETS = DEFAULT_TARGETS;
