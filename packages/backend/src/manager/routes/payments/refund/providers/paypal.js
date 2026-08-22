/**
 * PayPal refund provider
 * Refunds the most recent payment on a PayPal subscription and cancels it.
 * A one-time purchase is refunded against its order's capture instead.
 *
 * PayPal refunds are issued against individual sale/capture transactions,
 * not against the subscription itself. We find the most recent completed
 * transaction and refund it.
 *
 * Proration is the same day-based compute Stripe and Chargebee run — PayPal
 * just makes us assemble the period ourselves: it exposes no period_start /
 * period_end on a transaction, so the period the refunded payment bought runs
 * from that payment forward one billing interval. The interval comes from the
 * subscription's own plan; when neither the plan nor `next_billing_time` can
 * supply it the refund REFUSES rather than guessing at somebody's money
 * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
 */
const { FULL_REFUND_DAYS } = require('../../../../libraries/payment/refund-policy.js');

const DAY_MS = 24 * 60 * 60 * 1000;

module.exports = {
  /**
   * Process a refund for a PayPal subscription
   *
   * @param {object} options
   * @param {string} options.resourceId - PayPal subscription ID (e.g., 'I-xxx')
   * @param {string} options.uid - User's UID (for logging)
   * @param {object} options.ctx - Assistant instance for logging
   * @returns {{ amount: number, currency: string, full: boolean }}
   */
  async processRefund({ resourceId, uid, ctx }) {
    const PayPalLib = require('../../../../libraries/payment/providers/paypal.js');

    // 1. Get subscription transactions to find the latest payment
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const transactions = await PayPalLib.request(
      `/v1/billing/subscriptions/${resourceId}/transactions?start_time=${oneYearAgo.toISOString()}&end_time=${now.toISOString()}`
    );

    const completedTransactions = (transactions.transactions || [])
      .filter(t => t.status === 'COMPLETED')
      .sort((a, b) => new Date(b.time) - new Date(a.time));

    if (completedTransactions.length === 0) {
      throw new Error('No completed transactions found for this subscription');
    }

    const latestTransaction = completedTransactions[0];
    const saleId = latestTransaction.id;
    const transactionAmount = parseFloat(latestTransaction.amount_with_breakdown?.gross_amount?.value || '0');
    const currency = latestTransaction.amount_with_breakdown?.gross_amount?.currency_code || 'USD';

    if (transactionAmount <= 0) {
      throw new Error('No refundable amount on the latest transaction');
    }

    // 2. Calculate refund amount
    const transactionDate = new Date(latestTransaction.time);
    const daysSincePayment = (now - transactionDate) / (1000 * 60 * 60 * 24);

    let refundAmount;
    let isFullRefund;

    if (daysSincePayment <= FULL_REFUND_DAYS) {
      refundAmount = transactionAmount;
      isFullRefund = true;
    } else {
      // Prorated: remaining days / total days * amount — the same compute the
      // Stripe and Chargebee providers run, over a period PayPal makes us derive.
      const sub = await PayPalLib.request(`/v1/billing/subscriptions/${resourceId}`);
      const periodEnd = await this.resolvePeriodEnd({ sub, resourceId, periodStart: transactionDate, PayPalLib, ctx });

      const totalDays = (periodEnd - transactionDate) / DAY_MS;

      if (totalDays <= 0) {
        throw new Error(`PayPal billing period for subscription ${resourceId} ends at or before the payment it covers — refusing to prorate`);
      }

      const daysRemaining = Math.max(0, (periodEnd - now) / DAY_MS);

      refundAmount = Math.round((daysRemaining / totalDays) * transactionAmount * 100) / 100;
      isFullRefund = false;
    }

    if (refundAmount <= 0) {
      throw new Error('No refundable amount remaining');
    }

    // 3. Issue the refund against the sale/capture
    await PayPalLib.request(`/v2/payments/captures/${saleId}/refund`, {
      method: 'POST',
      body: JSON.stringify({
        amount: {
          value: refundAmount.toFixed(2),
          currency_code: currency,
        },
        note_to_payer: 'Subscription refund',
      }),
    });

    ctx.log(`PayPal refund issued: saleId=${saleId}, amount=${refundAmount}, full=${isFullRefund}, uid=${uid}`);

    // 4. Cancel the subscription
    try {
      await PayPalLib.request(`/v1/billing/subscriptions/${resourceId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Refund requested' }),
      });
      ctx.log(`PayPal subscription cancelled after refund: sub=${resourceId}, uid=${uid}`);
    } catch (e) {
      // Already cancelled — that's fine
      ctx.log(`PayPal subscription cancel after refund failed (may already be cancelled): ${e.message}`);
    }

    return {
      amount: refundAmount,
      currency: currency.toLowerCase(),
      full: isFullRefund,
    };
  },

  /**
   * Process a refund for a PayPal ONE-TIME purchase
   *
   * A one-time purchase is a PayPal ORDER (Orders API v2) and the money sits on
   * its capture, so the refund is issued against that capture. Always FULL: a
   * one-time purchase buys no billing period, so there is nothing to prorate over
   * ([#212](https://github.com/Omega-JS-Stack/omega/issues/212)).
   *
   * @param {object} options
   * @param {string} options.resourceId - PayPal order ID
   * @param {string} options.uid - User's UID (for logging)
   * @param {object} options.order - The payments-orders doc being refunded
   * @param {object} options.ctx - Assistant instance for logging
   * @returns {{ amount: number, currency: string, full: boolean }}
   */
  async processOneTimeRefund({ resourceId, uid, order, ctx }) {
    const PayPalLib = require('../../../../libraries/payment/providers/paypal.js');

    const paypalOrder = await PayPalLib.request(`/v2/checkout/orders/${resourceId}`);
    const captures = paypalOrder.purchase_units?.[0]?.payments?.captures || [];
    const capture = captures.find(c => c.status === 'COMPLETED');

    if (!capture) {
      throw new Error(`No completed capture found for PayPal order ${resourceId}`);
    }

    const amount = parseFloat(capture.amount?.value || '0');
    const currency = capture.amount?.currency_code || 'USD';

    if (amount <= 0) {
      throw new Error('No refundable amount on this purchase');
    }

    await PayPalLib.request(`/v2/payments/captures/${capture.id}/refund`, {
      method: 'POST',
      body: JSON.stringify({
        amount: {
          value: amount.toFixed(2),
          currency_code: currency,
        },
        note_to_payer: 'Purchase refund',
      }),
    });

    ctx.log(`PayPal one-time refund issued: captureId=${capture.id}, amount=${amount}, orderId=${order?.id}, uid=${uid}`);

    return {
      amount: amount,
      currency: currency.toLowerCase(),
      full: true,
    };
  },

  /**
   * Resolve the end of the billing period a PayPal payment bought.
   *
   * PayPal's own answer comes first: `billing_info.next_billing_time` IS the
   * period end while a subscription is live. A cancelled or suspended
   * subscription drops that field, so the period is rebuilt from the payment
   * being refunded plus the plan's REGULAR billing interval — the same
   * derivation the PayPal library's period-end resolution runs. When neither is
   * available the refund refuses: an invented period is an invented amount of
   * somebody's money.
   *
   * @param {object} options
   * @param {object} options.sub - The PayPal subscription resource
   * @param {string} options.resourceId - PayPal subscription ID (for messages)
   * @param {Date} options.periodStart - Start of the period being refunded (the payment's own date)
   * @param {object} options.PayPalLib - The PayPal library (plan lookup)
   * @param {object} options.ctx - Assistant instance for logging
   * @returns {Promise<Date>} The period end
   * @throws {Error} When the billing period cannot be derived
   */
  async resolvePeriodEnd({ sub, resourceId, periodStart, PayPalLib, ctx }) {
    const nextBilling = sub.billing_info?.next_billing_time;

    if (nextBilling) {
      return new Date(nextBilling);
    }

    if (!sub.plan_id) {
      throw new Error(`PayPal subscription ${resourceId} has no next_billing_time and no plan_id — the billing period cannot be derived`);
    }

    const plan = await PayPalLib.request(`/v1/billing/plans/${sub.plan_id}`);
    const cycle = (plan.billing_cycles || []).find(c => c.tenure_type === 'REGULAR');
    const unit = cycle?.frequency?.interval_unit;
    const count = cycle?.frequency?.interval_count || 1;

    if (!unit) {
      throw new Error(`PayPal plan ${sub.plan_id} exposes no REGULAR billing interval — the billing period cannot be derived`);
    }

    // UTC arithmetic on purpose: the local-time setters shift the period by an
    // hour across a DST boundary, and a billing period is not a wall clock.
    const periodEnd = new Date(periodStart);

    if (unit === 'YEAR') {
      periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + count);
    } else if (unit === 'MONTH') {
      periodEnd.setUTCMonth(periodEnd.getUTCMonth() + count);
    } else if (unit === 'WEEK') {
      periodEnd.setUTCDate(periodEnd.getUTCDate() + (count * 7));
    } else if (unit === 'DAY') {
      periodEnd.setUTCDate(periodEnd.getUTCDate() + count);
    } else {
      throw new Error(`PayPal plan ${sub.plan_id} uses an unknown billing interval "${unit}" — the billing period cannot be derived`);
    }

    ctx.log(`PayPal period end derived from plan ${sub.plan_id}: ${count} ${unit} after ${periodStart.toISOString()} → ${periodEnd.toISOString()}`);

    return periodEnd;
  },
};
