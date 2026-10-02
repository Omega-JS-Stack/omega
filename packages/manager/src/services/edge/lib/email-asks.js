/**
 * The mailbox provider ask, run by the edge setup before any edge op so a
 * provider picked here is in the config the dns-records op reads on the same
 * walk. The forwarding ask stays in the email-routing op.
 */
const { chosenProvider } = require('@omega.js/config');
const { resolveConfigValue } = require('../../../lib/config-flow.js');
const { presencePick } = require('../../domain/lib/providers.js');

/**
 * Ask for the mailbox provider when none is picked. Disable lands `false` at
 * `domain.email.providers`, which every reader takes as none.
 *
 * @param {Object} context - Service context (brandConfig, brandRoot, options)
 * @returns {Promise<void>}
 */
async function askEmailProvider(context) {
  await resolveConfigValue(context, {
    path: 'domain.email.providers',
    label: 'Email provider',
    instructions: ["The mailbox provider the domain's MX and SPF records point at."],
    present: (providers) => providers === false || chosenProvider(providers) !== null,
    ...presencePick('mailbox'),
  });
}

module.exports = { askEmailProvider };
