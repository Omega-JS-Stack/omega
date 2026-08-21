/**
 * EventMiddleware
 * Used to handle middleware for event triggers (auth, firestore, cron)
 *
 * Usage in consumer projects:
 *   exports.userOnCreate = functions
 *     .firestore.document('users/{uid}')
 *     .onCreate((snapshot, context) =>
 *       Manager.EventMiddleware({ snapshot, context }).run('users/on-create')
 *     );
 *
 * Handler location: functions/hooks/events/{name}.js
 */

function EventMiddleware(m, payload) {
  const self = this;

  self.Manager = m;
  self.payload = payload;
}

EventMiddleware.prototype.run = function (handlerName, options) {
  const self = this;

  // Shortcuts
  const Manager = self.Manager;
  const payload = self.payload;

  return new Promise(async function(resolve, reject) {
    const ctx = Manager.RouteContext();
    options = options || {};

    // Resolve handler path
    // If it's an absolute path, use it directly
    // Otherwise, look in the consumer's hooks/events/ directory
    let handlerPath;
    if (handlerName.startsWith('/')) {
      handlerPath = handlerName;
    } else {
      handlerPath = `${Manager.cwd}/events/${handlerName}.js`;
    }

    // Build context based on event type
    const context = {
      Manager,
      ctx,
      libraries: Manager.libraries,
      // Event-specific properties (some may be undefined depending on event type)
      user: payload.user,
      context: payload.context,
      change: payload.change,
      snapshot: payload.snapshot,
    };

    // Load handler
    let handler;
    try {
      handler = require(handlerPath);
    } catch (e) {
      // A handler that will not load is a server fault, so it goes through the
      // SAME door a 5xx route does: report() logs it AND captures it to Sentry
      // (#380). The require failure rides as the `cause`, keeping its own stack
      // and code — Sentry's linked-errors integration follows the chain.
      return reject(ctx.report(new Error(`EventMiddleware: Failed to load handler @ ${handlerPath}`, { cause: e })));
    }

    // Execute with hooks support
    const name = ctx.meta.name;
    const hook = Manager.handlers && Manager.handlers[name];

    try {
      // Pre hook
      if (hook) {
        await hook(context, 'pre');
      }

      // Main execution
      const result = await handler(context);

      // Post hook
      if (hook) {
        await hook(context, 'post');
      }

      return resolve(result);
    } catch (e) {
      // Re-throw a deliberate block untouched: it is the trigger's CLIENT fault,
      // the 4xx lane that never captures. Exactly TWO shapes qualify — an
      // HttpsError (its constructor always sets httpErrorCode, so that property
      // IS how a real block is recognized) and an explicit NUMERIC 4xx code. A
      // string `.code` (ENOENT, messaging/invalid-token) is a system error, not
      // a block, and respond.js rules the same way: its parseInt turns a string
      // code into NaN, which lands on the 500 lane and reports.
      const code = parseInt(e.code);
      if (e.httpErrorCode || (code >= 400 && code <= 499)) {
        return reject(e);
      }

      // Anything else is a server fault: report() logs it AND captures it (#380).
      // It decorates the SAME object in place (code/tag/usage land on the Error)
      // and hands it back, so the rejection value the trigger sees is that one
      // error — `e.code` reads report()'s 500 after capture. A trigger has no
      // res, which report() handles — its header attach is a no-op there.
      return reject(ctx.report(e));
    }
  });
};

module.exports = EventMiddleware;
