/**
 * Config-DERIVED values, handed to consumer code on the runtime config object
 * as `config.resolved.*` ([#290](https://github.com/Omega-JS-Stack/omega/issues/290)).
 *
 * A brand app cannot require @omega.js/config — it is a PRIVATE workspace
 * package, vendored into each framework's dist at prepare time — so a brand
 * that needed a derived value at runtime had to re-implement the derivation in
 * its own app (the giftly sync-gifts cron did exactly that), and every copy
 * drifts from the real merge rules. The framework calls the recipe; brands read
 * the finished value off the config object they already receive.
 *
 * Every derivation itself stays in @omega.js/config — ONE implementation. This
 * module only names the group and the values that belong in it; new derived
 * values join here as real brand needs surface.
 */
const { brandRepo } = require('@omega.js/config');

/**
 * Build the `resolved` group for a composed config.
 *
 * @param {object} config - The composed omega config (brand + backend target layers).
 * @returns {{ github: { owner: string, name: string, repo: string } }} Derived values; each field is '' when the config cannot resolve it.
 */
function resolvedConfigValues(config) {
  return {
    // The brand's GitHub repo: `.repo` is the "owner/name" slug every GitHub API
    // call wants, `.owner`/`.name` the same answer split. Resolves
    // `repo.providers.github` overlaid by the backend target's own `github`
    // block, which wins (the CMS/content repo override).
    github: brandRepo(config),
  };
}

module.exports = { resolvedConfigValues };
