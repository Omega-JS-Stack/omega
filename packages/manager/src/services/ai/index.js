/**
 * AI service (#639) — the ONE key per AI provider, asked once.
 *
 * It provisions nothing: there is no AI platform API to reconcile a brand
 * against, only two credentials the backend needs before it can call OpenAI
 * or Anthropic (contact inference, content + newsletter generation). The
 * legacy split — a company-wide `OMEGA_*` key beside the brand's bare one —
 * is gone: the bare name is the only name, and a company-wide value is simply
 * the COMPANY layer of the .env cascade under that same name.
 *
 * So the whole service is the shared setup contract's gate (lib/service-input.js,
 * the server/forms/chat/email shape): a brand that wants AI pastes the keys
 * mid-walk, a brand that does not answers Disable once (`ai.enabled: false`)
 * and is never asked again. Both keys are OPTIONAL in the registry
 * (`gates: false`), so preflight never gates a run on them.
 *
 * It runs before the delivery lane: the keys must be in the brand .env before
 * a target's runtime env composes from it.
 */
const { serviceInputSpec } = require('../../config.js');
const { createServiceRunner } = require('../../lib/service-runner.js');
const { requestServiceInput } = require('../../lib/service-input.js');

module.exports.run = createServiceRunner({
  serviceDir: __dirname,
  setup: async (context) => {
    if (context.brandConfig.ai?.enabled === false) {
      return { skip: true, reason: 'ai.enabled = false' };
    }

    const gate = await requestServiceInput(context, serviceInputSpec('ai'));
    if (gate) return gate;

    return {};
  },
});
