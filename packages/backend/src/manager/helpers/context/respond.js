/**
 * RouteContext response door — the ONE home of the wire contract.
 *
 * - respond(payload, options): the only sender. Objects go as JSON, 3xx codes
 *   redirect, Error payloads (or 4xx/5xx codes) take the error path. Every
 *   response carries the omega-properties header (code, tag, usage, schema).
 * - redirect(url, options): respond() with a 302 default.
 * - report(error, options): decorate + log + capture WITHOUT sending — the
 *   error factory for throw/reject sites and res-less triggers. Returns the
 *   decorated Error.
 *
 * Sentry rule (cp263, replaces the per-call options.sentry/options.log dance):
 * server-fault errors (code >= 500) capture to Sentry automatically; client
 * faults (4xx) never do. No per-call flags.
 */

const methods = {
  respond(response, options) {
    const self = this;
    const res = self.ref.res;

    // If response is a promise, wait for it to resolve and then call respond again with the resolved value
    if (response && typeof response.then === 'function') {
      return response
        .then((resolved) => self.respond(resolved, options))
        .catch((error) => self.respond(error, options));
    }

    // Structural double-respond guard — a second respond() (e.g. a route that keeps running
    // after an error path already responded) would crash with ERR_HTTP_HEADERS_SENT
    if (res?.headersSent) {
      self.warn('respond() called after a response was already sent — ignoring');
      return;
    }

    // Set options
    options = options || {};
    options.code = typeof options.code === 'undefined'
      ? 200
      : options.code;

    // log: false silences the success-path body log (large payloads like served
    // HTML); the error path always logs
    options.log = typeof options.log === 'undefined'
      ? true
      : options.log;

    // Fix code
    options.code = parseInt(options.code);

    // Error path: an Error payload or an error code
    const isErrorCode = isBetween(options.code, 400, 599);
    if (
      response instanceof Error
      || isErrorCode
    ) {
      options.code = isErrorCode ? options.code : undefined;

      return _sendError(self, response, options);
    }

    // Attach properties
    attachHeaderProperties(self, options);

    // Send response
    res.status(options.code);

    // Clear log prefix before sending
    self.clearLogPrefix();

    // Redirect
    const isRedirect = isBetween(options.code, 300, 399);
    if (isRedirect) {
      if (options.log) {
        self.log(`Redirecting (${options.code}):`, JSON.stringify(response));
      }

      return res.redirect(response);
    }

    if (options.log) {
      self.log(`Sending response (${options.code}):`, JSON.stringify(response));
    }

    // If it is an object, send as json
    if (
      response
      && typeof response === 'object'
      && typeof res.json === 'function'
    ) {
      return res.json(response);
    } else {
      return res.send(response);
    }
  },

  redirect(response, options) {
    const self = this;

    // Set options
    options = options || {};
    options.code = typeof options.code === 'undefined'
      ? 302
      : options.code;

    return self.respond(response, options);
  },

  // Decorate + log + capture, WITHOUT sending. Returns the decorated Error, so
  // throw/reject sites read naturally: `throw ctx.report('Bad settings', { code: 400 })`.
  // Also the right call in res-less contexts (auth triggers, cron) — the response
  // header attach inside is a no-op when there is no res.
  report(e, options) {
    const self = this;

    // Set options
    options = options || {};

    // Code: default to 500, else the caller's option; the Error's own code wins
    // over the default (but never over an explicit option)
    const isCodeSet = typeof options.code !== 'undefined';
    options.code = !isCodeSet
      ? 500
      : options.code;

    // Construct error
    const newError = e instanceof Error
      ? e
      : new Error(stringifyNonStrings(e));

    // Fix code
    options.code = isCodeSet ? options.code : newError.code || options.code;
    options.code = parseInt(options.code);
    options.code = isBetween(options.code, 400, 599) ? options.code : 500;

    // Attach properties (response header when a res exists + onto the Error itself)
    attachHeaderProperties(self, options, newError);

    // Log: server faults as real errors, client faults as a warning line
    if (isBetween(options.code, 500, 599)) {
      self.error(newError);

      // Server faults capture to Sentry automatically — one rule, no per-call flags
      self.Manager.libraries.sentry?.captureException?.(newError);
    } else {
      self.log(`⚠️ Client error (${options.code}):`, newError.message, newError.stack);
    }

    return newError;
  },
};

// Build the decorated error via report(), then send it (respond()'s error path)
function _sendError(self, e, options) {
  const res = self.ref.res;

  const newError = self.report(e, options);

  // Respond only if this context has a res (triggers do not) and nothing was sent yet
  if (res?.status && !res.headersSent) {
    let sendable = newError?.stack && options.stack
      ? newError?.stack
      : newError?.message;

    // Set error
    sendable = `${sendable || newError || 'Unknown error'}`;

    // Attach tag
    if (newError.tag) {
      sendable = `${sendable} (${newError.tag})`;
    }

    // Clear log prefix before sending
    self.clearLogPrefix();

    // Log
    self.log(`Sending response (${options.code}):`, JSON.stringify(sendable));

    // Send response
    res
      .status(options.code)
      .send(sendable);
  }

  return newError;
}

// The omega-properties header: code, tag, usage current+limits, schema, additional.
// Rides EVERY response (success and error) and is exposed to browsers via
// Access-Control-Expose-Headers; @omega.js/client's omega.request() consumes it.
function attachHeaderProperties(self, options, error) {
  // Create headers
  const headers = {
    code: options.code,
    tag: self.tag,
    usage: {
      current: self.usage ? self.usage.getUsage() : {},
      limits: self.usage ? self.usage.getLimit() : {},
    },
    schema: self.schema || {},
    additional: options.additional || {},
  };
  const res = self.ref.res;

  // Attach properties if this context has a res (it sometimes does not, like in auth().onCreate() triggers)
  // and only if nothing was sent yet — setting a header after send crashes with ERR_HTTP_HEADERS_SENT
  if (res?.header && res?.get && !res.headersSent) {
    res.header('omega-properties', JSON.stringify(headers));

    // Add omega-properties to Access-Control-Expose-Headers
    const existingExposed = res.get('Access-Control-Expose-Headers') || '';

    // If it does not exist, add it
    if (!existingExposed.match(/omega-properties/i)) {
      const newExposed = `${existingExposed}, omega-properties`.replace(/^, /, '');
      res.header('Access-Control-Expose-Headers', newExposed);
    }
  }

  // Attach properties to the error itself (callers read error.code etc.)
  if (error) {
    Object.keys(headers)
    .forEach((item) => {
      error[item] = headers[item];
    });
  }
}

function isBetween(value, min, max) {
  return value >= min && value <= max;
}

function stringifyNonStrings(e) {
  if (typeof e === 'string') {
    return e;
  } else {
    return JSON.stringify(e);
  }
}

module.exports = { methods };
