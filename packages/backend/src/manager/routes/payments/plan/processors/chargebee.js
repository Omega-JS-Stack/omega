/**
 * Chargebee plan-switch processor
 * Moves a live subscription onto a different item price.
 *
 * update_for_items REPLACES the subscription's items with the ones sent, so the
 * target item price is the whole payload. The item price id is the same
 * deterministic `{itemId}-{frequency}` the checkout builds, so a plan switch
 * lands on exactly the price a fresh subscription would have. Chargebee then
 * sends subscription_changed, which the existing pipeline processes into the
 * plan-changed transition.
 */
module.exports = {
  /**
   * Switch a Chargebee subscription to another plan
   *
   * @param {object} options
   * @param {string} options.resourceId - Chargebee subscription ID
   * @param {string} options.uid - User's UID (for logging)
   * @param {object} options.product - Target product object from config
   * @param {string} options.frequency - Target billing frequency ('monthly', 'annually', …)
   * @param {object} options.ctx - Assistant instance for logging
   */
  async switchPlan({ resourceId, uid, product, frequency, ctx }) {
    const ChargebeeLib = require('../../../../libraries/payment/processors/chargebee.js');
    ChargebeeLib.init();

    const chargebeeItemId = product.chargebee?.itemId;

    if (!chargebeeItemId) {
      throw new Error(`No Chargebee item ID configured for product ${product.id}`);
    }

    // Deterministic item price ID: {itemId}-{frequency} — the checkout's own convention
    const itemPriceId = `${chargebeeItemId}-${frequency}`;

    await ChargebeeLib.request(`/subscriptions/${resourceId}/update_for_items`, {
      method: 'POST',
      body: {
        subscription_items: {
          item_price_id: [itemPriceId],
          quantity: [1],
        },
      },
    });

    ctx.log(`Chargebee plan switched: sub=${resourceId}, uid=${uid}, itemPriceId=${itemPriceId} (${product.id}/${frequency})`);
  },
};
