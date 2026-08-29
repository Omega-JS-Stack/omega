const { projectUserForLog } = require('../../../helpers/middleware.js');

module.exports = async ({ ctx, user }) => {

  // Log user info — the allow-listed projection, never the document: it carries
  // api.privateKey ([#632](https://github.com/Omega-JS-Stack/omega/issues/632))
  ctx.log('User:', projectUserForLog(user));

  // Return user info
  return ctx.respond({ user });
};
