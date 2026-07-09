/**
 * Payment service — reconciles the brand's payment processors to
 * payment.products: Stripe (account settings, products + prices, webhook,
 * plus manual-guidance Radar/dispute checks), PayPal (catalog products +
 * billing plans, webhook), and Chargebee (item family → items → item prices,
 * webhook). Product IDs land in state until the config-serializer port can
 * write them back to omega.json5.
 *
 * Auth is per processor, non-interactively, from config + the brand .env:
 *   - Stripe:    STRIPE_SECRET_KEY
 *   - PayPal:    payment.processors.paypal.clientId + PAYPAL_CLIENT_SECRET
 *   - Chargebee: payment.processors.chargebee.site + CHARGEBEE_API_KEY
 * A processor without credentials (or set to `false` in config) is skipped
 * per-operation; the service only skips when NO processor is configured.
 * The webhook operations additionally need BACKEND_MANAGER_WEBHOOK_KEY.
 * omega-manager's interactive account setup (browser flow + .env secrets
 * writeback) rides the onboarding port.
 *
 * --processor=stripe|paypal|chargebee narrows the run to one processor's
 * operations (omega-manager's flag, unchanged).
 */
const { createServiceRunner } = require('../../lib/service-runner.js');
const { StripeAPI } = require('./lib/stripe-api.js');
const { PayPalAPI } = require('./lib/paypal-api.js');
const { ChargebeeAPI } = require('./lib/chargebee-api.js');
const { paidProducts } = require('./lib/payment-utils.js');

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

    // Resolve each processor non-interactively; unconfigured ones stay null
    // and their operations print a dim note. Tests inject fake clients via
    // context.stripeApi / paypalApi / chargebeeApi.
    const processors = payment.processors || {};

    let stripeApi = null;
    if (wanted('stripe') && processors.stripe !== false) {
      stripeApi = context.stripeApi
        || (process.env.STRIPE_SECRET_KEY ? new StripeAPI(process.env.STRIPE_SECRET_KEY) : null);
    }

    let paypalApi = null;
    if (wanted('paypal') && processors.paypal !== false) {
      const clientId = processors.paypal?.clientId;
      paypalApi = context.paypalApi
        || (clientId && process.env.PAYPAL_CLIENT_SECRET ? new PayPalAPI(clientId, process.env.PAYPAL_CLIENT_SECRET) : null);
    }

    let chargebeeApi = null;
    if (wanted('chargebee') && processors.chargebee !== false) {
      const site = processors.chargebee?.site;
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
