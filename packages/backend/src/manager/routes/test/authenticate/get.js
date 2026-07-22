module.exports = async ({ ctx, user }) => {

  // Log user info
  ctx.log('User:', user);

  // Return user info
  return ctx.respond({ user });
};
