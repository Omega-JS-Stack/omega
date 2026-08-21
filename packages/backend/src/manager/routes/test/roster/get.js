const { TEST_ACCOUNTS } = require('../../../../test/test-accounts.js');

/**
 * GET /test/roster
 * The personas a HUMAN switches between: every seeded account that carries a
 * `palette` label in `test-accounts.js`, in the order the seeder declares them.
 * The seed is the ONE owner of that roster ([#400](https://github.com/Omega-JS-Stack/omega/issues/400)):
 * the dev palette used to keep a hand-curated copy of the list, and the two
 * drifted apart the moment a persona was seeded without one being added.
 *
 * The seed TABLE is read rather than the assembled definitions: a localpart is
 * the part of a persona's declared email before the `@`, so it needs no domain
 * and no catalog to resolve, and the labels only exist on the table.
 *
 * Development/testing only, and deliberately unauthenticated: the palette asks
 * for the roster before anybody is signed in, which is the whole point of it.
 */
module.exports = async ({ ctx }) => {
  // Emulator-only: never a route outside development/testing (an explicit
  // positive check, per the context contract, not `!isProduction()`)
  if (!ctx.isDevelopment() && !ctx.isTesting()) {
    return ctx.respond('Not found', { code: 404 });
  }

  const personas = Object.values(TEST_ACCOUNTS)
    .filter((account) => account.palette)
    .map((account) => ({ localpart: (account.email || '').split('@')[0], label: account.palette }));

  ctx.log(`test/roster: ${personas.length} palette persona(s)`);

  return ctx.respond({ personas });
};
