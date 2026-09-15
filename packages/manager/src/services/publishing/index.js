/**
 * Publishing service ([#867](https://github.com/Omega-JS-Stack/omega/issues/867)):
 * every credential and id a brand needs before it can SHIP, collected at setup
 * time instead of discovered at release time.
 *
 * It provisions nothing: no store has an API that creates a listing, and no
 * signing vendor mints a credential for us. What it owns is the ask, derived
 * from the brand's own declaration (`targets.<name>.platforms.<platform>.formats`)
 * through @omega.js/config's format table:
 *
 *   - the developer KEYS a shipped format cannot ship without (the Chrome,
 *     Firefox and Edge store credentials, SNAPCRAFT_STORE_CREDENTIALS, the
 *     Windows signing set of the configured strategy). They live in the brand
 *     `.env`, asked through the shared setup contract with the env schema's
 *     label, mint page and hint (lib/service-input.js);
 *   - the per-listing IDS a store assigns when a human creates the listing
 *     (`targets.<name>.listings.<browser>.id`). They are config, never `.env`
 *     ([#893](https://github.com/Omega-JS-Stack/omega/issues/893)), asked
 *     through the config flow with a "not yet" skip.
 *
 * `certificates` keeps the APPLE material: one Apple identity signs every mac
 * format a company ships, so it belongs to the account, not to a format.
 *
 * A run that cannot ask (CI, a dry run, a piped boot) never prompts and never
 * quietly steps aside either: a shipped store with no credential is a publish
 * that dies on a runner, so the `keys` operation FAILS naming the key and this
 * walk. A listing id is the one thing no lane can produce, so a missing one is
 * warned with the manual step the publish prints too.
 */
const { serviceInputSpec } = require('../../config.js');
const { createServiceRunner } = require('../../lib/service-runner.js');
const { requestServiceInput } = require('../../lib/service-input.js');
const { canPrompt } = require('../../lib/run-gates.js');
const { shipTargets } = require('./lib/ship-list.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const config = context.brandConfig.publishing;

    if (config === false || config?.enabled === false) {
      return { skip: true, reason: 'publishing.enabled = false' };
    }

    // Nothing else ships an artifact a human installs: web and backend deploy.
    const shipping = shipTargets(context.brandConfig);
    if (shipping.length === 0) {
      return { skip: true, reason: 'no desktop or extension target' };
    }

    // The gate runs only where it can COLLECT. A headless run falls through to
    // the operations below on purpose: they are what turn a missing ship
    // credential into the loud refusal, and stepping aside here would hide it.
    if (canPrompt(context.options)) {
      const gate = await requestServiceInput(context, serviceInputSpec('publishing'));
      if (gate) {
        return gate;
      }
    }

    return { shipping };
  },
});
