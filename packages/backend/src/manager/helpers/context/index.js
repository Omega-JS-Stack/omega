/**
 * RouteContext — the per-request context every route/event/cron handler receives
 * as `ctx` (successor to BackendAssistant, renamed cp263).
 *
 * One instance wraps one request/response exchange (or one trigger invocation
 * without a res): parsed request data, logging, authentication, and the
 * response door (respond/redirect/report) with the omega-properties header +
 * status-code semantics.
 *
 * One concern per module: wiring here, everything else mixed in from siblings.
 */

const os = require('os');
const path = require('path');
const _ = require('lodash');
const uuid = require('uuid');

const logging = require('./logging.js');
const respond = require('./respond.js');
const authenticate = require('./authenticate.js');
const parse = require('./parse.js');
const { getClient } = require('./client-info.js');

function RouteContext() {
  const self = this;

  self.meta = {};
  self.initialized = false;

  return self;
}

RouteContext.prototype.init = function (ref, options) {
  const self = this;

  // Set options
  options = options || {};
  options.accept = options.accept || 'json';
  options.showOptionsLog = typeof options.showOptionsLog !== 'undefined' ? options.showOptionsLog : false;
  options.optionsLogString = typeof options.optionsLogString !== 'undefined' ? options.optionsLogString : '\n\n\n\n\n';
  options.fileSavePath = options.fileSavePath || process.env.npm_package_name || '';

  // Set now
  const now = new Date();

  // Attached libraries - used in report()/respond()
  self.analytics = null;
  self.usage = null;
  self.settings = null;
  self.schema = null;

  // Set ref FIRST so self.Manager is available below — meta.environment forwards to the
  // Manager's canonical getEnvironment() (the Manager is the SSOT), so the Manager ref must
  // be wired before we resolve the environment.
  ref = ref || {};

  // A context has no independent identity — it's a request-scoped face for its Manager,
  // and forwards environment/url resolution to it. A Manager ref is REQUIRED; constructing
  // one without it is a programming error (use Manager.RouteContext(), which injects it).
  if (!ref.Manager || typeof ref.Manager.getEnvironment !== 'function') {
    throw new Error('RouteContext.init(): a Manager reference is required (ref.Manager). Construct via Manager.RouteContext() so it is injected automatically.');
  }

  self.ref = {};
  self.ref.req = ref.req || {};
  self.ref.res = ref.res || {};
  self.ref.admin = ref.admin || {};
  self.ref.functions = ref.functions || {};
  self.ref.Manager = ref.Manager;
  self.Manager = self.ref.Manager;

  // Set meta
  self.meta = {};

  self.meta.startTime = {};
  self.meta.startTime.timestamp = now.toISOString();
  self.meta.startTime.timestampUNIX = Math.round((now.getTime()) / 1000);

  // Outside a function invocation (CLI lane, internal helpers) the module is the manager core.
  self.meta.name = options.functionName || process.env.FUNCTION_TARGET || 'manager';
  self.meta.environment = options.environment || self.getEnvironment();
  self.meta.type = options.functionType || process.env.FUNCTION_SIGNATURE_TYPE || 'unknown';

  // Set ID
  try {
    const headers = self?.ref?.req.headers || {};

    self.id = headers['function-execution-id']
      || headers['X-Cloud-Trace-Context']
      || self.Manager.Utilities().randomId();
  } catch {
    self.id = now.getTime();
  }

  // Set tag
  self.tag = `${self.meta.name}/${self.id}`;

  // Set logger prefix
  self.logPrefix = '';

  // Set stuff about request
  self.request = {};
  self.request.referrer = self.ref.req.headers?.referrer || self.ref.req.headers?.referer || '';
  self.request.method = self.ref.req.method || undefined;

  // Set geolocation + client data from headers (client-info.js owns the header vocabulary)
  const client = getClient(self.ref.req.headers, self.ref.req);

  self.request.geolocation = {
    ip: client.ip,
    continent: client.continent,
    country: client.country,
    region: client.region,
    city: client.city,
    latitude: client.latitude,
    longitude: client.longitude,
  };

  self.request.client = {
    userAgent: client.userAgent,
    language: client.language,
    platform: client.platform,
    mobile: client.mobile,
    url: client.url,
  };

  // Set request type
  if (
    self.ref.req.xhr || (self.ref.req?.headers?.accept || '').includes('json')
    || (self.ref.req?.headers?.['content-type'] || '').includes('json')
  ) {
    self.request.type = 'ajax';
  } else {
    self.request.type = 'form';
  }
  self.request.url = parse.tryUrl(self);
  self.request.path = self.ref.req.path || '';
  self.request.user = self.Manager.User({}).properties;
  self.request.user.authenticated = false;

  // Set body and query
  if (options.accept === 'json') {
    self.request.body = parse.tryParse(self.ref.req.body || '{}');
    self.request.query = parse.tryParse(self.ref.req.query || '{}');
  }

  // Set headers
  self.request.headers = self.ref.req.headers || {};

  // Merge data
  self.request.data = _.merge({}, self.request.body, self.request.query);

  // Set multipart data
  self.request.multipartData = {
    fields: {},
    files: {},
  };

  // Constants
  self.constant = {};
  self.constant.pastTime = {};
  self.constant.pastTime.timestamp = '1999-01-01T00:00:00Z';
  self.constant.pastTime.timestampUNIX = 915148800;

  // Visual request separator in dev logs
  if (
    (self.isDevelopment())
    && ((self.request.method !== 'OPTIONS') || (self.request.method === 'OPTIONS' && options.showOptionsLog))
    && (self.request.method !== 'undefined')
  ) {
    console.log(options.optionsLogString);
  }

  // Set tmpdir
  self.tmpdir = path.resolve(os.tmpdir(), options.fileSavePath, uuid.v4());

  // Set initialized
  self.initialized = true;

  return self;
};

// Environment helpers — the Manager is the SINGLE SOURCE OF TRUTH (see index.js). The
// context is a request-scoped face for its Manager and FORWARDS these straight through,
// so request handlers can call `ctx.getEnvironment()` / `ctx.isTesting()` and get exactly
// the same answer as `Manager.getEnvironment()`. No duplicated env-var logic lives here.
//
// Returns exactly ONE of 'development' | 'testing' | 'production' (mutually exclusive,
// testing wins). isDevelopment() is NOT true in testing; isProduction() is a real positive
// check (never `!isDevelopment()`). Gate "anything non-production" with `!isProduction()`
// or `isDevelopment() || isTesting()` intentionally.
RouteContext.prototype.getEnvironment = function () {
  return this.Manager.getEnvironment();
};

RouteContext.prototype.isDevelopment = function () {
  return this.Manager.isDevelopment();
};

RouteContext.prototype.isProduction = function () {
  return this.Manager.isProduction();
};

RouteContext.prototype.isTesting = function () {
  return this.Manager.isTesting();
};

RouteContext.prototype.getUser = function () {
  const self = this;

  return self?.usage?.user || self.request.user;
};

// Mix in the concern modules
Object.assign(
  RouteContext.prototype,
  logging.methods,
  respond.methods,
  authenticate.methods,
  parse.methods,
);

module.exports = RouteContext;
