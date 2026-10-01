/**
 * The preload every package's `node --test` script names (`--require`): inside a
 * runner child it keeps console bytes off node:test's frame pipe on stdout
 * (guard-stdout.js, plain form). Retires once the pinned node reaches >=26.7.0.
 */

const { guardStdout } = require('./guard-stdout.js');

// One application per process, whatever path the preload was resolved through
// (a package's `--require`, a vendored copy, a test's own require).
const APPLIED = Symbol.for('@omega.js/devkit:test/stdout-guard');

if (process.env.NODE_TEST_CONTEXT && !globalThis[APPLIED]) {
  globalThis[APPLIED] = true;
  guardStdout();
}
