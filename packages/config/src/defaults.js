/**
 * Schema-derived defaults — the ONE home of every config default
 * ([#478](https://github.com/Omega-JS-Stack/omega/issues/478)).
 *
 * Defaults used to be scattered: a per-framework `options.defaults` blob, the
 * manager's DEFAULTS layer, read-site fallbacks, and prose in the schema
 * descriptions. Now a schema entry declares its own `default:` and everything
 * derives from that:
 *
 *   - `schemaDefaults(target)` builds the merge chain's LOWEST layer
 *     (load.js). A framework still passes `options.defaults` on top, but only
 *     where that framework genuinely differs from the schema answer.
 *   - `missingDefaults(config)` names the blocks a brand's omega.json5 has yet
 *     to materialize — the manage walk writes exactly those, with each block's
 *     schema description as its guiding comment, and never touches a key the
 *     brand already authored (a new subsystem simply appears on the next run).
 *
 * A key with no sane framework answer carries no `default:` and is never
 * materialized: owner decisions, tri-states that mean "ask", ids the services
 * provision, anything secret-shaped (secrets live in .env regardless).
 */

const { SHARED_SCHEMA, TARGET_SCHEMAS } = require('./schema.js');
const { isPlainObject } = require('./merge.js');

function hasDefault(rule) {
  return Object.prototype.hasOwnProperty.call(rule, 'default');
}

/**
 * The rules that carry a default: SHARED_SCHEMA always, plus that target's
 * refinements (they overlay the same top-level namespace loadConfig resolves).
 * @param {string} [target] - Canonical target name ('web', 'backend', ...).
 * @returns {object[]}
 */
function defaultRules(target) {
  const rules = target && TARGET_SCHEMAS[target]
    ? [...SHARED_SCHEMA, ...TARGET_SCHEMAS[target]]
    : SHARED_SCHEMA;

  return rules.filter(hasDefault);
}

function setAtPath(target, dotted, value) {
  const names = dotted.split('.');
  const leaf = names.pop();
  let node = target;

  for (const name of names) {
    if (!isPlainObject(node[name])) node[name] = {};
    node = node[name];
  }

  node[leaf] = value;
}

/**
 * The default config a brand that authors nothing gets — every schema
 * `default:` at its own dot-path. A fresh deep copy per call: a caller that
 * mutates the result can never reach back into the schema.
 * @param {string} [target] - Canonical target name; adds that target's refinements.
 * @returns {object}
 */
function schemaDefaults(target) {
  const defaults = {};

  for (const rule of defaultRules(target)) {
    setAtPath(defaults, rule.path, structuredClone(rule.default));
  }

  return defaults;
}

/**
 * The guiding comments a materialized block travels with: dot-path →
 * description, for every defaulted key and for the container entries above
 * them (a `marketing` block insert is documented, and so is each key it
 * carries). The editor writes a comment only where it INSERTS that path, so
 * the map covers the whole default set and the file gets what it lacks.
 *
 * @param {string} [target] - Canonical target name; adds that target's refinements.
 * @returns {Object<string, string>}
 */
function defaultComments(target) {
  const rules = target && TARGET_SCHEMAS[target]
    ? [...SHARED_SCHEMA, ...TARGET_SCHEMAS[target]]
    : SHARED_SCHEMA;

  const defaulted = rules.filter(hasDefault).map((rule) => rule.path);
  const comments = {};

  for (const rule of rules) {
    const documents = defaulted.some((dotted) => dotted === rule.path || dotted.startsWith(`${rule.path}.`));
    if (documents && rule.description) {
      comments[rule.path] = rule.description;
    }
  }

  return comments;
}

function collectMissing(defaults, present, prefix, target, found) {
  for (const [key, value] of Object.entries(defaults)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    const authored = isPlainObject(present) && Object.prototype.hasOwnProperty.call(present, key);

    if (!authored) {
      found.push({ path: dotted, value });
      continue;
    }

    // Present and still a container on both sides → look for holes inside it.
    // A brand that authored anything else at this path (a scalar, false, null)
    // made a decision: never dive in, never overwrite.
    if (isPlainObject(value) && isPlainObject(present[key])) {
      collectMissing(value, present[key], dotted, target, found);
    }
  }

  return found;
}

/**
 * The schema-defaulted blocks a config does not carry yet, each at the HIGHEST
 * path that is missing (a brand with no `marketing` at all gets one
 * `marketing` block, not one edit per key inside it).
 *
 * Run against the RAW file contents the heal is about to edit, never a
 * resolved config — resolution already merged the defaults in, so every block
 * would read as present.
 *
 * @param {object} config - Parsed omega.json5 contents.
 * @param {string} [target] - Canonical target name; adds that target's refinements.
 * @returns {Array<{ path: string, value: * }>}
 */
function missingDefaults(config, target) {
  return collectMissing(schemaDefaults(target), config || {}, '', target, []);
}

module.exports = { schemaDefaults, missingDefaults, defaultComments, defaultRules };
