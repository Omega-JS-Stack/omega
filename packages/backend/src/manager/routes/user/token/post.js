/**
 * POST /user/token - Create custom Firebase token
 * Creates a custom auth token for the authenticated user
 */
module.exports = async ({ assistant, user, settings, libraries }) => {
  const { admin } = libraries;

  // Require authentication
  if (!user.authenticated) {
    return assistant.respond('Authentication required', { code: 401 });
  }

  // Get target UID
  const uid = settings.uid;

  // Require admin to create tokens for other users
  if (uid !== user.auth.uid && !user.roles.admin) {
    return assistant.respond('Admin required', { code: 403 });
  }

  // Create custom token
  const token = await admin.auth().createCustomToken(uid)
    .catch((e) => e);

  if (token instanceof Error) {
    return assistant.respond(`Failed to create custom token: ${token}`, { code: 500 });
  }

  return assistant.respond({ token });
};
