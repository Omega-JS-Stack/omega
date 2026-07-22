/**
 * Test portal processor
 * Returns a fake portal URL — no external API calls.
 * Only available in non-production environments.
 */
module.exports = {
  async createPortalSession({ uid, returnUrl, ctx }) {
    if (ctx.isProduction()) {
      throw new Error('Test processor is not available in production');
    }

    const url = returnUrl || 'https://example.com/account';

    ctx.log(`Test portal session: uid=${uid}, url=${url}`);

    return { url };
  },
};
