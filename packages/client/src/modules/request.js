/**
 * request — the harmonized API-fetch layer (successor to legacy UJM's authorizedFetch).
 *
 * One implementation for every surface: the browser singleton exposes it as
 * `omega.request(url, options)`; desktop main and the extension service worker
 * construct their own instance via `createRequest(deps)` with their framework's
 * url/auth plumbing. Every response's `omega-properties` header (code, tag,
 * usage current+limits, schema, additional — emitted by @omega.js/backend's
 * assistant on every respond/errorify) is parsed automatically; contexts with
 * bindings get server usage merged into the top-level `usage` bindings key.
 *
 * deps contract:
 *   getApiUrl()          -> base API url (required for route-relative paths)
 *   getIdToken(force)    -> fresh Firebase ID token, or null when signed out
 *   onProperties(props)  -> optional; called with the parsed omega-properties object
 *
 * `wakeup: true` is the one option that changes the SHAPE of the call: it warms
 * a cold backend and returns nothing (see the branch below).
 */

import { createLogger } from './logger.js';

const logger = createLogger('request');


const PROPERTIES_HEADER = 'omega-properties';

// The route every wakeup aims at, on every surface. ONE home because a wakeup
// never runs a route: @omega.js/backend's middleware answers it before it loads
// one, so the path is a label rather than a destination, and every caller
// naming "the route I am about to need" would be a dozen spellings of the same
// warm function. `/omega/health` is the public, input-free liveness probe — the
// one route whose name means exactly what this call does, and the only one that
// would still be harmless if the short-circuit ever stopped short-circuiting
// ([#644](https://github.com/Omega-JS-Stack/omega/issues/644)).
const WAKEUP_ROUTE = '/omega/health';

// Delay between retry attempts (options.tries)
const RETRY_DELAY = 500;

function createRequest(deps) {
  if (typeof deps?.getApiUrl !== 'function' || typeof deps?.getIdToken !== 'function') {
    throw new Error('createRequest requires getApiUrl and getIdToken deps');
  }

  return async function request(url, options = {}) {
    // Route-relative paths resolve through the host's getApiUrl(); absolute urls pass through
    const target = url.startsWith('/')
      ? `${deps.getApiUrl()}${url}`
      : url;

    // A wakeup is a fire-and-forget ping that warms a cold backend, nothing
    // more: @omega.js/backend's middleware sees `wakeup` in the request data
    // and answers it BEFORE it loads a route or authenticates, so every route
    // costs the same and none of them runs. Nothing is read back, no token is
    // minted, and a dead network resolves like a live one — the caller is not
    // waiting on an answer.
    if (options.wakeup) {
      fetch(withWakeupParam(target), { method: 'GET' }).catch(() => {});
      return;
    }

    const headers = { ...(options.headers || {}) };

    // Attach a fresh Bearer ID token unless the caller opted out (public routes)
    if (options.auth !== false) {
      const idToken = await Promise.resolve(deps.getIdToken(true)).catch(() => null);

      if (idToken) {
        headers['Authorization'] = `Bearer ${idToken}`;
      } else {
        logger.warn('No authenticated user — sending without Authorization. Did auth settle yet?');
      }
    }

    // JSON-encode object bodies (strings/FormData/URLSearchParams pass through)
    let body = options.body;
    if (body && typeof body === 'object' && !isRawBody(body)) {
      body = JSON.stringify(body);
      if (!hasHeader(headers, 'content-type')) {
        headers['Content-Type'] = 'application/json';
      }
    }

    // Fetch with bounded retries (network errors + 5xx) and an optional
    // per-attempt timeout — the wonderful-fetch semantics the legacy
    // authorizedFetch callers relied on (tries, timeout).
    const tries = Math.max(1, options.tries || 1);
    let response;

    for (let attempt = 1; ; attempt++) {
      try {
        response = await fetch(target, {
          ...options,
          // A body with no explicit method infers POST — fetch throws a
          // TypeError on GET/HEAD carrying a body, so the GET default is
          // never right there.
          method: options.method || (options.body ? 'POST' : 'GET'),
          headers,
          body,
          ...(options.timeout ? { signal: AbortSignal.timeout(options.timeout) } : {}),
        });

        if (response.status < 500 || attempt >= tries) {
          break;
        }
      } catch (e) {
        if (attempt >= tries) {
          throw e;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
    }

    // omega-properties rides EVERY assistant response (success and error)
    const properties = parseProperties(response.headers.get(PROPERTIES_HEADER));
    if (properties && deps.onProperties) {
      deps.onProperties(properties);
    }

    const data = await parseBody(response);

    if (!response.ok) {
      const message = (data && typeof data === 'object' && data.message)
        || (typeof data === 'string' && data)
        || `Request failed with status ${response.status}`;
      const error = new Error(message);
      error.code = response.status;
      error.properties = properties;
      error.data = data;
      throw error;
    }

    if (options.output === 'complete') {
      return { status: response.status, ok: response.ok, headers: response.headers, data, properties };
    }

    return data;
  };
}

// Merge server usage (current counters + plan limits) from an omega-properties
// payload into the top-level `usage` bindings key — the same key auth settle
// seeds, so `data-omega-bind` elements refresh automatically after every request.
// Shape per feature: { monthly, daily, ..., limit }.
function mergeUsageIntoBindings(bindings, properties) {
  const current = properties?.usage?.current;
  if (!current || !Object.keys(current).length) {
    return;
  }

  const limits = properties.usage.limits || {};
  const existing = bindings.getContext().usage || {};
  const usage = { ...existing };

  for (const key of Object.keys(current)) {
    usage[key] = {
      ...existing[key],
      ...current[key],
      // A key the server reports usage for but omits from limits must not
      // clobber the catalog-seeded limit from auth settle
      limit: limits[key] ?? existing[key]?.limit ?? 0,
    };
  }

  bindings.update({ usage });
}

function parseProperties(raw) {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (e) {
    logger.warn('Failed to parse omega-properties header:', e.message);
    return null;
  }
}

async function parseBody(response) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return response.json().catch(() => null);
  }

  return response.text();
}

// The param rides the URL because a wakeup is a GET, and the middleware reads
// it from the request data it merges the query string into.
function withWakeupParam(url) {
  return `${url}${url.includes('?') ? '&' : '?'}wakeup=true`;
}

function hasHeader(headers, name) {
  return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

function isRawBody(body) {
  return (typeof FormData !== 'undefined' && body instanceof FormData)
    || (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams)
    || (typeof Blob !== 'undefined' && body instanceof Blob)
    || (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer);
}

export { createRequest, mergeUsageIntoBindings, WAKEUP_ROUTE };
export default createRequest;
