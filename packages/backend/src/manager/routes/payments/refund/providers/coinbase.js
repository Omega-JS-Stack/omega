/**
 * Coinbase Commerce refund provider — the explicit UNSUPPORTED one.
 *
 * Coinbase Commerce has no refund API. Returning crypto is a transfer the
 * merchant makes by hand from the dashboard, at whatever the coin is worth that
 * day, and nothing about it is ever attached to the charge — so there is no call
 * this file could make and no amount it could report
 * ([#642](https://github.com/Omega-JS-Stack/omega/issues/642)).
 *
 * The file still EXISTS, because a missing one makes the route answer "Unknown
 * provider" — a different and wrong statement about a provider this backend
 * plainly knows ([Capability gating](../../../../../../docs/payment-system.md)).
 *
 * Nothing reaches these functions in practice: the refund route refuses a crypto
 * order before it loads a provider, through the ONE predicate the account page's
 * refund button reads too (`libraries/payment/refund-policy.js`), so a button the
 * page offers is still a refund the route accepts. They throw rather than
 * silently answering, so a caller that ever bypasses that refusal fails at the
 * bypass instead of recording a refund that never happened.
 */

const UNSUPPORTED = 'Coinbase Commerce has no refund API — a crypto refund is a manual transfer from the Coinbase Commerce dashboard';

module.exports = {
  /**
   * Refund a Coinbase subscription — there is no such thing to refund
   * @throws {Error} always
   */
  async processRefund() {
    throw new Error(`${UNSUPPORTED} (and Coinbase Commerce has no subscriptions at all)`);
  },

  /**
   * Refund a Coinbase ONE-TIME purchase — unsupported, by the provider
   * @throws {Error} always
   */
  async processOneTimeRefund() {
    throw new Error(UNSUPPORTED);
  },
};
