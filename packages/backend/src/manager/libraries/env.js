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
 * A key whose value must differ between a local run and a deployed one is NOT
 * this reader's business ([#586](https://github.com/Omega-JS-Stack/omega/issues/586)):
 * the brand's `.env.<environment>` overlay supplies the other value and the
 * cascade resolves it before anything reaches here, so `env.get()` reads ONE
 * name in every environment.
 *
 * Values are never printed. Errors name the KEY and the fix.
 */
const { envSchemaEntry, requiredEnvKeys, envEnvironment } = require('@omega.js/config');
const { checkEnvRules } = require('@omega.js/config/env-rules');

/**
 * The runtime environment — what the Manager's `getEnvironment()` and the three
 * `is*()` checks return. It is @omega.js/config's `envEnvironment()`, the ONE
 * home of the vocabulary: the same three names the `.env.<environment>` overlay
 * files are spelled with (#586), so a `.env.development` and a
 * `Manager.isDevelopment()` can never mean different things.
 *
 * Re-exported here because the provider libraries below already read the
 * environment through this reader and hold no Manager handle.
 *
 * @returns {'testing'|'production'|'development'} The environment.
 */
const environment = envEnvironment;

/** How a missing key gets fixed, by who is supposed to provide it. */
function remedy(entry) {
  return entry && typeof entry.generated === 'function'
    ? 'Run `npx omega manage` at the brand root (it mints the key), then redeploy the backend.'
    : 'Add it to the brand .env, then redeploy: every backend verb composes dist/.env from the cascade.';
}

/**
 * The resolved value of a declared env key: the cascade's value, else the
 * schema's static default, else undefined. An empty string reads as absent — a
 * key set to nothing is not set.
 *
 * @param {string} name - The env var name.
 * @returns {string|undefined} The value.
 * @throws {Error} UnknownEnvKeyError when the schema does not declare `name`.
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

  return process.env[name] || entry.default;
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
