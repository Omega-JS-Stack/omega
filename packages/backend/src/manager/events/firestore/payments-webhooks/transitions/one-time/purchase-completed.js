/**
 * Transition: purchase-completed
 * Triggered when a one-time payment checkout completes (checkout.session.completed with mode=payment)
 */
const { sendOrderEmail, formatDate } = require('../send-email.js');

module.exports = async function ({ before, after, order, uid, userDoc, ctx }) {
  const brandName = ctx.Manager.config.brand?.name || '';
  const productName = after.product?.name || '';

  // Pre-compute discount values for the email template
  const price = parseFloat(after.payment?.price || 0);
  const discount = order.discount;
  const hasPromoDiscount = discount?.valid === true && discount?.percent > 0;

  ctx.log(`Transition [one-time/purchase-completed]: uid=${uid}, resourceId=${after.payment?.resourceId}, discount=${hasPromoDiscount ? discount.code : 'none'}`);

  sendOrderEmail({
    template: 'order',
    subject: `Your ${brandName} ${productName} order #${order?.id || ''}`,
    categories: ['order/confirmation'],
    userDoc,
    ctx,
    data: {
      content: { event: 'confirmation',
        ...order,
        _computed: {
          date: formatDate(new Date().toISOString()),
          ...(hasPromoDiscount && {
            promoCode: discount.code,
            promoPercent: discount.percent,
            promoSavings: (price * discount.percent / 100).toFixed(2),
          }),
          totalToday: hasPromoDiscount
            ? (price - (price * discount.percent / 100)).toFixed(2)
            : price.toFixed(2),
        },
      },
    },
  });
};
