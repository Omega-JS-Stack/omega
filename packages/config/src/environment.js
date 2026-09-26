/**
 * environment.js, the ONE environment module every OMEGA target answers from
 * ([#817](https://github.com/Omega-JS-Stack/omega/issues/817)).
 *
 * Four calls, one implementation, one call form everywhere: `getEnvironment()`
 * plus `isDevelopment()` / `isProduction()` / `isTesting()`, called directly
 * by every framework's `omega` instance and build module. @omega.js/backend, @omega.js/desktop,
 * @omega.js/extension and @omega.js/web each carried their own copy of this
 * logic, each with its own signal list and its own DEFAULT, and the copies
 * disagreed: desktop answered `production` with no signal while the extension
 * answered `development`, so a desktop dev boot baked itself as a production
 * artifact.
 *
 * The fix is by construction, and it is the whole contract:
 *
 *   ONE INPUT. On Node it is `process.env.OMEGA_ENVIRONMENT`. In a browser
 *   context (a desktop renderer, an extension view, a web page), which can read
 *   neither env nor files, it is `config.environment`, the build fact every
 *   surface already bakes into `OMEGA_BUILD_JSON.config`
 *   ([#896](https://github.com/Omega-JS-Stack/omega/issues/896)), reached as
 *   `this.config.environment` off the instance the call is made on. Nothing else
 *   is consulted: no `app.isPackaged`, no `manifest.update_url`, no `NODE_ENV`,
 *   no terminal sniffing.
 *
 *   NO DEFAULT. A context with no input does not guess a safe answer, it throws
 *   and names the variable. A guessed environment is how a dev build ships as
 *   production and how a production build talks to an emulator, and both of
 *   those failures are silent until a user finds them.
 *
 * Who SETS the one input is each target's own business, at the one place it
 * already resolves its config, through `setEnvironment()` below (the only
 * writer, so a fourth word can never reach the variable): the backend's boot
 * takes the .env cascade's ambient answer, the desktop and extension build
 * modules take `production` under their build-mode flag and the ambient answer
 * otherwise, and web's verbs name their own (`omega build` is production,
 * `omega dev` is development).
 *
 * This module requires NOTHING. It is bundled into browser artifacts (the
 * desktop renderer, every extension bundle) and vendored into
 * @omega.js/client, so a single `node:fs` at the top would break all three.
 */

// The ONE environment vocabulary, and the home of it. Every `.env.<name>`
// overlay is suffixed with one of these, every `config/omega.<name>.json5`
// overlay is named with one of these, every framework's environment answer is
// one of these, and nothing anywhere spells a fourth
// ([#586](https://github.com/Omega-JS-Stack/omega/issues/586)).
const ENV_ENVIRONMENTS = ['development', 'testing', 'production'];

// The ONE input's name, spelled once so every error message and every writer
// reads it from here.
const ENVIRONMENT_VAR = 'OMEGA_ENVIRONMENT';

/**
 * The Node input: the environment variable, when this context has a `process`
 * at all (a browser bundle does not).
 * @returns {string|undefined} the raw value.
 */
function fromProcess() {
  return typeof process !== 'undefined' && process.env
    ? process.env[ENVIRONMENT_VAR]
    : undefined;
}

/**
 * The browser input: the build fact baked into `OMEGA_BUILD_JSON.config`,
 * reached through the instance the call was made on.
 * @param {object} [context] - the `this` of the call.
 * @returns {string|undefined} the raw value.
 */
function fromBakedConfig(context) {
  return context && context.config ? context.config.environment : undefined;
}

/**
 * The running environment, from the one input.
 *
 * @this {object} [context] - an instance carrying the baked `config`.
 * @returns {'development'|'testing'|'production'} exactly one of the three.
 * @throws {Error} when neither input names one of the three.
 */
function getEnvironment() {
  const value = fromProcess() || fromBakedConfig(this);

  if (!ENV_ENVIRONMENTS.includes(value)) {
    // Loud by design: every lane sets the input, so reaching here is a broken
    // lane, and any answer invented here would be wrong somewhere it matters.
    throw new Error(`${ENVIRONMENT_VAR} is not set to one of ${ENV_ENVIRONMENTS.join(' | ')} (got ${value === undefined ? 'nothing' : JSON.stringify(value)}). On Node the lane that boots or builds this target sets it; in a browser context it is the baked OMEGA_BUILD_JSON.config.environment, which every OMEGA build writes.`);
  }

  return value;
}

/**
 * @this {object} [context] - an instance carrying the baked `config`.
 * @returns {boolean} true only in development (never in testing).
 */
function isDevelopment() {
  return getEnvironment.call(this) === 'development';
}

/**
 * @this {object} [context] - an instance carrying the baked `config`.
 * @returns {boolean} true only in production, a real positive check.
 */
function isProduction() {
  return getEnvironment.call(this) === 'production';
}

/**
 * @this {object} [context] - an instance carrying the baked `config`.
 * @returns {boolean} true only while a test lane runs this process.
 */
function isTesting() {
  return getEnvironment.call(this) === 'testing';
}

/**
 * The ONE writer of the one input, so every lane that names an environment
 * spells it the same way and a fourth word is refused at the moment it is
 * written rather than at the moment it is read.
 *
 * @param {string} value - one of the three names.
 * @returns {string} the same value, so a caller can name it and pass it on.
 * @throws {Error} when it is not one of the three.
 */
function setEnvironment(value) {
  if (!ENV_ENVIRONMENTS.includes(value)) {
    throw new Error(`${ENVIRONMENT_VAR} cannot be set to ${value === undefined ? 'nothing' : JSON.stringify(value)}: it is one of ${ENV_ENVIRONMENTS.join(' | ')}.`);
  }

  process.env[ENVIRONMENT_VAR] = value;

  return value;
}

/**
 * The environment a NODE BUILD LANE is for, decided once for the two frameworks
 * whose build module names it at load (@omega.js/desktop and
 * @omega.js/extension, which carried byte-identical copies of this expression).
 * Two rules, no sniffing:
 *
 *   1. The build-mode flag is the lane SAYING it produces a production artifact
 *      (`omega build` sets `OMEGA_BUILD_MODE`), and it wins over anything
 *      inherited, so a production build spawned from a test run still bakes
 *      production.
 *   2. Otherwise a lane that already named one keeps it (the test runners spawn
 *      their children with `testing`), and a bare dev boot is `development`.
 *
 * It DECIDES; the caller writes it with `setEnvironment()`, which stays the one
 * writer. This is the only default anywhere near this module, and it belongs to
 * a build lane alone: a READER still gets no default at all.
 *
 * @param {boolean} buildMode - The lane's build-mode flag (`build.isBuildMode()`).
 * @returns {'development'|'testing'|'production'} the word that lane is for.
 */
function buildLaneEnvironment(buildMode) {
  return buildMode ? 'production' : (fromProcess() || 'development');
}

module.exports = {
  ENV_ENVIRONMENTS,
  ENVIRONMENT_VAR,
  getEnvironment,
  isDevelopment,
  isProduction,
  isTesting,
  setEnvironment,
  buildLaneEnvironment,
};
