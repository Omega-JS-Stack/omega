/**
 * What `GET /test/roster` hands over, composed from the seed table.
 */
const { getAccountTable } = require('./test-accounts.js');

/**
 * By default the personas a HUMAN switches between: every seeded account
 * carrying a `palette` label, in the order the seeder declares them. A suite
 * asking for `machinery` on a TESTING backend gets every seeded account, the
 * unlabeled ones with a `null` label; any other backend ignores the switch.
 * Read off the TABLE: a localpart needs no domain, and labels live only there.
 * @param {object} [extraAccounts] - Project-defined accounts from test/_init.js
 * @param {object} options
 * @param {boolean} options.testing - Whether the backend runs as testing (`ctx.isTesting()`)
 * @param {boolean} [options.machinery] - Include the unlabeled accounts a suite drives
 * @returns {{ localpart: string, label: string|null }[]} The roster, in declaration order
 */
function getRoster(extraAccounts, { testing, machinery = false }) {
  if (typeof testing !== 'boolean') {
    throw new TypeError(`getRoster needs options.testing as a boolean (got ${typeof testing})`);
  }

  const everyone = machinery && testing;

  return Object.values(getAccountTable(extraAccounts))
    .filter((account) => everyone || account.palette)
    .map((account) => ({ localpart: (account.email || '').split('@')[0], label: account.palette || null }));
}

module.exports = { getRoster };
