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
 * Pattern families (`match`, no `name`) carry a delivery like anything else,
 * but have no fixed name to render, so nothing here can list them.
 *
 * Every function takes an optional `schema` so a caller — the tests — can
 * exercise the rules against a fixture; the default is the real one.
 */

const { ENV_SCHEMA } = require('./env-schema.js');

// Keys a generated workflow's own `env:` block already declares. The generated
// block never restates one (a repeated YAML mapping key is invalid) — they are
// still PUBLISHED, they just aren't re-rendered.
const WORKFLOW_OWNED_KEYS = ['GH_TOKEN', 'NODE_VERSION', 'NODE_ENV'];

// Rendered in place of the block when a target delivers nothing, so the
// generated region is always a valid, self-explaining line of YAML.
const EMPTY_BLOCK = '# (no CI-delivered keys for this target — the next omega verb regenerates this block)';

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

/**
 * The keys a target's generated workflow needs in the runner env: every `ci`
 * delivery, plus every `bake` (a bake is injected before it is baked).
 *
 * @param {string} target - Target name.
 * @param {object} [options]
 * @param {object[]} [options.schema] - Env schema entries (default: the real schema).
 * @returns {string[]} Delivered env var names, sorted.
 */
function workflowSecretKeys(target, { schema = ENV_SCHEMA } = {}) {
  return deliveredNames(target, ['ci', 'bake'], schema);
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
  return deliveredNames(target, ['bake'], schema);
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
function renderSecretsBlock(target, { schema = ENV_SCHEMA, indent = '  ' } = {}) {
  const lines = workflowSecretKeys(target, { schema })
    .filter((key) => !WORKFLOW_OWNED_KEYS.includes(key))
    .map((key) => `${key}: \${{ secrets.${key} }}`);

  return lines.length ? lines.join(`\n${indent}`) : EMPTY_BLOCK;
}

module.exports = {
  WORKFLOW_OWNED_KEYS,
  workflowSecretKeys,
  bakeKeys,
  publishSecretKeys,
  renderSecretsBlock,
};
