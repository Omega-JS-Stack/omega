/**
 * Shared harness for the payments-route suites that call a handler DIRECTLY.
 *
 * The technique, for the routes that need a `user`: a real ctx from
 * Manager.RouteContext(), a real user built the
 * way `ctx.authenticate()` builds one (Manager.User(doc).properties, then the
 * `authenticated` flag it sets outside the schema), and only `res` as a
 * stand-in — the external sink respond() writes to, per the no-mock doctrine.
 *
 * Direct calls are the honest layer for these cases: they let one test choose a
 * provider and a subscription shape without minting a persona per permutation,
 * and they can run two handlers CONCURRENTLY in one process, which is the only
 * way to prove a same-instant duplicate delivery.
 *
 * `_`-prefixed, so the runner never discovers it as a suite.
 */

// A minimal express-shaped response recorder — the one external sink respond() writes to.
function recordingResponse() {
  const sent = { code: null, body: null, headers: {} };

  return {
    sent,
    headersSent: false,
    status(code) {
      sent.code = code;
      return this;
    },
    set(key, value) {
      sent.headers[key] = value;
      return this;
    },
    json(payload) {
      sent.body = payload;
      return this;
    },
    send(payload) {
      sent.body = payload;
      return this;
    },
  };
}

/**
 * Build a resolved user exactly the way authenticate() does.
 *
 * @param {object} Manager - The @omega.js/backend Manager
 * @param {object} doc - The user document shape (auth, roles, subscription, …)
 * @returns {object} The resolved user a route handler receives
 */
function buildUser(Manager, doc) {
  const user = Manager.User(doc).properties;

  // authenticate() sets this OUTSIDE the account schema — mirror it exactly
  user.authenticated = doc.authenticated !== false;

  return user;
}

/**
 * Run the thunk with `vars` applied to process.env (null deletes), restoring
 * every key afterwards. The route/provider code reads the environment live on
 * every call, so swapping it is the real switch.
 *
 * @param {object} vars - { NAME: 'value' | null }
 * @param {Function} fn - The thunk
 */
async function withEnvironment(vars, fn) {
  const original = {};

  Object.entries(vars).forEach(([key, value]) => {
    original[key] = process.env[key];

    if (value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });

  try {
    return await fn();
  } finally {
    Object.entries(original).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  }
}

/**
 * The environment overrides that make getEnvironment() resolve to production.
 * Testing wins over everything else, so it has to come off too.
 */
const PRODUCTION_ENVIRONMENT = {
  OMEGA_TEST_MODE: null,
  TERM_PROGRAM: null,
  FUNCTIONS_EMULATOR: null,
  ENVIRONMENT: 'production',
};

/**
 * Call a route handler directly against a real ctx.
 *
 * @param {object} options
 * @param {object} options.Manager - The @omega.js/backend Manager
 * @param {Function} options.handler - The route handler module
 * @param {string} options.functionName - The ctx's function-name tag
 * @param {object} [options.user] - A user built by buildUser()
 * @param {object} [options.settings] - The resolved request settings
 * @param {object} [options.req] - Request overrides (query, headers, body, rawBody)
 * @returns {Promise<object>} What the handler sent: { code, body, headers }
 */
async function callHandler({ Manager, handler, functionName, user, settings, req }) {
  const res = recordingResponse();
  const request = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    query: {},
    body: {},
    ...(req || {}),
  };
  const ctx = Manager.RouteContext({ req: request, res }, { functionName });

  await handler({
    ctx,
    Manager,
    user,
    settings,
    libraries: Manager.libraries,
  });

  return res.sent;
}

module.exports = {
  recordingResponse,
  buildUser,
  withEnvironment,
  callHandler,
  PRODUCTION_ENVIRONMENT,
};
