/**
 * Middleware
 * Used to handle middleware for the ctx
 */

const path = require('path');
const fs = require('fs');
const powertools = require('node-powertools');
const { merge } = require('lodash');
const JSON5 = require('json5');
const User = require('./user.js');
const redactSecret = require('./redact-secret.js');

// The channels a credential arrives on, one-to-one with the lanes
// context/authenticate.js reads: the bearer/API-key header, the admin key, the
// __session cookie, and the two payload keys. Anything here is rendered
// presence + last-4 before it reaches a log line
// ([#275](https://github.com/Omega-JS-Stack/omega/issues/275)).
const CREDENTIAL_HEADERS = ['authorization', 'omega-admin-key', 'cookie'];
const CREDENTIAL_DATA_KEYS = ['apikey', 'authenticationtoken'];

// The credential FAMILIES a RESPONSE carries, at any depth. `GET /omega/user`
// answers the whole user record, so the response log line printed every
// connected provider's token and the caller's own key
// ([#796](https://github.com/Omega-JS-Stack/omega/issues/796)). A key is
// matched by its NORMALIZED spelling (lower-cased, `-` and `_` stripped), so
// `access_token`, `accessToken` and `Access-Token` are one key and every
// provider's spelling is covered by the family it ends with: `token` catches
// the OAuth pair, the `signInToken` an admin custom token rides, and
// `authenticationToken`; `apikey` and `privatekey` catch `api_key` /
// `privateKey`; `secret` catches `clientSecret` and `webhook_secret`.
const CREDENTIAL_RESPONSE_SUFFIXES = ['secret', 'token', 'password', 'privatekey', 'apikey'];

// The credential names no family suffix catches.
const CREDENTIAL_RESPONSE_KEYS = ['sessioncookie'];

// What a credential that is not a string logs as. A connection's whole `token`
// object IS the credential (the access and refresh pair together), so it is
// replaced as one piece instead of being walked key by key.
const REDACTED_OBJECT = '***(redacted object)';

// The `test/` route folder is DEVELOPMENT-ONLY: it exists to exercise the
// framework (echo the settings engine, increment a usage counter, reset a
// seeded persona), and nothing in it belongs at a production URL.
// There are no exceptions: the one route that used to need a carve-out here —
// the liveness + version probe @omega.js/manager's live API check reads on a
// PRODUCTION host — is a real route now, `routes/health`.
const DEV_ONLY_ROUTE_FOLDER = 'test';

/**
 * The route path's segments, normalized the SAME way the loader's
 * path.resolve() below will read it. BackendRouter takes this straight off the
 * request URL, so every decision must key off the normalized form or a caller
 * walks past it with `./`, `//` or `x/../` and still lands on the handler.
 * @param {string} routeName - Route path (e.g. 'test/usage', './test/usage')
 * @returns {string[]} Segments ('x/../test/usage' → ['test', 'usage'])
 */
function normalizeRouteSegments(routeName) {
  return path.posix
    .normalize(String(routeName || '').replace(/\.js$/, '').toLowerCase())
    .split('/')
    .filter((segment) => segment && segment !== '.');
}

/**
 * Whether a route path names something OUTSIDE the routes directory. A leading
 * `..` is refused even when it climbs back in (`../routes/test/usage` resolves
 * right back to `routes/test/usage`, walking past every folder-level gate), and
 * an absolute path is refused because path.resolve() would hand it the whole
 * filesystem — `/omega/../schemas/test/usage` otherwise require()s a schema
 * module as a handler.
 * @param {string} routeName - Route path
 * @returns {boolean}
 */
function isRouteOutsideRoutesDir(routeName) {
  const raw = String(routeName || '').replace(/\.js$/, '');

  if (path.posix.isAbsolute(raw)) {
    return true;
  }

  return normalizeRouteSegments(raw)[0] === '..';
}

/**
 * Whether a route must be refused because it belongs to a development-only
 * folder and this is production. ONE guard for the whole folder instead of a
 * copy per handler, so a NEW `routes/test/*` file is gated the day it lands.
 * @param {string} routeName - Route path (e.g. 'test/usage', 'user/sign-up')
 * @param {string} environment - Manager.getEnvironment() ('development' | 'testing' | 'production')
 * @returns {boolean}
 */
function isDevOnlyRouteBlocked(routeName, environment) {
  const segments = normalizeRouteSegments(routeName);

  if (segments[0] !== DEV_ONLY_ROUTE_FOLDER) {
    return false;
  }

  return environment === 'production';
}

function Middleware(m, req, res) {
  const self = this;

  self.Manager = m;
  self.req = req;
  self.res = res;
}

Middleware.prototype.run = function (libPath, options) {
  const self = this;

  // Shortcuts
  const Manager = self.Manager;
  const req = self.req;
  const res = self.res;
  const { cors } = Manager.libraries;

  return cors(req, res, async () => {
    const ctx = Manager.RouteContext({req: req, res: res});

    // A route path may only ever name a handler INSIDE the routes directory.
    // It arrives off the request URL, and the loader below feeds it straight to
    // path.resolve() — so refuse anything that climbs out FIRST, before any
    // folder-level gate keys off a path that resolve() would rewrite.
    if (isRouteOutsideRoutesDir(libPath)) {
      ctx.log(`Middleware.run(): Refused ${libPath} — a route path may not escape the routes directory`);

      return ctx.respond('Not found', {code: 404});
    }

    // Development-only route folders are 404'd in production. This is the one
    // place BOTH request paths converge — the deployed omega_api function
    // (Manager._processMiddleware) and the local express server
    // (Manager.setupCustomServer) — so gating here gates every test route at
    // once, including any added later.
    if (isDevOnlyRouteBlocked(libPath, ctx.getEnvironment())) {
      ctx.log(`Middleware.run(): Refused ${libPath} — the ${DEV_ONLY_ROUTE_FOLDER}/ route folder is development-only`);

      return ctx.respond('Not found', {code: 404});
    }

    // Set options
    options = options || {};
    options.authenticate = typeof options.authenticate === 'boolean' ? options.authenticate : true;
    options.setupAnalytics = typeof options.setupAnalytics === 'boolean' ? options.setupAnalytics : true;
    options.setupUsage = typeof options.setupUsage === 'boolean' ? options.setupUsage : true;
    options.setupSettings = typeof options.setupSettings === 'undefined' ? true : options.setupSettings;
    options.sanitize = typeof options.sanitize === 'undefined' ? false : options.sanitize;
    options.includeNonSchemaSettings = typeof options.includeNonSchemaSettings === 'undefined' ? false : options.includeNonSchemaSettings;
    options.schema = typeof options.schema === 'undefined' ? libPath : options.schema;
    options.parseMultipartFormData = typeof options.parseMultipartFormData === 'undefined' ? true : options.parseMultipartFormData;

    // Set base path
    options.routesDir = typeof options.routesDir === 'undefined' ? `${Manager.cwd}/routes` : options.routesDir;
    options.schemasDir = typeof options.schemasDir === 'undefined' ? `${Manager.cwd}/schemas` : options.schemasDir;

    // Parse multipart/form-data if needed
    if (options.parseMultipartFormData && req.headers['content-type']?.includes('multipart/form-data')) {
      try {
        const parsed = await ctx.parseMultipartFormData();

        // Add each field to the body either as a whole json object or each field
        // Parsed JSON
        if (parsed.fields.json) {
          ctx.request.body = JSON5.parse(parsed.fields.json || '{}');
        } else {
          ctx.request.body = parsed.fields;
        }

        // Re-assign data how ctx normally does it
        ctx.request.data = merge({}, ctx.request.body, ctx.request.query);

        // Log that it was parsed successfully
        ctx.log(`Middleware.run(): Parsed multipart form data successfully`);
      } catch (e) {
        return ctx.respond(new Error(`Failed to parse multipart form data: ${e.message}`), {code: 400});
      }
    }

    // Set properties
    const data = ctx.request.data;
    const headers = ctx.request.headers;
    const method = ctx.request.method.toLowerCase();
    const url = ctx.request.url;
    const geolocation = ctx.request.geolocation;
    const client = ctx.request.client;

    // Strip URL
    const strippedUrl = stripUrl(url);

    // Log
    ctx.log(`Middleware.process(): Request (${geolocation.ip || 'unknown'} @ ${geolocation.country || '?'}, ${geolocation.region || '?'}, ${geolocation.city || '?'}) [${method} > ${strippedUrl}]`, safeStringify(redactDataForLog(data)));
    ctx.log(`Middleware.process(): Headers`, safeStringify(redactHeadersForLog(headers)));

    // Set paths
    const routesDir = path.resolve(options.routesDir, libPath.replace('.js', ''));
    const schemasDir = path.resolve(options.schemasDir);

    // Wakeup trigger (quit immediately if wakeup is true to avoid cold start on a future request)
    if (data.wakeup) {
      ctx.log(`Middleware.process(): Wakeup activated at ${new Date().toISOString()}`);

      return ctx.respond({wakeup: true});
    }

    // Load route handler
    // First try method-specific file (e.g., get.js, post.js), then fallback to
    // index.js. Existence is checked BEFORE require so a route module's own
    // broken require can't be mistaken for a missing file — and a route DIR
    // that exists with neither file for this method answers an honest 405
    // instead of a 500 (dogfood friction #17).
    let routeHandler;

    try {
      const methodFile = `${method}.js`;
      const methodFilePath = path.resolve(routesDir, methodFile);
      const indexPath = path.resolve(routesDir, 'index.js');

      if (fs.existsSync(methodFilePath)) {
        routeHandler = require(methodFilePath);
        ctx.log(`Middleware.process(): Loaded route: ${methodFile}`);
      } else if (fs.existsSync(indexPath)) {
        routeHandler = require(indexPath);
        ctx.log(`Middleware.process(): Method-specific file (${methodFile}) not found, using index.js`);
      } else if (fs.existsSync(routesDir)) {
        return ctx.respond(new Error(`Method not allowed: ${method.toUpperCase()} is not supported by ${libPath}`), {code: 405});
      } else {
        return ctx.respond(new Error(`Unable to load route @ (${libPath}): route does not exist`), {code: 500});
      }
    } catch (e) {
      return ctx.respond(new Error(`Unable to load route @ (${libPath}): ${e.message}`), {code: 500});
    }

    // Setup user
    if (options.authenticate) {
      await ctx.authenticate();
    }

    // Setup usage — LAZY ([#647](https://github.com/Omega-JS-Stack/omega/issues/647)):
    // attaching costs nothing, and the counter resolves the account on its
    // first consume()/read(), so a route that never counts never pays for one
    if (options.setupUsage) {
      ctx.usage = Manager.Usage().attach(ctx, {log: false});
    }

    // Log working user
    const workingUser = ctx.getUser();
    const resolvedSub = User.resolveSubscription(workingUser);
    ctx.log(`Middleware.process(): User (${workingUser.auth.uid}, ${workingUser.auth.email}, ${workingUser.subscription.product.id}=${workingUser.subscription.status} (resolved: ${resolvedSub.plan})):`, safeStringify(projectUserForLog(workingUser)));

    // Setup analytics
    if (options.setupAnalytics) {
      const uuid = ctx.request.user.auth.uid
        || ctx.request.geolocation.ip
        || 'unknown'

      ctx.analytics = Manager.Analytics({
        ctx: ctx,
        uuid: uuid,
      });
    }

    // Resolve settings (hold the instance — the sanitize pass below reads the
    // per-field schema map it exposes)
    let settingsLib = null;

    if (options.setupSettings) {
      // Resolve settings
      try {
        // Attach schema to ctx
        // ctx.schema.dir = schemasDir;
        // ctx.schema.name = options.schema;
        settingsLib = Manager.Settings();
        ctx.settings = settingsLib.resolve(ctx, undefined, data, {dir: schemasDir, schema: options.schema});
      } catch (e) {
        return ctx.respond(new Error(`Unable to resolve schema ${options.schema}: ${e.message}`), {code: e.code || 500});
      }

      // // Here we need to include IF it exists the apiKey (admin rides the
      // // omega-admin-key header — never settings)
      // if (data.apiKey) {
      //   ctx.settings.apiKey = data.apiKey;
      // }

      // Merge settings with data
      if (options.includeNonSchemaSettings) {
        ctx.settings = merge(data, ctx.settings)
      }

      // Log multipart files if they exist
      const files = ctx.request.multipartData.files || {};
      if (files) {
        ctx.log(`Middleware.process(): Multipart files`, safeStringify(files));
      }
    } else {
      ctx.settings = data;
    }

    // Trim whitespace on all string settings (always on — harmless and useful).
    ctx.settings = Manager.Utilities().trim(ctx.settings);

    // Optional HTML strip (off by default — opt in with `{ sanitize: true }`).
    // Sanitize at the HTML-insertion site instead unless you need a belt-and-suspenders pass here.
    // Respects sanitize: false on individual schema fields.
    if (options.sanitize) {
      const schema = settingsLib ? settingsLib.schema : null;
      const utilities = Manager.Utilities();

      ctx.settings = sanitizeWithSchema(utilities, ctx.settings, schema);
    }

    // Log
    ctx.log(`Middleware.process(): Resolved settings with schema=${options.schema}`, safeStringify(ctx.settings));

    // Build context object for route handler
    const context = {
      Manager: Manager,
      ctx: ctx,
      user: ctx.getUser(),
      usage: ctx.usage,
      settings: ctx.settings,
      analytics: ctx.analytics,
      libraries: Manager.libraries,
      utilities: Manager.Utilities(),
    };

    // Execute route handler
    try {
      routeHandler(context)
        .catch(e => {
          return ctx.respond(e, {code: e.code});
        });
    } catch (e) {
      return ctx.respond(e, {code: e.code});
    }
  });
};

function sanitizeWithSchema(utilities, obj, schema) {
  // Not an object — sanitize directly
  if (obj == null || typeof obj !== 'object') {
    return utilities.sanitize(obj);
  }

  // Arrays — sanitize each item (no schema for array items)
  if (Array.isArray(obj)) {
    return obj.map(item => utilities.sanitize(item));
  }

  // Objects — walk keys, skip fields where schema says sanitize: false
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const schemaNode = schema ? schema[key] : null;

    if (schemaNode && schemaNode.sanitize === false) {
      result[key] = value;
    } else {
      result[key] = sanitizeWithSchema(utilities, value, schemaNode);
    }
  }
  return result;
}

function stripUrl(url) {
  const newUrl = new URL(url);

  return `${newUrl.host}${newUrl.pathname}`.replace(/\/$/, '');
}

/**
 * The user projection a log line may carry: who the caller is, the plan the
 * request runs under, and the roles that gate it.
 *
 * Built by ALLOW-LIST, not by redacting known-secret keys. The raw document
 * carries `api.privateKey` — a live credential — so logging the doc wrote a
 * durable copy of every caller's key into Cloud Logging on every authenticated
 * request. An allow-list also means a field added to the account schema later
 * stays off the line until somebody puts it here deliberately.
 * @param {object} user - The user document (ctx.getUser())
 * @returns {object} { id, plan: { id, status }, roles: string[] }
 */
function projectUserForLog(user) {
  const roles = user?.roles && typeof user.roles === 'object' ? user.roles : {};

  return {
    id: user?.auth?.uid || null,
    plan: {
      id: user?.subscription?.product?.id || null,
      status: user?.subscription?.status || null,
    },
    // Names of the ENABLED roles only. `roles` is a $passthrough group, so a
    // consumer can hang an arbitrary value off it; emitting names keeps any
    // such value off the line.
    roles: Object.keys(roles).filter((role) => roles[role] === true),
  };
}

/**
 * A COPY of `source` with every credential channel rendered by `render`.
 * A copy because ctx.request.headers IS req.headers and ctx.request.data is
 * what the route handler reads next — redacting in place would break the
 * authentication the line is describing.
 * @param {object} source - Headers or request data.
 * @param {string[]} channels - Lower-cased key names to redact.
 * @param {function} render - (value, key) → the string to log instead.
 * @returns {object} A shallow copy, credential channels replaced.
 */
function redactChannels(source, channels, render) {
  const object = source && typeof source === 'object' ? source : {};
  const redacted = { ...object };

  for (const key of Object.keys(object)) {
    if (channels.includes(key.toLowerCase())) {
      redacted[key] = render(`${object[key] || ''}`, key.toLowerCase());
    }
  }

  return redacted;
}

/**
 * The headers a log line may carry. An API key authenticates as
 * `Authorization: Bearer <api.privateKey>`, so the raw headers line wrote a
 * live credential into Cloud Logging on every API-key request
 * ([#275](https://github.com/Omega-JS-Stack/omega/issues/275)). The auth scheme
 * survives — it says WHICH lane the caller used, which is the diagnostic value
 * of the line — and the credential after it does not.
 * @param {object} headers - ctx.request.headers
 * @returns {object} A copy safe to log.
 */
function redactHeadersForLog(headers) {
  return redactChannels(headers, CREDENTIAL_HEADERS, (value, key) => {
    const scheme = key === 'authorization' ? /^(\S+\s+)(.+)$/.exec(value) : null;

    return scheme ? `${scheme[1]}${redactSecret(scheme[2])}` : redactSecret(value);
  });
}

/**
 * The request data a log line may carry: the two payload credential lanes
 * (`apiKey`, `authenticationToken`) redacted, every other field intact — the
 * line is the primary request trace and stays readable
 * ([#275](https://github.com/Omega-JS-Stack/omega/issues/275)).
 * @param {object} data - ctx.request.data
 * @returns {object} A copy safe to log.
 */
function redactDataForLog(data) {
  return redactChannels(data, CREDENTIAL_DATA_KEYS, (value) => redactSecret(value));
}

/**
 * The response a log line may carry: a DEEP copy with every credential key
 * rendered by `redactSecret()`, at any depth and whatever its case.
 *
 * The route logger's `Sending response` line stringifies whatever a route
 * answers, and `GET /omega/user` answers the whole user record: every
 * `connections.<provider>.token` plus `api.privateKey` landed in Cloud Logging
 * on every read ([#796](https://github.com/Omega-JS-Stack/omega/issues/796)).
 * [#275](https://github.com/Omega-JS-Stack/omega/issues/275) gave the request
 * side of that line this treatment; this is the response side. A copy because
 * the object is what `res.json()` sends next.
 * @param {*} response - Whatever respond() is about to send.
 * @returns {*} A copy safe to log; anything that is not an object passes through.
 */
function redactResponseForLog(response) {
  if (!response || typeof response !== 'object') {
    return response;
  }

  // Anything that serializes itself is walked through THAT shape: the copy
  // reads own properties, and a Date has none, so a walked Date logged as `{}`
  // where JSON.stringify would have shown its ISO string.
  if (typeof response.toJSON === 'function') {
    return redactResponseForLog(response.toJSON());
  }

  if (Array.isArray(response)) {
    return response.map((item) => redactResponseForLog(item));
  }

  const redacted = {};

  for (const [key, value] of Object.entries(response)) {
    if (!isCredentialResponseKey(key)) {
      redacted[key] = redactResponseForLog(value);

      continue;
    }

    // An absent credential says so: "no token stored" is a diagnostic the line
    // exists for, and it gives nothing away. A flag or a count under a
    // credential-shaped name (`hasPassword: true`) is not a secret either.
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
      redacted[key] = value;
    } else {
      redacted[key] = typeof value === 'string' ? redactSecret(value) : REDACTED_OBJECT;
    }
  }

  return redacted;
}

/**
 * Whether a response key names a credential, separator and case insensitively.
 * @param {string} key - The key as the response spells it.
 * @returns {boolean}
 */
function isCredentialResponseKey(key) {
  const name = key.toLowerCase().replace(/[-_]/g, '');

  return CREDENTIAL_RESPONSE_KEYS.includes(name)
    || CREDENTIAL_RESPONSE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

// Helper to safely stringify objects by truncating long strings (like base64)
function safeStringify(obj, maxLength = 100) {
  const truncate = (value) => {
    if (typeof value === 'string' && value.length > maxLength) {
      return `${value.substring(0, maxLength)}... [truncated ${value.length - maxLength} chars]`;
    }
    return value;
  };

  const truncated = JSON.parse(JSON.stringify(obj, (key, value) => truncate(value)));
  return JSON.stringify(truncated);
}

// Static, alongside User.resolveSubscription's precedent — the dev-only
// decision is pure, so tests exercise it directly with a real Manager's
// getEnvironment() rather than through a hand-rolled request.
Middleware.isDevOnlyRouteBlocked = isDevOnlyRouteBlocked;
Middleware.isRouteOutsideRoutesDir = isRouteOutsideRoutesDir;
Middleware.projectUserForLog = projectUserForLog;
Middleware.redactHeadersForLog = redactHeadersForLog;
Middleware.redactDataForLog = redactDataForLog;
Middleware.redactResponseForLog = redactResponseForLog;
Middleware.DEV_ONLY_ROUTE_FOLDER = DEV_ONLY_ROUTE_FOLDER;

module.exports = Middleware;
