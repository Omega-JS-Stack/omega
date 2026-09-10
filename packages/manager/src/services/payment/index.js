/**
 * Payment service — reconciles the brand's payment providers to
 * payment.products: Stripe (account settings, products + prices, webhook,
 * plus manual-guidance Radar/dispute checks), PayPal (catalog products +
 * billing plans, webhook), and Chargebee (item family → items → item prices,
 * webhook). Product IDs are written back to omega.json5
 * (payment.products[id=…] — comment-preserving) and mirrored in state.
 *
 * Coinbase Commerce (crypto, #642) reconciles NOTHING — no catalog, no webhook
 * API — so it has no operations and no client; its whole surface here is the
 * credential ask, gated on payment.providers.coinbase.enabled.
 *
 * Auth is per provider, from config + the brand .env:
 *   - Stripe:    STRIPE_SECRET_KEY
 *   - PayPal:    payment.providers.paypal.clientId + PAYPAL_CLIENT_SECRET
 *   - Chargebee: payment.providers.chargebee.site + CHARGEBEE_API_KEY
 *   - Coinbase:  COINBASE_COMMERCE_API_KEY (no public half at all)
 * When an enabled provider's credentials are missing, interactive runs
 * offer the setup flow (lib/provider-setup.js — dashboard browser open,
 * public keys land in omega.json5, secrets in the brand .env); otherwise
 * the provider is skipped per-operation with a dim note. The service only
 * skips when NO provider is configured. The webhook operations additionally
 * need OMEGA_WEBHOOK_KEY, which the setup MINTS through the shared contract
 * (it is OMEGA's own key, #635) rather than asking anyone for.
 *
 * --provider=stripe|paypal|chargebee|coinbase narrows the run to one provider's
 * operations (omega-manager's flag, unchanged).
 */
const { serviceInputSpec } = require('../../config.js');
const { createServiceRunner } = require('../../lib/service-runner.js');
const { requestServiceInput } = require('../../lib/service-input.js');
const { StripeAPI } = require('./lib/stripe-api.js');
const { PayPalAPI } = require('./lib/paypal-api.js');
const { ChargebeeAPI } = require('./lib/chargebee-api.js');
const { paidProducts } = require('./lib/payment-utils.js');
const { providerSetupFlow } = require('./lib/provider-setup.js');

const PROVIDERS = ['paypal', 'stripe', 'chargebee', 'coinbase'];

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    const payment = context.brandConfig.payment || {};

    if (payment.enabled === false) {
      return { skip: true, reason: 'payment.enabled = false' };
    }

    const url = (context.brandConfig.brand?.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!url) {
      return { skip: true, reason: 'no brand.url configured' };
    }

    if (paidProducts(context.brandConfig).length === 0) {
      return { skip: true, reason: 'no paid products in payment.products' };
    }

    const providerFilter = context.options?.provider || null;
    if (providerFilter && !PROVIDERS.includes(providerFilter)) {
      return { skip: true, reason: `unknown --provider "${providerFilter}" (paypal | stripe | chargebee | coinbase)` };
    }
    const wanted = (name) => !providerFilter || providerFilter === name;

    // Resolve each provider; when an enabled one is missing credentials,
    // interactive runs offer the setup flow (which lands them in
    // omega.json5 + the brand .env + process.env) before giving up.
    // Unconfigured ones stay null and their operations print a dim note.
    // Tests inject fake clients via context.stripeApi / paypalApi /
    // chargebeeApi (injected clients never trigger the flow).
    const providers = () => context.brandConfig.payment.providers || {};

    let stripeApi = null;
    if (wanted('stripe') && providers().stripe !== false) {
      if (!context.stripeApi && (!process.env.STRIPE_SECRET_KEY || !providers().stripe?.publishableKey)) {
        await providerSetupFlow(context, 'stripe');
      }
      if (providers().stripe !== false) {
        stripeApi = context.stripeApi
          || (process.env.STRIPE_SECRET_KEY ? new StripeAPI(process.env.STRIPE_SECRET_KEY) : null);
      }
    }

    let paypalApi = null;
    if (wanted('paypal') && providers().paypal !== false) {
      if (!context.paypalApi && (!providers().paypal?.clientId || !process.env.PAYPAL_CLIENT_SECRET)) {
        await providerSetupFlow(context, 'paypal');
      }
      const clientId = providers().paypal !== false ? providers().paypal?.clientId : null;
      paypalApi = context.paypalApi
        || (clientId && process.env.PAYPAL_CLIENT_SECRET ? new PayPalAPI(clientId, process.env.PAYPAL_CLIENT_SECRET) : null);
    }

    let chargebeeApi = null;
    if (wanted('chargebee') && providers().chargebee !== false) {
      if (!context.chargebeeApi && (!providers().chargebee?.site || !process.env.CHARGEBEE_API_KEY)) {
        await providerSetupFlow(context, 'chargebee');
      }
      const site = providers().chargebee !== false ? providers().chargebee?.site : null;
      chargebeeApi = context.chargebeeApi
        || (site && process.env.CHARGEBEE_API_KEY ? new ChargebeeAPI(site, process.env.CHARGEBEE_API_KEY) : null);
    }

    // Coinbase Commerce (crypto, [#642](https://github.com/Omega-JS-Stack/omega/issues/642))
    // has NO operations and therefore no API client: a charge is created ad hoc
    // at checkout, there is no product catalog to reconcile, and the webhook
    // endpoint is set by hand in its dashboard (the API manages none). Its whole
    // manage-time surface is the CREDENTIAL, so the shared setup contract asks
    // for it right here (#608) and nothing below reads it.
    //
    // Gated on the provider being switched ON, because `enabled` IS the whole
    // switch for this one (there is no public datum to gate on — the API key is
    // the entire credential): a brand that never turned crypto on is never asked
    // for a key it has no use for.
    if (wanted('coinbase') && providers().coinbase?.enabled === true && !process.env.COINBASE_COMMERCE_API_KEY) {
      await providerSetupFlow(context, 'coinbase');
    }

    if (!stripeApi && !paypalApi && !chargebeeApi) {
      return {
        skip: true,
        reason: providerFilter === 'coinbase'
          // Asked for above and that is all there is: crypto reconciles nothing
          ? 'coinbase has nothing to reconcile — Coinbase Commerce has no product catalog and no webhook API; its key is the whole surface'
          : providerFilter
            ? `provider "${providerFilter}" not configured`
            : 'no payment provider configured (STRIPE_SECRET_KEY, paypal.clientId + PAYPAL_CLIENT_SECRET, or chargebee.site + CHARGEBEE_API_KEY)',
      };
    }

    // The webhook key is OMEGA's OWN (#635): the shared helper mints it in
    // place when this service runs before the workspace one did, so every
    // webhook operation below can read it unconditionally.
    const gate = await requestServiceInput(context, serviceInputSpec('payment', { names: ['OMEGA_WEBHOOK_KEY'] }));
    if (gate) return gate;

    // Stripe account ID → state (dashboard deep-links for the radar/disputes
    // guidance; omega-manager's bookmark service reads it too). Non-fatal.
    let serviceData;
    if (stripeApi) {
      try {
        const account = await stripeApi.getAccount();
        serviceData = { stripeAccountId: account.id };
      } catch {
        // Deep-links fall back to the account-less dashboard URLs
      }
    }

    // Narrow operations to the filtered provider (operation names are prefixed)
    let operations;
    if (providerFilter) {
      operations = context.operations.filter((op) => op.name.startsWith(providerFilter));
    }

    return {
      stripeApi,
      paypalApi,
      chargebeeApi,
      domain: url,
      serviceData,
      operations,
    };
  },
});
