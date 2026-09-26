/**
 * Context: the `ctx` every route, event and cron handler receives, one class
 * for all three.
 *
 * One instance wraps one request/response exchange, or one trigger invocation
 * without either: `ctx.request` is the parsed request on HTTP and null
 * everywhere else. It carries the tagged logger, the response door
 * (respond/redirect/report) with the omega-properties header and status-code
 * semantics, authentication, and the request services, each built on first
 * read: `ctx.user` (a signed-out `User` until `authenticate()` lands one),
 * `ctx.usage`, `ctx.analytics`, `ctx.email`, `ctx.ai` and `ctx.metadata()`.
 * `ctx.data` is the route's validated input, set by the request pipeline.
 *
 * One concern per module: the class here, its logging, response, auth and
 * parsing methods mixed in from context/.
 */
const os = require('os');
const path = require('path');
const _ = require('lodash');
const uuid = require('uuid');

const { User } = require('./helpers/account.js');
const Usage = require('./services/usage.js');
const Analytics = require('./services/analytics.js');
const Metadata = require('./services/metadata.js');
const Email = require('./libraries/email/index.js');
const AI = require('./libraries/ai/index.js');
const logging = require('./context/logging.js');
const respond = require('./context/respond.js');
const authenticate = require('./context/authenticate.js');
const parse = require('./context/parse.js');
const { getClient } = require('./context/client-info.js');

/**
 * The context of one handler invocation.
 */
class Context {
  /**
   * @param {object} omega - the Omega instance (the environment, config and process services).
   * @param {object} [exchange] - { req, res }: the HTTP exchange, absent for events and cron.
   * @param {object} [options] - { accept, showOptionsLog, optionsLogString, fileSavePath, functionName, functionType, environment }
   */
  constructor(omega, { req = null, res = null } = {}, options = {}) {
    options.accept = options.accept || 'json';
    options.showOptionsLog = typeof options.showOptionsLog !== 'undefined' ? options.showOptionsLog : false;
    options.optionsLogString = typeof options.optionsLogString !== 'undefined' ? options.optionsLogString : '\n\n\n\n\n';
    options.fileSavePath = options.fileSavePath || process.env.npm_package_name || '';

    const now = new Date();

    this.omega = omega;
    this.req = req;
    this.res = res;

    // The request services, built on first read (see the getters below)
    this._services = {};

    // Outside a function invocation (CLI lane, internal helpers) the module is the manager core
    this.meta = {
      startTime: {
        timestamp: now.toISOString(),
        timestampUNIX: Math.round(now.getTime() / 1000),
      },
      name: options.functionName || process.env.FUNCTION_TARGET || 'manager',
      environment: options.environment || this.getEnvironment(),
      type: options.functionType || process.env.FUNCTION_SIGNATURE_TYPE || 'unknown',
    };

    // The invocation id: the runtime's, else a fresh one
    try {
      const headers = (req && req.headers) || {};

      this.id = headers['function-execution-id']
        || headers['X-Cloud-Trace-Context']
        || omega.utilities.randomId();
    } catch {
      this.id = now.getTime();
    }

    this.tag = `${this.meta.name}/${this.id}`;
    this.logPrefix = '';

    // The parsed request, on HTTP only
    this.request = req ? buildRequest(this, req, options) : null;

    // The route's validated input, set by the request pipeline
    this.data = undefined;

    // Visual request separator in dev logs
    if (
      this.request
      && this.isDevelopment()
      && ((this.request.method !== 'OPTIONS') || (this.request.method === 'OPTIONS' && options.showOptionsLog))
    ) {
      console.log(options.optionsLogString);
    }

    this.tmpdir = path.resolve(os.tmpdir(), options.fileSavePath, uuid.v4());
  }

  /** The caller: a signed-out `User` until authenticate() resolves one. */
  get user() {
    this._services.user = this._services.user || new User();

    return this._services.user;
  }

  /** The counted-feature gate for this caller (services/usage.js). */
  get usage() {
    this._services.usage = this._services.usage || new Usage(this);

    return this._services.usage;
  }

  /** GA4 events as this caller (services/analytics.js). */
  get analytics() {
    this._services.analytics = this._services.analytics || new Analytics(this);

    return this._services.analytics;
  }

  /** Transactional and marketing email, logging through this context (libraries/email). */
  get email() {
    this._services.email = this._services.email || new Email(this);

    return this._services.email;
  }

  /** The provider-agnostic AI surface, logging through this context (libraries/ai). */
  get ai() {
    this._services.ai = this._services.ai || new AI(this);

    return this._services.ai;
  }

  /**
   * Stamp a document's metadata block (services/metadata.js).
   * @param {object} [metadata] - { tag }: the tag to stamp, else a fresh uuid.
   * @param {object} [document] - the document the block is written onto.
   * @returns {object} the metadata block.
   */
  metadata(metadata, document) {
    this._services.metadata = this._services.metadata || new Metadata(this);

    return this._services.metadata.set(metadata, document);
  }

  // Environment helpers: the Omega instance is the ONE source (see index.js).
  // The context forwards them straight through, so `ctx.isTesting()` answers
  // exactly what `omega.isTesting()` does. Exactly one of the three is*() is
  // true: isDevelopment() is NOT true in testing, and isProduction() is a real
  // positive check, never `!isDevelopment()`.
  getEnvironment() {
    return this.omega.getEnvironment();
  }

  isDevelopment() {
    return this.omega.isDevelopment();
  }

  isProduction() {
    return this.omega.isProduction();
  }

  isTesting() {
    return this.omega.isTesting();
  }
}

/**
 * The parsed request of an HTTP exchange.
 * @param {Context} ctx - the context being built (its meta and omega are set).
 * @param {object} req - the request.
 * @param {object} options - the context options (`accept`).
 * @returns {object} ctx.request.
 */
function buildRequest(ctx, req, options) {
  const request = {};

  request.referrer = req.headers?.referrer || req.headers?.referer || '';
  request.method = req.method || undefined;

  // Set geolocation + client data from headers (client-info.js owns the header vocabulary)
  const client = getClient(req.headers, req);

  request.geolocation = {
    ip: client.ip,
    continent: client.continent,
    country: client.country,
    region: client.region,
    city: client.city,
    latitude: client.latitude,
    longitude: client.longitude,
  };

  request.client = {
    userAgent: client.userAgent,
    language: client.language,
    platform: client.platform,
    mobile: client.mobile,
    url: client.url,
  };

  // Set request type
  if (
    req.xhr || (req.headers?.accept || '').includes('json')
    || (req.headers?.['content-type'] || '').includes('json')
  ) {
    request.type = 'ajax';
  } else {
    request.type = 'form';
  }
  request.url = parse.tryUrl(ctx, req);
  request.path = req.path || '';

  // Set body and query
  if (options.accept === 'json') {
    request.body = parse.tryParse(req.body || '{}');
    request.query = parse.tryParse(req.query || '{}');
  }

  request.headers = req.headers || {};

  // Merge data
  request.data = _.merge({}, request.body, request.query);

  // Filled by parseMultipart()
  request.multipart = {
    fields: {},
    files: {},
  };

  return request;
}

// Mix in the concern modules
Object.assign(
  Context.prototype,
  logging.methods,
  respond.methods,
  authenticate.methods,
  parse.methods,
);

module.exports = Context;
