/**
 * The delivery renderer — every workflow secrets block, bake list and
 * push-secrets set, derived from the env schema alone
 * ([#627](https://github.com/Omega-JS-Stack/omega/issues/627)).
 *
 * HOW a key reaches its consumer used to be decided in three unrelated places:
 * the web target scanned the resolved .env to render its workflow block, the
 * extension and desktop workflows carried hand-written `${{ secrets.KEY }}`
 * lists, and each build's bake was hand-coded per framework. Three systems for
 * one concern. The schema's `delivery` field is now the single declaration
 * (see env-schema.js's header for the three modes) and this module is its ONE
 * reader — no framework keeps a list.
 *
 * Two rules ride on every list here:
 *
 *   - `deliverAs` is honored: the DELIVERED name is what a runner and an
 *     artifact ever see (the brand's `GOOGLE_ANALYTICS_SECRET_WEB` is
 *     `GOOGLE_ANALYTICS_SECRET` in CI), so a repo secret is named for what
 *     reads it, not for the brand-level slot it came from.
 *   - `machineLocal` keys never leave the developer's machine
 *     ([#454](https://github.com/Omega-JS-Stack/omega/issues/454)), so they
 *     drop out of every rendered and published set.
 *
 * The schema NAMES most of what travels, and two kinds of key it cannot name
 * ride the same pipeline through the target's COMPOSED production values
 * (`values`, from composeTargetEnv), which every list here takes as an option:
 *
 *   - a PATTERN family member (`match`, no `name`): the schema knows
 *     `CONNECTIONS_<PROVIDER>_CLIENT_ID` as a shape, so only a composed set can
 *     say which providers this brand actually configured
 *     ([#876](https://github.com/Omega-JS-Stack/omega/issues/876)).
 *   - a CUSTOM key the schema does not know at all: a consumer's own line in
 *     the brand `.env`, which used to reach no runner and fail the consumer's
 *     own workflow step silently
 *     ([#835](https://github.com/Omega-JS-Stack/omega/issues/835)). It travels
 *     in the target's FILE mode: written into the `.env` the runner builds on
 *     the backend, the runner env alone everywhere else.
 *
 * Both halves come out of ONE primitive (`deliveredKeys`), so what a workflow
 * injects, what push-secrets publishes, and what the backend's `.env` writer
 * names can never disagree inside a run. No `values` = the schema half alone,
 * which is what a lane with no brand to compose from gets.
 *
 * Every function takes an optional `schema` so a caller (the tests) can
 * exercise the rules against a fixture; the default is the real one.
 */

const { ENV_SCHEMA, envSchemaEntry } = require('./env-schema.js');

// Keys a generated workflow's own `env:` block already declares. The generated
// block never restates one (a repeated YAML mapping key is invalid) — they are
// still PUBLISHED, they just aren't re-rendered.
const WORKFLOW_OWNED_KEYS = ['GH_TOKEN', 'CLOUDFLARE_TOKEN', 'NODE_VERSION', 'NODE_ENV'];

// Rendered in place of the block when a target delivers nothing, so the
// generated region is always a valid, self-explaining line of YAML.
const EMPTY_BLOCK = '# (no CI-delivered keys for this target — the next omega verb regenerates this block)';

// What a target's generated workflow carries in the runner env, per target.
//
// The default is the CI half: `ci` plus `bake` (a bake is injected before it is
// baked), because those artifacts carry their values inside themselves and
// never read an env file.
//
// The BACKEND is the one target whose deployed artifact ships a composed `.env`
// and whose deploy now runs on a runner
// ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)): the runner has
// no brand checkout to compose that file from, so its workflow WRITES the .env
// from the runner env, which puts every `env` delivery on the runner too.
const WORKFLOW_MODES = {
  backend: ['env', 'ci', 'bake'],
};

const DEFAULT_WORKFLOW_MODES = ['ci', 'bake'];

/**
 * The mode a key the schema does not declare travels in, per target: the
 * target's own FILE mode where it has one (backend, whose workflow writes the
 * `.env` its upload ships with), the runner env everywhere else (#835).
 *
 * A custom key declares no delivery, so it takes the channel its target
 * already uses for the keys it composes. A packaged app carries no `.env`, so
 * there is nothing on web, desktop or the extension for a file mode to mean.
 *
 * @param {string} target - Target name.
 * @returns {string} `'env'` or `'ci'`.
 */
function customDeliveryMode(target) {
  return (WORKFLOW_MODES[target] || DEFAULT_WORKFLOW_MODES).includes('env') ? 'env' : 'ci';
}

/**
 * The delivered names a target receives in the given modes, sorted and
 * deduplicated.
 *
 * The publicAtRest gate lives here, so EVERY lane that walks a baking entry
 * refuses it: a `secret: true` key with no `publicAtRest` declaration can
 * never reach a shipped artifact, not through a bake list and not through the
 * workflow injection its bake implies.
 *
 * @param {string} target - Target name ('web', 'backend', 'desktop', …).
 * @param {string[]} modes - The delivery modes to collect.
 * @param {object[]} schema - Env schema entries.
 * @returns {string[]} Delivered env var names.
 */
function deliveredNames(target, modes, schema) {
  const names = new Set();

  for (const entry of schema) {
    const mode = entry.delivery && entry.delivery[target];
    if (!mode) continue;

    if (mode === 'bake' && entry.secret && !entry.publicAtRest) {
      throw new Error(`${entry.name || entry.match}: bakes into the ${target} artifact but declares no publicAtRest — a secret can never ride a shipped build`);
    }

    if (!modes.includes(mode)) continue;
    if (!entry.name) continue;
    if (entry.machineLocal) continue;

    names.add(entry.deliverAs || entry.name);
  }

  return [...names].sort();
}

// GitHub's own rule for a secret name: letters, digits and underscores, never
// leading with a digit. A composed key that breaks it is refused by name.
const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The ONE delivered key set (#835, #876): the schema's named deliveries for
 * this target in these modes, plus what only the target's COMPOSED production
 * values can name.
 *
 * Every list in this file derives from here, so the workflow block, the
 * published secrets and the backend's `.env` key list are three renderings of
 * one set rather than three sets that have to agree.
 *
 * A composed key is added when it is a `match` family member this target
 * delivers in these modes, or when the schema does not know it at all and the
 * target's custom mode is one of them. It is NOT added when the schema names
 * it: the walk above already ruled on every fixed name, so a `machineLocal`
 * path and a key whose only delivery here is the local `.env` stay home
 * exactly as they did before a composed set existed. A WORKFLOW_OWNED name is
 * never taken from a composed set either: those belong to the template, and
 * neither is a `GITHUB_`-prefixed name, which GitHub refuses as a secret. A
 * composed name GitHub could not hold as a secret at all throws, naming the key
 * and the rule.
 *
 * @param {string} target - Target name ('web', 'backend', …).
 * @param {string[]} modes - The delivery modes to collect.
 * @param {object} [options]
 * @param {object[]} [options.schema] - Env schema entries (default: the real schema).
 * @param {Object<string, string>} [options.values] - The target's composed
 *   production values (names are read, values never are).
 * @returns {string[]} Delivered env var names, sorted.
 */
function deliveredKeys(target, modes, { schema = ENV_SCHEMA, values = null } = {}) {
  const names = new Set(deliveredNames(target, modes, schema));
  if (!values) return [...names].sort();

  const customMode = customDeliveryMode(target);

  for (const key of Object.keys(values)) {
    if (names.has(key)) continue;

    const entry = envSchemaEntry(key, schema);

    if (entry) {
      // A fixed name is the walk above's business, whatever it decided.
      if (entry.name) continue;
      if (entry.machineLocal) continue;
      if (!modes.includes(entry.delivery && entry.delivery[target])) continue;
      names.add(key);
      continue;
    }

    if (!modes.includes(customMode)) continue;
    if (WORKFLOW_OWNED_KEYS.includes(key)) continue;
    // GitHub REFUSES an Actions secret whose name starts with GITHUB_ (the
    // prefix is the runner's own), so publishing one would fail the deploy
    // precheck outright. A brand .env carrying GITHUB_TOKEN is a plausible
    // typo for GH_TOKEN, and the workflow reads its own `secrets.GITHUB_TOKEN`
    // either way.
    if (key.startsWith('GITHUB_')) continue;
    // dotenv reads `[\w.-]+` as a key, so a brand `.env` can carry a name
    // GitHub's secret API refuses outright (`ACME.WEBHOOK`). Delivering it
    // would render a workflow line nothing can resolve and fail the publish
    // three layers from the typo, so it fails HERE, by name.
    if (!SECRET_NAME.test(key)) {
      throw new Error(`${key}: a delivered env key must be a GitHub secret name (${SECRET_NAME.source.replace(/^\^|\$$/g, '')}), so rename it in the target's .env`);
    }
    names.add(key);
  }

  return [...names].sort();
}

/**
 * The keys a target's generated workflow needs in the runner env: every `ci`
 * delivery, plus every `bake` (a bake is injected before it is baked).
 *
 * @param {string} target - Target name.
 * @param {object} [options]
 * @param {object[]} [options.schema] - Env schema entries (default: the real schema).
 * @returns {string[]} Delivered env var names, sorted.
 */
function workflowSecretKeys(target, { schema = ENV_SCHEMA, values = null } = {}) {
  return deliveredKeys(target, WORKFLOW_MODES[target] || DEFAULT_WORKFLOW_MODES, { schema, values });
}

/**
 * The keys a target's RUNTIME reads from the `.env` its artifact ships with:
 * every `env` delivery, and ONLY those. Backend is the only target with one
 * today, and the one caller is its generated workflow, which writes that file
 * on the runner from the secrets the block above injects (#872).
 *
 * A `ci` key is deliberately not here: it reaches the deploy PROCESS through
 * the runner env (the deploy credential, the license key the verdict is checked
 * with) and the shipped artifact must never carry it. The mode list below is
 * the whole of that exclusion, and `artifactEnvValues` applies the same rule to
 * the other writer of a backend `.env`, the stage's composer.
 *
 * @param {string} target - Target name.
 * @param {object} [options]
 * @param {object[]} [options.schema] - Env schema entries.
 * @returns {string[]} Delivered env var names, sorted.
 */
function envFileKeys(target, { schema = ENV_SCHEMA, values = null } = {}) {
  return deliveredKeys(target, ['env'], { schema, values });
}

/**
 * Composed env values, narrowed to what a target's shipped artifact may carry:
 * everything the composer resolved, minus every key the schema delivers to this
 * target as `ci` ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
 *
 * The two sets differ on purpose. `composeTargetEnv` (env.js) resolves a value
 * for EVERY key a target claims, because the secrets publisher needs the `ci`
 * values too: a repo secret the workflow injects has to be valued from the same
 * cascade as everything else. The `.env` written INTO an artifact is the
 * narrower half, and this is the filter that says so, from the same declaration
 * `envFileKeys` reads. A pattern family and a target-layer key have no `ci`
 * delivery to match, so they pass through untouched.
 *
 * @param {string} target - Target name.
 * @param {Object<string, string>} values - The composed values.
 * @param {object} [options]
 * @param {object[]} [options.schema] - Env schema entries.
 * @returns {Object<string, string>} A new map, runner-only keys removed.
 */
function artifactEnvValues(target, values, { schema = ENV_SCHEMA } = {}) {
  const runnerOnly = new Set(deliveredKeys(target, ['ci'], { schema }));
  const shipped = {};

  for (const [key, value] of Object.entries(values)) {
    if (runnerOnly.has(key)) continue;
    shipped[key] = value;
  }

  return shipped;
}

/**
 * The keys a target's build writes INTO its shipped artifact — what a packaged
 * app carries because it runs with no .env. Every one is public at rest.
 *
 * @param {string} target - Target name.
 * @param {object} [options]
 * @param {object[]} [options.schema] - Env schema entries.
 * @returns {string[]} Delivered env var names, sorted.
 */
function bakeKeys(target, { schema = ENV_SCHEMA } = {}) {
  return deliveredKeys(target, ['bake'], { schema });
}

/**
 * The SOURCE names of a target's baked keys: the brand-level name a human sets
 * (`GOOGLE_ANALYTICS_SECRET_DESKTOP`), not the `deliverAs` name the build reads
 * it under. The bake GUARD names keys at the level a human can fix them, and it
 * must not judge a target on keys it never bakes
 * ([#891](https://github.com/Omega-JS-Stack/omega/issues/891): the desktop's
 * other rules are CI-delivered signing credentials, which the deploy lane owns).
 *
 * @param {string} target - Target name.
 * @param {object} [options]
 * @param {object[]} [options.schema] - Env schema entries.
 * @returns {string[]} Brand-level env var names, sorted.
 */
function bakeSourceKeys(target, { schema = ENV_SCHEMA } = {}) {
  return schema
    .filter((entry) => entry.name && !entry.machineLocal && entry.delivery && entry.delivery[target] === 'bake')
    .map((entry) => entry.name)
    .sort();
}

/**
 * The repo Actions secrets a push-secrets publisher sends for a target: the
 * same set the workflow consumes (a secret CI never reads has no business in
 * the repo, and a key the workflow injects must exist as one). Workflow-owned
 * names are included — the template's `${{ secrets.GH_TOKEN }}` needs the
 * secret to exist even though the generated block never restates it.
 *
 * @param {string} target - Target name.
 * @param {object} [options]
 * @param {object[]} [options.schema] - Env schema entries.
 * @returns {string[]} Delivered env var names, sorted.
 */
function publishSecretKeys(target, options) {
  return workflowSecretKeys(target, options);
}

/**
 * Render a workflow's generated env block: one `KEY: ${{ secrets.KEY }}` line
 * per CI-delivered key, sorted (a deterministic block re-renders
 * byte-identical, so a scaffold's idempotency check reports no write). Lines
 * join at `indent`; the template's token supplies the first line's.
 *
 * @param {string} target - Target name.
 * @param {object} [options]
 * @param {object[]} [options.schema] - Env schema entries.
 * @param {string} [options.indent] - The token's indent (default two spaces).
 * @returns {string} The block body (no leading indent).
 */
function renderSecretsBlock(target, { schema = ENV_SCHEMA, indent = '  ', values = null } = {}) {
  const lines = workflowSecretKeys(target, { schema, values })
    .filter((key) => !WORKFLOW_OWNED_KEYS.includes(key))
    .map((key) => `${key}: \${{ secrets.${key} }}`);

  return lines.length ? lines.join(`\n${indent}`) : EMPTY_BLOCK;
}

/**
 * The KEY NAMES a workflow writes its target's `.env` from, as a JSON array
 * ready to drop into the template's writer step (#872).
 *
 * NAMES only, never `KEY="$KEY"` lines: the writer is a node one-liner that
 * reads each name out of the runner env and serializes the file through
 * `serializeEnv` (env.js), the documented SSOT for every `.env` writeback. The
 * step this replaced pasted values into a shell heredoc, where a value carrying
 * a NEWLINE split its own line and everything after it parsed as a key of its
 * own (verified: a `K="$K"` heredoc with a multi-line value yields the injected
 * key), and a quote or a backslash left the file malformed. No shell ever sees
 * a value now.
 *
 * @param {string} target - Target name.
 * @param {object} [options]
 * @param {object[]} [options.schema] - Env schema entries.
 * @returns {string} A JSON array of names, sorted (`[]` when the target ships no .env).
 */
function renderEnvFileKeys(target, { schema = ENV_SCHEMA, values = null } = {}) {
  return JSON.stringify(envFileKeys(target, { schema, values }));
}

module.exports = {
  WORKFLOW_OWNED_KEYS,
  deliveredKeys,
  workflowSecretKeys,
  envFileKeys,
  artifactEnvValues,
  bakeKeys,
  bakeSourceKeys,
  publishSecretKeys,
  renderSecretsBlock,
  renderEnvFileKeys,
};
