/**
 * Does a uid belong to THIS project? — the one place that question is asked.
 *
 * A user doc is born at signup, behind a real Firebase auth user. Both payment
 * seams (the webhook pipeline and the checkout route) need to know a uid is one
 * of ours before anything is written under it
 * ([#399](https://github.com/Omega-JS-Stack/omega/issues/399)), and the sign-in
 * heal needs the record itself before it recreates a doc under one
 * ([#405](https://github.com/Omega-JS-Stack/omega/issues/405)).
 */

/**
 * The Firebase auth user for this uid in this project, or null when there is none
 *
 * @param {object} admin - The firebase-admin app
 * @param {string} uid - The uid to look up
 * @returns {Promise<object|null>} The UserRecord, or null when the user does not exist
 * @throws {Error} When the Auth service itself failed — never read as an absence
 */
async function getAuthUser(admin, uid) {
  try {
    return await admin.auth().getUser(uid);
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      return null;
    }

    // Anything else is Auth being unreachable or misconfigured, which is no proof
    // the user is missing — swallowing it here would refuse a real customer.
    throw e;
  }
}

/**
 * Whether a Firebase auth user exists for this uid in this project
 *
 * @param {object} admin - The firebase-admin app
 * @param {string} uid - The uid to look up
 * @returns {Promise<boolean>}
 * @throws {Error} When the Auth service itself failed — never read as an absence
 */
async function hasAuthUser(admin, uid) {
  return !!await getAuthUser(admin, uid);
}

module.exports = { getAuthUser, hasAuthUser };
