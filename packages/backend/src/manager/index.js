// Libraries
const path = require('path');
const { get: _get, set: _set } = require('lodash');
const jetpack = require('fs-jetpack');
const { hasOmegaConfig, loadConfig, loadEnv, formatErrors } = require('@omega.js/config');
const { resolvedConfigValues } = require('./helpers/resolved-config.js');
const EventEmitter = require('events');
// const EventEmitter = require('events').EventEmitter;
const util = require('util');

// const { debug, log, error, warn } = require('firebase-functions/lib/logger');
// let User;
// let Analytics;
// Paths
const wrappers = './functions/wrappers';
const _legacy = './functions/_legacy';
const events = path.resolve(__dirname, './events');
const cron = path.resolve(events, './cron');

const BEM_TEMPLATES_DIR = path.resolve(__dirname, '../../templates');
const BEM_PACKAGE = require('../../package.json');

function Manager() {
  const self = this;

  // @omega.js/backend library version
  self.version = BEM_PACKAGE.version;

  // Constants
  self.SERVER_UUID = '11111111-1111-1111-1111-111111111111';

  // Modable
  self.libraries = {};
  self.handlers = {};

  self._internal = {
    storage: {},
  };

  self.interface = {}

  // Setup EventEmitter
  EventEmitter.call(self);

  // Return
  return self;
}

// Inherit from EventEmitter
util.inherits(Manager, EventEmitter);

// Process-level latch for the TEST-environment banner. init() can run more than
// once in a single process (the test runner, a custom server, a re-entrant boot);
// the banner is boot information, not per-init information, so it says its piece
// once and then stays quiet.
let _testBannerLogged = false;

// The emulator boots a FRESH functions worker per invocation — measured on one
// playground seed: 53 worker processes for 92 invocations, so a once-per-process
// line still prints 53 times to announce what the emulator itself announced. The
// test-environment boot lines are therefore silent under the emulator. They stay
// LOUD (once) in a deployed process that resolves test mode, which is the case
// where "this is a test environment" is an alarm, not a truism.
function isUnderEmulator() {
  return process.env.FUNCTIONS_EMULATOR === 'true';
}

Manager.prototype.init = function (exporter, options) {
  const self = this;

  // Auto-detect test-runner context. The test runner sets OMEGA_TEST_RUNNER=1
  // before invoking anything that loads @omega.js/backend. When detected, init() runs the
  // library-loading + project-config-setup pieces normally, but skips wiring
  // Firebase Cloud Functions handlers and the custom-server boot (neither
  // works outside an actual Functions runtime). The runner has already called
  // firebase-admin.initializeApp() so we also skip that step to avoid the
  // "default app already initialized" crash.
  const isTestRunner = !!process.env.OMEGA_TEST_RUNNER;

  // Set options defaults
  options = options || {};
  options.initialize = typeof options.initialize === 'undefined' ? !isTestRunner : options.initialize;
  options.log = typeof options.log === 'undefined' ? false : options.log;
  options.projectType = typeof options.projectType === 'undefined' ? 'firebase' : options.projectType; // firebase, custom
  options.routes = typeof options.routes === 'undefined' ? '/routes' : options.routes;
  options.schemas = typeof options.schemas === 'undefined' ? '/schemas' : options.schemas;
  options.setupFunctions = typeof options.setupFunctions === 'undefined' ? !isTestRunner : options.setupFunctions;
  options.setupFunctionsLegacy = typeof options.setupFunctionsLegacy === 'undefined' ? false : options.setupFunctionsLegacy;
  options.setupFunctionsIdentity = typeof options.setupFunctionsIdentity === 'undefined' ? !isTestRunner : options.setupFunctionsIdentity;
  options.setupServer = typeof options.setupServer === 'undefined' ? !isTestRunner : options.setupServer;
  options.initializeLocalStorage = typeof options.initializeLocalStorage === 'undefined' ? false : options.initializeLocalStorage;
  options.resourceZone = typeof options.resourceZone === 'undefined' ? 'us-central1' : options.resourceZone;
  options.sentry = typeof options.sentry === 'undefined' ? !isTestRunner : options.sentry;
  options.reportErrorsInDev = typeof options.reportErrorsInDev === 'undefined' ? false : options.reportErrorsInDev;
  options.firebaseConfig = options.firebaseConfig;
  options.useFirebaseLogger = typeof options.useFirebaseLogger === 'undefined' ? true : options.useFirebaseLogger;
  options.serviceAccountPath = typeof options.serviceAccountPath === 'undefined' ? 'service-account.json' : options.serviceAccountPath;;
  options.fetchStats = typeof options.fetchStats === 'undefined'
    // ? options.projectType === 'firebase'
    ? false
    : options.fetchStats;
  options.checkNodeVersion = typeof options.checkNodeVersion === 'undefined' ? true : options.checkNodeVersion;
  options.uniqueAppName = options.uniqueAppName || undefined;
  options.ctx = options.ctx || {};
  options.cwd = typeof options.cwd === 'undefined' ? process.cwd() : options.cwd;
  options.projectPackageDirectory = typeof options.projectPackageDirectory === 'undefined' ? undefined : options.projectPackageDirectory;
  options.logSavePath = typeof options.logSavePath === 'undefined' ? false : options.logSavePath;
  // options.ctx.optionsLogString = options.ctx.optionsLogString || undefined;

  // Express options
  options.express = options.express || {};
  options.express.bodyParser = options.express.bodyParser || {};
  options.express.bodyParser.json = options.express.bodyParser.json || { limit: '100kb' };
  options.express.bodyParser.urlencoded = options.express.bodyParser.urlencoded || { limit: '100kb', extended: true };

  // Load libraries
  self.libraries = {
    // Third-party
    functions: options.projectType === 'firebase'
      ? require('firebase-functions/v1')
      : null,
    admin: require('firebase-admin'),
    cors: require('cors')({ origin: true }),
    sentry: null,

    // First-party
    RouteContext: require('./helpers/context/index.js'),
    localDatabase: null,
    User: null,
    Analytics: null,
    logger: null,
  };

  // Set properties
  self.cwd = options.cwd;
  self.rootDirectory = __dirname;

  // Set options
  self.options = options;
  self.project = options.firebaseConfig || JSON.parse(process.env.FIREBASE_CONFIG || '{}');
  self.project.resourceZone = options.resourceZone;
  self.project.serviceAccountPath = path.resolve(self.cwd, options.serviceAccountPath);

  // Load package.json
  self.package = resolveProjectPackage(options.projectPackageDirectory || self.cwd);

  // Resolve the .env cascade from the functions dir (functions/.env rides
  // the deploy artifact; the brand/company layers exist only in local dev)
  try {
    loadEnv(self.cwd);
  } catch (e) {
    self.ctx.error(new Error(`Failed to set up environment variables from .env file: ${e.message}`));
  }

  // Load config — the consumer's config/omega.json5 resolved through
  // @omega.js/config (brand-monorepo aware: cwd is the functions dir, the
  // loader walks up to the brand layer when one exists). The framework
  // defaults layer is templates/config/omega.json5 resolved through the SAME
  // loader, so both sides live in one shape. Missing consumer config
  // (non-consumer cwd, some tests) → defaults only, same as before the flip.
  const configDefaults = loadConfig(BEM_TEMPLATES_DIR, 'backend').config;
  delete configDefaults.targets;

  if (hasOmegaConfig(self.cwd)) {
    const { config, errors } = loadConfig(self.cwd, 'backend', { defaults: configDefaults });
    self.config = config;

    // Boot warns on schema findings, audit (mgr setup) throws — the two-mode
    // contract from @omega.js/config. Secrets in the file already threw above.
    if (errors.length) {
      console.warn(`[@omega.js/backend] config/omega.json5 schema warnings:\n${formatErrors(errors)}`);
    }
  } else {
    self.config = configDefaults;
  }

  // Config-DERIVED values, on the config object consumer code already reads
  // (#290): `config.resolved.github.repo` and whatever joins it. The recipes
  // live in @omega.js/config — private, so a brand app cannot call them and
  // used to re-implement them — and the framework runs them once, here, on the
  // composed config.
  self.config.resolved = resolvedConfigValues(self.config);

  // Expose config on the constructor for static access by internal libraries.
  // Since Node.js caches require(), any `require('./index.js')` returns this same
  // Manager function with .config already set — no need for setConfig() patterns.
  Manager.config = self.config;

  // Set PAYPAL_CLIENT_ID from config (clientId is public, not a secret — lives in config, not .env)
  process.env.PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || self.config?.payment?.processors?.paypal?.clientId || '';

  // Set CHARGEBEE_SITE from config (site is public, not a secret — lives in config, not .env)
  process.env.CHARGEBEE_SITE = process.env.CHARGEBEE_SITE || self.config?.payment?.processors?.chargebee?.site || '';

  // Get brand ID
  const brandId = self.config?.brand?.id;

  // Set log
  if (options.logSavePath) {
    self.libraries.logger = new (require('wonderful-log'))({
      console: {
        enabled: false,
      },
      file: {
        enabled: true,
        path: options.logSavePath,
      },
    });
  }

  // Environment helpers — the Manager is the SINGLE SOURCE OF TRUTH (mirrors EM/UJM/BXM,
  // where the Manager owns these). getEnvironment() is the ONLY place that reads the raw
  // env vars (OMEGA_TEST_MODE / ENVIRONMENT / FUNCTIONS_EMULATOR / TERM_PROGRAM); the three
  // is*() checks derive from it live on every call. They return exactly ONE of three
  // mutually-exclusive values — testing wins, then production, else development.
  // The ctx exposes the same methods but FORWARDS to these (ctx.isTesting()
  // → Manager.isTesting()), so request handlers can keep calling `ctx.*`.
  // Defined BEFORE the ctx is constructed so the ctx's own init() can call back.
  self.getEnvironment = function() {
    // Testing takes precedence — set by the test runner / emulator (OMEGA_TEST_MODE=true).
    if (process.env.OMEGA_TEST_MODE === 'true') {
      return 'testing';
    }
    if (process.env.ENVIRONMENT === 'production') {
      return 'production';
    } else if (
      process.env.ENVIRONMENT === 'development'
      || process.env.FUNCTIONS_EMULATOR === true
      || process.env.FUNCTIONS_EMULATOR === 'true'
      || process.env.TERM_PROGRAM === 'Apple_Terminal'
      || process.env.TERM_PROGRAM === 'vscode'
    ) {
      return 'development';
    } else {
      // Default: production. @omega.js/backend's deployed RUNTIME can legitimately lack a dev signal — a
      // live Cloud Function has no FUNCTIONS_EMULATOR and often no ENVIRONMENT var, so
      // "no signal" IS the normal production state. Defaulting to development here would make
      // every deployed function skip real side effects (emails/analytics/webhooks).
      // (Contrast UJM/BXM, whose deployed artifacts always carry their signal, so they default
      // to development — a bare context there is just build tooling.)
      return 'production';
    }
  };

  // The three checks are mutually exclusive — each true for ONLY its own environment.
  // isDevelopment() is NOT true in testing; isProduction() is a real positive check
  // (never `!isDevelopment()`). Gate "anything non-production" with `!isProduction()`
  // or `isDevelopment() || isTesting()` intentionally.
  self.isDevelopment = function() {
    return self.getEnvironment() === 'development';
  };
  self.isProduction = function() {
    return self.getEnvironment() === 'production';
  };
  self.isTesting = function() {
    return self.getEnvironment() === 'testing';
  };

  // Init ctx
  self.ctx = self.RouteContext().init({
    req: null,
    res: null,
    admin: self.libraries.admin,
    functions: self.libraries.functions,
    Manager: self,
  }, options.ctx);

  // Helper functions for URLs based on environment
  self.getFunctionsUrl = function(env) {
    // Auto-detect (no explicit env): development OR testing → local URLs. Test runs
    // hit the local emulator, so getApiUrl/getFunctionsUrl/getWebsiteUrl must resolve
    // to localhost. NOTE: getParentApiUrl/getParentUrl are intentionally NOT changed —
    // the parent is a real remote server with no localhost equivalent.
    const isDev = env === 'development' || (!env && (self.isDevelopment() || self.isTesting()));
    // N7: the CLI that booted the stack publishes resolved ports via
    // OMEGA_*_PORT env (functions workers inherit them) — classic default
    // when unset (plain local boot).
    return isDev
      ? `http://localhost:${process.env.OMEGA_FUNCTIONS_PORT || 5001}/${self.project.projectId}/${self.project.resourceZone}`
      : `https://${self.project.resourceZone}-${self.project.projectId}.cloudfunctions.net`;
  };

  self.getApiUrl = function(env) {
    // Auto-detect (no explicit env): development OR testing → local URLs. Test runs
    // hit the local emulator, so getApiUrl/getFunctionsUrl/getWebsiteUrl must resolve
    // to localhost. NOTE: getParentApiUrl/getParentUrl are intentionally NOT changed —
    // the parent is a real remote server with no localhost equivalent.
    const isDev = env === 'development' || (!env && (self.isDevelopment() || self.isTesting()));
    if (isDev) {
      const httpsPort = process.env.OMEGA_HTTPS_PORT;
      return httpsPort
        ? `https://localhost:${httpsPort}`
        : `http://localhost:${process.env.OMEGA_HOSTING_PORT || 5002}`;
    }
    return `https://api.${(self.config.brand?.url || '').replace(/^https?:\/\//, '')}`;
  };

  self.getWebsiteUrl = function(env) {
    // Auto-detect (no explicit env): development OR testing → local URLs. Test runs
    // hit the local emulator, so getApiUrl/getFunctionsUrl/getWebsiteUrl must resolve
    // to localhost. NOTE: getParentApiUrl/getParentUrl are intentionally NOT changed —
    // the parent is a real remote server with no localhost equivalent.
    const isDev = env === 'development' || (!env && (self.isDevelopment() || self.isTesting()));
    // Scheme follows the local https stack (cp176): ONE mkcert install fronts
    // backend AND web dev alike, so this process's own proxy presence
    // (OMEGA_HTTPS_PORT) is the honest signal for the website's scheme too —
    // --no-https / missing mkcert drops both sides back to plain http.
    const websiteScheme = process.env.OMEGA_HTTPS_PORT ? 'https' : 'http';
    return isDev
      ? `${websiteScheme}://localhost:${process.env.OMEGA_WEBSITE_PORT || 4000}`
      : self.config.brand?.url || '';
  };

  // Resolve the parent @omega.js/backend's website URL (the parent's brand domain, NO `api.` subdomain).
  // - If config.parent === 'self', THIS @omega.js/backend is the parent — returns this brand's own URL.
  // - If config.parent is a URL, returns it as-is.
  // - Returns '' if neither is configured.
  // Use getParentApiUrl() for the API URL (with `api.` subdomain inserted).
  self.getParentUrl = function() {
    const parent = self.config.parent;
    if (parent === 'self') {
      return self.config.brand?.url || '';
    }
    return parent || '';
  };

  // Resolve the parent @omega.js/backend's API URL (`https://api.{parent-host}`).
  // ALWAYS returns the live production URL — even when THIS brand is running
  // in dev/test mode. The parent's API is a real remote server (no localhost
  // equivalent), so dev-mode does NOT redirect to localhost the way getApiUrl()
  // does. Use this when you need to call the parent's API from any environment.
  self.getParentApiUrl = function() {
    const base = self.getParentUrl().replace(/^https?:\/\//, '');
    return base ? `https://api.${base}` : '';
  };

  // Returns true when this @omega.js/backend IS the parent (config.parent === 'self').
  // Gates parent-only routes like /marketing/webhook/forward.
  self.isParent = function() {
    return self.config.parent === 'self';
  };

  // Set more properties (need to wait for ctx to determine if DEV)
  self.project.functionsUrl = self.getFunctionsUrl();

  // Set API URL (like @omega.js/client's getApiUrl)
  // Testing: http://localhost:5002 (hosting emulator with rewrites)
  // Development: http://localhost:5002 (local hosting)
  // Production: https://api.{domain}
  self.project.apiUrl = self.getApiUrl();

  // Set website URL
  // Development: http://localhost:4000 (local `omega dev` hosting)
  // Production: https://{domain} (from brand.url)
  self.project.websiteUrl = self.getWebsiteUrl();

  // Set environment
  process.env.ENVIRONMENT = process.env.ENVIRONMENT || self.getEnvironment();

  // Set @omega.js/backend env variables
  process.env.OMEGA_FUNCTIONS_URL = self.project.functionsUrl;
  process.env.OMEGA_API_URL = self.project.apiUrl;
  process.env.OMEGA_WEBSITE_URL = self.project.websiteUrl;

  // Use the working Firebase logger that they disabled for whatever reason
  // Load the Firebase logger compat shim only in production (NOT development or testing).
  if (
    process.env.GCLOUD_PROJECT
    && self.isProduction()
    && options.useFirebaseLogger
  ) {
    // require('firebase-functions/lib/logger/compat'); // Old way
    require('firebase-functions/logger/compat'); // firebase-functions@4 and above?
  }

  // Handle test environment
  if (self.isTesting()) {
    if (!isUnderEmulator() && !_testBannerLogged) {
      _testBannerLogged = true;
      self.ctx.log('⚠️⚠️⚠️ Running in TEST environment, some features may be disabled ⚠️⚠️⚠️');
    }

    // Install the test-mode-file watcher exactly once. Lets the test command
    // flip env vars (currently just TEST_EXTENDED_MODE) on the running emulator
    // mid-session without restarting it. See src/test/utils/test-mode-file.js
    // for the file format and allowlist.
    setupTestModeWatcher(self);
  }

  // Handle dev environments
  if (self.isDevelopment()) {
    const version = require('wonderful-version');
    const nodeUsing = version.major(process.versions.node);
    const nodeRequired = version.major(self.package?.engines?.node || '0.0.0');

    // Fix firebase-tools overwriting console.log
    // https://stackoverflow.com/questions/56026747/firebase-console-log-on-localhost
    if (process.env.GCLOUD_PROJECT) {
      function logFix() {
        console.error(...arguments);
      }
      console.log = logFix;
      console.info = logFix;
    }

    // Reject if we're using an unsupported Node.js version
    if (version.is(nodeUsing, '<', nodeRequired)) {
      const msg = `Node.js version mismatch: using ${nodeUsing} but asked for ${nodeRequired}`;
      if (options.checkNodeVersion) {
        self.ctx.error(new Error(msg));
        return process.exit(1);
      } else {
        self.ctx.log(msg);
      }
    }
  }

  if (options.log) {
    // self.ctx.log('process.env', process.env)
    self.ctx.log('Resolved serviceAccountPath', self.project.serviceAccountPath);
  }

  if (!brandId) {
    self.ctx.warn('⚠️ Missing config.brand.id');
  }

  // Setup sentry — @omega.js/monitoring owns the policy (config resolution from
  // `monitoring.*`, the release tag, the gates) for every OMEGA target (#380).
  // The gates run at BOOT, not per event: getEnvironment() is env-derived and
  // stable for the life of a process, so a non-production run that would have
  // dropped every event in beforeSend now never loads @sentry/node at all.
  // `libraries.sentry` stays the ONE capture handle (null when off) — the
  // chokepoint in helpers/context/respond.js reads it exactly as before.
  if (self.options.sentry) {
    self.libraries.sentry = require('@omega.js/monitoring/node').initialize({
      config:       self.config?.monitoring,
      release:      { id: brandId || self.project.projectId, version: self.package.version },
      isProduction: self.isProduction(),
      allowInDev:   self.options.reportErrorsInDev,
      // Read at capture time: one process serves many invocations, so the
      // function identity belongs to the event, not the boot.
      tags: () => ({
        'function.name': self.ctx.meta.name,
        'function.type': self.ctx.meta.type,
        'environment':   self.getEnvironment(),
      }),
    });
  }

  // Setup options features
  if (self.options.initialize) {
    // Initialize Firebase. On any managed runtime — explicit ADC pointer, deployed Cloud
    // Functions/Cloud Run (K_SERVICE/FUNCTION_TARGET), or the emulator — a no-args
    // initializeApp() authenticates with the runtime's own identity. A staged
    // service-account.json is ONLY for local scripts hitting the real project.
    const onCloudRuntime = !!process.env.K_SERVICE || !!process.env.FUNCTION_TARGET;
    const onEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || onCloudRuntime || onEmulator) {
      self.libraries.initializedAdmin = self.libraries.admin.initializeApp();
    } else {
      const serviceAccount = require(self.project.serviceAccountPath);
      const loadedProjectId = serviceAccount.project_id;
      const expectedProjectId = self.project.projectId;

      // A cert for the wrong project authenticates every Firestore call with the wrong
      // identity — gRPC UNAUTHENTICATED at request time, far from the cause. Refuse to boot.
      // Compare project id to project id, EXACTLY: a brand id is not a project id (brand
      // `omega-playground` runs on project `omegajs-playground`), so matching against the
      // brand — by substring or otherwise — both false-negatives and false-positives.
      // When the expected project is unknown (no FIREBASE_CONFIG), there is nothing to
      // verify against, so boot proceeds rather than guessing.
      if (expectedProjectId && loadedProjectId !== expectedProjectId) {
        throw new Error(`Service account project mismatch: ${loadedProjectId} is not ${expectedProjectId} — fix ${self.project.serviceAccountPath}`);
      }

      self.libraries.initializedAdmin = self.libraries.admin.initializeApp({
        credential: self.libraries.admin.credential.cert(serviceAccount),
        databaseURL: self.project.databaseURL || `https://${self.project.projectId}.firebaseio.com`,
      }, options.uniqueAppName);
    }
  }

  // Setup main functions
  if (options.projectType === 'firebase' && options.setupFunctions) {
    self.setupFunctions(exporter, options);
  }

  // Setup custom server
  if (options.projectType === 'custom' && options.setupServer) {
    self.setupCustomServer(exporter, options);
  }

  // Setup LocalDatabase
  if (options.initializeLocalStorage) {
    self.storage();
  }

  // Fetch stats
  if (self.isDevelopment() && options.fetchStats) {
    setTimeout(function () {
      self.ctx.log('Fetching meta/stats...');
      self.libraries.admin
      .firestore().doc('meta/stats')
      .get()
      .then(doc => {
        self.ctx.log('meta/stats', doc.data());
      })
    }, 100);
  }

  // Send analytics
  self.Analytics({
    ctx: self.ctx,
    uuid: self.SERVER_UUID,
  })
  .event('admin/initialized', {});

  // Return
  return self;
};

// HELPERS
Manager.prototype._preProcess = function (mod) {
  const self = this;
  const name = mod.ctx.meta.name;
  return new Promise(async function(resolve, reject) {
    if (self.handlers && self.handlers[name]) {
      let result;
      try {
        result = self.handlers[name](mod)
      } catch (e) {
        mod.ctx.error(e);
        return reject(e);
      }
      if (Promise.resolve(result) == result) {
        result
        .then(r => {
          return resolve(r);
        })
        .catch(e => {
          mod.ctx.error(e);
          return reject(e);
        })
      } else {
        return resolve(result);
      }
    } else {
      return resolve(null);
    }
  });
};

Manager.prototype._handleMcp = function (req, res, routePath) {
  const self = this;
  const cors = self.libraries.cors;

  return cors(req, res, async () => {
    const { handleMcpRoute } = require('../mcp/handler.js');
    await handleMcpRoute(req, res, {
      Manager: self,
      routePath: routePath,
    });
  });
};

Manager.prototype._processMiddleware = function (req, res, routePath) {
  const self = this;

  const bemRoutesDir = path.resolve(__dirname, './routes');
  const bemSchemasDir = path.resolve(__dirname, './schemas');
  const consumerRoutesDir = path.normalize(`${self.cwd}${self.options.routes || '/routes'}`);
  const consumerSchemasDir = path.normalize(`${self.cwd}${self.options.schemas || '/schemas'}`);

  // Check if the route exists in the consumer's routes directory first
  const consumerRoutePath = path.resolve(consumerRoutesDir, routePath);
  const isConsumerRoute = require('fs').existsSync(consumerRoutePath);

  const routesDir = isConsumerRoute ? consumerRoutesDir : bemRoutesDir;
  const schemasDir = isConsumerRoute ? consumerSchemasDir : bemSchemasDir;

  return self.Middleware(req, res).run(routePath, {
    routesDir,
    schemasDir,
    schema: routePath,
  });
};

Manager.prototype.RouteContext = function(ref, options) {
  const self = this;

  // Set options defaults
  ref = ref || {};
  options = options || {};

  // Create ctx instance
  return (new self.libraries.RouteContext()).init({
    req: ref.req,
    res: ref.res,
    admin: self.libraries.admin,
    functions: self.libraries.functions,
    Manager: self,
  }, options)
};

Manager.prototype.User = function () {
  const self = this;
  self.libraries.User = self.libraries.User || require('./helpers/user.js');
  return new self.libraries.User(self, ...arguments);
};

Manager.prototype.Analytics = function () {
  const self = this;
  self.libraries.Analytics = self.libraries.Analytics || require('./helpers/analytics.js');
  return new self.libraries.Analytics(self, ...arguments);
};

Manager.prototype.ApiManager = function () {
  const self = this;
  self.libraries.ApiManager = self.libraries.ApiManager || require('./helpers/api-manager.js');
  return new self.libraries.ApiManager(self, ...arguments);
};

Manager.prototype.Roles = function () {
  const self = this;
  self.libraries.Roles = self.libraries.Roles || require('./helpers/roles.js');
  return new self.libraries.Roles(self, ...arguments);
};

Manager.prototype.Usage = function () {
  const self = this;
  self.libraries.Usage = self.libraries.Usage || require('./helpers/usage.js');
  return new self.libraries.Usage(self, ...arguments);
};

Manager.prototype.Middleware = function () {
  const self = this;
  self.libraries.Middleware = self.libraries.Middleware || require('./helpers/middleware.js');
  return new self.libraries.Middleware(self, ...arguments);
};

Manager.prototype.BackendRouter = function (req, res) {
  const self = this;
  self.libraries.BackendRouter = self.libraries.BackendRouter || require('./helpers/backend-router.js');
  return new self.libraries.BackendRouter(self, req, res);
};

Manager.prototype.EventMiddleware = function (payload) {
  const self = this;
  self.libraries.EventMiddleware = self.libraries.EventMiddleware || require('./helpers/event-middleware.js');
  return new self.libraries.EventMiddleware(self, payload);
};

Manager.prototype.Settings = function () {
  const self = this;
  self.libraries.Settings = self.libraries.Settings || require('./helpers/settings.js');
  return new self.libraries.Settings(self, ...arguments);
};

Manager.prototype.Metadata = function () {
  const self = this;
  self.libraries.Metadata = self.libraries.Metadata || require('./helpers/metadata.js');
  return new self.libraries.Metadata(self, ...arguments);
};

Manager.prototype.Email = function (ctx) {
  const self = this;
  self.libraries.Email = self.libraries.Email || require('./libraries/email/index.js');
  return new self.libraries.Email(ctx);
};

Manager.prototype.AI = function (ctx, key) {
  const self = this;
  self.libraries.AI = self.libraries.AI || require('./libraries/ai/index.js');
  return new self.libraries.AI(ctx, key);
};

// Manager.prototype.Utilities = function () {
//   const self = this;
//   self.libraries.Utilities = self.libraries.Utilities || require('./helpers/utilities.js');
//   return new self.libraries.Utilities(self, ...arguments);
// };

Manager.prototype.Utilities = function () {
  const self = this;

  if (!self._internal.utilities) {
    self.libraries.Utilities = require('./helpers/utilities.js');
    self._internal.utilities = new self.libraries.Utilities(self, ...arguments);
  }

  return self._internal.utilities;
};

Manager.prototype.storage = function (options) {
  const self = this;
  options = options || {};
  options.name = options.name || 'main';

  if (!self._internal.storage[options.name]) {
    options.temporary = typeof options.temporary === 'undefined' ? false : options.temporary;
    options.clear = typeof options.clear === 'undefined' ? true : options.clear;
    options.log = typeof options.log === 'undefined' ? false : options.log;

    // Set path
    const subfolder = `storage/${self.options.uniqueAppName || 'primary'}/${options.name}`;

    // Setup lowdb
    const { LowSync } = require('lowdb');
    const { JSONFileSync } = require('lowdb/node');
    const location = options.temporary
      ? `${require('os').tmpdir()}/${subfolder}.json`
      : `./.data/${subfolder}.json`;

    // Log
    if (options.log) {
      self.ctx.log('storage(): Location', location);
    }

    // Clear temporary storage
    if (
      options.temporary
      && self.isDevelopment()
      && options.clear
    ) {
      self.ctx.log('Removed temporary file @', location);
      jetpack.remove(location);
    }

    // Setup options
    options.clearInvalid = typeof options.clearInvalid === 'undefined'
      ? true
      : options.clearInvalid;

    function _setup() {
      if (!jetpack.exists(location)) {
        jetpack.write(location, {});
      }
      const db = new LowSync(new JSONFileSync(location), {});
      db.read();

      // Wrap lowdb in a v1-compatible API so consumers don't need lodash
      self._internal.storage[options.name] = {
        _db: db,
        _location: location,
        get(path, defaultValue) {
          const result = _get(db.data, path, defaultValue);
          return { value() { return result; } };
        },
        set(path, value) { _set(db.data, path, value); return this; },
        write() { db.write(); return this; },
        getState() { return db.data; },
        setState(data) { db.data = data; return this; },
      };
    }

    try {
      _setup()
    } catch (e) {
      self.ctx.error(`Could not setup storage: ${location}`, e);

      try {
        if (options.clearInvalid) {
          self.ctx.log(`Clearing invalid storage: ${location}`);
          jetpack.write(location, {});
        }
        _setup()
      } catch (e) {
        self.ctx.error(`Failed to clear invalid storage: ${location}`, e);
      }
    }
  }

  return self._internal.storage[options.name]
};

Manager.prototype.getCustomServer = function () {
  const self = this;

  if (!self._internal.server || !self._internal.app) {
    throw new Error('Server not set up');
  }

  return {
    server: self._internal.server,
    app: self._internal.app,
  };
};

Manager.prototype.install = function (controller, options) {
  const self = this;

  // Set options defaults
  options = options || {};
  options.prefix = typeof options.prefix === 'undefined' ? null : options.prefix;
  options.dir = typeof options.dir === 'undefined' ? '' : options.dir;
  options.log = typeof options.log === 'undefined' ? false : options.log;

  // Fix dir
  options.dir = path.resolve(self.cwd, options.dir);

  // If dir is a single file, install it. if its a directory, install all
  const isDirectory = jetpack.exists(options.dir) === 'dir';

  if (options.log) {
    self.ctx.log(`Installing from ${options.dir}, prefix=${options.prefix}, isDirectory=${isDirectory}...`);
  }

  // function _install(prefix, file) {
  //   if (!file.includes('.js')) {return}
  //   const name = file.replace('.js', '');
  //   const _prefix = prefix ? `${prefix}_${name}` : name;

  //   const fullPath = path.resolve(options.dir, file);

  //   if (options.log) {
  //     self.ctx.log(`Installing ${_prefix} from ${fullPath}...`);
  //   }

  //   controller[`${_prefix}`] = require(fullPath);
  // }

  function _install(prefix, file) {
    if (!file.includes('.js')) return;

    const name = file.replace('.js', '');
    const _prefix = prefix ? `${prefix}_${name}` : name;
    const fullPath = path.resolve(options.dir, file);

    if (options.log) {
      self.ctx.log(`Installing ${_prefix} from ${fullPath}...`);
    }

    const mod = require(fullPath);

    // If module exports a function, bind it to controller
    if (typeof mod === 'function') {
      controller[_prefix] = mod.bind(controller);
    } else {
      controller[_prefix] = mod;
    }
  }

  if (isDirectory) {
    jetpack.list(options.dir)
    .forEach(file => _install(options.prefix, file))
  } else {
    _install(options.prefix, options.dir);
  }
};

// Require
Manager.prototype.require = function (name) {
  return require(name);
};
Manager.require = function (name) {
  return require(name);
};

Manager.prototype.debug = function () {
  return {
    throwException: function () {
      throw new Error('TEST_ERROR');
    },
    throwRejection: function () {
      Promise.reject(new Error('TEST_ERROR'));
    }
  }
}

// Setup functions
Manager.prototype.setupFunctions = function (exporter, options) {
  const self = this;
  const resourceZone = options.resourceZone;

  // Helper to create a function builder with region + runtime options
  function fn(runtimeOptions) {
    return self.libraries.functions
      .runWith(runtimeOptions)
      .region(resourceZone);
  }

  // Log
  if (options.log) {
    self.ctx.log('Setting up Firebase functions...');
  }

  // Setup functions
  exporter.omega_api =
  fn({memory: '256MB', timeoutSeconds: 60 * 5})
  .https.onRequest(async (req, res) => {
    const route = self.BackendRouter(req, res).resolve();

    // MCP endpoint — bypass middleware, handle protocol directly
    const mcpRoutePath = resolveMcpRoutePath(route.routePath);
    if (mcpRoutePath) {
      return self._handleMcp(req, res, mcpRoutePath);
    }

    // RESTful middleware system
    return self._processMiddleware(req, res, route.routePath);
  });

  // Setup legacy functions
  if (options.setupFunctionsLegacy) {
    exporter.omega_signUpHandler =
    fn({memory: '256MB', timeoutSeconds: 60})
    .https.onRequest(async (req, res) => {
      const Module = require(`${_legacy}/actions/sign-up-handler.js`);
      Module.init(self, { req: req, res: res, });

      return self._preProcess(Module)
      .then(r => Module.main())
      .catch(e => {
        self.ctx.error(e);
        return res.status(500).send(e.message);
      });
    });

    // Admin
    exporter.omega_createPost =
    fn({memory: '256MB', timeoutSeconds: 60})
    .https.onRequest(async (req, res) => {
      const Module = require(`${_legacy}/admin/create-post.js`);
      Module.init(self, { req: req, res: res, });

      return self._preProcess(Module)
      .then(r => Module.main())
      .catch(e => {
        self.ctx.error(e);
        return res.status(500).send(e.message);
      });
    });

    exporter.omega_firestoreWrite =
    fn({memory: '256MB', timeoutSeconds: 60})
    .https.onRequest(async (req, res) => {
      const Module = require(`${_legacy}/admin/firestore-write.js`);
      Module.init(self, { req: req, res: res, });

      return self._preProcess(Module)
      .then(r => Module.main())
      .catch(e => {
        self.ctx.error(e);
        return res.status(500).send(e.message);
      });
    });

    exporter.omega_getStats =
    fn({memory: '256MB', timeoutSeconds: 420})
    .https.onRequest(async (req, res) => {
      const Module = require(`${_legacy}/admin/get-stats.js`);
      Module.init(self, { req: req, res: res, });

      return self._preProcess(Module)
      .then(r => Module.main())
      .catch(e => {
        self.ctx.error(e);
        return res.status(500).send(e.message);
      });
    });

    exporter.omega_sendNotification =
    fn({memory: '1GB', timeoutSeconds: 420})
    .https.onRequest(async (req, res) => {
      const Module = require(`${_legacy}/admin/send-notification.js`);
      Module.init(self, { req: req, res: res, });

      return self._preProcess(Module)
      .then(r => Module.main())
      .catch(e => {
        self.ctx.error(e);
        return res.status(500).send(e.message);
      });
    });

    exporter.omega_query =
    fn({memory: '256MB', timeoutSeconds: 60})
    .https.onRequest(async (req, res) => {
      const Module = require(`${_legacy}/admin/query.js`);
      Module.init(self, { req: req, res: res, });

      return self._preProcess(Module)
      .then(r => Module.main())
      .catch(e => {
        self.ctx.error(e);
        return res.status(500).send(e.message);
      });
    });

    exporter.omega_createPostHandler =
    fn({memory: '256MB', timeoutSeconds: 60})
    .https.onRequest(async (req, res) => {
      const Module = require(`${_legacy}/actions/create-post-handler.js`);
      Module.init(self, { req: req, res: res, });

      return self._preProcess(Module)
      .then(r => Module.main())
      .catch(e => {
        self.ctx.error(e);
        return res.status(500).send(e.message);
      });
    });

    exporter.omega_generateUuid =
    fn({memory: '256MB', timeoutSeconds: 60})
    .https.onRequest(async (req, res) => {
      const Module = require(`${_legacy}/actions/generate-uuid.js`);
      Module.init(self, { req: req, res: res, });

      return self._preProcess(Module)
      .then(r => Module.main())
      .catch(e => {
        self.ctx.error(e);
        return res.status(500).send(e.message);
      });
    });

    // Test
    exporter.omega_test_authenticate =
    fn({memory: '256MB', timeoutSeconds: 60})
    .https.onRequest(async (req, res) => {
      const Module = require(`${_legacy}/test/authenticate.js`);
      Module.init(self, { req: req, res: res, });

      return self._preProcess(Module)
      .then(r => Module.main())
      .catch(e => {
        self.ctx.error(e);
        return res.status(500).send(e.message);
      });
    });

    exporter.omega_test_webhook =
    fn({memory: '256MB', timeoutSeconds: 60})
    .https.onRequest(async (req, res) => {
      const Module = require(`${_legacy}/test/webhook.js`);
      Module.init(self, { req: req, res: res, });

      return self._preProcess(Module)
      .then(r => Module.main())
      .catch(e => {
        self.ctx.error(e);
        return res.status(500).send(e.message);
      });
    });
  }

  // Setup identity functions
  if (options.setupFunctionsIdentity) {
    exporter.omega_authBeforeCreate =
    fn({memory: '256MB', timeoutSeconds: 60})
    .auth.user()
    .beforeCreate((user, context) => self.EventMiddleware({ user, context }).run(`${events}/auth/before-create.js`));

    exporter.omega_authBeforeSignIn =
    fn({memory: '256MB', timeoutSeconds: 60})
    .auth.user()
    .beforeSignIn((user, context) => self.EventMiddleware({ user, context }).run(`${events}/auth/before-signin.js`));
  }

  // Setup events
  exporter.omega_authOnCreate =
  fn({memory: '256MB', timeoutSeconds: 60})
  .auth.user()
  .onCreate((user, context) => self.EventMiddleware({ user, context }).run(`${events}/auth/on-create.js`));

  exporter.omega_authOnDelete =
  fn({memory: '256MB', timeoutSeconds: 60})
  .auth.user()
  .onDelete((user, context) => self.EventMiddleware({ user, context }).run(`${events}/auth/on-delete.js`));

  exporter.omega_notificationsOnWrite =
  fn({memory: '256MB', timeoutSeconds: 60})
  .firestore.document('notifications/{token}')
  .onWrite((change, context) => self.EventMiddleware({ change, context }).run(`${events}/firestore/notifications/on-write.js`));

  exporter.omega_paymentsWebhookOnWrite =
  fn({memory: '256MB', timeoutSeconds: 60})
  .firestore.document('payments-webhooks/{eventId}')
  .onWrite((change, context) => self.EventMiddleware({ change, context }).run(`${events}/firestore/payments-webhooks/on-write.js`));

  exporter.omega_paymentsDisputeOnWrite =
  fn({memory: '256MB', timeoutSeconds: 60})
  .firestore.document('payments-disputes/{alertId}')
  .onWrite((change, context) => self.EventMiddleware({ change, context }).run(`${events}/firestore/payments-disputes/on-write.js`));

  // Setup cron jobs
  exporter.omega_cronDaily =
  fn({memory: '256MB', timeoutSeconds: 60 * 5})
  .pubsub.schedule('0 0 * * *')
  .onRun((context) => self.EventMiddleware({ context }).run(`${cron}/daily.js`));

  // Frequent cron runs the inline newsletter generator (AI structure + section
  // images + article + uploads) — needs the v1 max timeout. If a run times out
  // or OOMs, the campaign lease reclaim in marketing-campaigns.js retries it
  // safely.
  exporter.omega_cronFrequent =
  fn({memory: '256MB', timeoutSeconds: 540})
  .pubsub.schedule('*/10 * * * *')
  .onRun((context) => self.EventMiddleware({ context }).run(`${cron}/frequent.js`));
};

// Setup Custom Server
Manager.prototype.setupCustomServer = function (_library, options) {
  const self = this;

  // Require
  const glob = require('glob').globSync;

  // Log
  if (options.log) {
    self.ctx.log('Setting up custom server...');
  }

  // Setup express
  const app = require('express')({
    logger: true,
  });

  // Setup body parser with configurable limits
  app.use(require('body-parser').json(options.express.bodyParser.json));
  app.use(require('body-parser').urlencoded(options.express.bodyParser.urlencoded));

  // Handle errors with custom error handler
  app.use((err, req, res, next) => {
    // Create a new ctx because our custom Middleware has not been run yet
    const ctx = self.RouteContext({ req: req, res: res, }, {});

    // Handle PayloadTooLargeError from body-parser
    if (err.type === 'entity.too.large') {
      return ctx.respond('Request payload too large.', { code: 413 });
    }

    // Catch-all for other body-parser and middleware errors
    if (err) {
      // Log
      // @TODO: REMOVE THIS LOG ONCE WE'RE CONFIDENT IT'S WORKING AS INTENDED
      console.log('@TODO: Custom Error Handler:', err);

      // Return
      return ctx.respond(err.message || 'Bad request', { code: err.status || err.code || err.statusCode || 400 });
    }

    // If no error, continue
    next(err);
  });

  // Designate paths
  const managerRoutesPath = path.normalize(`${__dirname}/routes`);
  const managerSchemasPath = path.normalize(`${__dirname}/schemas`);
  const customRoutesPath = path.normalize(`${self.cwd}${options.routes}`);
  const customSchemasPath = path.normalize(`${self.cwd}${options.schemas}`);

  // Create routes
  const routes = [];

  // Push function
  function _push(dir, isManager) {
    // Get all files (index.js and method-specific files like get.js, post.js)
    glob('**/*.js', { cwd: dir })
    .forEach((file) => {
      const fileName = path.basename(file, '.js');
      const dirName = path.dirname(file);

      // Determine method and route name
      let method = 'all'; // default to all methods
      let routeName;

      if (fileName === 'index') {
        // Traditional index.js file: routes/restart/index.js -> restart
        // Root index.js: routes/index.js -> '' (empty string for root path)
        routeName = dirName === '.' ? '' : dirName;
      } else if (['get', 'post', 'put', 'delete', 'patch', 'options', 'head'].includes(fileName.toLowerCase())) {
        // Method-specific file: routes/restart/get.js -> restart (GET only)
        method = fileName.toLowerCase();
        routeName = dirName === '.' ? '' : dirName;
      } else {
        // Unknown pattern, skip
        return;
      }

      // Build the item
      const item = {
        name: routeName,
        method: method,
        namespace: file,
        path: path.resolve(dir, file),
        dir: dir,
        isManager: isManager,
      }

      // If it exists in routes with same name AND method, replace it
      const existing = routes.findIndex(r => r.name === item.name && r.method === item.method);
      if (existing > -1) {
        routes[existing] = item;
        return;
      }

      // Otherwise, push it
      routes.push(item);
    });
  }

  // Push routes
  // _push(`${__dirname}/routes`)
  _push(managerRoutesPath, true)
  _push(customRoutesPath, false)

  // Log routes
  // if (options.log) {
  //   self.ctx.log('Routes:', routes);
  // }

  // Install process
  routes.forEach((file) => {
    // self.ctx.log('---file', file);
    // Require the file
    const cors = self.libraries.cors;

    // Log
    // if (options.log) {
      self.ctx.log(`Initializing route: ${file.method.toUpperCase()} /${file.name} @ ${file.path}`);
    // }

    // Register the route with the appropriate HTTP method
    app[file.method](`/${file.name}`, async (req, res) => {
      return cors(req, res, async () => {
        // For root route (empty name), skip schema validation
        const middlewareOptions = {
          routesDir: file.isManager ? managerRoutesPath : customRoutesPath,
          schemasDir: file.isManager ? managerSchemasPath : customSchemasPath,
        };

        // Only set schema if route name is not empty
        if (file.name) {
          middlewareOptions.schema = file.name;
        } else {
          middlewareOptions.setupSettings = false;
        }

        self.Middleware(req, res).run(file.name, middlewareOptions)
      });
    })
  });

  // Run the server!
  const server = app.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' }, (error) => {
    if (error) {
      self.ctx.error(error);
      process.exit(1);
    }

    const address = server.address();

    // Log
    if (options.log) {
      self.ctx.log(`Server listening on ${address.address}:${address.port}`);
    }

    // Set server and app to internal
    self._internal.server = server;
    self._internal.app = app;

    // Emit event
    self.emit('online', new Event('online'), server, app);
  });
}

function resolveProjectPackage(dir) {
  try {
    return require(path.resolve(dir, 'functions', 'package.json'));
  } catch (e) {}

  try {
    return require(path.resolve(dir, 'package.json'));
  } catch (e) {}
}

/**
 * Check if a routePath is an MCP-related route and normalize it.
 * Handles /omega/mcp/* paths and /.well-known/oauth-* discovery.
 *
 * @param {string} routePath - Resolved route path from BackendRouter
 * @returns {string|null} - Normalized MCP route path, or null if not MCP
 */
function resolveMcpRoutePath(routePath) {
  // Direct MCP paths (via /mcp/* or /omega/mcp/*)
  if (routePath === 'mcp' || routePath.startsWith('mcp/')) {
    return routePath;
  }

  // OAuth discovery (via /.well-known/oauth-*)
  if (routePath === '.well-known/oauth-protected-resource'
    || routePath === '.well-known/oauth-authorization-server') {
    return routePath;
  }

  // Root-level OAuth paths — Claude Chat sends these directly
  // regardless of what the discovery endpoints return
  if (routePath === 'authorize') {
    return 'mcp/authorize';
  }
  if (routePath === 'token') {
    return 'mcp/token';
  }
  if (routePath === 'register') {
    return 'mcp/register';
  }

  return null;
}

/**
 * Install the test-mode-file watcher. Called once during Manager.init() when
 * running in the test environment (emulator). Reads the shared state file
 * (`<projectRoot>/.temp/test-mode.json`) at startup to sync any env vars
 * set by an earlier test command, then watches the file for live changes.
 *
 * Idempotent — guarded by a module-level flag so reload-during-nodemon
 * doesn't stack listeners.
 *
 * @param {Manager} manager
 */
let _testModeWatcherInstalled = false;
function setupTestModeWatcher(manager) {
  if (_testModeWatcherInstalled) {
    return;
  }
  _testModeWatcherInstalled = true;

  const fs = require('fs');
  const jetpack = require('fs-jetpack');
  const { TEST_MODE_FILENAME, TEMP_DIR_NAME, getTestModeFilePath, readTestMode, applyEnvFromFile } = require('../test/utils/test-mode-file.js');

  // Resolve the consumer's project root. self.cwd is the consumer's
  // functions/ directory; the test-mode file lives one level up at
  // <projectRoot>/.temp/test-mode.json.
  const projectDir = path.dirname(manager.cwd);
  const filePath = getTestModeFilePath(projectDir);
  const tempDir = path.join(projectDir, TEMP_DIR_NAME);

  // Initial sync — apply any state the test/emulator command wrote before
  // this process booted. A sync/flip is an EVENT and always says so; the
  // resolved mode is per-worker boot noise under the emulator (see
  // isUnderEmulator) and only announces itself outside one.
  const initial = readTestMode(projectDir);
  const changed = applyEnvFromFile(initial);
  for (const c of changed) {
    manager.ctx.log(`test-mode sync ${c.key}: ${c.was || '(unset)'} → ${c.now || '(unset)'}`);
  }
  if (!isUnderEmulator()) {
    manager.ctx.log(`test-mode resolved TEST_EXTENDED_MODE=${!!process.env.TEST_EXTENDED_MODE} (file ${initial ? 'present' : 'absent'})`);
  }

  // Ensure .temp/ exists so we can watch the directory (fs.watch on a missing
  // path throws synchronously). Watching the directory rather than the file
  // means deletes/recreations of test-mode.json don't break the watcher, and
  // we don't depend on whatever writer happened to run first.
  jetpack.dir(tempDir);

  try {
    fs.watch(tempDir, { persistent: false }, (eventType, filename) => {
      // Only react to our file. fs.watch may emit for any change in the dir.
      if (filename && filename !== TEST_MODE_FILENAME) {
        return;
      }
      const next = readTestMode(projectDir);
      const flipped = applyEnvFromFile(next);
      for (const c of flipped) {
        manager.ctx.log(`test-mode flip ${c.key}: ${c.was || '(unset)'} → ${c.now || '(unset)'}`);
      }
    });
  } catch (e) {
    manager.ctx.log(`test-mode watcher failed to install (${e.message}), live sync disabled`);
  }
}

module.exports = Manager;
