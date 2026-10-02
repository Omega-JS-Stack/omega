/**
 * The ship plan:
 * what a brand's declaration says a target ships, and the ONE wording a
 * missing ship credential and a missing listing are reported in, so the manage
 * walk's `publishing` service, the desktop publish and the extension publish
 * say the same thing in the same words. @omega.js/config's platforms.js owns
 * what each format is and needs; which keys a brand still owes is its
 * missingEnvKeys for `publish`. Values are never read here, only names.
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
 * The refusal a missing ship credential earns: ONE line shape per key,
 * `<KEY> (required by <path>): <the fix>`, the same shape push-secrets prints,
 * so the two rungs of the same story read alike.
 *
 * @param {Array<{ text, label }>} missing - @omega.js/config's missingEnvKeys
 *   rows for `publish`: each names its key, the format that needs it, its label.
 * @returns {string} The message (callers throw it, or return it as an error).
 */
function shipKeyRefusal(missing) {
  const lines = missing.map(({ text, label }) => `  ${text}: `
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

module.exports = { shipPlan, shipKeyRefusal, listingManualStep, PUBLISHING_WALK };
