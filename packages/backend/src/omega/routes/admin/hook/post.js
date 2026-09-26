/**
 * POST /admin/hook - Run a hook or cron job manually
 *
 * Resolves the hook from multiple locations:
 *   1. @omega.js/backend internal crons (e.g. path="cron/daily/blog-auto-publisher")
 *   2. @omega.js/backend internal functions/core hooks
 *   3. Consumer project root
 *   4. Consumer hooks/ directory
 *
 * Supports both calling conventions:
 *   - Function export: module.exports = async ({ ctx, omega, ... }) => {}
 *   - Class export: module.exports = class { main(ctx) {} }
 */
const path = require('path');

// The framework's own tree (the events a hook path may name)
const OMEGA_DIR = path.resolve(__dirname, '../../..');
module.exports = async ({ ctx, omega, user, data, analytics }) => {

  if (!user.authenticated && ctx.isProduction()) {
    return ctx.respond('Authentication required', { code: 401 });
  }

  if (!user.roles.admin && ctx.isProduction()) {
    return ctx.respond('Admin required.', { code: 403 });
  }

  if (!data.path) {
    return ctx.respond('Missing required parameter: path', { code: 400 });
  }

  ctx.log('Running hook:', data.path);

  const loaded = loadHook(ctx, data.path);

  if (!loaded) {
    return ctx.respond(`Hook not found: ${data.path}`, { code: 404 });
  }

  const hookName = data.path.split('/').pop();
  ctx.setLogPrefix(`hook/${hookName}()`);

  try {
    let result;

    if (loaded.type === 'function') {
      result = await loaded.handler({
        ctx,
        omega,
        context: {},
      });
    } else {
      const instance = loaded.handler;
      instance.omega = omega;
      instance.ctx = ctx;
      instance.context = null;
      result = await instance.main(ctx);
    }

    analytics.event('admin/hook', { path: data.path });

    return ctx.respond(result || { success: true });
  } catch (e) {
    ctx.error(`Hook error: ${e.message}`, e);
    return ctx.respond(e.message, { code: 500 });
  }
};

function loadHook(ctx, hookPath) {
  const omega = ctx.omega;

  const searchPaths = [
    // @omega.js/backend internal crons + events (e.g. "cron/daily/blog-auto-publisher")
    path.join(OMEGA_DIR, 'events', hookPath),
    // @omega.js/backend internal functions/core
    path.join(OMEGA_DIR, '..', '..', 'functions', 'core', hookPath),
    // Consumer project root
    path.join(omega.cwd, hookPath),
    // Consumer hooks/ directory
    path.join(omega.cwd, 'hooks', hookPath),
  ];

  for (const searchPath of searchPaths) {
    const resolved = pathify(searchPath);
    ctx.log('Trying path:', resolved);

    try {
      const mod = require(resolved);

      if (typeof mod === 'function' && !mod.prototype?.main) {
        return { type: 'function', handler: mod };
      }

      return { type: 'class', handler: new mod() };
    } catch (e) {
      // Continue to next path
    }
  }

  return null;
}

function pathify(p) {
  return `${p.replace(/\.js$/, '')}.js`;
}
