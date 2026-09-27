// The store listing ids: the ONE home of the id each browser store knows this
// extension by, public by design, so `targets.<name>.listings.<browser>.id` in
// config and never `.env` (`omega migrate` names an old `.env` line). Every
// reader takes the RESOLVED config, where `listings` sits at the top level: the
// package task (the firefox gecko id), the publish task, the local scaffold.

/**
 * A browser's store listing id from the resolved config.
 *
 * @param {object} config - The resolved config (build.getConfig()).
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
 * @param {object} config - The resolved config (build.getConfig()).
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
