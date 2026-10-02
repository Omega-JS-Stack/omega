/**
 * Config-landing interactive flows — omega-manager's schema-prompter engine
 * reshaped for the new world. When a required config value is missing and
 * the session is interactive (and not a dry run), offer the setup flow —
 * select from an API list (brand matches sorted first, create-new via API
 * handler or browser) or paste back an id from a dashboard — and land the
 * result in omega.json5 via the comment-preserving writeback. The in-memory
 * brandConfig is patched too, so the rest of the run sees the value.
 *
 * Non-interactive or dry-run sessions get null back and each service keeps
 * its clean skip; every flow leads with a uniform Yes / Skip / Disable
 * gate ("Disable" writes `<section>: false` so the service stops asking).
 *
 * Tri-state standard (#33, Ian's call): a missing/null value means ASK
 * (this module), `false` at the path — or any ancestor section — means the
 * user OPTED OUT (silent skip, never prompt or warn again), and any other
 * value means USE IT. Every flow can land the `false`: the gate's Disable
 * writes it (disablePath defaults to the value's own path), and selection
 * flows may offer an inline opt-out choice via `spec.optOut`.
 */
const chalk = require('chalk').default;
const jetpack = require('fs-jetpack');
const JSON5 = require('json5');
const { setAtPath, getAtPath, resolveConfigPath } = require('@omega.js/config');
const { input, select, isInteractive } = require('@omega.js/devkit/prompt');
const { openBrowser } = require('@omega.js/devkit/flows');
const { writeBrandConfig } = require('./config-write.js');
const { canPrompt } = require('./run-gates.js');

const CREATE_NEW = '__CREATE_NEW__';
const OPT_OUT = '__OPT_OUT__';

/**
 * Read a dot-notation path for the tri-state standard: `false` at the path
 * or any ancestor section means opted out; missing segments are undefined.
 */
function readTriState(obj, path) {
  let node = obj;
  for (const key of path.split('.')) {
    if (node === false) {
      return { optedOut: true, value: undefined };
    }
    if (node == null) {
      return { optedOut: false, value: undefined };
    }
    node = node[key];
  }
  return { optedOut: node === false, value: node === false ? undefined : node };
}

/**
 * Whether the brand's own config/omega.json5 holds a dot path, whatever the
 * merged config says: the one way to tell a schema default from an answer.
 *
 * @param {Object} context - Service context (brandRoot)
 * @param {string} path - Dot path
 * @returns {boolean}
 */
function isAuthored(context, path) {
  const file = resolveConfigPath(context.brandRoot);
  return Boolean(file) && getAtPath(JSON5.parse(jetpack.read(file)), path) !== undefined;
}

/**
 * Whether an item's display name fuzzily matches the brand (id, name, or
 * domain, ignoring case/spaces/hyphens) — those sort to the top of lists.
 */
function matchesBrand(itemName, brand) {
  if (!brand) {
    return false;
  }

  const brandId = (brand.id || '').toLowerCase().replace(/-/g, '');
  const brandName = (brand.name || '').toLowerCase().replace(/\s+/g, '');
  const brandUrl = (brand.url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\./g, '');
  const name = itemName.toLowerCase().replace(/[\s-]/g, '');

  return Boolean(
    (brandId && (name.includes(brandId) || brandId.includes(name)))
    || (brandName && (name.includes(brandName) || brandName.includes(name)))
    || (brandUrl && name.includes(brandUrl)),
  );
}

/**
 * Build a select() choices array from API items: "create new" first, then
 * the default item (cursor lands there), then brand matches, then the rest
 * alphabetically.
 *
 * @param {Array} items - Raw API items
 * @param {Object} brand - brandConfig.brand (for match sorting)
 * @param {Object} spec
 * @param {Function} [spec.getName] - item → display name
 * @param {Function} [spec.getValue] - item → choice value
 * @param {*} [spec.defaultValue] - Value whose item sorts to the top
 * @param {string} [spec.createNewLabel] - Adds a "+ Create new …" choice
 * @returns {{ choices: Array, defaultValue: * }} - defaultValue resolved for select()
 */
function sortChoicesForBrand(items, brand, spec = {}) {
  const { getName, getValue, defaultValue, createNewLabel } = spec;
  const nameOf = (item) => (getName ? getName(item) : String(item));
  const valueOf = (item) => (getValue ? getValue(item) : item);
  const isDefault = (item) => defaultValue !== undefined && defaultValue !== null && valueOf(item) === defaultValue;

  const sorted = [...items].sort((a, b) => {
    const aMatches = matchesBrand(nameOf(a), brand);
    const bMatches = matchesBrand(nameOf(b), brand);
    if (aMatches !== bMatches) {
      return aMatches ? -1 : 1;
    }
    if (isDefault(a) !== isDefault(b)) {
      return isDefault(a) ? -1 : 1;
    }
    return nameOf(a).toLowerCase().localeCompare(nameOf(b).toLowerCase());
  });

  const defaultItem = sorted.find(isDefault) || null;
  const choices = [];

  if (createNewLabel) {
    choices.push({ name: `+ Create new ${createNewLabel}`, value: CREATE_NEW });
  }
  if (defaultItem) {
    choices.push({ name: nameOf(defaultItem), value: valueOf(defaultItem) });
  }
  for (const item of sorted) {
    if (item === defaultItem) {
      continue;
    }
    choices.push({ name: nameOf(item), value: valueOf(item) });
  }

  // Cursor: the default item when given, else the best real item (the
  // brand match after sorting) — never "+ Create new" by accident
  const cursorItem = defaultItem || sorted[0] || null;

  return { choices, defaultValue: cursorItem ? valueOf(cursorItem) : undefined };
}

/**
 * Land a value: write it into omega.json5 (comment-preserving) and patch
 * the in-memory brandConfig so the rest of the run sees it.
 */
function landValue(context, path, value) {
  writeBrandConfig(context, { [path]: value });
  setAtPath(context.brandConfig, path, value);
}

/**
 * The uniform Yes / Skip / Disable gate every config-landing flow leads
 * with — the ONE place that wording lives, so a flow built by hand
 * (the pixel provisioning's token ask) and the shared setup contract
 * (lib/service-input.js, #608) open exactly like resolveConfigValue.
 * "Disable" lands `false` at disablePath (the tri-state opt-out) and says
 * where to delete it.
 *
 * @param {Object} context - Service context
 * @param {Object} spec
 * @param {string} spec.label - Human name ("Meta Pixel", "GA4 property")
 * @param {string[]} [spec.instructions] - Numbered guidance lines
 * @param {string} spec.disablePath - Where Disable writes `false`
 * @returns {Promise<'yes'|'skip'|'disable'>} - The chosen outcome; callers that
 *   only proceed on Yes compare against 'yes', the ones that report WHICH
 *   step-aside happened (#608) read the other two.
 */
async function confirmSetup(context, spec) {
  const { label, instructions, disablePath } = spec;
  const brandName = context.brandConfig.brand?.name || context.brandId;

  console.log(`    ${chalk.yellow('!')} ${label} not configured for ${chalk.cyan(brandName)}`);
  for (const line of instructions || []) {
    console.log(`        ${line}`);
  }

  const action = await select({
    message: 'Set up now?',
    choices: [
      { name: 'Yes', value: 'yes' },
      { name: 'Skip for now', value: 'skip' },
      { name: 'Disable (stop prompting)', value: 'disable' },
    ],
    default: 'yes',
  });

  if (action === 'disable') {
    landValue(context, disablePath, false);
    console.log(`    ${chalk.yellow('!')} ${label} disabled in omega.json5 (${disablePath}: false — delete the line to be asked again)`);
  }

  return action;
}

/**
 * Selection flow: list items from the API, pick one (or create new via
 * API handler / browser + refresh). Returns the picked value or null.
 */
async function runSelection(context, spec) {
  const { label, choices: listItems, getName, getValue, defaultValue, createNew } = spec;

  const items = await listItems(context);
  const built = sortChoicesForBrand(items, context.brandConfig.brand, {
    getName,
    getValue,
    defaultValue,
    createNewLabel: createNew ? (createNew.label || label) : null,
  });

  // Inline opt-out (tri-state): picking it lands `false` — resolveConfigValue
  // handles the landing so this stays a pure selection
  if (spec.optOut) {
    built.choices.push({ name: spec.optOut.label || `No ${label} — don't ask again`, value: OPT_OUT });
  }

  const picked = await select({
    message: spec.message || `Select ${label}:`,
    choices: built.choices,
    default: built.defaultValue,
  });

  if (picked !== CREATE_NEW) {
    return picked;
  }

  // Create new via API handler
  if (createNew.handler) {
    console.log(`    ${chalk.dim('→')} Creating new ${createNew.label || label}...`);
    const value = await createNew.handler(context);
    console.log(`    ${chalk.green('✓')} Created`);
    return value;
  }

  // Create new via browser, then re-list or paste back
  console.log(`    ${chalk.dim('→')} Opening browser to create a new ${createNew.label || label}...`);
  console.log(`    ${chalk.dim('→')} URL: ${chalk.cyan(createNew.url)}`);
  await openBrowser(createNew.url);
  await input({ message: 'Press ENTER when done...' });

  if (createNew.refreshChoices) {
    console.log(`    ${chalk.dim('→')} Refreshing list...`);
    const fresh = await listItems(context);
    const rebuilt = sortChoicesForBrand(fresh, context.brandConfig.brand, { getName, getValue, defaultValue });
    return select({
      message: `Select the new ${createNew.label || label}:`,
      choices: rebuilt.choices,
      default: rebuilt.defaultValue,
    });
  }

  return input({ message: `Enter the ${createNew.label || label} you just created:` });
}

/**
 * Entry flow: open the dashboard and take a pasted-back value. An array of
 * entries asks each in turn, and `spec.getValue` turns the answers into the
 * one value that lands.
 */
async function runEntry(context, spec) {
  const answers = [];

  for (const { url, message, validate } of [].concat(spec.entry)) {
    if (url) {
      await openBrowser(url);
    }

    const value = await input({
      message,
      validate: validate || ((val) => (val?.trim() ? true : 'Required')),
    });
    answers.push(value.trim());
  }

  return Array.isArray(spec.entry) ? spec.getValue(answers) : answers[0];
}

/**
 * Resolve a config value and land it in omega.json5. Returns what is there, or null without
 * asking when it or an ancestor is `false` or the run cannot prompt, or when the user skips.
 * @param {object} context - Service context (brandConfig, brandRoot, options)
 * @param {object} spec - `path` (the dot path the value lands at), `label`, `instructions`
 * @param {string} [spec.disablePath] - Where Disable/opt-out writes `false` (default `path`)
 * @param {boolean} [spec.gate] - false skips the Yes/Skip/Disable gate (a chained ask)
 * @param {Function} [spec.choices] - Selection mode, with `getName`, `getValue`, `defaultValue`, `createNew`, `optOut`
 * @param {object|object[]} [spec.entry] - Paste-back mode (an array asks each, `getValue` joins)
 * @param {Function} [spec.present] - value → whether it answers, `false` included (an empty pick or list is none)
 * @returns {Promise<*>} The landed value, or null (undefined and null in config never answer)
 */
async function resolveConfigValue(context, spec) {
  const { path, label } = spec;
  const disablePath = spec.disablePath || path;

  const parent = path.slice(0, Math.max(path.lastIndexOf('.'), 0));
  if (parent && readTriState(context.brandConfig, parent).optedOut) {
    return null;
  }

  // readTriState folds the path's own `false` into optedOut
  const { optedOut, value: current } = readTriState(context.brandConfig, path);
  const existing = optedOut ? false : current;
  if (existing === false && !spec.present) {
    return null;
  }
  if (existing !== undefined && existing !== null && (!spec.present || spec.present(existing))) {
    return existing;
  }

  if (!canPrompt(context.options)) {
    // A terminal that cannot prompt is a dry run
    const rerun = isInteractive() ? 'run manage without --dry-run' : 'run manage in a terminal';
    console.log(`    ${chalk.dim(`→ Set ${path} in config/omega.json5, or ${rerun} to answer`)}`);
    return null;
  }

  if (spec.gate !== false) {
    const action = await confirmSetup(context, {
      label,
      instructions: spec.instructions,
      disablePath,
    });
    if (action !== 'yes') {
      return null;
    }
  }

  const value = spec.choices
    ? await runSelection(context, spec)
    : await runEntry(context, spec);

  if (value === OPT_OUT) {
    landValue(context, disablePath, false);
    console.log(`    ${chalk.yellow('!')} ${label}: opted out (${disablePath}: false — delete the line to be asked again)`);
    return null;
  }

  if (value === undefined || value === null || value === '') {
    return null;
  }

  landValue(context, path, value);
  return value;
}

module.exports = {
  resolveConfigValue,
  confirmSetup,
  readTriState,
  isAuthored,
  sortChoicesForBrand,
  landValue,
};
