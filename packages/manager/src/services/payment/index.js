/**
 * Payment service — reconciles the brand's payment providers to
 * payment.products: Stripe (account settings, products + prices, webhook,
 * plus manual-guidance Radar/dispute checks), PayPal (catalog products +
 * billing plans, webhook), and Chargebee (item family → items → item prices,
 * webhook). Product IDs are written back to omega.json5
 * (payment.products[id=…] — comment-preserving) and mirrored in state.
 *
 * Auth is per provider, from config + the brand .env:
 *   - Stripe:    STRIPE_SECRET_KEY
 *   - PayPal:    payment.providers.paypal.clientId + PAYPAL_CLIENT_SECRET
 *   - Chargebee: payment.providers.chargebee.site + CHARGEBEE_API_KEY
 * When an enabled provider's credentials are missing, interactive runs
 * offer the setup flow (lib/provider-setup.js — dashboard browser open,
 * public keys land in omega.json5, secrets in the brand .env); otherwise
 * the provider is skipped per-operation with a dim note. The service only
 * skips when NO provider is configured. The webhook operations
 * additionally need OMEGA_WEBHOOK_KEY.
 *
 * --provider=stripe|paypal|chargebee narrows the run to one provider's
 * operations (omega-manager's flag, unchanged).
 */
const { createServiceRunner } = require('../../lib/service-runner.js');
const { StripeAPI } = require('./lib/stripe-api.js');
const { PayPalAPI } = require('./lib/paypal-api.js');
const { ChargebeeAPI } = require('./lib/chargebee-api.js');
const { paidProducts } = require('./lib/payment-utils.js');
const { providerSetupFlow } = require('./lib/provider-setup.js');

const PROVIDERS = ['paypal', 'stripe', 'chargebee'];

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
      return { skip: true, reason: `unknown --provider "${providerFilter}" (paypal | stripe | chargebee)` };
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

    if (!stripeApi && !paypalApi && !chargebeeApi) {
      return {
        skip: true,
        reason: providerFilter
          ? `provider "${providerFilter}" not configured`
          : 'no payment provider configured (STRIPE_SECRET_KEY, paypal.clientId + PAYPAL_CLIENT_SECRET, or chargebee.site + CHARGEBEE_API_KEY)',
      };
    }

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
