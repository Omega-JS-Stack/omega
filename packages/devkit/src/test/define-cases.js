// defineCases — the wrapper every OMEGA case file exports its spec through
// ([#630](https://github.com/Omega-JS-Stack/omega/issues/630)).
//
// A case file is a plain module: `module.exports = { tests: [...] }` with the
// bodies as `run(ctx)` functions. Only the OMEGA runner (src/test/runner-core.js
// here, @omega.js/backend's own runner there) ever CALLS those bodies. So
// `node --test <case-file>` loads the module, executes nothing, and reports
// `pass 1` — a hollow green that reads like a passing suite to a human and to a
// verifier alike. That is the trap this closes.
//
// The signal is `NODE_TEST_CONTEXT`, which node:test sets in the child process
// it spawns per file (`child-v8`); it is present for the whole module load, so a
// require-time check sees it. It is NOT enough on its own: the env var is
// inherited, so a legitimate `omega test` run nested inside a node:test process
// would trip too. The runners therefore call markRunnerActive() before loading
// any case file, and that opt-out is an ENV var rather than a module flag
// because the desktop/extension lanes load their case files in spawned children
// (Electron), which inherit the environment but not module state.

const path = require('path');

// Set by every OMEGA case runner before it loads a case file; inherited by the
// children those runners spawn. Its presence means "the cases are about to run
// for real", which is exactly what NODE_TEST_CONTEXT alone cannot tell us.
const RUNNER_ENV = 'OMEGA_CASE_RUNNER';

/**
 * Mark the current process (and anything it spawns) as an OMEGA case run.
 * @returns {void}
 */
function markRunnerActive() {
  process.env[RUNNER_ENV] = 'true';
}

/**
 * Resolve the file that called defineCases, so the failure can name it.
 * @returns {string|null} Absolute path, or null when the stack is unreadable.
 */
function callerFile() {
  const original = Error.prepareStackTrace;
  try {
    Error.prepareStackTrace = (_, frames) => frames;
    const error = new Error();
    Error.captureStackTrace(error, defineCases);
    const frames = error.stack;
    return (frames && frames[0] && frames[0].getFileName()) || null;
  } catch (e) {
    return null;
  } finally {
    Error.prepareStackTrace = original;
  }
}

/**
 * The runner-scoped path a human types to run just this file, derived from the
 * case file's position under its test root (`test/suites/` or `test/`).
 * @param {string|null} file - Absolute path of the case file.
 * @returns {string} A path filter, or '' when the file sits outside a test root.
 */
function scopedPath(file) {
  if (!file) return '';
  const normalized = file.split(path.sep).join('/');
  const root = ['/test/suites/', '/test/'].find((marker) => normalized.includes(marker));
  if (!root) return '';
  // FIRST occurrence anchors on the package's test root: a nested test/ dir
  // (backend test/routes/test/) must stay part of the filter, not swallow it.
  return normalized
    .slice(normalized.indexOf(root) + root.length)
    .replace(/\.test\.js$/, '')
    .replace(/\.js$/, '');
}

/**
 * Return a case spec, failing loudly when the file was loaded by `node --test`.
 * @param {object|Array} spec - The case-runner spec (suite, group, standalone, or array form).
 * @returns {object|Array} The same spec, unchanged.
 */
function defineCases(spec) {
  // NODE_TEST_CONTEXT only exists in the default per-file child; with
  // --experimental-test-isolation=none the file loads in the main process,
  // where the --test flag itself is the surviving signal.
  if ((process.env.NODE_TEST_CONTEXT || process.execArgv.includes('--test')) && process.env[RUNNER_ENV] !== 'true') {
    const file = callerFile();
    const filter = scopedPath(file);
    throw new Error([
      'OMEGA case file loaded under `node --test` — NOTHING RAN.',
      '',
      `  ${file || '(this file)'}`,
      '',
      '`node --test` only loads the module; the case bodies never execute, so the',
      'run reports a hollow pass. These cases run under the OMEGA runner:',
      '',
      `  npx omega test framework:${filter}   (a framework suite)`,
      `  npx omega test ${filter}             (a project's own test/)`,
      '',
    ].join('\n'));
  }

  return spec;
}

module.exports = defineCases;
module.exports.markRunnerActive = markRunnerActive;
module.exports.RUNNER_ENV = RUNNER_ENV;
