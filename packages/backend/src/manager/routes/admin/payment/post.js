/**
 * POST /admin/payment - Payment provider webhook
 * Admin-only endpoint to process payment events
 */
const jetpack = require('fs-jetpack');

module.exports = async ({ ctx, Manager, user, settings, analytics }) => {

  // Require authentication
  if (!user.authenticated) {
    return ctx.respond('Authentication required', { code: 401 });
  }

  // Require admin
  if (!user.roles.admin) {
    return ctx.respond('Admin required.', { code: 403 });
  }

  // Check for productId in payload
  const productId = settings?.payload?.details?.productIdGlobal;
  if (!productId) {
    return ctx.respond('No productId', { code: 400 });
  }

  const providerPath = `${Manager.cwd}/payment-providers/${productId}.js`;

  ctx.log('Loading payment provider:', providerPath);

  // Check if provider exists
  if (!jetpack.exists(providerPath)) {
    ctx.warn('Subprovider does not exist:', providerPath);
    return ctx.respond({});
  }

  // Load provider
  let provider;
  try {
    provider = new (require(providerPath));
    provider.Manager = Manager;
  } catch (e) {
    ctx.error('Subprovider failed to load:', providerPath, e);
    return ctx.respond({});
  }

  // Process payment
  const result = await provider.process(settings).catch(e => e);

  if (result instanceof Error) {
    return ctx.respond(`Payment provider @ "${providerPath}" failed: ${result}`, { code: 500 });
  }

  // Track analytics
  analytics.event('admin/payment', { productId: productId });

  return ctx.respond(result);
};
