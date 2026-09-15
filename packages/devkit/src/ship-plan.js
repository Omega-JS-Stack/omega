/**
 * The ship plan ([#867](https://github.com/Omega-JS-Stack/omega/issues/867)):
 * what a brand's declaration says a target ships, what each shipped format is
 * still missing, and the ONE wording both are reported in.
 *
 * @omega.js/config's platforms.js owns WHAT each format is and needs (the
 * format table). This owns the two questions every lane asks of that table and
 * the sentences the answers are printed in, so its three readers say the same
 * thing in the same words:
 *
 *   - the manage walk's `publishing` service, which collects what is missing;
 *   - the desktop publish, which refuses before it builds;
 *   - the extension publish, which refuses on a missing credential and prints
 *     the manual step for a listing only a human can create.
 *
 * Values are never read here, only NAMES: whether a key has a value is the
 * whole question, and an empty string is absent (the .env cascade's own rule).
 */

const { enabledFormats, formatKeys, FORMATS } = require('@omega.js/config');

// The ONE walk that collects every ship credential. Named in each refusal, so
// the fix is a command away instead of a hunt through the env schema.
const PUBLISHING_WALK = 'omega manage --service publishing';

/**
 * Everything a target ships, each entry carrying what it needs.
 *
 * @param {object} config - A resolved target config (the declaration is read
 *   at `config.platforms`, which is where `targets.<name>.platforms` resolves).
 * @param {string} target - Target type ('desktop' | 'extension').
 * @returns {Array<object>} In offer order: `{ platform, format, options, kind,
 *   ext, label, console, path, requires, listing }`. `path` is the declaration
 *   that enabled it, `requires` is narrowed to THIS brand, and `listing` names
 *   the config paths the format cannot ship without.
 */
function shipPlan(config, target) {
  return enabledFormats(config, target).map((entry) => {
    const spec = FORMATS[target][entry.platform][entry.format];
    const { requires, listing } = formatKeys(target, entry.platform, entry.format, config);

    return {
      ...entry,
      kind: spec.kind,
      ...(spec.ext ? { ext: spec.ext } : {}),
      ...(spec.label ? { label: spec.label } : {}),
      ...(spec.console ? { console: spec.console } : {}),
      path: `platforms.${entry.platform}.formats.${entry.format}`,
      requires,
      listing,
    };
  });
}

/**
 * The keys a plan needs that the environment does not answer.
 *
 * @param {Array<object>} plan - A shipPlan.
 * @param {object} [env] - Env map (default: process.env).
 * @returns {Array<{ key: string, path: string, label: string }>} One entry per
 *   empty key, in declaration order; `path` is what requires it.
 */
function missingShipKeys(plan, env) {
  const values = env || process.env;
  const missing = [];

  for (const entry of plan) {
    for (const key of entry.requires) {
      if (values[key]) continue;
      missing.push({ key, path: entry.path, label: entry.label || entry.format });
    }
  }

  return missing;
}

/**
 * The refusal a missing ship credential earns: ONE line shape per key,
 * `<KEY> (required by <path>): <the fix>`, the same shape push-secrets prints
 * ([#891](https://github.com/Omega-JS-Stack/omega/issues/891)), so the two
 * rungs of the same story read alike.
 *
 * @param {Array<{ key, path, label }>} missing - missingShipKeys' return.
 * @returns {string} The message (callers throw it, or return it as an error).
 */
function shipKeyRefusal(missing) {
  const lines = missing.map(({ key, path, label }) => `  ${key} (required by ${path}): `
    + `${label} cannot publish without it. Run \`${PUBLISHING_WALK}\` (it asks for the key and writes the brand .env), then re-run.`);

  return `${missing.length} ship credential(s) this brand's declaration requires are empty in the .env cascade (company/brand/target).\n${lines.join('\n')}`;
}

/**
 * The step a missing listing id leaves a human. The store assigns the id when
 * somebody creates the listing, so no lane can mint one: the publish attaches
 * the artifact to the release and prints this, and the walk prints it when it
 * had nobody to ask.
 *
 * @param {object} store
 * @param {string} store.label - The store's name ('Chrome Web Store').
 * @param {string} store.console - The page the listing is created on.
 * @param {string} store.path - The brand-config path the id lands at.
 * @param {string} [store.asset] - The release asset to upload, when a lane has one.
 * @returns {string} One line.
 */
function listingManualStep({ label, console: consoleUrl, path, asset }) {
  const upload = asset ? `, upload ${asset} from the release` : '';

  return `${label} has no listing id yet: create the listing at ${consoleUrl}${upload}, then set ${path} in config/omega.json5 and re-run.`;
}

module.exports = { shipPlan, missingShipKeys, shipKeyRefusal, listingManualStep, PUBLISHING_WALK };
