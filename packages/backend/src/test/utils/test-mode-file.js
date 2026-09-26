/**
 * Shared state file that lets the test command and the running emulator
 * agree on a small set of env vars without coordinated shell flags.
 *
 * The test command writes this file pre-flight (before invoking the runner).
 * The emulator process watches it and mutates the corresponding entries in
 * `process.env` in place when it changes. All existing branch sites read
 * `process.env.X` per call so the mutation is invisible to them — no
 * code-branch refactor needed.
 *
 * File lives at `<consumerProject>/.temp/test-mode.json` — `.temp/` is the
 * standard transient cache directory across every OMEGA target
 * (sits at the repo root, gitignored by default).
 *
 * ## Allowlist
 *
 * `SYNCED_ENV_KEYS` is the explicit list of env vars allowed to flow from the
 * test command into the emulator. Adding a new live-sync var = one-line addition.
 *
 * Why an allowlist (not "sync everything"):
 *   - Some env vars are process-specific (e.g. FIRESTORE_EMULATOR_HOST is only
 *     correct on the test runner, never on the emulator) and would break things
 *     if synced. The allowlist prevents that.
 *   - Sensitive values (API keys) shouldn't be silently overwritten on the
 *     emulator just because the test runner happens to have them set.
 *   - Keeps mutation explicit and reviewable.
 *
 * File format:
 *   {
 *     "env": {
 *       "TEST_EXTENDED_MODE": "true"
 *     },
 *     "updatedAt": "2026-05-14T..."
 *   }
 *
 * Values are strings to match `process.env` semantics. Empty string means
 * "unset" — applyEnvFromFile() will `delete process.env[key]` when the value
 * is empty, matching the way Node treats unset vs falsy env vars.
 */
const path = require('path');
const jetpack = require('fs-jetpack');

const TEST_MODE_FILENAME = 'test-mode.json';
const TEMP_DIR_NAME = '.temp';

// Explicit allowlist of env vars that flow from the test command into the
// running emulator. Add a key here to make it live-syncable; nothing else
// flows through.
const SYNCED_ENV_KEYS = [
  'TEST_EXTENDED_MODE',
];

/**
 * Resolve the absolute path to the test-mode file for a given consumer project.
 *
 * @param {string} projectDir - Consumer project root (the directory that
 *                               contains `firebase.json` / `functions/`).
 * @returns {string} Absolute path to `<projectDir>/.temp/test-mode.json`.
 */
function getTestModeFilePath(projectDir) {
  return path.join(projectDir, TEMP_DIR_NAME, TEST_MODE_FILENAME);
}

/**
 * Read the current test-mode payload from disk. Tolerant — returns `null`
 * if the file is missing or unreadable, never throws.
 *
 * @param {string} projectDir
 * @returns {{ env: Object<string, string>, updatedAt: string } | null}
 */
function readTestMode(projectDir) {
  const filePath = getTestModeFilePath(projectDir);

  if (!jetpack.exists(filePath)) {
    return null;
  }

  try {
    const data = jetpack.read(filePath, 'json');
    if (!data || typeof data !== 'object') {
      return null;
    }
    return {
      env: (data.env && typeof data.env === 'object') ? data.env : {},
      updatedAt: data.updatedAt || null,
    };
  } catch (e) {
    return null;
  }
}

/**
 * Write the desired env subset to disk. Atomic via fs-jetpack. Creates the
 * `.temp/` directory if missing. Filters input through SYNCED_ENV_KEYS so
 * only allowlisted keys are persisted, even if the caller passes extras.
 *
 * @param {string} projectDir
 * @param {Object<string, string|undefined>} envInput - Map of env vars to sync.
 *                                                       Keys outside SYNCED_ENV_KEYS are dropped.
 *                                                       Empty/undefined values are persisted as ''
 *                                                       (meaning "unset on receiving side").
 * @returns {string} Absolute path of the written file (for logging).
 */
function writeTestMode(projectDir, envInput) {
  const filePath = getTestModeFilePath(projectDir);
  const env = {};

  for (const key of SYNCED_ENV_KEYS) {
    const v = envInput?.[key];
    env[key] = v == null ? '' : String(v);
  }

  const payload = {
    env,
    updatedAt: new Date().toISOString(),
  };

  jetpack.write(filePath, payload, { atomic: true });

  return filePath;
}

/**
 * Capture the allowlisted subset of `process.env` into a plain object.
 * Convenience for callers that want to write "whatever I currently have".
 *
 * @param {NodeJS.ProcessEnv} [source=process.env]
 * @returns {Object<string, string>}
 */
function captureSyncedEnv(source) {
  const src = source || process.env;
  const out = {};

  for (const key of SYNCED_ENV_KEYS) {
    out[key] = src[key] == null ? '' : String(src[key]);
  }

  return out;
}

/**
 * Apply a `data.env` payload to the current process's `process.env`. Used by
 * the watcher inside the emulator process. Returns a list of `{key, was, now}`
 * for any key that actually changed (caller can log these).
 *
 * Empty-string values in the payload are treated as "unset" — the
 * corresponding `process.env[key]` is deleted. This matches Node semantics
 * where `delete process.env.X` makes `process.env.X === undefined` and
 * `!!process.env.X === false`.
 *
 * @param {{ env: Object<string, string> } | null} data
 * @returns {Array<{ key: string, was: string|undefined, now: string|undefined }>}
 */
function applyEnvFromFile(data) {
  if (!data || !data.env) {
    return [];
  }

  const changed = [];

  for (const key of SYNCED_ENV_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(data.env, key)) {
      continue;
    }

    const was = process.env[key];
    const next = data.env[key];

    if (next === '' || next == null) {
      if (was != null) {
        delete process.env[key];
        changed.push({ key, was, now: undefined });
      }
    } else if (was !== next) {
      process.env[key] = next;
      changed.push({ key, was, now: next });
    }
  }

  return changed;
}

/**
 * Install the test-mode-file watcher: sync the env vars an earlier test command
 * wrote before this process booted, then watch the file for live changes.
 * Called once by omega.initialize() in the test environment.
 *
 * Idempotent: guarded by a module-level flag so reload-during-nodemon doesn't
 * stack listeners.
 *
 * @param {string} projectDir - the consumer project root (the parent of its functions dir).
 * @param {object} logger - where the sync and flip lines go (omega.logger).
 * @param {object} [options] - { quiet }: skip the resolved-mode line (per-worker noise under the emulator).
 */
let watcherInstalled = false;
function watchTestMode(projectDir, logger, options) {
  if (watcherInstalled) {
    return;
  }
  watcherInstalled = true;

  const fs = require('fs');
  const tempDir = path.join(projectDir, TEMP_DIR_NAME);

  // Initial sync: apply any state the test/emulator command wrote before this
  // process booted. A sync/flip is an EVENT and always says so; the resolved
  // mode only announces itself when not quiet.
  const initial = readTestMode(projectDir);
  const changed = applyEnvFromFile(initial);
  for (const c of changed) {
    logger.log(`test-mode sync ${c.key}: ${c.was || '(unset)'} → ${c.now || '(unset)'}`);
  }
  if (!(options || {}).quiet) {
    logger.log(`test-mode resolved TEST_EXTENDED_MODE=${!!process.env.TEST_EXTENDED_MODE} (file ${initial ? 'present' : 'absent'})`);
  }

  // Ensure .temp/ exists so we can watch the directory (fs.watch on a missing
  // path throws synchronously). Watching the directory rather than the file
  // means deletes/recreations of test-mode.json don't break the watcher.
  jetpack.dir(tempDir);

  try {
    fs.watch(tempDir, { persistent: false }, (eventType, filename) => {
      // Only react to our file. fs.watch may emit for any change in the dir.
      if (filename && filename !== TEST_MODE_FILENAME) {
        return;
      }
      const next = readTestMode(projectDir);
      const flipped = applyEnvFromFile(next);
      for (const c of flipped) {
        logger.log(`test-mode flip ${c.key}: ${c.was || '(unset)'} → ${c.now || '(unset)'}`);
      }
    });
  } catch (e) {
    logger.log(`test-mode watcher failed to install (${e.message}), live sync disabled`);
  }
}

module.exports = {
  watchTestMode,
  TEST_MODE_FILENAME,
  TEMP_DIR_NAME,
  SYNCED_ENV_KEYS,
  getTestModeFilePath,
  readTestMode,
  writeTestMode,
  captureSyncedEnv,
  applyEnvFromFile,
};
