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
const { input, select, isInteractive } = require('@omega.js/devkit/prompt');
const { openBrowser } = require('@omega.js/devkit/flows');
const { writeBrandConfig } = require('./config-write.js');

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
 * Set a dot-notation path on an object, creating intermediate objects.
 */
function setAtPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let node = obj;
  for (const key of keys) {
    if (typeof node[key] !== 'object' || node[key] === null) {
      node[key] = {};
    }
    node = node[key];
  }
  node[last] = value;
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
 * Entry flow: open the dashboard and take a pasted-back value.
 */
async function runEntry(context, spec) {
  const { url, message, validate } = spec.entry;

  if (url) {
    await openBrowser(url);
  }

  const value = await input({
    message,
    validate: validate || ((val) => (val?.trim() ? true : 'Required')),
  });

  return value.trim();
}

/**
 * Resolve a required config value interactively and land it in omega.json5.
 *
 * Tri-state (#33): returns the value already in config if present
 * (idempotent); returns null WITHOUT prompting when the value — or any
 * ancestor section — is `false` (the user opted out); returns null without
 * prompting when non-interactive or dry-run, and when the user skips or
 * disables — callers keep their existing clean-skip handling.
 *
 * @param {Object} context - Service context (brandConfig, brandRoot, options)
 * @param {Object} spec
 * @param {string} spec.path - omega.json5 dot path the value lands at
 * @param {string} spec.label - Human name ("GA4 property", "Chatsy chat agent")
 * @param {string[]} [spec.instructions] - Numbered guidance lines shown before the gate
 * @param {string} [spec.message] - Selection prompt (default "Select <label>:")
 * @param {Function} [spec.choices] - async (context) → items (selection mode)
 * @param {Function} [spec.getName] - item → display name
 * @param {Function} [spec.getValue] - item → value
 * @param {*} [spec.defaultValue] - Sorts its item to the top of the list
 * @param {Object} [spec.createNew] - { label, handler } (API) or { label, url, refreshChoices } (browser)
 * @param {Object} [spec.entry] - { url, message, validate } (paste-back mode)
 * @param {Object} [spec.optOut] - { label } inline selection choice → lands `false`
 * @param {string} [spec.disablePath] - Where Disable/opt-out writes `false`
 *   (defaults to spec.path — section paths let one opt-out cover a service)
 * @param {boolean} [spec.gate] - false = skip the Yes/Skip/Disable gate (a
 *   chained value whose flow the user already said Yes to)
 * @returns {Promise<*>} - The landed value, or null
 */
async function resolveConfigValue(context, spec) {
  const { path, label } = spec;
  const disablePath = spec.disablePath || path;

  const { optedOut, value: existing } = readTriState(context.brandConfig, path);
  if (optedOut) {
    return null;
  }
  if (existing !== undefined && existing !== null) {
    return existing;
  }

  if (!isInteractive() || context.options?.dryRun) {
    return null;
  }

  if (spec.gate !== false) {
    const brandName = context.brandConfig.brand?.name || context.brandId;
    console.log(`    ${chalk.yellow('!')} ${label} not configured for ${chalk.cyan(brandName)}`);
    for (const line of spec.instructions || []) {
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

    if (action === 'skip') {
      return null;
    }

    if (action === 'disable') {
      landValue(context, disablePath, false);
      console.log(`    ${chalk.yellow('!')} ${label} disabled in omega.json5 (${disablePath}: false — delete the line to be asked again)`);
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
  sortChoicesForBrand,
  setAtPath,
};
