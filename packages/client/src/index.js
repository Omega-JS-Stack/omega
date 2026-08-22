import Storage from './modules/storage.js';
import Utilities from './modules/utilities.js';
import * as domUtils from './modules/dom.js';
import Analytics from './modules/analytics.js';
import Auth from './modules/auth.js';
import Bindings from './modules/bindings.js';
import Firestore from './modules/firestore.js';
import Notifications from './modules/notifications.js';
import ServiceWorker from './modules/service-worker.js';
import Sentry from './modules/sentry.js';
import Device from './modules/device.js';
import Verts from './modules/verts.js';
import { createRequest, mergeUsageIntoBindings } from './modules/request.js';
import { createLogger } from './modules/logger.js';
import { pathPrefix } from './modules/path-prefix.js';

const firebaseLogger = createLogger('firebase');
const analyticsLogger = createLogger('analytics');
const chatsyLogger = createLogger('chatsy');
const versionLogger = createLogger('version');

// Classic dev ports (N7) — the browser-side fallbacks when no resolved map is
// provided. Lockstep with @omega.js/config's CLASSIC_PORTS: browser code can't
// import that Node module (fs/net), so the numbers live here too.
const DEV_PORT_FALLBACKS = {
  auth: 9099,
  firestore: 8080,
  functions: 5001,
  hosting: 5002,
};

// The classic dev WEBSITE ORIGIN (#262) — the same lockstep-with-@omega.js/config
// deal as the ports above (its CLASSIC_DEV_ORIGIN). Protocol included, because a
// port alone cannot say it: `omega dev` fronts the public port with the mkcert
// proxy by default, so the assumption is https.
const DEV_ORIGIN_FALLBACK = 'https://localhost:4000';

class Manager {
  constructor() {
    // Configuration from init()
    this.config = {};

    // Runtime state
    this.state = {
      serviceWorker: null
    };

    // Auth settler: resolves when Firebase auth first determines user state
    this._firebaseAuthInitialized = false;
    this._authReadyResolve = null;
    this._authReady = new Promise((resolve) => {
      this._authReadyResolve = resolve;
    });

    // Initialize modules
    this._storage = new Storage();
    this._utilities = new Utilities(this);
    this._analytics = new Analytics(this);
    this._auth = new Auth(this);
    this._bindings = new Bindings(this);
    this._firestore = new Firestore(this);
    this._notifications = new Notifications(this);
    this._serviceWorker = new ServiceWorker(this);
    this._sentry = new Sentry(this);
    this._device = new Device(this);
    this._verts = new Verts(this);

    // Harmonized API fetch (omega.request) — fresh Bearer token when signed in,
    // omega-properties processed on every response (server usage → bindings)
    this._request = createRequest({
      getApiUrl: () => this.getApiUrl(),
      getIdToken: (force) => this._firebaseAuth?.currentUser
        ? this._auth.getIdToken(force)
        : null,
      onProperties: (properties) => mergeUsageIntoBindings(this._bindings, properties),
    });
  }

  // Make an API request: `omega.request('/omega/user/token', { method: 'POST', body: {} })`.
  // Route-relative paths resolve through getApiUrl(); pass `auth: false` for public routes,
  // `output: 'complete'` for { status, ok, headers, data, properties }.
  request(url, options) {
    return this._request(url, options);
  }

  // Module getters
  storage() {
    return this._storage;
  }

  auth() {
    return this._auth;
  }

  bindings() {
    return this._bindings;
  }

  firestore() {
    return this._firestore;
  }

  notifications() {
    return this._notifications;
  }

  serviceWorker() {
    return this._serviceWorker;
  }

  sentry() {
    return this._sentry;
  }

  device() {
    return this._device;
  }

  analytics() {
    return this._analytics;
  }

  verts() {
    return this._verts;
  }

  // DOM utilities
  dom() {
    return domUtils;
  }

  utilities() {
    return this._utilities;
  }

  // Initialize the manager
  async initialize(configuration) {
    try {
      // Store configuration as-is
      this.config = this._processConfiguration(configuration);

      // Set platform and runtime on HTML element
      this._setHtmlDataAttributes();

      // Initialize Firebase if a config blob is present (presence-driven — matches @omega.js/backend
      // convention). Reads `cloud.config` (the omega.json5 canonical shape — desktop passes its
      // resolved config through) and falls back to nested `firebase.app.config` (the web/extension
      // bridge contract shape).
      // Initialize Firebase only when the resolved config can actually boot the
      // SDK — apiKey is mandatory (init without one crashes with auth/invalid-api-key).
      // Configs carrying only projectId still resolve for getFunctionsUrl derivation.
      if (this._resolveFirebaseConfig()?.apiKey) {
        await this._initializeFirebase();
      } else {
        firebaseLogger.log('Skipped: config has no apiKey (Firebase-less site or empty framework merge blob)');
      }

      // Initialize Sentry if enabled
      if (this.config.sentry?.enabled) {
        await this._sentry.init(this.config.sentry.config);
      }

      // Initialize Analytics when the google provider is configured
      // (canonical shape: analytics.providers.google.{id,secret} — C4 cp106a;
      // projectId feeds the cross-surface uuidv5 identity namespace)
      // Web is the exception: its transport is the page's own gtag, so there
      // is no id or secret to require here (#159): the api_secret must never
      // reach a page at all.
      // Desktop's renderer is the other exception: it never sends at all
      // ([#411](https://github.com/Omega-JS-Stack/omega/issues/411)). When the
      // host injected an analytics bridge, every event forwards over IPC to the
      // main process, whose sender owns the one device id, the one session id
      // and the real engagement time — so a bridged renderer initializes with
      // no id and no secret of its own.
      const googleAnalytics = this.config.analytics?.providers?.google;
      const isWebRuntime = this._utilities.getRuntime() === 'web';
      const analyticsBridge = this._resolveAnalyticsBridge();
      if (isWebRuntime || analyticsBridge || (googleAnalytics?.id && googleAnalytics?.secret)) {
        this._analytics.init({
          id: googleAnalytics?.id || null,
          secret: googleAnalytics?.secret,
          projectId: this._resolveFirebaseConfig()?.projectId || this.config.brand?.id || null,
          bridge: analyticsBridge,
        });
      } else {
        analyticsLogger.log('Skipped: missing analytics.providers.google id or secret');
      }

      // Initialize service worker if enabled — dev included (push/caching are
      // testable locally). Registering at the page's scope ('/', or the base
      // path the site is mounted under — #360) REPLACES whatever worker last
      // claimed it (a different project on the same localhost port), and the
      // worker itself evicts foreign caches on boot. When a
      // project explicitly disables the SW, sweep the origin clean instead so
      // a previous project's worker can't keep serving its stale caches.
      // Only http(s) origins are eligible: file:// (desktop) and
      // chrome-extension:// (extension) pages ship the API but cannot host a
      // page-scope worker, so they skip the branch entirely — no register, no sweep.
      const originProtocol = window.location?.protocol;

      if (originProtocol === 'http:' || originProtocol === 'https:') {
        if (this.config.serviceWorker?.enabled) {
          this._serviceWorker.register({
            path: this.config.serviceWorker?.config?.path
          });
        } else {
          this._serviceWorker.unregisterAll();
        }
      }

      // Start version checking if enabled
      if (this.config.refreshNewVersion?.enabled) {
        this._startVersionCheck();
      }

      // Set up auth event listeners (uses event delegation, no need to wait for DOM)
      this._auth.setupEventListeners();

      // Set up push notifications
      if (this.config.pushNotifications?.enabled) {
        this._notifications.initialize(this.config.pushNotifications.config);
      }

      // Initialize Chatsy chat widget if enabled
      const chatsy = this.config.inbound?.chat?.providers?.chatsy;
      if (chatsy?.enabled && chatsy?.agentId) {
        this._initializeChatsy();
      }

      // Old IE force polyfill
      // await this._loadPolyfillsIfNeeded();

      // Initialize local device-stats tracking (installed/session/version)
      await this._device.initialize();

      // Update bindings with config and device data. `device` is the LOCAL
      // stats key — the `usage` key belongs to SERVER usage (seeded on auth
      // settle, refreshed from omega-properties by omega.request()).
      this.bindings().update({
        config: this.config,
        device: this._device.getBindingData(),
      });

      return this;
    } catch (error) {
      console.error('Manager initialization error:', error);
      throw error;
    }
  }

  _processConfiguration(configuration) {
    // Default configuration structure
    const defaults = {
      runtime: null, // Auto-detect if not provided (web, browser-extension, electron, node)
      environment: 'production',
      buildTime: Date.now(),
      brand: {
        id: 'brand',
        name: 'Brand',
        description: '',
        type: 'Organization',
        images: {
          brandmark: '',
          wordmark: '',
          combomark: ''
        },
        contact: {
          email: '',
          phone: ''
        },
        address: {}
      },
      auth: {
        enabled: true,
        config: {
          policy: null,
          redirects: {
            authenticated: '/dashboard/account',
            unauthenticated: '/signup'
          }
        }
      },
      firebase: {
        app: {
          enabled: true,
          config: {}
        },
        appCheck: {
          enabled: false,
          config: {
            siteKey: ''
          }
        }
      },
      // Consent (#383) — the region-gated banner. The palette/theme keys the
      // old `cookieConsent` blob carried are gone: the panel paints itself from
      // the --omega-* token sheet, which is the only way it is correct in both
      // color modes. `type` is gone too — the visitor's timezone decides opt-in
      // vs opt-out, never a config key.
      consent: {
        enabled: true,
        config: {
          position: 'bottom-left',
          content: {
            message: 'We use cookies to improve your experience, measure traffic, and personalize marketing. See our { terms }.',
            panelIntro: 'We and our partners use cookies and similar technologies to operate this site, measure how it is used, and personalize marketing. Necessary technologies are always active; the rest are yours to switch on or off, here or later, and a choice takes effect the moment you make it. See our { cookies } and { terms }.',
            accept: 'Accept',
            customize: 'Customize',
            acceptAll: 'Accept all',
            acceptNone: 'Accept none'
          }
        }
      },
      // ONE home (#23): the manager provisions the agent and writes agentId
      // here, and the widget's presentation settings sit beside it — there is
      // no second `chatsy` blob to keep in sync.
      inbound: {
        chat: {
          providers: {
            chatsy: {
              enabled: false,
              agentId: '',
              settings: {
                button: {
                  backgroundColor: '#237afc',
                  textColor: '#FFFFFF',
                  position: 'bottom-right',
                  type: 'round',
                  icon: 'default',
                }
              }
            }
          }
        }
      },
      sentry: {
        enabled: true,
        config: {
          dsn: '',
          release: '',
          replaysSessionSampleRate: 0.01,
          replaysOnErrorSampleRate: 0.01
        }
      },
      exitPopup: {
        enabled: true,
        config: {
          timeout: 1000 * 60 * 60 * 4,
          title: 'Want 15% off?',
          message: 'Get 15% off your purchase of our Premium plans.',
          okButton: {
            text: 'Claim 15% Discount',
            link: '/pricing'
          },
          // Social-proof faces above the offer (foot.html renders them);
          // an empty list renders four neutral glyph slots
          avatars: []
        }
      },
      lazyLoading: {
        enabled: true,
        config: {
          selector: '[data-lazy]',
          rootMargin: '50px 0px', // Start loading 50px before element comes into view
          threshold: 0.01, // Trigger when 1% of element is visible
          loadedClass: 'lazy-loaded',
          loadingClass: 'lazy-loading',
          errorClass: 'lazy-error'
        }
      },
      socialSharing: {
        enabled: false,
        config: {
          selector: '[data-social-share]',
          defaultPlatforms: ['facebook', 'twitter', 'linkedin', 'pinterest', 'reddit', 'email', 'copy'],
          buttonClass: '',
          showLabels: false,
          openInNewWindow: true,
          windowWidth: 600,
          windowHeight: 400,
        }
      },
      pushNotifications: {
        enabled: true,
        config: {
          autoRequest: 1000 * 60
        }
      },
      validRedirectHosts: [],
      payment: {
        providers: {},
        products: [],
      },

      // Non-configurable defaults
      refreshNewVersion: {
        enabled: true,
        config: {
          interval: 1000 * 60 * 60, // Check every hour
        }
      },
      serviceWorker: {
        enabled: true,
        config: {
          path: '/service-worker.js'
        }
      },
      analytics: {
        providers: {
          google: { id: '', secret: '' },
          meta: { id: '' },
          tiktok: { id: '' },
        },
      },
    };

    // Deep merge configuration with defaults
    const merged = this._deepMerge(defaults, configuration);

    // Evaluate string expressions for timeout values
    if (merged.exitPopup?.config?.timeout) {
      merged.exitPopup.config.timeout = safeEvaluate(merged.exitPopup.config.timeout);
    }

    if (merged.pushNotifications?.config?.autoRequest) {
      merged.pushNotifications.config.autoRequest = safeEvaluate(merged.pushNotifications.config.autoRequest);
    }

    if (merged.refreshNewVersion?.config?.interval) {
      merged.refreshNewVersion.config.interval = safeEvaluate(merged.refreshNewVersion.config.interval);
    }

    // Calculate buildTimeISO from buildTime
    if (merged.buildTime) {
      merged.buildTimeISO = new Date(merged.buildTime).toISOString();
    }

    // Return merged configuration
    return merged;
  }

  _deepMerge(target, source) {
    const output = Object.assign({}, target);
    if (isObject(target) && isObject(source)) {
      Object.keys(source).forEach(key => {
        if (isObject(source[key])) {
          if (!(key in target))
            Object.assign(output, { [key]: source[key] });
          else
            output[key] = this._deepMerge(target[key], source[key]);
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    return output;

    function isObject(item) {
      return item && typeof item === 'object' && !Array.isArray(item);
    }
  }

  _setHtmlDataAttributes() {
    // Skip if not in browser environment
    if (typeof document === 'undefined') {
      return;
    }

    const $html = document.documentElement;

    // Set platform (OS) - windows, mac, linux, ios, android, chromeos, unknown
    $html.dataset.platform = this._utilities.getPlatform();

    // Set browser - chrome, firefox, safari, edge, opera, brave
    $html.dataset.browser = this._utilities.getBrowser();

    // Set runtime - web, browser-extension, electron, node
    $html.dataset.runtime = this._utilities.getRuntime();

    // Set device - mobile, tablet, desktop
    $html.dataset.device = this._utilities.getDevice();
  }

  // Resolve the desktop renderer's analytics bridge — the ONE seam that turns
  // this client into a forwarder instead of a sender
  // ([#411](https://github.com/Omega-JS-Stack/omega/issues/411)).
  //
  // INJECTED by the host, never sniffed off a global: @omega.js/desktop's
  // renderer passes its preload's analytics surface as `config.analyticsBridge`
  // when it boots this client. A page that merely happens to carry a
  // `window.desktop` can never bridge a brand's analytics into a void, and web
  // and the extension inject nothing, so they keep every path they have today.
  //
  // An injected value with no `event()` is a broken host, not a runtime
  // condition — it raises rather than quietly falling back to a sender the
  // desktop app must not have.
  _resolveAnalyticsBridge() {
    const bridge = this.config?.analyticsBridge;

    if (!bridge) {
      return null;
    }

    if (typeof bridge.event !== 'function') {
      throw new Error('config.analyticsBridge carries no event() — the host must inject its preload\'s analytics surface, or nothing at all');
    }

    return bridge;
  }

  // Resolve the Firebase web SDK config blob. `cloud.config` first (canonical
  // omega.json5 role shape — desktop passes its resolved config through), then nested
  // `firebase.app.config` (the web/extension bridge contract shape).
  // A blob only counts when at least one value is non-empty — framework config merges
  // (e.g. UJM's Jekyll chain) inject all-empty-string blobs into Firebase-less sites,
  // and those must resolve to null (no init, no URL derivation).
  _resolveFirebaseConfig() {
    const hasValues = (blob) => !!blob
      && typeof blob === 'object'
      && Object.values(blob).some((value) => value);

    const cloud = this.config.cloud?.config;
    if (hasValues(cloud)) {
      return cloud;
    }
    const nested = this.config.firebase?.app?.config;
    if (hasValues(nested)) {
      return nested;
    }
    return null;
  }

  async _initializeFirebase() {
    const firebaseConfig = this._resolveFirebaseConfig();

    // Dynamically import Firebase v12
    const { initializeApp } = await import('firebase/app');
    const { getAuth, onAuthStateChanged } = await import('firebase/auth');
    const { initializeFirestore } = await import('firebase/firestore');
    const { getMessaging } = await import('firebase/messaging');

    // If we're in devmode, set the firebase config authDomain to the current host
    // if (this.isDevelopment() && firebaseConfig) {
    //   firebaseConfig.authDomain = window.location.hostname;
    // }

    // Initialize Firebase. Re-init guards: if there's already a [DEFAULT] app
    // (live reload, re-init in tests), get the existing one rather than throwing
    // `app/duplicate-app`.
    const { getApp, getApps } = await import('firebase/app');
    const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

    // Store Firebase references
    this._firebaseApp = app;
    this._firebaseAuth = getAuth(app);
    this._firebaseFirestore = initializeFirestore(app, {});

    // Connect to the local emulator suite in development — ZERO flags (N5): dev mode
    // means LOCAL Firebase, period. environment=development (what `omega dev` injects)
    // auto-connects so dev can mutate data, test rules instantly, and seed the
    // frontend; production builds (environment=production) never connect. There is
    // deliberately NO live-Firebase opt-out for dev — build production locally if you
    // truly need live. Ports come from the resolved dev map when one was provided
    // (N7: the `dev.ports` chrome, then `window.__OMEGA_DEV_PORTS__` for the keys it
    // omits), classic defaults otherwise — and an assumed port says so out loud.
    // Both connects live HERE, immediately after the instances are created: the auth
    // module reads accounts via `manager.firebaseFirestore` directly, so connecting
    // lazily (or in only one module) leaves early reads pointed at LIVE Firebase.
    // Auth warnings banner disabled: it injects a DOM overlay that interferes with
    // page content in automated flows.
    if (this.isDevelopment()) {
      const ports = this._devPorts();
      const authEmulatorUrl = this._authEmulatorUrl();
      this._warnClassicPortAssumption();
      firebaseLogger.log(`Connecting to emulators (auth ${authEmulatorUrl}, firestore :${ports.firestore})`);
      const { connectAuthEmulator } = await import('firebase/auth');
      const { connectFirestoreEmulator } = await import('firebase/firestore');
      connectAuthEmulator(this._firebaseAuth, authEmulatorUrl, { disableWarnings: true });
      connectFirestoreEmulator(this._firebaseFirestore, 'localhost', ports.firestore);
      firebaseLogger.log('Emulators connected');
    }

    // Only initialize messaging if service workers AND push are supported —
    // getMessaging() floats an unhandled unsupported-browser rejection otherwise
    if ('serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window) {
      this._firebaseMessaging = getMessaging(app);
    } else {
      console.warn('Service workers or push not available - Firebase Messaging disabled');
      this._firebaseMessaging = null;
    }

    // Initialize Firebase App Check if enabled
    if (this.config.firebase.appCheck?.enabled) {
      const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import('firebase/app-check');
      const siteKey = this.config.firebase.appCheck.config.siteKey;

      if (siteKey) {
        initializeAppCheck(app, {
          provider: new ReCaptchaEnterpriseProvider(siteKey),
          isTokenAutoRefreshEnabled: true
        });
      }
    }

    // Setup auth state listener
    onAuthStateChanged(this._firebaseAuth, (user) => {
      // Mark auth as initialized and resolve the settler promise on first callback
      if (!this._firebaseAuthInitialized) {
        this._firebaseAuthInitialized = true;
        this._authReadyResolve();
      }

      // Let auth module handle everything including DOM updates
      this._auth._handleAuthStateChange(user);

      // Analytics follows auth: the identity on every runtime (user_id =
      // uuidv5(uid, namespace)), plus the login/logout events on the runtimes
      // that own them — web's auth pages fire their own (#328 gap 8)
      this._analytics.handleAuthChange(user);

      // Update Chatsy with current user
      if (this._chatsy) {
        const resolved = this._auth.getUser();
        this._chatsy.setUser(resolved ? { id: resolved.uid, email: resolved.email, firstName: resolved.displayName, photoURL: resolved.photoURL } : null);
      }
    });
  }

  // Getters for Firebase services
  get firebaseApp() { return this._firebaseApp; }
  get firebaseAuth() { return this._firebaseAuth; }
  get firebaseFirestore() { return this._firebaseFirestore; }
  get firebaseMessaging() { return this._firebaseMessaging; }

  isDevelopment() {
    return this.config.environment === 'development';
  }

  // The dev port map a page was actually GIVEN (N7), without fallbacks — two
  // channels, and the BAKED CHROME WINS: `config.dev.ports` is written by
  // `omega dev` at render time, so it is the live map of the stack this page
  // was served by. `window.__OMEGA_DEV_PORTS__` is a driver-injected fallback
  // for pages whose chrome carries nothing — a statically built site the
  // devkit e2e harness serves, say — and it must not be able to OVERRIDE the
  // real channel, or a green suite proves only the side channel
  // ([#300](https://github.com/Omega-JS-Stack/omega/issues/300)). Presence of
  // a key means a RESOLVED fact about a live stack; absence means "assume the
  // classics".
  _providedDevPorts() {
    return {
      ...(typeof window !== 'undefined' && window.__OMEGA_DEV_PORTS__ || {}),
      ...(this.config.dev?.ports || {}),
    };
  }

  _devPorts() {
    return { ...DEV_PORT_FALLBACKS, ...this._providedDevPorts() };
  }

  // One loud line, dev only, when a port is an ASSUMPTION rather than a
  // resolved fact (#300). Nothing identity-checks what answers on a classic
  // port, so a neighbouring project's emulator holding it reads as an auth
  // mystery (`auth/user-not-found` for hours) instead of a port problem. This
  // says which numbers are guesses, before the first connect.
  _warnClassicPortAssumption() {
    const provided = this._providedDevPorts();
    const assumed = Object.keys(DEV_PORT_FALLBACKS).filter((name) => !provided[name]);
    if (!assumed.length) {
      return;
    }

    firebaseLogger.warn(
      `No resolved dev port for ${assumed.join(', ')}; assuming the classic ${assumed.map((name) => `${name} :${DEV_PORT_FALLBACKS[name]}`).join(', ')}. `
      + 'If another project\'s emulator holds those ports, this page is talking to IT, not your stack. '
      + 'Boot the backend with `omega dev` (or `omega emulator`) so the resolved map reaches the page.',
    );
  }

  // Where the dev WEBSITE answers — the one shared answer for every surface
  // that links to it in dev (#262). A resolved fact when the stack published
  // one: `omega dev` puts its origin in the same `dev` map as the ports, and
  // web reads it from the page chrome while desktop/extension read it from
  // their build-time bake of that same map. Protocol is part of the fact —
  // the dev server fronts its public port with the mkcert proxy by default,
  // so a port alone would still be a guess about the scheme.
  getDevWebsiteOrigin() {
    const provided = this.config.dev?.origin;

    if (provided) {
      return provided;
    }

    this._warnClassicOriginAssumption();
    return DEV_ORIGIN_FALLBACK;
  }

  // The origin's half of the classic-assumption warning (#300's pattern, #262):
  // one loud line when the answer is a guess rather than a published fact,
  // because a wrong dev origin fails as a silent connection refusal.
  _warnClassicOriginAssumption() {
    firebaseLogger.warn(
      `No resolved dev website origin; assuming the classic ${DEV_ORIGIN_FALLBACK}. `
      + 'If your `omega dev` bumped its port (or runs without mkcert), this is the wrong origin. '
      + 'Boot the website with `omega dev` so the resolved origin reaches this surface.',
    );
  }

  // Where the auth emulator answers FROM THE BROWSER'S POINT OF VIEW (#156).
  // A surface whose dev server proxies the emulator under its own origin says
  // so with `dev.authEmulatorProxy` — and then the emulator URL must be that
  // origin, so the OAuth handler and the SDK's helper iframe are first-party
  // and the redirect credential survives storage partitioning. Every other
  // surface (desktop, extension, a page with no proxy) keeps talking straight
  // to the emulator's own port.
  // Origin only, never a path: connectAuthEmulator() discards any path on the
  // URL it is handed, so the proxy has to be mounted at the site root.
  _authEmulatorUrl() {
    if (this.config.dev?.authEmulatorProxy && typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }

    return `http://localhost:${this._devPorts().auth}`;
  }

  getFunctionsUrl(environment) {
    const env = environment || this.config.environment;
    const projectId = this._resolveFirebaseConfig()?.projectId;

    if (!projectId) {
      throw new Error('Firebase project ID not configured');
    }

    if (env === 'development') {
      return `http://localhost:${this._devPorts().functions}/${projectId}/us-central1`;
    }

    return `https://us-central1-${projectId}.cloudfunctions.net`;
  }

  getApiUrl(environment, url) {
    // Precedence: passed environment > query string > config.environment
    const searchParams = new URLSearchParams(window.location.search);
    const queryEnv = searchParams.get('_dev_apiEnvironment');
    const env = environment
      || queryEnv
      || this.config.environment;

    if (env === 'development') {
      // Scheme follows what the provided dev map says is actually running (N7):
      // - `https` key → `mgr serve`'s mkcert proxy (it owns publishing that key).
      // - `hosting` key → an allocator-booted emulator stack; the hosting
      //   emulator speaks plain http on 127.0.0.1 (rewrites /omega/** to the API).
      // - no map → classic assumption: `mgr serve`'s HTTPS proxy on 5002
      //   (since @omega.js/backend 5.7.0) — plain http:// cannot connect to it.
      const provided = this._providedDevPorts();
      if (provided.https) {
        return `https://localhost:${provided.https}`;
      }
      if (provided.hosting) {
        return `http://127.0.0.1:${provided.hosting}`;
      }
      return 'https://localhost:5002';
    }

    // The API rides the BRAND domain (api.<brand host>). Never derive from
    // authDomain: it is an auth concern (the brand host, with /__/auth/*
    // self-hosted at build time) and its value must stay free to change
    // without moving the API base.
    const brandUrl = this.config.brand?.url; // schema enforces an http(s) URL
    const baseUrl = url || brandUrl || window.location.origin;

    // Prepend 'api.' subdomain, hostname-only (playground.omegajs.dev ->
    // api.playground.omegajs.dev) — any path/port on brand.url is dropped,
    // exactly like the desktop/extension url-helpers mirrors.
    return `https://api.${new URL(baseUrl).hostname}`;
  }

  isValidRedirectUrl(url) {
    try {
      const currentUrlObject = new URL(window.location.href);
      const decoded = decodeURIComponent(url);

      // Path-relative values ('/pricing') resolve against the page origin so they
      // reach the checks below as an absolute URL instead of throwing and falling
      // back to the policy default. Only a leading '/' counts: anything else must
      // parse as an absolute URL on its own, so garbage ('not-a-url') still fails.
      // A protocol-relative value ('//evil.com') resolves to its own host and is
      // then rejected by the same-host check, exactly like the absolute form.
      const returnUrlObject = decoded.startsWith('/')
        ? new URL(decoded, currentUrlObject.origin)
        : new URL(decoded);

      // Loopback returns (RFC 8252 §7.3) are valid while the SITE runs in development:
      // native apps (Electron Manager) can't OS-register their custom scheme in dev, so
      // their sign-in flow returns to an ephemeral 127.0.0.1 listener instead. Any port —
      // the app binds it at flow start. Production sites never match this branch.
      if (this.isDevelopment() && ['127.0.0.1', '[::1]', 'localhost'].includes(returnUrlObject.hostname)) {
        return true;
      }

      return returnUrlObject.host === currentUrlObject.host
        || returnUrlObject.protocol === `${this.config.brand?.id}:`
        || (this.config.validRedirectHosts || []).includes(returnUrlObject.host);
    } catch (e) {
      return false;
    }
  }

  // The web build's public config filter inlines `settings: null` when a
  // brand sets none, and Chatsy's constructor rejects a null blob — omit the
  // key instead so the widget applies its own defaults (#377).
  _chatsyOptions(config) {
    return config.settings ? { settings: config.settings } : {};
  }

  async _initializeChatsy() {
    try {
      const { default: Chatsy } = await import('chatsy');
      const config = this.config.inbound.chat.providers.chatsy;

      this._chatsy = new Chatsy(config.agentId, this._chatsyOptions(config));

      chatsyLogger.log('Initialized');
    } catch (error) {
      chatsyLogger.error('Failed to initialize:', error);
    }
  }

  _startVersionCheck() {
    // Quit if window is not available
    if (typeof window !== 'undefined') {
      // Re-focus events
      window.addEventListener('focus', () => {
        this._checkVersion();
      });

      window.addEventListener('online', () => {
        this._checkVersion();
      });
    }

    // Set up interval — re-initializing replaces the timer, never stacks a
    // second one on top of the first
    clearInterval(this._versionCheckInterval);
    this._versionCheckInterval = setInterval(() => {
      this._checkVersion();
    }, this.config.refreshNewVersion.config.interval);
  }


  // async _loadPolyfillsIfNeeded() {
  //   // Check if polyfills are needed by testing for ES6 features
  //   const featuresPass = (
  //     typeof Symbol !== 'undefined'
  //   );

  //   // If all features are supported, no polyfills needed
  //   if (featuresPass) {
  //     return;
  //   }

  //   // Load polyfills for older browsers (especially IE)
  //   try {
  //     await domUtils.loadScript({
  //       src: 'https://cdnjs.cloudflare.com/polyfill/v3/polyfill.min.js?flags=always%2Cgated&features=default%2Ces5%2Ces6%2Ces7%2CPromise.prototype.finally%2C%7Ehtml5-elements%2ClocalStorage%2Cfetch%2CURLSearchParams',
  //       crossorigin: 'anonymous'
  //     });
  //     console.log('Polyfills loaded for older browser');
  //   } catch (error) {
  //     console.error('Failed to load polyfills:', error);
  //     // Continue initialization even if polyfills fail to load
  //   }
  // }

  async _checkVersion() {
    if (this.isDevelopment()) {
      /* @dev-only:start */
      {
        versionLogger.log('Skipping version check in development mode');
      }
      /* @dev-only:end */
      return;
    }

    try {
      // The manifest is served from the site's own mount (#364): under a URL
      // path (#355) a root-relative fetch lands off-site and 404s forever. No
      // stamp means the domain root and an unchanged URL.
      const response = await fetch(`${pathPrefix()}/build.json?cb=${Date.now()}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch build.json (${response.status})`);
      }

      const data = await response.json();
      if (!data.timestamp) {
        throw new Error('No timestamp found in build.json');
      }

      const buildTimeLive = new Date(data.timestamp);
      const buildTimeCurrent = new Date(this.config.buildTime);

      // Add 1 hour to current build time to account for npm build process
      buildTimeCurrent.setHours(buildTimeCurrent.getHours() + 1);

      // Log version info
      versionLogger.log(`Current build time: ${buildTimeCurrent.toISOString()}, Live build time: ${buildTimeLive.toISOString()}`);

      // If live version is newer, reload the page
      if (buildTimeCurrent >= buildTimeLive) {
        return; // No update needed
      }

      // New version detected
      versionLogger.log('New version detected, reloading page...');

      // If running in a non-browser environment, warn and return
      if (typeof window === 'undefined') {
        versionLogger.warn('Cannot reload in non-browser environment');
        return;
      }

      // Force page reload
      window.onbeforeunload = function () {
        return undefined;
      };

      window.location.reload(true);
    } catch (error) {
      versionLogger.warn('Failed version check:', error);
    }
  }
}

// Safely evaluate timeout string expressions
const safeEvaluate = (str) => {
  if (typeof str !== 'string') return str;

  // Only allow numbers, *, +, -, /, parentheses, and whitespace
  if (!/^[\d\s\*\+\-\/\(\)]+$/.test(str)) {
    console.warn('Invalid expression format:', str);
    return str;
  }

  try {
    // Use Function constructor instead of eval for safer evaluation
    return new Function(`return ${str}`)();
  } catch (e) {
    console.warn('Failed to evaluate expression:', str, e);
    return str;
  }
};

// Create singleton instance
const manager = new Manager();

// Export for different environments
export default manager;
export { Manager };

// For non-ES6 environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = manager;
}

