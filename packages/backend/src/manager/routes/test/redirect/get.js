module.exports = async ({ ctx, settings }) => {

  // Get URL from settings (defaults to itwcreativeworks.com)
  const url = settings.url;

  ctx.log('Redirecting', url);

  return ctx.redirect(url);
};
