/**
 * The env presence checker — the ONE evaluator of the schema's `required` and
 * `requiredWhen` rules
 * ([#626](https://github.com/Omega-JS-Stack/omega/issues/626)).
 *
 * Every such rule used to be a hand-written if in whatever target noticed it
 * first: the extension's build threw when a GA4 id had no Measurement Protocol
 * secret, the manager's captcha service paired site key and secret on its own.
 * Each was one more place to drift, and each protected one target only. The
 * schema declares the rule once (env-schema.js) and this checker answers it
 * for its three real consumers:
 *
 *   - the backend's boot reader (@omega.js/backend, libraries/env.js
 *     `assertRules`) — production refuses, everything else warns;
 *   - the two BAKE lanes, where a missing key would be frozen into a shipped
 *     artifact: the extension's build.json bake (gulp/tasks/package.js) and the
 *     desktop's webpack DefinePlugin bake (gulp/tasks/webpack.js), both
 *     refusing in build/publish mode and warning in development. Web has NO
 *     bake seam — a site reads its values at request time, so there is nothing
 *     to freeze and nothing to check;
 *   - the manager's manage-time workspace op
 *     (services/workspace/ensure/env-rules.js), evaluated per ENABLED target
 *     against that target's resolved config — the earliest a human hears about
 *     any of it, and a warning every time.
 *
 * PRESENCE ONLY, never a value shape (Ian 2026-08-26): a rule fires when the
 * key is empty, never because a value "looks wrong". `requiredWhen` is
 * one-directional — a truthy config path makes the key mandatory; an empty key
 * never says anything about the config.
 *
 * The checker NEVER throws and never logs. It returns the violations and the
 * caller decides the severity (build mode and production boot fail loudly,
 * development warns and continues).
 */

const { ENV_SCHEMA } = require('./env-schema.js');
const { getPath } = require('./validate.js');

/**
 * Whether a key has a value in the given env map, under its own name or the
 * name it is DELIVERED under (a target's build holds
 * `GOOGLE_ANALYTICS_SECRET`, never the brand-level
 * `GOOGLE_ANALYTICS_SECRET_WEB` it came from). An empty string is absent —
 * the same rule the .env cascade applies.
 *
 * @param {object} env - Env var map (process.env, a composed target env, …).
 * @param {object} entry - The schema entry.
 * @returns {boolean}
 */
function hasValue(env, entry) {
  if (env[entry.name]) return true;

  return Boolean(entry.deliverAs && env[entry.deliverAs]);
}

/**
 * Check a resolved config + env pair against the schema's presence rules.
 *
 * Pass the caller's `target` and only the entries that name it are evaluated —
 * a web build never owes the desktop's Snap credentials. Without one, every
 * entry is checked, which is the manager's brand-wide view.
 *
 * @param {object} config - The resolved omega.json5 config.
 * @param {object} env - Env var map (process.env, a composed target env, …).
 * @param {object} [options]
 * @param {string} [options.target] - Target name ('web', 'backend', …).
 * @param {object[]} [options.schema] - Env schema entries (default: the real schema).
 * @returns {Array<{ key: string, rule: 'required'|'requiredWhen', path: string|null }>}
 *   One violation per empty key that owes a value; `path` is the config path
 *   that made it mandatory, null for an unconditional `required`.
 */
function checkEnvRules(config, env, { target, schema = ENV_SCHEMA } = {}) {
  const values = env || {};
  const violations = [];

  for (const entry of schema) {
    // A pattern family has no fixed name, so nothing can be owed under it
    if (!entry.name) continue;
    if (target && !entry.targets.includes(target)) continue;
    if (!entry.required && !entry.requiredWhen) continue;
    if (hasValue(values, entry)) continue;

    if (entry.required) {
      violations.push({ key: entry.name, rule: 'required', path: null });
    } else if (getPath(config, entry.requiredWhen)) {
      violations.push({ key: entry.name, rule: 'requiredWhen', path: entry.requiredWhen });
    }
  }

  return violations;
}

module.exports = { checkEnvRules };
