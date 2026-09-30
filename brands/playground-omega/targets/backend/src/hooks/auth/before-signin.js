/**
 * Surface: auth hook, before-signin (blocking: throwing an HttpsError here would
 * refuse the sign-in; this one only logs, so every sign-in proceeds)
 * Doc: node_modules/@omega.js/manager/docs/backend/auth-hooks.md
 */
module.exports = async ({ ctx, user }) => {
  ctx.log(`hook/before-signin: ${user.uid} is signing in`);
};
