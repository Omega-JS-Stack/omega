/**
 * The per-brand deploy record — `<target>` under the `deploy` section of
 * `.omega/state.json` (gitignored, per-machine). Multi-instance targets key
 * per target: the primary stays `<target>`, other instances record under
 * `<target>:<id>` (see deployKey).
 *
 * Written by every framework's deploy verb on success; read by the
 * manager's testing service to tell "never deployed" (live-URL checks skip
 * with a nudge) from "deployed but down" (an honest error). A record-less
 * brand whose live URL answers gets ADOPTED — recorded on the spot — so
 * fresh clones of long-deployed brands self-heal on their first manage run
 * (Ian 2026-07-17).
 *
 * state.json is the ONE per-machine record file, sectioned per fact kind
 * (#479): future record-shaped facts join it as sibling top-level sections, so
 * this module reads and writes ONLY `deploy` and passes every other section
 * through verbatim — including the config-shaped keys an unmigrated brand
 * still carries from the retired state CONTENT (#434), which belong to the
 * state-retirement migration and to nothing here.
 *
 * The record spent 0.45.0 in a `.omega/deploys.json` of its own (#449); a
 * brand still carrying that file has it adopted here, once and loudly.
 */
const fs = require('node:fs');
const path = require('node:path');
const jetpack = require('fs-jetpack');

const Logger = require('./logger.js');
const { findBrandRoot } = require('./local.js');

const logger = new Logger('deploy-record');

function stateFile(dir) {
  return path.join(findBrandRoot(dir), '.omega', 'state.json');
}

/**
 * Read the machine state with its `deploy` section resolved, folding in the
 * interim `.omega/deploys.json` (#449) on the way — one-time and LOUD, so a
 * brand that deployed on 0.45.0 keeps its stamps and the operator sees where
 * they went. Records already in state.json WIN: newest write, newest home.
 *
 * A brand whose state.json already carries a `deploy` key is home — the
 * records are read in place, silently, whatever else the file still holds.
 *
 * Rewrites the files it touches, so callers hold the lock.
 *
 * @param {string} file - The state.json path.
 * @returns {Object} The machine state, `deploy` section included.
 */
function loadState(file) {
  const state = jetpack.read(file, 'json') || {};
  const records = state.deploy || {};

  const deploysFile = path.join(path.dirname(file), 'deploys.json');
  const deploys = jetpack.read(deploysFile, 'json');

  state.deploy = deploys ? { ...deploys, ...records } : records;
  if (!deploys) return state;

  // The new home lands before the old file goes: a crash between the two
  // writes must never leave the records with no file at all.
  jetpack.write(file, state, { jsonIndent: 2 });
  jetpack.remove(deploysFile);

  if (Object.keys(deploys).length > 0) {
    logger.log(`Adopted ${describe(deploys)} from .omega/deploys.json into .omega/state.json — the old file was removed.`);
  }

  return state;
}

/**
 * "1 deploy record" / "3 deploy records" — the adoption line's subject.
 * @param {Object} records - key → record.
 * @returns {string}
 */
function describe(records) {
  const count = Object.keys(records).length;
  return `${count} deploy record${count === 1 ? '' : 's'}`;
}

/**
 * Record key for a target's instance (multi-instance targets): the primary
 * keeps today's bare target key (zero breaking change — existing records
 * stay valid); any other instance keys `<target>:<id>`, matching the
 * per-target deploy model (each target deploys its own instance).
 * @param {string} target - Target key (web/backend/desktop/extension)
 * @param {string} [instance] - Instance id ('main' or absent = the primary)
 * @returns {string} The deploy-record key
 */
function deployKey(target, instance) {
  return instance && instance !== 'main' ? `${target}:${instance}` : target;
}

/**
 * Run fn under a best-effort cross-process lock on the records file, so two
 * targets deploying in parallel can't drop each other's record in the
 * read-modify-write. Lock contention waits briefly; a stale lock (owner
 * crashed) is stolen after 5s; on timeout we proceed unlocked — a deploy
 * must never fail over its bookkeeping.
 * @param {string} file - Records file path.
 * @param {function} fn - Critical section.
 * @returns {*} fn's result.
 */
function withStateLock(file, fn) {
  const lockDir = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const deadline = Date.now() + 2000;
  let locked = false;
  while (Date.now() < deadline) {
    try {
      fs.mkdirSync(lockDir);
      locked = true;
      break;
    } catch (e) {
      try {
        if (Date.now() - fs.statSync(lockDir).mtimeMs > 5000) {
          fs.rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        continue; // Lock vanished between mkdir and stat — retry immediately
      }
      // Synchronous 25ms wait (no async surface here by design)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }

  try {
    return fn();
  } finally {
    if (locked) {
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
  }
}

/**
 * Record a successful deploy for a target.
 *
 * @param {Object} options
 * @param {string} options.dir - Any directory inside the brand (target or root)
 * @param {string} options.target - Target key (web/backend/desktop/extension)
 * @param {string} [options.instance] - Instance id; non-main instances record
 *   under their own `<target>:<id>` key (per-target deploy records)
 * @param {Object} [options.detail] - Extra fields (method, adopted, …)
 * @returns {Object} The written record
 */
function recordDeploy(options) {
  const file = stateFile(options.dir);
  const key = deployKey(options.target, options.instance);

  return withStateLock(file, () => {
    const state = loadState(file);

    state.deploy[key] = { at: new Date().toISOString(), ...(options.detail || {}) };
    jetpack.write(file, state, { jsonIndent: 2 });

    return state.deploy[key];
  });
}

/**
 * The recorded deploy for a target's instance — null when the brand has
 * never deployed it from this machine (and no manage run has adopted a live
 * site yet).
 *
 * @param {Object} options - { dir, target, instance? }
 * @returns {Object|null}
 */
function readDeployRecord(options) {
  const file = stateFile(options.dir);
  // Under the lock because the read is also where a legacy record is adopted
  const state = withStateLock(file, () => loadState(file));
  return state.deploy[deployKey(options.target, options.instance)] || null;
}

module.exports = { recordDeploy, readDeployRecord, deployKey };
