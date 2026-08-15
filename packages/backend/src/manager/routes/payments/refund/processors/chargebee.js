/**
 * Chargebee refund processor
 * Issues a refund for the latest invoice and cancels the subscription immediately.
 *
 * Refund amount:
 * - Full refund if the last payment was ≤7 days ago
 * - Prorated refund (based on days remaining in billing period) if >7 days ago
 *
 * Chargebee refunds are issued on invoices via POST /invoices/{id}/refund.
 * After refunding, the subscription is cancelled immediately.
 *
 * A one-time purchase is its own non-recurring invoice, refunded in full.
 */
const { FULL_REFUND_DAYS } = require('../../../../libraries/payment/refund-policy.js');

module.exports = {
  /**
   * Process a refund for a Chargebee subscription
   *
   * @param {object} options
   * @param {string} options.resourceId - Chargebee subscription ID
   * @param {string} options.uid - User's UID (for logging)
   * @param {object} options.subscription - User's subscription object from Firestore
   * @param {object} options.ctx - Assistant instance for logging
   * @returns {{ amount: number, currency: string, full: boolean }}
   */
  async processRefund({ resourceId, uid, ctx }) {
    const ChargebeeLib = require('../../../../libraries/payment/processors/chargebee.js');
    ChargebeeLib.init();

    // 1. Retrieve subscription
    const subResult = await ChargebeeLib.request(`/subscriptions/${resourceId}`);
    const sub = subResult.subscription;

    // 2. Find the latest paid invoice for this subscription
    const invoiceResult = await ChargebeeLib.request(
      `/invoices?subscription_id[is]=${encodeURIComponent(resourceId)}&status[is]=paid&sort_by[desc]=date&limit=1`,
    );

    const invoices = invoiceResult.list || [];

    if (invoices.length === 0) {
      throw new Error('No paid invoice found for this subscription');
    }

    const invoice = invoices[0].invoice;
    const invoiceAmountCents = invoice.amount_paid || invoice.total || 0;

    if (invoiceAmountCents <= 0) {
      throw new Error('No refundable amount on the latest invoice');
    }

    // 3. Calculate refund amount
    const invoicePaidAt = invoice.paid_at || invoice.date;
    const daysSincePayment = (Date.now() / 1000 - invoicePaidAt) / 86400;

    let refundAmountCents;
    let isFullRefund;

    if (daysSincePayment <= FULL_REFUND_DAYS) {
      refundAmountCents = invoiceAmountCents;
      isFullRefund = true;
    } else {
      // Prorated: remaining days / total days * amount
      const periodStart = sub.current_term_start || invoice.date;
      const periodEnd = sub.current_term_end || (invoice.date + 86400 * 30);
      const totalDays = (periodEnd - periodStart) / 86400;
      const daysRemaining = Math.max(0, (periodEnd - Date.now() / 1000) / 86400);

      refundAmountCents = Math.round((daysRemaining / totalDays) * invoiceAmountCents);
      isFullRefund = false;
    }

    if (refundAmountCents <= 0) {
      throw new Error('No refundable amount remaining');
    }

    // 4. Issue refund on the invoice
    await ChargebeeLib.request(`/invoices/${invoice.id}/refund`, {
      method: 'POST',
      body: { refund_amount: refundAmountCents },
    });

    const currency = invoice.currency_code || 'USD';

    ctx.log(`Chargebee refund issued: invoiceId=${invoice.id}, amount=${refundAmountCents}, full=${isFullRefund}, uid=${uid}`);

    // 5. Cancel subscription immediately (if not already cancelled)
    if (sub.status !== 'cancelled') {
      await ChargebeeLib.request(`/subscriptions/${resourceId}/cancel_for_items`, {
        method: 'POST',
        body: { cancel_option: 'immediately' },
      });
      ctx.log(`Chargebee subscription cancelled immediately: sub=${resourceId}, uid=${uid}`);
    }

    return {
      amount: refundAmountCents / 100,
      currency: currency.toLowerCase(),
      full: isFullRefund,
    };
  },

  /**
   * Process a refund for a Chargebee ONE-TIME purchase
   *
   * A one-time purchase is a non-recurring INVOICE, and Chargebee issues refunds
   * on invoices — the same call the subscription path makes, against the order's
   * own invoice. Always FULL: a one-time purchase buys no billing period, so
   * there is nothing to prorate over
   * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
   *
   * @param {object} options
   * @param {string} options.resourceId - Chargebee invoice ID
   * @param {string} options.uid - User's UID (for logging)
   * @param {object} options.order - The payments-orders doc being refunded
   * @param {object} options.ctx - Assistant instance for logging
   * @returns {{ amount: number, currency: string, full: boolean }}
   */
  async processOneTimeRefund({ resourceId, uid, order, ctx }) {
    const ChargebeeLib = require('../../../../libraries/payment/processors/chargebee.js');
    ChargebeeLib.init();

    const invoiceResult = await ChargebeeLib.request(`/invoices/${resourceId}`);
    const invoice = invoiceResult.invoice;
    const amountCents = invoice?.amount_paid || 0;

    if (amountCents <= 0) {
      throw new Error('No refundable amount on this purchase');
    }

    await ChargebeeLib.request(`/invoices/${resourceId}/refund`, {
      method: 'POST',
      body: { refund_amount: amountCents },
    });

    const currency = invoice.currency_code || 'USD';

    ctx.log(`Chargebee one-time refund issued: invoiceId=${resourceId}, amount=${amountCents}, orderId=${order?.id}, uid=${uid}`);

    return {
      amount: amountCents / 100,
      currency: currency.toLowerCase(),
      full: true,
    };
  },
};
