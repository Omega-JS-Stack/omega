// The store listing ids
// ([#893](https://github.com/Omega-JS-Stack/omega/issues/893)): the ONE home
// of the identifier each browser store knows this extension by.
//
// An item id is PUBLIC by design: it is the id in the listing URL every user
// sees, so it belongs in config/omega.json5 beside the listing it identifies
// (`targets.<name>.listings.<browser>.id`) and never in `.env`, which carries
// secrets. The `.env` names it used to live under are retired keys now, and a
// brand still declaring one fails the env load (@omega.js/config's env-retired.js).
//
// Every reader takes the RESOLVED config (the target layer already merged onto
// the shared sections, so `listings` sits at the top level): the package task,
// which writes the firefox id into the manifest as the gecko id, the publish
// task, which addresses each store with it, and the local scaffold, which pins
// the derived firefox id into the brand config.

/**
 * A browser's store listing id from the resolved config.
 *
 * @param {object} config - The resolved config (Manager.getConfig()).
 * @param {string} browser - `chrome`, `firefox` or `edge`.
 * @returns {string} The id, or '' when the brand has not declared one.
 */
function listingId(config, browser) {
  const listing = config && config.listings && config.listings[browser];

  return (listing && listing.id) || '';
}

/**
 * The Firefox add-on id a brand's own facts name, when it has declared none.
 *
 * The firefox id is OURS, not the store's: AMO adopts whatever gecko id the
 * packaged manifest carries as the add-on guid, so the value is deterministic
 * per brand and knowable before the first upload. Which is why it has ONE
 * derivation ([#893](https://github.com/Omega-JS-Stack/omega/issues/893)), read
 * by the package task (the gecko id it writes into the manifest) and by the
 * local scaffold (which pins it into config/omega.json5 so it stays stable
 * after that upload, `brand.url` being free to change afterwards).
 *
 * @param {object} config - The resolved config (Manager.getConfig()).
 * @returns {string} e.g. `extension@example.com`, or '' with no brand facts at all.
 */
function deriveFirefoxId(config) {
  let host = null;
  try { host = new URL(config?.brand?.url).hostname; } catch (e) { /* no brand url: fall through to brand.id */ }
  host = host || (config?.brand?.id ? `${config.brand.id}.extension` : null);

  return host ? `extension@${host}` : '';
}

/**
 * The config path a listing id is declared at, for a fix line a human can act on.
 *
 * @param {string} target - This extension target's NAME (its folder under targets/).
 * @param {string} browser - `chrome`, `firefox` or `edge`.
 * @returns {string} e.g. `targets.extension.listings.chrome.id`.
 */
function listingConfigPath(target, browser) {
  return `targets.${target}.listings.${browser}.id`;
}

module.exports = { listingId, deriveFirefoxId, listingConfigPath };
