/**
 * GET /test/redirect
 * Exercises ctx.redirect(). Development-only like the rest of the `test/`
 * folder (the middleware gates the whole family), and RELATIVE PATHS ONLY.
 */
module.exports = async ({ ctx, settings }) => {

  // Get URL from settings (defaults to the site root)
  const url = settings.url;

  // Reflecting a caller-supplied absolute URL would make this an open redirect.
  // Refuse a scheme (`https:`, `javascript:`) and the protocol-relative forms
  // (`//host`, `/\host`, which browsers treat as `//host`) outright rather than
  // trying to sanitize them.
  const isRelative = url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\');

  if (!isRelative) {
    // The refused value is logged, never echoed into the response body.
    ctx.log('Refusing to redirect to a non-relative URL', url);

    return ctx.respond('Only relative paths may be redirected to', { code: 400 });
  }

  ctx.log('Redirecting', url);

  return ctx.redirect(url);
};
