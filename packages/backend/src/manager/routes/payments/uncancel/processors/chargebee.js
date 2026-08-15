/**
 * Chargebee uncancel processor
 * Withdraws a scheduled cancellation via remove_scheduled_cancellation.
 *
 * A Chargebee subscription cancelled with cancel_option 'end_of_term' sits in
 * status non_renewing — still serving the term, just not renewing. Removing the
 * scheduled cancellation puts it back to active; Chargebee then sends the
 * subscription_changed webhook the existing pipeline processes.
 */
module.exports = {
  /**
   * Resume a Chargebee subscription that is scheduled to cancel
   *
   * @param {object} options
   * @param {string} options.resourceId - Chargebee subscription ID
   * @param {string} options.uid - User's UID (for logging)
   * @param {object} options.subscription - User's current subscription object
   * @param {object} options.ctx - Assistant instance for logging
   */
  async uncancel({ resourceId, uid, ctx }) {
    const ChargebeeLib = require('../../../../libraries/payment/processors/chargebee.js');
    ChargebeeLib.init();

    await ChargebeeLib.request(`/subscriptions/${resourceId}/remove_scheduled_cancellation`, {
      method: 'POST',
    });

    ctx.log(`Chargebee scheduled cancellation removed: sub=${resourceId}, uid=${uid}`);
  },
};
