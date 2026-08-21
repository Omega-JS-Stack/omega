/**
 * env — the Node/Electron half of core's gate seam (#380).
 *
 * core.js is pure so the browser bundle can import it; every `process.env` read
 * lives HERE, and only hosts with a real process require this file.
 *
 * The switches, in the order they win:
 *   OMEGA_SENTRY_ENABLED=false  kill switch — nothing reports, ever
 *   OMEGA_TEST_RUNNER           a test run never pollutes a live project
 *   OMEGA_SENTRY_FORCE=true     report from a non-production run (local proving)
 *   OMEGA_BUILD_MODE=true       the DEFAULT production signal, for hosts that
 *                               have no runtime one
 *
 * The production signal is the host's to supply. @omega.js/desktop has no
 * runtime answer — "should we ship telemetry" is a property of its BUILD, so it
 * falls through to OMEGA_BUILD_MODE. @omega.js/backend does have one
 * (`Manager.isProduction()`, env-derived and stable for the life of the
 * process) and passes it in.
 */

/**
 * Read the environment gates for core.resolveConfig().
 * @param {object} [host] - the host's own signals
 * @param {boolean} [host.isProduction] - overrides the OMEGA_BUILD_MODE default
 * @param {boolean} [host.allowInDev] - the host's own dev opt-in (e.g. @omega.js/backend's `reportErrorsInDev`)
 * @returns {{ killed: boolean, killedReason: string|null, isProduction: boolean, allowInDev: boolean }}
 */
function readGates(host) {
  host = host || {};
  const env = process.env;

  let killedReason = null;
  if (env.OMEGA_SENTRY_ENABLED === 'false') {
    killedReason = 'OMEGA_SENTRY_ENABLED=false';
  } else if (env.OMEGA_TEST_RUNNER) {
    killedReason = 'test run (OMEGA_TEST_RUNNER)';
  }

  return {
    killed:       !!killedReason,
    killedReason,
    isProduction: typeof host.isProduction === 'boolean'
      ? host.isProduction
      : env.OMEGA_BUILD_MODE === 'true',
    allowInDev:   !!host.allowInDev || env.OMEGA_SENTRY_FORCE === 'true',
  };
}

module.exports = { readGates };
