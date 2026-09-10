const path = require('path');
const { getPaletteRoster } = require('../../../../test/test-accounts.js');
const { loadSeedAccounts } = require('../../../../test/seed.js');

/**
 * GET /test/roster
 * The personas a HUMAN switches between: every seeded account that carries a
 * `palette` label, in the order the seeder declares them.
 * The seed is the ONE owner of that roster ([#400](https://github.com/Omega-JS-Stack/omega/issues/400)):
 * the dev palette used to keep a hand-curated copy of the list, and the two
 * drifted apart the moment a persona was seeded without one being added.
 *
 * The WHOLE seed, both halves ([#712](https://github.com/Omega-JS-Stack/omega/issues/712)):
 * the framework's own table plus the project's `test/_init.js` accounts — the
 * documented extension point the seeder itself merges in. Reading the table
 * alone made a consumer persona carrying a label invisible, which is the exact
 * drift #400 built this route to end.
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

  // Manager.cwd is the consumer's functions/ directory; test/_init.js lives one
  // level up at <projectRoot>/test/ — the same resolution the test-mode watcher
  // makes. Loaded once per process, not per request.
  const projectDir = path.dirname(ctx.Manager.cwd);
  const projectAccounts = loadSeedAccounts({ projectDir, config: ctx.Manager.config, Manager: ctx.Manager });

  const personas = getPaletteRoster(projectAccounts);

  ctx.log(`test/roster: ${personas.length} palette persona(s)`);

  return ctx.respond({ personas });
};
