/**
 * Ensure the brand names the human its transactional email signs off as —
 * `brand.contact.person.name` ([#694](https://github.com/Omega-JS-Stack/omega/issues/694)).
 *
 * @omega.js/backend's personal sends (welcome, discount nudge, checkup) resolve
 * their signoff from it and throw a coded 400 without it. Found live: the first
 * real signup on a launched brand returned 200 while all three sends failed in
 * function logs nobody was watching, because nothing checked the value before
 * the launch. SENDGRID_API_KEY is what turns those sends on, and this service
 * only runs with it (or an injected client), so the SendGrid walk is the launch
 * gate that catches the hole — and it FAILS, because a silent nudge is exactly
 * what the runtime already does.
 *
 * Last in the operation order on purpose: the value is a precondition of
 * @omega.js/backend's sends, not of anything provisioned here, so every SendGrid
 * operation still converges and the run ends failed with the key named.
 * The runtime error stays as it is — it names the key correctly already.
 */
const chalk = require('chalk').default;

const CONFIG_PATH = 'brand.contact.person.name';

module.exports = async function ensureContactPerson(context) {
  const { brandConfig } = context;
  const person = brandConfig.brand?.contact?.person || {};

  if (person.name) {
    console.log(`      ${chalk.green('✓')} Email signoff: ${chalk.cyan(person.name)}`);
    return {};
  }

  console.log(`      ${chalk.red('✗')} No ${chalk.cyan(CONFIG_PATH)} — every personal send (welcome, discount nudge, checkup) fails at runtime`);
  console.log(`      ${chalk.dim('→')} Set ${chalk.cyan(CONFIG_PATH)} in config/omega.json5, then rerun`);

  return {
    status: 'error',
    error: `Missing ${CONFIG_PATH} in config/omega.json5 — @omega.js/backend's welcome, discount-nudge and checkup emails cannot send without it`,
    output: { contactPerson: { missing: CONFIG_PATH } },
  };
};
