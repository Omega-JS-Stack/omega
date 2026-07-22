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
 *   - Function export: module.exports = async ({ Manager, ctx, ... }) => {}
 *   - Class export: module.exports = class { main(ctx) {} }
 */
module.exports = async ({ ctx, Manager, user, settings, analytics }) => {

  if (!user.authenticated && ctx.isProduction()) {
    return ctx.respond('Authentication required', { code: 401 });
  }

  if (!user.roles.admin && ctx.isProduction()) {
    return ctx.respond('Admin required.', { code: 403 });
  }

  if (!settings.path) {
    return ctx.respond('Missing required parameter: path', { code: 400 });
  }

  ctx.log('Running hook:', settings.path);

  const loaded = loadHook(ctx, settings.path);

  if (!loaded) {
    return ctx.respond(`Hook not found: ${settings.path}`, { code: 404 });
  }

  const hookName = settings.path.split('/').pop();
  ctx.setLogPrefix(`hook/${hookName}()`);

  try {
    let result;

    if (loaded.type === 'function') {
      result = await loaded.handler({
        Manager,
        ctx,
        context: {},
        libraries: Manager.libraries,
      });
    } else {
      const instance = loaded.handler;
      instance.Manager = Manager;
      instance.ctx = ctx;
      instance.context = null;
      instance.libraries = Manager.libraries;
      result = await instance.main(ctx);
    }

    analytics.event('admin/hook', { path: settings.path });

    return ctx.respond(result || { success: true });
  } catch (e) {
    ctx.error(`Hook error: ${e.message}`, e);
    return ctx.respond(e.message, { code: 500 });
  }
};

function loadHook(ctx, hookPath) {
  const Manager = ctx.Manager;
  const path = require('path');

  const searchPaths = [
    // @omega.js/backend internal crons + events (e.g. "cron/daily/blog-auto-publisher")
    path.join(Manager.rootDirectory, 'events', hookPath),
    // @omega.js/backend internal functions/core
    path.join(Manager.rootDirectory, '..', '..', 'functions', 'core', hookPath),
    // Consumer project root
    path.join(Manager.cwd, hookPath),
    // Consumer hooks/ directory
    path.join(Manager.cwd, 'hooks', hookPath),
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
