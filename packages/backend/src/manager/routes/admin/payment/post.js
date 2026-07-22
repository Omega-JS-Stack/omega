/**
 * POST /admin/payment - Payment processor webhook
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

  const processorPath = `${Manager.cwd}/payment-processors/${productId}.js`;

  ctx.log('Loading payment processor:', processorPath);

  // Check if processor exists
  if (!jetpack.exists(processorPath)) {
    ctx.warn('Subprocessor does not exist:', processorPath);
    return ctx.respond({});
  }

  // Load processor
  let processor;
  try {
    processor = new (require(processorPath));
    processor.Manager = Manager;
  } catch (e) {
    ctx.error('Subprocessor failed to load:', processorPath, e);
    return ctx.respond({});
  }

  // Process payment
  const result = await processor.process(settings).catch(e => e);

  if (result instanceof Error) {
    return ctx.respond(`Payment processor @ "${processorPath}" failed: ${result}`, { code: 500 });
  }

  // Track analytics
  analytics.event('admin/payment', { productId: productId });

  return ctx.respond(result);
};
