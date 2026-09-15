/**
 * Config-DERIVED values, handed to consumer code on the runtime config object
 * as `config.resolved.*` ([#290](https://github.com/Omega-JS-Stack/omega/issues/290)).
 *
 * A brand target cannot require @omega.js/config — it is a PRIVATE workspace
 * package, vendored into each framework's dist at prepare time — so a brand
 * that needed a derived value at runtime had to re-implement the derivation in
 * its own target (the giftly sync-gifts cron did exactly that), and every copy
 * drifts from the real merge rules. The framework calls the recipe; brands read
 * the finished value off the config object they already receive.
 *
 * Every derivation itself stays in @omega.js/config — ONE implementation. This
 * module only names the group and the values that belong in it; new derived
 * values join here as real brand needs surface.
 */
const { sourceRepo } = require('@omega.js/config');

/**
 * Build the `resolved` group for a composed config.
 *
 * @param {object} config - The composed omega config (brand + backend target layers).
 * @returns {{ github: { owner: string, name: string, slug: string }|null }} Derived values; `github` is null when the config names no org (or no brand id).
 */
function resolvedConfigValues(config) {
  return {
    // The brand's SOURCE repo, `<brand.id>-omega` under the one `repo.org`
    // block ([#883](https://github.com/Omega-JS-Stack/omega/issues/883)): where
    // the site's content lives, so it is the repo the CMS routes commit to.
    // `.slug` is the "owner/name" every GitHub API call wants, `.owner`/`.name`
    // the same answer split. Null when the config names no org: half an address
    // addresses nothing, and the routes' guards say so.
    github: sourceRepo(config),
  };
}

module.exports = { resolvedConfigValues };
