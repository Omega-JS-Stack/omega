/**
 * Shared harness for the payments-route suites that call a handler DIRECTLY.
 *
 * The technique, for the routes that need a `user`: a real Context, a real
 * user built the way `ctx.authenticate()` builds one (a `User` from
 * @omega.js/account, carrying the authenticated verdict the lanes reached), and
 * only `res` as a stand-in: the external sink respond() writes to, per the
 * no-mock doctrine.
 *
 * Direct calls are the honest layer for these cases: they let one test choose a
 * provider and a subscription shape without minting a persona per permutation,
 * and they can run two handlers CONCURRENTLY in one process, which is the only
 * way to prove a same-instant duplicate delivery.
 *
 * `_`-prefixed, so the runner never discovers it as a suite.
 */

// A minimal express-shaped response recorder — the one external sink respond() writes to.
const { User } = require('../../../dist/omega/helpers/account.js');
const Context = require('../../../dist/omega/context.js');

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
 * @param {object} doc - The user document shape (auth, roles, subscription, …)
 * @returns {User} The resolved user a route handler receives
 */
function buildUser(doc) {
  const user = new User(doc);
  const authenticated = doc.authenticated !== false;

  // authenticate()'s verdict wins over the getter's uid rule, as it does there
  if (user.authenticated !== authenticated) {
    Object.defineProperty(user, 'authenticated', { value: authenticated, writable: true });
  }

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
  // The ONE environment input (#817): a deployed production run names it, and
  // the ambient signals come off so nothing is ambiguous.
  OMEGA_ENVIRONMENT: 'production',
  OMEGA_TEST_MODE: null,
  TERM_PROGRAM: null,
  FUNCTIONS_EMULATOR: null,
  ENVIRONMENT: 'production',
};

/**
 * Call a route handler directly against a real ctx.
 *
 * @param {object} options
 * @param {object} options.omega - The Omega instance
 * @param {Function} options.handler - The route handler module
 * @param {string} options.functionName - The ctx's function-name tag
 * @param {object} [options.user] - A user built by buildUser()
 * @param {object} [options.data] - The resolved request input
 * @param {object} [options.req] - Request overrides (query, headers, body, rawBody)
 * @returns {Promise<object>} What the handler sent: { code, body, headers }
 */
async function callHandler({ omega, handler, functionName, user, data, req }) {
  const res = recordingResponse();
  const request = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    query: {},
    body: {},
    ...(req || {}),
  };
  const ctx = new Context(omega, { req: request, res }, { functionName });

  await handler({
    ctx,
    omega,
    user,
    data,
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
