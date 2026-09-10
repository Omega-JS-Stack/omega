/**
 * WHICH targets a brand-root fan-out runs over, in WHICH order, with WHICH
 * flags — the two pure helpers every fan-out shares.
 *
 * They started in commands/deploy.js because deploy was the first fan-out;
 * `omega update` and the build/clean fan-out (lib/verb-fanout.js) then imported
 * them from there, which put a lib file under a command. They live HERE, one
 * home, and deploy.js re-exports them for its own callers.
 */

// Deploy order — backend's API goes live before the surfaces that call it, and
// every other fan-out reuses it as the dependency order. A custom target (#603)
// has no rank, so it lands after every framework one.
const DEPLOY_ORDER = ['backend', 'web', 'extension', 'desktop', 'mobile'];

// The flag that spells the target picker, on every brand-root verb (#780).
// ONE name, one constant: commands/test.js reads this very export, so
// `omega test --target=` and `omega deploy --target=` can never drift.
const PICKER_FLAG = 'target';

// The pickers `--target=` replaced (#780). Removed, never aliased (no legacy
// accommodations); `--only` was the collision that forced the rename, since
// `firebase deploy --only hosting` picks a SERVICE, not a brand target.
const RETIRED_PICKERS = ['only', 'except'];

// Brand-level flags consumed by the fan-out — everything else forwards to the
// targets. `_`/`$0` are yargs bookkeeping; continue-on-error is the
// manage-parity bail switch; --target is the target picker. A caller adds
// the flags IT consumes (verb-fanout's --dry-run) per call.
const CONSUMED_KEYS = new Set(['_', '$0', PICKER_FLAG, 'continue-on-error', 'continueOnError']);

/**
 * Refuse a retired picker (#780), loudly: silently ignoring `--only` would run
 * the whole brand when a subset was asked for, and aliasing it would keep the
 * firebase collision alive. A `refusal` error prints its message alone (the
 * cli-router keeps stacks for bugs), so the one sentence IS the output.
 *
 * @param {object} [options] - the parsed CLI options
 * @throws {Error} when --only or --except was passed
 */
function assertPickerFlags(options = {}) {
  const used = RETIRED_PICKERS.filter((flag) => options[flag] !== undefined);
  if (used.length === 0) return;

  const error = new Error(`${used.map((flag) => `--${flag}`).join(' and ')} ${used.length > 1 ? 'are' : 'is'} retired: pick targets with --${PICKER_FLAG}=<target|targetDir>[,…] instead (firebase's own --only hosting runs from targets/backend).`);
  error.refusal = true;
  throw error;
}

/**
 * Refuse a picker token that names nothing (#780). A typo can never quietly
 * narrow the set: on a publishing verb that would under-deploy, and on any
 * verb a green exit would stand for work that never ran. The whole run stops,
 * naming the token and what the brand actually has.
 *
 * The MATCHING is the caller's (a fan-out matches key-or-dir, `omega dev`
 * matches the targets that have a dev leg); the refusal is one implementation.
 *
 * @param {string[]} unknown - the tokens that matched nothing
 * @param {string[]} known - the names a token could have spelled
 * @throws {Error} when any token matched nothing
 */
function assertKnownTargets(unknown, known) {
  if (unknown.length === 0) return;

  const error = new Error(`Unknown --${PICKER_FLAG} ${unknown.length > 1 ? 'tokens' : 'token'} ${unknown.map((token) => `"${token}"`).join(', ')}: this brand's targets are ${known.join(', ')}. Nothing ran.`);
  error.refusal = true;
  throw error;
}

/**
 * A comma list of target tokens, trimmed and emptied of blanks.
 *
 * @param {string} [value] - the raw flag value
 * @returns {string[]}
 */
function parseTargetTokens(value) {
  return String(value || '').split(',').map((part) => part.trim()).filter(Boolean);
}

/**
 * Does this target answer to this token? A target is named by its KEY ('web')
 * or by its dir name ('website') — the ONE matcher every brand-root picker
 * uses, so `--target=` cannot mean one thing on `deploy` and another on `test`.
 *
 * @param {{ target: string|null, name: string }} entry - a discovered target
 * @param {string} token - the picker token
 * @returns {boolean}
 */
function targetMatches(entry, token) {
  return entry.target === token || entry.name === token;
}

/**
 * Pure target selection — which targets run for a given picker, in order.
 * Picker tokens match a target's key ('web') or its dir name ('website'); no
 * picker means every target.
 *
 * @param {object} input
 * @param {Array<{ name: string, target: string|null }>} input.targets - the target-mapped target dirs
 * @param {string} [input.target] - the --target= comma list: the exact set to run
 * @returns {{ selected: Array }}
 * @throws {Error} when a token matches no target
 */
function selectTargets({ targets, target }) {
  const tokens = parseTargetTokens(target);
  assertKnownTargets(
    tokens.filter((token) => !targets.some((entry) => targetMatches(entry, token))),
    targets.map((entry) => entry.target || entry.name),
  );

  const selected = targets
    .filter((entry) => tokens.length === 0 || tokens.some((token) => targetMatches(entry, token)))
    .sort((a, b) => {
      const rank = (entry) => {
        const index = DEPLOY_ORDER.indexOf(entry.target);
        return index === -1 ? DEPLOY_ORDER.length : index;
      };
      return rank(a) - rank(b);
    });

  return { selected };
}

/**
 * Rebuild forwardable CLI flags from the yargs-parsed options: brand-level
 * keys are consumed, camelCase twins of kebab-case flags are skipped (yargs
 * mints both), booleans re-spell as --flag/--no-flag, values as --flag=value.
 *
 * @param {object} options - the yargs-parsed options
 * @param {string[]} [alsoConsumed] - extra keys THIS fan-out consumes (both spellings)
 * @returns {string[]}
 */
function buildForwardedFlags(options, alsoConsumed = []) {
  const flags = [];
  const consumed = alsoConsumed.length ? new Set([...CONSUMED_KEYS, ...alsoConsumed]) : CONSUMED_KEYS;

  for (const [key, value] of Object.entries(options)) {
    if (consumed.has(key)) continue;
    if (value === undefined || value === null) continue;
    // Skip yargs' camelCase duplicate when the kebab-case original exists
    if (/[A-Z]/.test(key) && key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`) in options) continue;

    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      if (entry === true) flags.push(`--${key}`);
      else if (entry === false) flags.push(`--no-${key}`);
      else flags.push(`--${key}=${entry}`);
    }
  }

  return flags;
}

module.exports = { DEPLOY_ORDER, PICKER_FLAG, CONSUMED_KEYS, assertPickerFlags, assertKnownTargets, selectTargets, buildForwardedFlags, parseTargetTokens, targetMatches };
