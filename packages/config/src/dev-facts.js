/**
 * dev-facts.js, the ONE missing-dev-fact error
 * ([#834](https://github.com/Omega-JS-Stack/omega/issues/834)).
 *
 * The classic port numbers are DEFINED once, in `CLASSIC_PORTS` beside this
 * file, and the allocator resolves a live map from them at boot (N7). Browser
 * code can read neither env nor files, so every surface BAKES that resolved map
 * into its build json under one key, `OMEGA_BUILD_JSON.config.dev`
 * ([#300](https://github.com/Omega-JS-Stack/omega/issues/300),
 * [#262](https://github.com/Omega-JS-Stack/omega/issues/262)).
 *
 * What this file exists to stop is the OTHER half of that arrangement: the same
 * numbers hand-typed a second time as a browser-side fallback for "a build made
 * with no stack up". @omega.js/client carried four of them plus a classic dev
 * origin, @omega.js/desktop's url-helpers and client-bridge carried three more,
 * and @omega.js/extension's url-helpers and background worker two. Every one of
 * them was a guess about a port nothing identity-checks, so a neighbouring
 * project's emulator holding 9099 read as an auth mystery for hours rather than
 * as a port problem, and a wrong API base read as a silent connection refusal.
 *
 * So there is no fallback anywhere any more. A real build always carries the
 * map; a read that finds none throws THIS error, which names the fact it wanted
 * and the build step that writes it.
 *
 * This module requires NOTHING: it is bundled into browser artifacts (the
 * desktop renderer, every extension bundle) and vendored into @omega.js/client.
 */

// The ONE key every surface bakes the resolved map under, spelled once.
const DEV_FACT_CHANNEL = 'OMEGA_BUILD_JSON.config.dev';

/**
 * The error a surface throws when a dev fact it needs was never baked.
 *
 * @param {string} what - the fact, named the way the caller wanted it
 *   ("dev port for `auth`", "dev website origin").
 * @param {string} writer - the build step that writes the map on THIS surface,
 *   so the message says where to go and not just what is absent.
 * @returns {Error} the error to throw.
 */
function devFactMissing(what, writer) {
  return new Error(`No resolved ${what} in ${DEV_FACT_CHANNEL}. It is written by ${writer}. A build made without it is not a build, so nothing here assumes a classic port.`);
}

module.exports = {
  DEV_FACT_CHANNEL,
  devFactMissing,
};
