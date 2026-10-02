/**
 * The named rules an env key's `requiredWhen` and `askedWhen` are written in
 * (env-schema.js), so the key list reads as plain statements and no caller
 * writes a test of its own. Presence only, never a value's shape.
 *
 * A rule is a function `(config) => boolean` carrying `text` (what a refusal
 * prints after "required by"), `note` (a clause it prints after that, if one),
 * `path` (the config path it reads, if one) and `switches` (the `onUnlessOff`
 * paths it honours, in order: the last is the narrowest, what "Disable" turns
 * off for that ask).
 */

const { getPath } = require('./validate.js');
const { chosenProvider } = require('./providers.js');
const { hasTargetOfType } = require('./targets.js');
const { isDemoProject } = require('./demo.js');
const { deepMerge } = require('./merge.js');
const { windowsSigningStrategy, DEFAULT_WINDOWS_SIGNING_STRATEGY } = require('./windows-signing.js');

// The one target type whose default formats owe keys
const DESKTOP = 'desktop';
// What a refusal adds after a default format's path, so nobody hunts for the switch
const ON_BY_DEFAULT = 'on by default until set to false';

/**
 * Give a test function its readable facts.
 * @param {function(object): boolean} test - The check itself.
 * @param {object} facts - `{ text, note?, path?, switches? }`.
 * @returns {function(object): boolean} The rule.
 */
function rule(test, { text, note = null, path = null, switches = [] }) {
  const named = (config) => Boolean(test(config || {}));
  return Object.assign(named, { text, note, path, switches });
}

/**
 * A config path holds a value (any truthy one).
 * @param {string} path - Dotted omega.json5 path.
 * @returns {function} The rule.
 */
function holds(path) {
  return rule((config) => getPath(config, path), { text: path, path });
}

/**
 * A feature is on unless the config turns it off: absent means on, and a
 * `false` at the path or at any section above it means off (the tri-state
 * opt-out "Disable permanently" writes).
 * @param {string} path - Dotted path of the switch.
 * @returns {function} The rule.
 */
function onUnlessOff(path) {
  const parts = path.split('.');
  const test = (config) => {
    let node = config;
    for (const part of parts) {
      if (node === false) return false;
      if (node == null || typeof node !== 'object') return true;
      node = node[part];
    }
    return node !== false;
  };

  return rule(test, { text: `${path} is not false`, path, switches: [path] });
}

/**
 * A provider is the chosen one. The path names either a `providers` map
 * (presence picks, `false` drops) or a plain value (`strategy: 'cloud'`).
 * With no name, any chosen provider holds.
 * @param {string} path - Dotted path of the map or the value.
 * @param {string} [name] - The provider that must be chosen.
 * @returns {function} The rule.
 */
function chosen(path, name) {
  const test = (config) => {
    const value = getPath(config, path);
    const picked = value && typeof value === 'object' ? chosenProvider(value) : value;
    return name === undefined ? Boolean(picked) : picked === name;
  };

  return rule(test, { text: name === undefined ? `${path} names a provider` : `${path}=${name}`, path });
}

/**
 * The brand declares a target of one of these types.
 * @param {...string} types - Target types ('desktop', 'mobile', ...).
 * @returns {function} The rule.
 */
function hasTarget(...types) {
  const test = (config) => types.some((type) => hasTargetOfType(config, type));
  return rule(test, { text: `a ${types.join(' or ')} target` });
}

/**
 * What each target of a type sees: its `targets.<name>` entry over the shared
 * config, the same overlay the loader resolves. A resolved view (it carries
 * its own `type`) or a config with no such entry is taken as it is.
 * @param {object} config - A brand config, or one target's resolved view.
 * @param {string} type - The target type.
 * @returns {object[]} One view per target of that type.
 */
function targetViews(config, type) {
  if (config.type === type) return [config];

  const entries = Object.values(config.targets || {}).filter((entry) => entry && entry.type === type);
  return entries.length > 0 ? entries.map((entry) => deepMerge(config, entry)) : [config];
}

/**
 * Whether one view ships a format: every platform and format defaults on, so
 * only a `false` at the platform or at the format drops it.
 * @param {object} [view] - One target's resolved view.
 * @param {string} platform - A platform ('linux', 'windows', 'chrome', ...).
 * @param {string} format - One of its formats ('snap', 'nsis', ...).
 * @returns {boolean}
 */
function formatShips(view, platform, format) {
  return getPath(view, `platforms.${platform}`) !== false
    && getPath(view, `platforms.${platform}.formats.${format}`) !== false;
}

/**
 * The desktop views that ship one format: what the build ships, defaults
 * included (formatShips, the rule platforms.js's enabledFormats reads too).
 * @param {object} config - A brand config, or one target's resolved view.
 * @param {string} platform - A desktop platform ('linux', 'windows', ...).
 * @param {string} format - One of its formats ('snap', 'nsis', ...).
 * @returns {object[]} The views; [] for a config with no desktop target.
 */
function viewsShipping(config, platform, format) {
  if (config.type !== DESKTOP && !hasTargetOfType(config, DESKTOP)) return [];

  return targetViews(config, DESKTOP).filter((view) => formatShips(view, platform, format));
}

/**
 * A desktop target ships the format: on by default, off only with `false`.
 * @param {string} platform - A desktop platform.
 * @param {string} format - One of its formats.
 * @returns {function} The rule.
 */
function ships(platform, format) {
  const path = `platforms.${platform}.formats.${format}`;
  const test = (config) => viewsShipping(config, platform, format).length > 0;

  return rule(test, { text: path, note: ON_BY_DEFAULT, path });
}

/**
 * A desktop target ships the Windows installer and signs it with this
 * strategy, the default strategy included when none is written.
 * @param {string} strategy - A Windows signing strategy ('self-hosted', ...).
 * @returns {function} The rule.
 */
function signsWith(strategy) {
  const path = 'platforms.windows.signing.strategy';
  const test = (config) => viewsShipping(config, 'windows', 'nsis')
    .some((view) => windowsSigningStrategy(view) === strategy);
  const isDefault = strategy === DEFAULT_WINDOWS_SIGNING_STRATEGY ? `${strategy} is the default strategy, and ` : '';

  return rule(test, { text: `${path}=${strategy}`, note: `${isDefault}platforms.windows.formats.nsis is ${ON_BY_DEFAULT}`, path });
}

/**
 * The cloud project is not a `demo-` one, which is local only. No id yet is
 * "not chosen", not demo: the cloud service asks so it can pick one.
 * @returns {function} The rule.
 */
function realProject() {
  const path = 'cloud.config.projectId';
  return rule((config) => !isDemoProject(getPath(config, path)), { text: `${path} is not a demo- id`, path });
}

/**
 * Every rule holds.
 * @param {...function} rules - The rules.
 * @returns {function} The rule.
 */
function all(...rules) {
  return rule((config) => rules.every((each) => each(config)), {
    text: rules.map((each) => each.text).join(' and '),
    switches: rules.flatMap((each) => each.switches),
  });
}

/**
 * At least one rule holds.
 * @param {...function} rules - The rules.
 * @returns {function} The rule.
 */
function any(...rules) {
  return rule((config) => rules.some((each) => each(config)), {
    text: rules.map((each) => each.text).join(' or '),
  });
}

/**
 * A key's `askedWhen`: the rule per manager service that asks for it. The
 * whole holds when any service asks; `services` keeps each service's own.
 * @param {Object<string, function>} byService - Service name to its rule.
 * @returns {function} The rule, with `services`.
 */
function asks(byService) {
  return Object.assign(any(...Object.values(byService)), { services: byService });
}

module.exports = { holds, onUnlessOff, chosen, hasTarget, ships, signsWith, realProject, all, any, asks, targetViews, formatShips };
