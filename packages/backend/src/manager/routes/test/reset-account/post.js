const { getAccountDefinitions, createAccount, seedOrderFixture } = require('../../../../test/test-accounts.js');

/**
 * POST /test/reset-account
 * Restore the CALLER's own seeded persona to its seed shape — the user doc
 * `test-accounts.js` defines plus its canonical purchase record — so a browser
 * flow that mutated a persona (a cancellation, an upgrade, a trial) can be run
 * again without rebooting the emulator.
 *
 * The one route in the framework that reads the seeder from a request handler:
 * the seeder IS the shape, so re-seeding here can never drift from the boot
 * seed. Development/testing only, and only for the account the caller is
 * signed in as — there is no uid parameter.
 */
module.exports = async ({ ctx, user }) => {
  // Emulator-only: never a route outside development/testing (an explicit
  // positive check, per the context contract — not `!isProduction()`)
  if (!ctx.isDevelopment() && !ctx.isTesting()) {
    return ctx.respond('Not found', { code: 404 });
  }

  // Require authentication
  if (!user.authenticated) {
    return ctx.respond('Authentication required', { code: 401 });
  }

  const admin = ctx.Manager.libraries.admin;
  const config = ctx.Manager.config;
  // An admin-key caller authenticates without being anybody, and this route
  // only ever acts on the account it is called AS.
  const uid = user.auth?.uid;

  // The seeder resolves persona emails against the brand's contact domain —
  // the same derivation `omega emulator` seeds with.
  const domain = (config.brand?.contact?.email || '').split('@')[1] || '';
  const definitions = getAccountDefinitions(domain, config);
  const entry = Object.entries(definitions).find(([, definition]) => definition.uid === uid);

  // Only a persona the FRAMEWORK seeds may be reset: resetting deletes and
  // recreates the account, which no real user's account may ever undergo.
  if (!entry) {
    ctx.log(`test/reset-account: refused — uid ${uid} is not a seeded test account`);
    return ctx.respond('Not a seeded test account', { code: 403 });
  }

  const [key, definition] = entry;

  ctx.log(`test/reset-account: resetting persona ${key} (${definition.email}) to its seed`);

  // Clear the persona's purchase records FIRST — a journey buys its own
  // orders, and a stale one would outlive the reset and re-disqualify the
  // persona from a trial it is supposed to be offered.
  const orders = await admin.firestore().collection('payments-orders').where('owner', '==', uid).get();
  await Promise.all(orders.docs.map((doc) => doc.ref.delete()));

  // Re-run the seeder's own per-account primitive (auth delete + create, then
  // the seed properties merged over the fresh doc) and stand the persona's
  // canonical order fixture back up.
  await createAccount(admin, definition);
  const order = await seedOrderFixture(admin, key, config);

  ctx.log(`test/reset-account: ${key} reset (${orders.size} order(s) cleared, ${order ? `order ${order.orderId} reseeded` : 'no order fixture'})`);

  return ctx.respond({
    success: true,
    persona: key,
    uid,
    email: definition.email,
    ordersCleared: orders.size,
    orderId: order?.orderId || null,
  });
};
