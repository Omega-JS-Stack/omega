/**
 * Give a synthetic uid the Firebase auth user a real one always has.
 *
 * A suite that fabricates a purchaser used to need nothing but a user doc — or not
 * even that, where the pipeline wrote the doc itself. Both payment seams now
 * refuse a uid this project has no auth user for, so nothing is ever created
 * under an emulator-only uid a QA checkout leaked into a live project
 * ([#399](https://github.com/Omega-JS-Stack/omega/issues/399)).
 *
 * `_`-prefixed directory, so the runner never walks it looking for suites.
 */

/**
 * Create the auth user for a uid, if it does not already have one
 *
 * Deliberately passwordless: such a record carries no providerData, which
 * auth:on-create reads as anonymous and skips — so a suite that seeds its own
 * user doc is never raced by the trigger writing a different one. Suites that
 * want the trigger's doc keep using a persona.
 *
 * @param {object} Manager - The real booted @omega.js/backend Manager
 * @param {string} uid - The synthetic uid
 * @param {string} [email] - The email to register (defaults to `<uid>@example.com`)
 */
async function ensureAuthUser(Manager, uid, email) {
  const auth = Manager.libraries.admin.auth();

  try {
    await auth.getUser(uid);
  } catch (e) {
    await auth.createUser({ uid: uid, email: email || `${uid}@example.com` });
  }
}

module.exports = { ensureAuthUser };
