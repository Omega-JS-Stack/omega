/**
 * Payment service — reconciles the brand's payment processors to
 * payment.products: Stripe (account settings, products + prices, webhook,
 * plus manual-guidance Radar/dispute checks), PayPal (catalog products +
 * billing plans, webhook), and Chargebee (item family → items → item prices,
 * webhook). Product IDs are written back to omega.json5
 * (payment.products[id=…] — comment-preserving) and mirrored in state.
 *
 * Auth is per processor, from config + the brand .env:
 *   - Stripe:    STRIPE_SECRET_KEY
 *   - PayPal:    payment.processors.paypal.clientId + PAYPAL_CLIENT_SECRET
 *   - Chargebee: payment.processors.chargebee.site + CHARGEBEE_API_KEY
 * When an enabled processor's credentials are missing, interactive runs
 * offer the setup flow (lib/processor-setup.js — dashboard browser open,
 * public keys land in omega.json5, secrets in the brand .env); otherwise
 * the processor is skipped per-operation with a dim note. The service only
 * skips when NO processor is configured. The webhook operations
 * additionally need OMEGA_WEBHOOK_KEY.
 *
 * --processor=stripe|paypal|chargebee narrows the run to one processor's
 * operations (omega-manager's flag, unchanged).
 */
const { createServiceRunner } = require('../../lib/service-runner.js');
const { StripeAPI } = require('./lib/stripe-api.js');
const { PayPalAPI } = require('./lib/paypal-api.js');
const { ChargebeeAPI } = require('./lib/chargebee-api.js');
const { paidProducts } = require('./lib/payment-utils.js');
const { processorSetupFlow } = require('./lib/processor-setup.js');

const PROCESSORS = ['paypal', 'stripe', 'chargebee'];

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

    const processorFilter = context.options?.processor || null;
    if (processorFilter && !PROCESSORS.includes(processorFilter)) {
      return { skip: true, reason: `unknown --processor "${processorFilter}" (paypal | stripe | chargebee)` };
    }
    const wanted = (name) => !processorFilter || processorFilter === name;

    // Resolve each processor; when an enabled one is missing credentials,
    // interactive runs offer the setup flow (which lands them in
    // omega.json5 + the brand .env + process.env) before giving up.
    // Unconfigured ones stay null and their operations print a dim note.
    // Tests inject fake clients via context.stripeApi / paypalApi /
    // chargebeeApi (injected clients never trigger the flow).
    const processors = () => context.brandConfig.payment.processors || {};

    let stripeApi = null;
    if (wanted('stripe') && processors().stripe !== false) {
      if (!context.stripeApi && (!process.env.STRIPE_SECRET_KEY || !processors().stripe?.publishableKey)) {
        await processorSetupFlow(context, 'stripe');
      }
      if (processors().stripe !== false) {
        stripeApi = context.stripeApi
          || (process.env.STRIPE_SECRET_KEY ? new StripeAPI(process.env.STRIPE_SECRET_KEY) : null);
      }
    }

    let paypalApi = null;
    if (wanted('paypal') && processors().paypal !== false) {
      if (!context.paypalApi && (!processors().paypal?.clientId || !process.env.PAYPAL_CLIENT_SECRET)) {
        await processorSetupFlow(context, 'paypal');
      }
      const clientId = processors().paypal !== false ? processors().paypal?.clientId : null;
      paypalApi = context.paypalApi
        || (clientId && process.env.PAYPAL_CLIENT_SECRET ? new PayPalAPI(clientId, process.env.PAYPAL_CLIENT_SECRET) : null);
    }

    let chargebeeApi = null;
    if (wanted('chargebee') && processors().chargebee !== false) {
      if (!context.chargebeeApi && (!processors().chargebee?.site || !process.env.CHARGEBEE_API_KEY)) {
        await processorSetupFlow(context, 'chargebee');
      }
      const site = processors().chargebee !== false ? processors().chargebee?.site : null;
      chargebeeApi = context.chargebeeApi
        || (site && process.env.CHARGEBEE_API_KEY ? new ChargebeeAPI(site, process.env.CHARGEBEE_API_KEY) : null);
    }

    if (!stripeApi && !paypalApi && !chargebeeApi) {
      return {
        skip: true,
        reason: processorFilter
          ? `processor "${processorFilter}" not configured`
          : 'no payment processor configured (STRIPE_SECRET_KEY, paypal.clientId + PAYPAL_CLIENT_SECRET, or chargebee.site + CHARGEBEE_API_KEY)',
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

    // Narrow operations to the filtered processor (operation names are prefixed)
    let operations;
    if (processorFilter) {
      operations = context.operations.filter((op) => op.name.startsWith(processorFilter));
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
