/**
 * The parent forwarder's host, and the two reasons a marketing webhook is not
 * configured at all: the ONE copy both provider services read
 * ([#677](https://github.com/Omega-JS-Stack/omega/issues/677)).
 *
 * Every provider webhook OMEGA manages points at the parent @omega.js/backend's
 * `/omega/marketing/webhook/forward` endpoint, addressed by the RESOLVED
 * `company.url` (this brand's own url when it names no company). So the opt-out,
 * the no-parent refusal and the host derivation are one decision, made here, and
 * a provider service only spells its own provider and its own payload.
 */
const chalk = require('chalk').default;

/**
 * Resolve the parent host a managed webhook points at.
 *
 * Prints the skip lines itself, so both services say the same thing the same
 * way; the returned reason is what the caller branches on.
 *
 * @param {object} company - The RESOLVED `brandConfig.company` (may be absent).
 * @param {string} what - What is being configured, for the lines ('webhook',
 *   'Event Webhook').
 * @returns {{ skip: string }|{ parentHost: string }} `skip` names the reason
 *   ('opted-out', 'no-url'); otherwise the host, with no protocol and no
 *   trailing slash.
 */
function resolveParentHost(company, what) {
  // The provider ACCOUNT can be somebody else's, which nothing in the company
  // TOPOLOGY says: the playground's SendGrid account is ITW's, and repointing
  // that account's one Event Webhook would break a production forwarder.
  // `company: { webhooks: false }` is how a brand says so.
  if (company?.webhooks === false) {
    console.log(chalk.dim(`      ⊘ company.webhooks = false: ${what} opted out`));
    return { skip: 'opted-out' };
  }

  const resolved = company || {};

  if (!resolved.url) {
    console.log(chalk.dim(`      ⊘ The company (${resolved.id || 'none'}) resolved no url: nothing to point the ${what} at`));
    console.log(chalk.dim("      → Name it with company: { id: '<parent brand.id>' } in omega.json5, and clone the parent on this machine"));
    return { skip: 'no-url' };
  }

  // The company's own host: its url IS this brand's when it names no company,
  // which is what the old `parent: 'self'` spelled by hand.
  return { parentHost: resolved.url.replace(/^https?:\/\//, '').replace(/\/$/, '') };
}

module.exports = { resolveParentHost };
