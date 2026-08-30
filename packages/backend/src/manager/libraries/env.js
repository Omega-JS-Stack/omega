/**
 * The ONE env reader ([#581](https://github.com/Omega-JS-Stack/omega/issues/581)).
 *
 * Every framework read of a brand-supplied key goes through here instead of
 * touching `process.env` directly, so three things stop being possible: a
 * key nobody declared (`get()` refuses a name the env schema does not know —
 * a typo used to resolve to `undefined` forever), a required key discovered
 * at a customer's first action instead of at boot (`assertRequired()`), and
 * two readers of one secret drifting apart (#569's raw read beside its own
 * helper).
 *
 * The schema is @omega.js/config's `ENV_SCHEMA` — the same list the manager
 * mints from, groups a brand .env by, and composes `targets/backend/.env`
 * from — so "what the backend needs" has one home shared with the thing that
 * provides it. Runtime/platform vars are NOT in it and never come through
 * here: `FIREBASE_CONFIG`, `FUNCTIONS_EMULATOR`, `GCLOUD_PROJECT`, the
 * `OMEGA_*_PORT` map, the test-mode switches — those are the runtime's own
 * facts about itself, not a brand's credentials.
 *
 * It is also where the DEV/LIVE split lives (#586): payment secrets carry an
 * optional `<KEY>_DEV` twin, which every read prefers outside production and
 * ignores in production, and a LIVE-shaped credential is refused outside
 * production outright. Both rules are the schema's data, applied once here, so
 * every provider library gets them without knowing they exist.
 *
 * Values are never printed. Errors name the KEY and the fix.
 */
const { envSchemaEntry, requiredEnvKeys, devEnvKeyMap } = require('@omega.js/config');
const { checkEnvRules } = require('@omega.js/config/env-rules');

/**
 * The runtime environment — the SINGLE SOURCE OF TRUTH the Manager's
 * `getEnvironment()` and the three `is*()` checks are, and the answer this
 * reader's own dev/live rules gate on (the provider libraries that call
 * `get()` hold no Manager handle). Exactly ONE of three mutually-exclusive
 * values: testing wins, then production, else development.
 *
 * The final `else` is PRODUCTION on purpose: a deployed Cloud Function has no
 * FUNCTIONS_EMULATOR and often no ENVIRONMENT var, so "no signal" IS the
 * normal production state. Defaulting to development would make every deployed
 * function skip real side effects (emails/analytics/webhooks) — and, since
 * #586, prefer a `_DEV` payment secret in front of real customers.
 * (Contrast UJM/BXM, whose deployed artifacts always carry their signal.)
 *
 * @returns {'testing'|'production'|'development'} The environment.
 */
function environment() {
  // Testing takes precedence — set by the test runner / emulator (OMEGA_TEST_MODE=true).
  if (process.env.OMEGA_TEST_MODE === 'true') {
    return 'testing';
  }
  if (process.env.ENVIRONMENT === 'production') {
    return 'production';
  } else if (
    process.env.ENVIRONMENT === 'development'
    || process.env.FUNCTIONS_EMULATOR === true
    || process.env.FUNCTIONS_EMULATOR === 'true'
    || process.env.TERM_PROGRAM === 'Apple_Terminal'
    || process.env.TERM_PROGRAM === 'vscode'
  ) {
    return 'development';
  } else {
    return 'production';
  }
}

/** How a missing key gets fixed, by who is supposed to provide it. */
function remedy(entry) {
  return entry && typeof entry.generated === 'function'
    ? 'Run `npx omega manage` at the brand root (it mints the key), then redeploy the backend.'
    : 'Add it to the brand .env, then redeploy: every backend verb composes dist/.env from the cascade.';
}

/**
 * The LIVE pattern that governs a name — a `_DEV` twin is governed by its base
 * key's shape, so a live credential pasted into the twin is refused too.
 *
 * @param {object} entry - The schema entry.
 * @returns {RegExp|undefined} The pattern a live credential matches.
 */
function liveShapeOf(entry) {
  return entry.liveShape || (entry.devOf ? envSchemaEntry(entry.devOf)?.liveShape : undefined);
}

/**
 * Refuse a credential that announces a LIVE account on a non-production run
 * (#586). Stripe stamps `sk_live_`/`rk_live_` and Chargebee `live_`, so those
 * two are caught by shape; PayPal's halves are opaque and rely on the `_DEV`
 * twin alone.
 *
 * @param {string} name - The key the value came from.
 * @param {object} entry - Its schema entry.
 * @param {string} value - The resolved value (never printed).
 * @throws {Error} LiveSecretOutsideProductionError (code 500).
 */
function assertNotLive(name, entry, value) {
  const shape = liveShapeOf(entry);
  if (!shape || !value || !shape.test(value)) { return; }

  const base = entry.devOf || name;
  const error = new Error(
    `${name} holds a LIVE credential and this process is running in ${environment()} — refusing to use it. `
    + `A non-production run must never reach a live payment account (a local test purchase would charge a real card). `
    + `Put the provider's TEST credential in ${base}_DEV — the backend prefers it outside production and no deploy ever uploads it — and keep the live one in ${base} for the deployed backend.`,
  );
  error.name = 'LiveSecretOutsideProductionError';
  error.code = 500;
  throw error;
}

/**
 * The resolved value of a declared env key: outside production the key's
 * `_DEV` twin when one is set, else the cascade's value, else the schema's
 * static default, else undefined. An empty string reads as absent — a key set
 * to nothing is not set.
 *
 * In PRODUCTION a `_DEV` key reads as absent, whatever the cascade holds: the
 * deploy lane strips those rows from the upload, and this is the second latch
 * so a stale row that survived some other way still cannot redirect a real
 * customer's payment.
 *
 * @param {string} name - The env var name.
 * @returns {string|undefined} The value.
 * @throws {Error} UnknownEnvKeyError when the schema does not declare `name`.
 * @throws {Error} LiveSecretOutsideProductionError when the resolved value is
 *   a live credential on a non-production run (#586).
 */
function get(name) {
  const entry = envSchemaEntry(name);

  if (!entry) {
    // Programmer error, not configuration: reading an undeclared key can only
    // ever return undefined, so it fails at the read instead of at the symptom
    const error = new Error(`${name} is not declared in the env schema (@omega.js/config's env-schema.js) — declare it there, or read a runtime var directly.`);
    error.name = 'UnknownEnvKeyError';
    throw error;
  }

  const production = environment() === 'production';

  if (entry.devOf && production) { return undefined; }

  // Derived on every read, not cached: the schema is the live list (the
  // manager's own tests add entries to it at runtime)
  const twin = production ? undefined : devEnvKeyMap()[name];
  const source = twin && process.env[twin] ? twin : name;
  const value = process.env[source] || entry.default;

  if (!production) { assertNotLive(source, envSchemaEntry(source), value); }

  return value;
}

/**
 * Whether a declared env key resolves to a value — the switch every optional
 * provider gates on (`env.has('SENDGRID_API_KEY')`).
 *
 * @param {string} name - The env var name.
 * @returns {boolean} True when the key resolves to a non-empty value.
 */
function has(name) {
  return !!get(name);
}

/**
 * The value of a key the caller cannot proceed without.
 *
 * @param {string} name - The env var name.
 * @returns {string} The value.
 * @throws {Error} MissingEnvKeyError (code 500) naming the key and the fix.
 */
function require_(name) {
  const value = get(name);
  if (value) { return value; }

  const entry = envSchemaEntry(name);
  // code 500 like the libraries' other faults (errorWithCode): a missing key
  // is the server's misconfiguration, never the caller's input
  const error = new Error(`${name} is missing from the .env cascade — ${entry.description} ${remedy(entry)}`);
  error.name = 'MissingEnvKeyError';
  error.code = 500;
  throw error;
}

/**
 * Validate every key this target refuses to run without, in ONE pass — the
 * boot guard. Missing keys are reported together: a brand fixes its .env
 * once, not once per restart.
 *
 * @param {string} [target] - The target whose required keys to check.
 * @throws {Error} MissingEnvKeysError (code 500) listing every missing key.
 */
function assertRequired(target = 'backend') {
  const missing = requiredEnvKeys(target).filter((name) => !get(name));
  if (missing.length === 0) { return; }

  const lines = missing.map((name) => `  - ${name}: ${envSchemaEntry(name).description}`);
  const error = new Error(
    `${missing.length} required env ${missing.length === 1 ? 'key is' : 'keys are'} missing from the .env cascade:\n${lines.join('\n')}\n`
    + `${remedy(envSchemaEntry(missing[0]))}`,
  );
  error.name = 'MissingEnvKeysError';
  error.code = 500;
  error.keys = missing;
  throw error;
}

/**
 * Validate every key this brand's OWN config made mandatory — the schema's
 * `requiredWhen` rules ([#626](https://github.com/Omega-JS-Stack/omega/issues/626)).
 *
 * `assertRequired` above covers the keys OMEGA needs no matter what a brand
 * configures. This is the other half: a config path that is set makes its key
 * mandatory (a GA4 Measurement ID with no Measurement Protocol secret sends no
 * events; a reCAPTCHA site key with no secret half 403s every protected POST).
 * The rule is declared once in the env schema and evaluated by ONE checker
 * shared with the manager's manage-time pass — this reader only decides what a
 * violation costs, which the caller in index.js resolves: production refuses,
 * everything else warns and continues.
 *
 * Violations name the BRAND-LEVEL key (GOOGLE_ANALYTICS_SECRET_BACKEND, not
 * the GOOGLE_ANALYTICS_SECRET it is delivered as), because that is the name a
 * human puts in the brand .env.
 *
 * @param {object} config - The resolved omega.json5 config.
 * @param {string} [target] - The target whose rules to check.
 * @throws {Error} MissingConditionalEnvKeysError (code 500) naming every key
 *   and the config path that made it mandatory.
 */
function assertRules(config, target = 'backend') {
  // The checker answers for BOTH schema rules; the unconditional `required`
  // half is assertRequired's above, and reporting a key twice in one boot
  // would just be noise.
  const violations = checkEnvRules(config, process.env, { target })
    .filter((violation) => violation.rule === 'requiredWhen');
  if (violations.length === 0) { return; }

  const named = violations.map(({ key, path }) => (path ? `${key} (required by ${path})` : key)).join(', ');
  const error = new Error(
    `${violations.length} env ${violations.length === 1 ? 'key this brand\'s config requires is' : 'keys this brand\'s config requires are'} missing from the .env cascade: ${named}. `
    + `${remedy(envSchemaEntry(violations[0].key))}`,
  );
  error.name = 'MissingConditionalEnvKeysError';
  error.code = 500;
  error.keys = violations.map((violation) => violation.key);
  throw error;
}

/**
 * Whether a boot that FAILED assertRequired() may warn and continue instead
 * of refusing. Exactly one lane qualifies: a process with no consumer
 * omega.json5 is not a brand's backend at all — it is the framework booting
 * itself (its offline unit lanes, a bare require of the package), where there
 * is no brand for a manage run to have minted keys into. Anything shaped like
 * a brand refuses in EVERY environment, development included (#569's
 * production-only branch is gone): the key is one `npx omega manage` away,
 * and a dev loop that boots without it just moves the crash to a customer.
 * The self-test fixture IS brand-shaped, so it gets its required keys seeded
 * the same way a real brand does — see ensureFixtureEnv in cli/commands/test.js.
 *
 * @param {object} context
 * @param {boolean} context.hasConsumerConfig - Whether a consumer omega.json5 resolved.
 * @returns {boolean} True when the fault is advisory.
 */
function guardIsAdvisory({ hasConsumerConfig }) {
  return !hasConsumerConfig;
}

module.exports = {
  environment,
  get,
  has,
  require: require_,
  assertRequired,
  assertRules,
  guardIsAdvisory,
};
