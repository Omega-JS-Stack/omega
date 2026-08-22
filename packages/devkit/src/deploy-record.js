/**
 * The per-brand deploy record — `<target>` in `.omega/deploys.json`
 * (gitignored, per-machine). Multi-instance targets key per target: the
 * primary stays `<target>`, other instances record under `<target>:<id>`
 * (see deployKey).
 *
 * Written by every framework's deploy verb on success; read by the
 * manager's testing service to tell "never deployed" (live-URL checks skip
 * with a nudge) from "deployed but down" (an honest error). A record-less
 * brand whose live URL answers gets ADOPTED — recorded on the spot — so
 * fresh clones of long-deployed brands self-heal on their first manage run
 * (Ian 2026-07-17).
 *
 * The record used to live under the `deploy` key of `.omega/state.json`; that
 * file is retired (#434) and the record moved to a file of its own (#449). A
 * brand still carrying the old key has it adopted here, once and silently.
 */
const fs = require('node:fs');
const path = require('node:path');
const jetpack = require('fs-jetpack');

const { findBrandRoot } = require('./local.js');

function recordsFile(dir) {
  return path.join(findBrandRoot(dir), '.omega', 'deploys.json');
}

/**
 * Read the records, adopting the `deploy` key of a retired
 * `.omega/state.json` on the way (#449) — one-time and silent, so a brand
 * that deployed before the rename keeps its stamps. The old file goes once
 * nothing else is left in it; a brand that has not run the state-retirement
 * migration yet keeps its file (minus the key) for that migration to finish.
 * Records already here WIN: they are the newer write.
 *
 * Rewrites both files, so callers hold the lock.
 *
 * @param {string} file - The deploys.json path.
 * @returns {Object} key → record.
 */
function loadRecords(file) {
  const records = jetpack.read(file, 'json') || {};

  const legacy = path.join(path.dirname(file), 'state.json');
  const state = jetpack.read(legacy, 'json');
  if (!state?.deploy) {
    return records;
  }

  const { deploy, ...rest } = state;
  const adopted = { ...deploy, ...records };
  jetpack.write(file, adopted, { jsonIndent: 2 });

  if (Object.keys(rest).length > 0) {
    jetpack.write(legacy, rest, { jsonIndent: 2 });
  } else {
    jetpack.remove(legacy);
  }

  return adopted;
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
  const file = recordsFile(options.dir);
  const key = deployKey(options.target, options.instance);

  return withStateLock(file, () => {
    const records = loadRecords(file);

    records[key] = { at: new Date().toISOString(), ...(options.detail || {}) };
    jetpack.write(file, records, { jsonIndent: 2 });

    return records[key];
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
  const file = recordsFile(options.dir);
  // Under the lock because the read is also where a legacy record is adopted
  const records = withStateLock(file, () => loadRecords(file));
  return records[deployKey(options.target, options.instance)] || null;
}

module.exports = { recordDeploy, readDeployRecord, deployKey };
