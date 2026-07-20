/**
 * The per-brand deploy record — `deploy.<target>` in `.omega/state.json`
 * (the brand's durable derived-state file; gitignored, per-machine).
 *
 * Written by every framework's deploy verb on success; read by the
 * manager's testing service to tell "never deployed" (live-URL checks skip
 * with a nudge) from "deployed but down" (an honest error). A record-less
 * brand whose live URL answers gets ADOPTED — recorded on the spot — so
 * fresh clones of long-deployed brands self-heal on their first manage run
 * (Ian 2026-07-17).
 */
const fs = require('node:fs');
const path = require('node:path');
const jetpack = require('fs-jetpack');

const { findBrandRoot } = require('./local.js');

function stateFile(dir) {
  return path.join(findBrandRoot(dir), '.omega', 'state.json');
}

/**
 * Run fn under a best-effort cross-process lock on the state file, so two
 * targets deploying in parallel can't drop each other's record in the
 * read-modify-write. Lock contention waits briefly; a stale lock (owner
 * crashed) is stolen after 5s; on timeout we proceed unlocked — a deploy
 * must never fail over its bookkeeping.
 * @param {string} file - State file path.
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
 * @param {string} options.dir - Any directory inside the brand (app or root)
 * @param {string} options.target - Target key (web/backend/desktop/extension)
 * @param {Object} [options.detail] - Extra fields (method, adopted, …)
 * @returns {Object} The written record
 */
function recordDeploy(options) {
  const file = stateFile(options.dir);

  return withStateLock(file, () => {
    const state = jetpack.read(file, 'json') || {};

    state.deploy = state.deploy || {};
    state.deploy[options.target] = { at: new Date().toISOString(), ...(options.detail || {}) };
    jetpack.write(file, state, { jsonIndent: 2 });

    return state.deploy[options.target];
  });
}

/**
 * The recorded deploy for a target — null when the brand has never deployed
 * it from this machine (and no manage run has adopted a live site yet).
 *
 * @param {Object} options - { dir, target }
 * @returns {Object|null}
 */
function readDeployRecord(options) {
  const state = jetpack.read(stateFile(options.dir), 'json') || {};
  return state.deploy?.[options.target] || null;
}

module.exports = { recordDeploy, readDeployRecord };
