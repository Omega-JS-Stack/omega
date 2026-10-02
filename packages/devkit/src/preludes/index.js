/**
 * runPreludes: the BOOT PRELUDE list every verb but a read-only one passes through.
 * A prelude is CHEAP, NON-INTERACTIVE and idempotent (it runs again on every
 * re-entry); one that stops the run THROWS one line of why. The contract:
 * docs/devkit/index.md, Boot preludes.
 */

const { isReadOnlyVerb } = require('../verbs.js');

// The list. Order is the boot order.
const PRELUDES = [
  require('./origin-heal.js'),
  require('./docs-sync.js'),
];

/**
 * The verb a prelude list filters on: the first positional of the invocation.
 * A flag there (`--version`) is no verb: the CLI is about to run its default
 * command, which only an `'all'` prelude covers.
 *
 * @param {string} [verb] - The raw first argument.
 * @returns {string|null} The verb, or null when the invocation names none.
 */
function normalizeVerb(verb) {
  return typeof verb === 'string' && verb.length > 0 && !verb.startsWith('-') ? verb : null;
}

/**
 * Does this prelude target the verb about to run?
 *
 * @param {{ name: string, verbs: string|string[] }} prelude - The prelude.
 * @param {string|null} verb - The normalized verb.
 * @returns {boolean}
 * @throws {Error} When the prelude declares no usable `verbs`. A list entry
 *   nobody can target is a programmer error, and a silent skip would make it
 *   look like a prelude that simply never applies.
 */
function targetsVerb(prelude, verb) {
  const { verbs } = prelude;
  if (verbs === 'all') return true;

  const list = typeof verbs === 'string' ? [verbs] : verbs;
  if (!Array.isArray(list) || list.length === 0 || list.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Boot prelude "${prelude.name}" declares no verbs: \`verbs\` is 'all', one verb name, or a list of verb names.`);
  }

  return verb !== null && list.includes(verb);
}

/**
 * Run every prelude the verb selects, in list order.
 *
 * @param {object} [options]
 * @param {string} [options.verb] - The verb about to run (the CLI's first positional).
 * @param {string} [options.targetDir] - The invocation's directory (default: cwd).
 * @param {string|null} [options.brandRoot] - The brand root; resolved from `targetDir` when absent.
 * @param {object} [options.config] - The composed omega config, when the caller already has it.
 * @param {Array<{ name: string, verbs: string|string[], run: function }>} [options.preludes] - The list (default: PRELUDES).
 * @returns {{ ran: string[] }} The preludes that ran, in the order they ran.
 */
function runPreludes(options = {}) {
  const preludes = options.preludes || PRELUDES;
  const verb = normalizeVerb(options.verb);
  // A verb the verb table marks readOnly leaves every file as it was, and a prelude may write or print
  if (isReadOnlyVerb(verb)) return { ran: [] };
  const targetDir = options.targetDir || process.cwd();
  const brandRoot = options.brandRoot === undefined ? resolveBrandRoot(targetDir) : options.brandRoot;

  // Filtering first, and over the WHOLE list: a malformed `verbs` is raised
  // before any prelude has run, not halfway through the boot.
  const selected = preludes.filter((prelude) => targetsVerb(prelude, verb));
  const ran = [];

  for (const prelude of selected) {
    try {
      prelude.run({ verb, brandRoot, targetDir, config: options.config });
    } catch (error) {
      console.error(`omega: ${error.message}`);
      process.exit(1);
    }
    ran.push(prelude.name);
  }

  return { ran };
}

/**
 * The brand root of an invocation, or null outside a brand (this monorepo's own
 * packages, a fresh directory). Required lazily: `@omega.js/config` is loaded by
 * most verbs anyway, and a boot that resolves nothing should not pay for it.
 *
 * @param {string} targetDir - The invocation's directory.
 * @returns {string|null}
 */
function resolveBrandRoot(targetDir) {
  return require('@omega.js/config').resolveBrandRoot(targetDir);
}

module.exports = {
  runPreludes,
  PRELUDES,
};
