/**
 * Log redaction: what a request, a response and a user may put on a log line.
 *
 * Every backend log line lands in Cloud Logging for the whole retention window,
 * so the request trace, the headers line, the user line and the response line
 * each pass through one of these first. Shared by the request pipeline, the
 * Context response door and the utilities service.
 */

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

/**
 * The user projection a log line may carry: who the caller is, the plan the
 * request runs under, and the roles that gate it.
 *
 * Built by ALLOW-LIST, not by redacting known-secret keys. The raw document
 * carries `api.privateKey` — a live credential — so logging the doc wrote a
 * durable copy of every caller's key into Cloud Logging on every authenticated
 * request. An allow-list also means a field added to the account schema later
 * stays off the line until somebody puts it here deliberately.
 * @param {object} user - The user document (ctx.user)
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

module.exports = {
  CREDENTIAL_HEADERS,
  CREDENTIAL_DATA_KEYS,
  projectUserForLog,
  redactHeadersForLog,
  redactDataForLog,
  redactResponseForLog,
  safeStringify,
};
