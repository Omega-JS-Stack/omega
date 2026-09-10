/**
 * The environment surface ([#717](https://github.com/Omega-JS-Stack/omega/issues/717))
 * — the same four calls the three sibling frameworks answer
 * (@omega.js/backend's Manager, @omega.js/desktop's and @omega.js/extension's
 * mode-helpers): `getEnvironment()` plus `isDevelopment()` / `isProduction()` /
 * `isTesting()`. Web used to be the outlier: a bare `options.environment`
 * string threaded positionally through the build, reachable from nothing.
 *
 * `getEnvironment()` is the SINGLE SOURCE OF TRUTH — the ONLY function that
 * reads the raw signals and resolves them to exactly ONE of three
 * mutually-exclusive values. The three is*() checks DERIVE from it, so they can
 * never disagree with it: `isDevelopment()` is NOT true in testing, and
 * `isProduction()` is a real positive check, never `!isDevelopment()`. Gate
 * "anything non-production" with `!isProduction()` or `isDevelopment() ||
 * isTesting()` intentionally.
 *
 * The vocabulary is @omega.js/config's (`ENV_ENVIRONMENTS`, #586) — the same
 * three names the `.env.<environment>` overlay files are spelled with — so a
 * `.env.development` and an `isDevelopment()` can never mean different things.
 *
 * Web's contexts are the plain options objects the build lanes already thread
 * (`{ environment, consumerDir, … }`), not Manager instances, so the surface is
 * called on one: `getEnvironment.call(options)`. It is mixed into web's Manager
 * equivalent — the CLI Main class (src/cli.js) — by attachTo() below.
 */
const { ENV_ENVIRONMENTS } = require('@omega.js/config');

/**
 * The running environment, resolved from every raw signal.
 * Precedence: testing → the context's explicit environment → build signals →
 * development.
 * @returns {'development'|'testing'|'production'} exactly one of the three
 */
function getEnvironment() {
  // 1. Testing wins — a test run is not development, whatever else says.
  if (process.env.OMEGA_TEST_MODE === 'true') return 'testing';

  // 2. The context's own environment: the deliberate value web's verbs already
  //    thread (`omega build` → production, `omega dev` → development) and the
  //    build lanes pass down. It beats the ambient signals, exactly as
  //    @omega.js/desktop's config override beats its auto-detected packaged state.
  if (this && ENV_ENVIRONMENTS.includes(this.environment)) return this.environment;

  // 3. Build-time / Node signals.
  if (process.env.OMEGA_BUILD_MODE === 'true') return 'production';
  if (process.env.NODE_ENV === 'production') return 'production';
  if (process.env.NODE_ENV === 'development') return 'development';

  // 4. Default: development. Web's deployed artifact is static HTML emitted by
  //    a build that CARRIED its signal (the production environment is baked
  //    into build.json at emit time), so reaching here means a bare tooling
  //    context, where development is the sensible answer. (Contrast
  //    @omega.js/backend and @omega.js/desktop, whose deployed RUNTIME can
  //    legitimately lack a signal, so they default to production.)
  return 'development';
}

/**
 * @returns {boolean} true only in development (never in testing)
 */
function isDevelopment() {
  return getEnvironment.call(this) === 'development';
}

/**
 * @returns {boolean} true only in production — a real positive check
 */
function isProduction() {
  return getEnvironment.call(this) === 'production';
}

/**
 * @returns {boolean} true only while web's test framework runs this process
 */
function isTesting() {
  return getEnvironment.call(this) === 'testing';
}

/**
 * Mix the surface into a Manager constructor's prototype AND the constructor
 * itself, so `Manager.isTesting()` works statically too — the idiom
 * @omega.js/desktop and @omega.js/extension attach with.
 * @param {Function} Manager - the constructor to extend
 */
function attachTo(Manager) {
  Manager.prototype.getEnvironment = getEnvironment;
  Manager.prototype.isDevelopment  = isDevelopment;
  Manager.prototype.isProduction   = isProduction;
  Manager.prototype.isTesting      = isTesting;
  Manager.getEnvironment = getEnvironment;
  Manager.isDevelopment  = isDevelopment;
  Manager.isProduction   = isProduction;
  Manager.isTesting      = isTesting;
}

module.exports = { attachTo, getEnvironment, isDevelopment, isProduction, isTesting };
