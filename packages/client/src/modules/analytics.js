import core from './analytics-core.js';
import { createLogger } from './logger.js';

const logger = createLogger('analytics');

// Supported runtimes for analytics
const SUPPORTED_RUNTIMES = ['browser-extension', 'electron', 'web'];

// Raw per-install device id (a plain UUID) — client_id derives from it
const DEVICE_ID_KEY = '_omega_device_id';

class Analytics {
  constructor(manager) {
    this.manager = manager;
    this.initialized = false;
    this.devMode = false;
    this.runtime = null;
    this.config = null;
    this.measurementId = null;
    this.secret = null;
    this.projectId = null;
    this.namespace = null;
    this.clientId = null;
    this.userId = null;
    this.userProperties = {};
  }

  // Check if runtime is supported
  _isSupported() {
    return SUPPORTED_RUNTIMES.includes(this.runtime);
  }

  // Web's transport is the page's own gtag, never the Measurement Protocol
  _isWeb() {
    return this.runtime === 'web';
  }

  // Initialize analytics
  init(config = {}) {
    // Store config
    this.config = config;

    // Get runtime
    this.runtime = this.manager.utilities().getRuntime();

    if (!this._isSupported()) {
      logger.log(`Runtime "${this.runtime}" not supported yet, skipping`);
      return;
    }

    // Skip if already initialized
    if (this.initialized) {
      logger.log('Already initialized');
      return;
    }

    // Check for development mode — dev NEVER posts to a real property
    // (consumers' dev traffic must not land in anyone's GA4; the baked-in
    // fallback credentials are gone by design — C4 cp106a de-ITW).
    this.devMode = this.manager.isDevelopment();

    // Canonical handoff: analytics.providers.google.{id,secret} + the
    // brand's projectId for the cross-surface identity namespace
    this.measurementId = config.measurementId || config.id;
    this.projectId = config.projectId || null;

    // The Measurement Protocol api_secret is never read on web: the page's
    // gtag is the transport there, and the secret must never reach a page.
    this.secret = this._isWeb() ? null : config.secret;

    // Skip if no measurement ID. Web has none to require, since the gtag
    // config is page-side (emitted by web core foot.html)
    if (!this.measurementId && !this._isWeb()) {
      logger.log('No measurement ID provided, skipping initialization');
      return;
    }

    // Cross-surface identity — shared analytics-core (the ONE place the
    // uuidv5 math lives; desktop's main-process lib uses the same module)
    this.namespace = core.deriveNamespace(this.projectId);

    // Generate or retrieve client ID
    this.clientId = this._getClientId();

    // Log initialization
    logger.log(`Initializing with measurement ID: ${this.measurementId || 'page-side gtag'}${this.devMode ? ' (dev mode)' : ''} [${this.runtime}]`);

    // Mark as initialized
    this.initialized = true;

    // Send initial pageview, never on web: the page's own gtag config
    // already fired one and a second would double-count
    if (!this._isWeb()) {
      this.event('page_view');
    }
  }

  // Stable per-install device id, hashed into the project namespace so the
  // same device is the same GA client across surfaces. Without a projectId
  // the raw (still stable) device id is used as-is.
  _getClientId() {
    let deviceId = null;
    try {
      deviceId = localStorage.getItem(DEVICE_ID_KEY);
    } catch (e) {
      // localStorage not available
    }

    if (!deviceId) {
      deviceId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Math.random().toString(36).substring(2)}.${Date.now()}`;
      try {
        localStorage.setItem(DEVICE_ID_KEY, deviceId);
      } catch (e) {
        // localStorage not available
      }
    }

    return core.deriveClientId(deviceId, this.namespace);
  }

  // Get page data to include with all events
  _getPageData() {
    return {
      page_path: window.location.pathname,
      page_title: document.title,
      page_location: window.location.href,
    };
  }

  // Track an event
  event(eventName, params = {}) {
    if (!this._isSupported()) {
      return;
    }

    if (!this.initialized) {
      return;
    }

    // Normalize to GA4's charset/length rule — same core call desktop makes,
    // so an event name lands (or is rejected) identically on every surface
    const name = core.normalizeEventName(eventName);
    if (!name) {
      logger.warn(`Dropping event with unusable name: ${eventName}`);
      return;
    }

    // Merge page data with provided params
    const eventParams = {
      ...this._getPageData(),
      ...params,
    };

    // Log event
    logger.log(`Event: ${name}${this.devMode ? ' (dev mode)' : ''}`, eventParams);

    // Transport split: web hands the event to the page's gtag; the
    // Measurement Protocol stays exclusive to the runtimes that have no page
    // of their own to carry a gtag config
    if (this._isWeb()) {
      this._sendViaGtag(name, eventParams);
    } else {
      this._sendViaFetch(name, eventParams);
    }
  }

  // Send event via the page's gtag (web). Web core foot.html emits the gtag
  // config, and a no-op gtag stub when the brand has no analytics configured
  _sendViaGtag(eventName, params = {}) {
    if (typeof window.gtag !== 'function') {
      logger.log('No gtag on the page, event not sent');
      return;
    }

    window.gtag('event', eventName, params);
  }

  // Send event via Measurement Protocol (fetch)
  _sendViaFetch(eventName, params = {}) {
    // Dev mode logs only — nothing posts
    if (this.devMode) {
      logger.log('Dev mode: event logged locally, not sent');
      return;
    }

    // Measurement Protocol requires api_secret
    if (!this.secret) {
      logger.warn('No API secret provided, cannot send via Measurement Protocol');
      return;
    }

    const url = core.buildCollectUrl(this.measurementId, this.secret);

    const payload = core.buildPayload({
      clientId: this.clientId,
      userId: this.userId,
      userProperties: this.userProperties,
      eventName,
      params: {
        ...params,
        engagement_time_msec: 100,
        session_id: this._getSessionId(),
      },
    });

    // Send via fetch (fire and forget)
    fetch(url, {
      method: 'POST',
      body: JSON.stringify(payload),
    }).catch((err) => {
      logger.warn('Failed to send event:', err);
    });
  }

  // Get or generate session ID
  _getSessionId() {
    const storageKey = '_ga_session_id';
    const sessionTimeout = 30 * 60 * 1000; // 30 minutes

    let sessionData = null;
    try {
      sessionData = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    } catch (e) {
      // sessionStorage not available
    }

    const now = Date.now();

    // Check if session is still valid
    if (sessionData && (now - sessionData.lastActive) < sessionTimeout) {
      sessionData.lastActive = now;
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(sessionData));
      } catch (e) {
        // sessionStorage not available
      }
      return sessionData.id;
    }

    // Create new session
    const newSession = {
      id: `${Date.now()}`,
      lastActive: now,
    };

    try {
      sessionStorage.setItem(storageKey, JSON.stringify(newSession));
    } catch (e) {
      // sessionStorage not available
    }

    return newSession.id;
  }

  // Set user properties — GA4 wraps each value as { value } — merged into
  // every subsequent event's user_properties block
  setUserProperties(properties = {}) {
    // TODO: web stores but never sends these (only the MP payload reads them);
    // wiring gtag("set", ...) is open — see #159
    if (!this._isSupported()) {
      return;
    }

    if (!this.initialized) {
      return;
    }

    this.userProperties = { ...this.userProperties, ...core.wrapUserProperties(properties) };
  }

  // Set user ID — raw uid in, uuidv5 out (the same value desktop/backend
  // emit for this uid). Without a namespace the raw uid is never sent.
  setUserId(userId) {
    // TODO: web stores but never sends these (only the MP payload reads them);
    // wiring gtag("set", ...) is open — see #159
    if (!this._isSupported()) {
      return;
    }

    if (!this.initialized) {
      return;
    }

    this.userId = core.deriveUserId(userId, this.namespace);
  }
}

export default Analytics;
