module.exports = async ({ ctx, Manager }) => {

  // Get url
  const url = Manager.config?.brand?.url;

  // Log
  ctx.log('Route.main(): Executing route logic', url);

  // Redirect to brand URL
  return ctx.redirect(url);
};
