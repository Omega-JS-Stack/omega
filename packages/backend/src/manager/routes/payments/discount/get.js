/**
 * GET /payments/discount?code=FLASH20
 * Validates a discount code and returns the discount details
 */
const discountCodes = require('../../../libraries/payment/discount-codes.js');

module.exports = async ({ ctx, user, settings }) => {
  const result = discountCodes.validate(settings.code, user.authenticated ? user : undefined);

  ctx.log(`Discount validation: code=${result.code}, valid=${result.valid}`);

  if (!result.valid) {
    return ctx.respond({ valid: false }, { code: 200 });
  }

  return ctx.respond({
    valid: true,
    code: result.code,
    percent: result.percent,
    duration: result.duration,
  });
};
