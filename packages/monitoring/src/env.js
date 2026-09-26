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
 *   the ONE environment         the DEFAULT production signal, for hosts that
 *                               pass no runtime one
 *
 * The production signal is the host's to supply, and the DEFAULT is the one
 * environment every OMEGA target answers from
 * ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)):
 * `@omega.js/config/environment`'s `isProduction()`, read off the host the gates
 * were asked for (`process.env.OMEGA_ENVIRONMENT` on Node, the host's baked
 * `config.environment` in a browser-ish context such as a renderer bundle).
 * OMEGA_BUILD_MODE used to be that default, which made it a FIFTH production
 * signal with its own opinion: a build-mode run of a development artifact
 * reported as production, and a packaged production app whose lane did not
 * carry the flag reported as development. @omega.js/backend still passes its
 * own answer in (`omega.isProduction()`), and a boolean a host supplies
 * always wins.
 */

const { isProduction } = require('@omega.js/config/environment');

/**
 * Read the environment gates for core.resolveConfig().
 * @param {object} [host] - the host's own signals, and the context the one
 *   environment is read off (an Omega instance carrying the baked `config`)
 * @param {boolean} [host.isProduction] - overrides the one environment's answer
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
      : isProduction.call(host),
    allowInDev:   !!host.allowInDev || env.OMEGA_SENTRY_FORCE === 'true',
  };
}

module.exports = { readGates };
