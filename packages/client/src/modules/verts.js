/**
 * Verts module — the fallback-ladder ad engine shared by every surface
 * (docs/web/ads-system.md, phase 2).
 *
 * Two lanes, one implementation:
 *   1. Provider lane (web only): AdSense. Script-load failure IS the adblock
 *      detector (no bait divs, no library) — blocked → straight to the
 *      fallback lane. Otherwise the <ins> is built per type and fill is
 *      awaited via a MutationObserver on data-ad-status (+ timeout).
 *   2. Fallback lane (all surfaces): a sandboxed iframe to the resolved
 *      in-house source's /omega/verts/serve, origin-validated postMessage with
 *      a fixed vocabulary (omega-vert:set-dimensions / omega-vert:click), and
 *      HOST-owned lifecycle — rotation timer, staleness recovery
 *      (visibilitychange/online → reload when stale), and no-fill collapse
 *      (a unit that never reports dimensions within the fill timeout hides
 *      itself and emits omega-vert:no-fill). The iframe only renders and
 *      reports; it never refreshes itself (kills the legacy chrome-error
 *      stranding).
 *
 * Element binding (the mirrored-implementation surface): mount($el) arms one
 * host lazily near the viewport (IntersectionObserver) reading its
 * data-omega-vert* attributes; bind(root) scans [data-omega-vert] and mounts
 * every match. The web verts/unit section delegates here, and desktop/
 * extension bind the same vocabulary in phase 4 — one implementation.
 *
 * Source resolution (advertising.providers.inhouse.source):
 *   'self'    → this brand's api URL (manager.getApiUrl())
 *   'company' → the parent company's api URL (config.company.url through the
 *               same api-URL derivation — the config company layer supplies
 *               company.url to every sub-brand)
 *   full URL  → used verbatim (trailing slashes stripped)
 */

// Size presets (name → max-height in pixels) — the ONE px table (SSOT; the
// section scss carries no copy, the module applies the constraint inline).
const SIZE_PRESETS = {
  banner: 150,
  leaderboard: 90,
  rectangle: 250,
  'large-rectangle': 600,
  skyscraper: 600,
};

// AdSense unit attributes per type — the ONE layout table (the legacy
// duplicated the in-feed layout keys across includes).
const ADSENSE_FORMATS = {
  display: { style: 'display:block', attributes: { 'data-ad-format': 'auto', 'data-full-width-responsive': 'true' }, slotKey: 'display' },
  'in-article': { style: 'display:block; text-align:center', attributes: { 'data-ad-layout': 'in-article', 'data-ad-format': 'fluid' }, slotKey: 'inArticle' },
  'in-feed': { style: 'display:block', attributes: { 'data-ad-format': 'fluid' }, slotKey: 'inFeed', layoutKeys: { 'image-above': '-6t+ed+2x-11-88', 'image-side': '-fb+5w+4e-db+86' } },
  multiplex: { style: 'display:block', attributes: { 'data-ad-format': 'autorelaxed' }, slotKey: 'multiplex' },
};

// Fixed postMessage vocabulary (matches @omega.js/backend's rendered unit)
const MESSAGE_DIMENSIONS = 'omega-vert:set-dimensions';
const MESSAGE_CLICK = 'omega-vert:click';

// Sandbox attributes for the house iframe (legacy-proven set)
const IFRAME_SANDBOX = 'allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-top-navigation-by-user-activation';

// Lifecycle defaults — rotation OFF by default; staleness generous
const DEFAULT_FILL_TIMEOUT = 9000;
const DEFAULT_STALE_AFTER = 1000 * 60 * 10;
const DEFAULT_ROTATE_INTERVAL = 0;
const MAX_HEIGHT_CEILING = 1200;

/**
 * Resolve a size preset name or raw pixel value to a max-height in px.
 * @param {string|number} value - preset name ('banner') or raw px ('300')
 * @returns {number|null} pixels, or null when unresolvable
 */
function resolveSizePx(value) {
  if (!value) {
    return null;
  }

  if (SIZE_PRESETS[value]) {
    return SIZE_PRESETS[value];
  }

  const num = parseInt(value, 10);
  return isNaN(num) || num <= 0 ? null : num;
}

/**
 * Clamp a reported iframe height to sane bounds.
 * @param {*} height - reported height (any postMessage payload value)
 * @param {number} [maxPx] - unit max-height (size preset), ceiling otherwise
 * @returns {number|null} clamped integer px, or null when not a usable number
 */
function clampHeight(height, maxPx) {
  const num = parseInt(height, 10);
  if (isNaN(num) || num <= 0) {
    return null;
  }

  return Math.min(num, maxPx || MAX_HEIGHT_CEILING);
}

/**
 * One mounted house/company ad unit — owns the iframe and its lifecycle.
 */
class VertUnit {
  /**
   * @param {object} manager - the client singleton
   * @param {Element} $el - host element the iframe mounts into
   * @param {object} options
   * @param {string} options.source - resolved base URL of the ad server
   * @param {string[]} [options.tags] - contextual tags for targeting
   * @param {string} [options.size] - size preset or raw px (max-height)
   * @param {string} [options.theme] - 'light' | 'dark' passthrough
   * @param {string} [options.vertId] - pin a specific ad
   * @param {number} [options.fillTimeout] - ms before no-fill collapse
   * @param {number} [options.staleAfter] - ms before a recovery reload
   * @param {number} [options.rotateInterval] - ms between rotations (0 = off)
   * @param {Function} [options.onFill] - first successful dimension report
   * @param {Function} [options.onNoFill] - collapse (204 / never reported)
   * @param {Function} [options.onClick] - click message from the frame
   */
  constructor(manager, $el, options = {}) {
    this.manager = manager;
    this.$el = $el;
    this.options = options;

    this.source = String(options.source || '').replace(/\/+$/, '');
    this.sourceOrigin = new URL(this.source).origin;
    this.maxHeight = resolveSizePx(options.size);

    this.filled = false;
    this.destroyed = false;
    this.lastLoadedAt = 0;
    this.staleAfter = options.staleAfter || DEFAULT_STALE_AFTER;
    this.rotateInterval = options.rotateInterval || DEFAULT_ROTATE_INTERVAL;
    this.fillTimeout = options.fillTimeout || DEFAULT_FILL_TIMEOUT;

    this.$iframe = null;
    this._fillTimer = null;
    this._rotateTimer = null;

    // Bound listeners — kept for removal on destroy
    this._onMessage = (event) => this.handleMessage(event);
    this._onRecover = () => this.recover();
  }

  /**
   * The serve URL for one impression (cache-busted so rotation reloads
   * always reselect).
   * @returns {string}
   */
  buildServeUrl() {
    const url = new URL(`${this.source}/omega/verts/serve`);

    if (typeof window !== 'undefined' && window.location?.host) {
      url.searchParams.set('parent', window.location.host);
    }

    const tags = this.options.tags || [];
    if (tags.length) {
      url.searchParams.set('tags', tags.join(','));
    }

    if (this.options.vertId) {
      url.searchParams.set('vertId', this.options.vertId);
    }

    if (this.maxHeight) {
      url.searchParams.set('height', String(this.maxHeight));
    }

    if (this.options.theme) {
      url.searchParams.set('theme', this.options.theme);
    }

    url.searchParams.set('t', String(Date.now()));

    return url.toString();
  }

  /**
   * Mount the iframe and start the lifecycle (fill timer, rotation,
   * staleness listeners).
   * @returns {VertUnit} this
   */
  load() {
    // Host constraint from the size preset — inline so the px table stays
    // one place (AdSense-style important overrides can't relax it either)
    if (this.maxHeight) {
      this.$el.style.setProperty('max-height', `${this.maxHeight}px`, 'important');
      this.$el.style.setProperty('overflow', 'hidden');
    }

    const $iframe = document.createElement('iframe');
    $iframe.setAttribute('sandbox', IFRAME_SANDBOX);
    $iframe.setAttribute('frameborder', '0');
    $iframe.setAttribute('scrolling', 'no');
    $iframe.setAttribute('allowtransparency', 'true');
    $iframe.setAttribute('title', 'Sponsored');
    $iframe.style.setProperty('display', 'block');
    $iframe.style.setProperty('width', '100%');
    $iframe.style.setProperty('border', '0');
    $iframe.addEventListener('load', () => {
      this.lastLoadedAt = Date.now();
    });
    $iframe.src = this.buildServeUrl();

    this.$iframe = $iframe;
    this.$el.appendChild($iframe);

    // Fixed-vocabulary message channel + host-owned recovery hooks
    window.addEventListener('message', this._onMessage);
    window.addEventListener('online', this._onRecover);
    document.addEventListener('visibilitychange', this._onRecover);

    this._armFillTimer();

    if (this.rotateInterval > 0) {
      this._rotateTimer = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          return;
        }
        this.reload('rotate');
      }, this.rotateInterval);
    }

    return this;
  }

  /**
   * Origin-validated message handler — the source origin ONLY, and (when the
   * browser supplies it) only this unit's own frame.
   * @param {MessageEvent} event
   */
  handleMessage(event) {
    if (this.destroyed || event.origin !== this.sourceOrigin) {
      return;
    }

    // Multiple units on one page: only this unit's frame speaks to it
    if (event.source && this.$iframe?.contentWindow && event.source !== this.$iframe.contentWindow) {
      return;
    }

    const message = event.data || {};

    if (message.type === MESSAGE_DIMENSIONS) {
      const height = clampHeight(message.height, this.maxHeight);
      if (!height) {
        return;
      }

      this.$iframe.style.height = `${height}px`;
      this.lastLoadedAt = Date.now();

      if (!this.filled) {
        this.filled = true;
        this._clearFillTimer();
        this._emit('fill', { height });
      }
    } else if (message.type === MESSAGE_CLICK) {
      // The frame's <a> navigates through the redirect route itself — the
      // click message is optional host-side handling (telemetry, callbacks)
      this._emit('click', { id: message.id });
    }
  }

  /**
   * Staleness check — has the frame gone longer than staleAfter without a
   * (re)load or dimension report?
   * @param {number} [now]
   * @returns {boolean}
   */
  isStale(now) {
    return ((now || Date.now()) - this.lastLoadedAt) > this.staleAfter;
  }

  /**
   * Recovery hook (visibilitychange / online): reload a stale frame — the
   * legacy self-refresh stranded chrome-error:// pages exactly here.
   */
  recover() {
    if (this.destroyed || !this.filled) {
      return;
    }

    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }

    if (this.isStale()) {
      this.reload('stale');
    }
  }

  /**
   * Reload the iframe with a fresh serve URL (rotation / staleness).
   * @param {string} [reason]
   */
  reload(reason) {
    if (this.destroyed || !this.$iframe) {
      return;
    }

    this.filled = false;
    this.$iframe.src = this.buildServeUrl();
    this._armFillTimer();
    this._emit('reload', { reason });
  }

  /**
   * No-fill collapse: hide the host, emit, and tear down — the ladder's end.
   */
  noFill() {
    if (this.destroyed) {
      return;
    }

    this.$el.style.setProperty('display', 'none');
    this._emit('no-fill', {});
    this.destroy();
  }

  /** Remove listeners and timers; the unit is inert afterwards. */
  destroy() {
    this.destroyed = true;
    this._clearFillTimer();

    if (this._rotateTimer) {
      clearInterval(this._rotateTimer);
      this._rotateTimer = null;
    }

    window.removeEventListener('message', this._onMessage);
    window.removeEventListener('online', this._onRecover);
    document.removeEventListener('visibilitychange', this._onRecover);
  }

  _armFillTimer() {
    this._clearFillTimer();
    this._fillTimer = setTimeout(() => {
      // A 204 no-fill (or a dead server) never posts dimensions — collapse
      if (!this.filled) {
        this.noFill();
      }
    }, this.fillTimeout);
  }

  _clearFillTimer() {
    if (this._fillTimer) {
      clearTimeout(this._fillTimer);
      this._fillTimer = null;
    }
  }

  _emit(name, detail) {
    const callback = this.options[`on${name.replace(/(^|-)(\w)/g, (m, sep, ch) => ch.toUpperCase())}`];
    if (typeof callback === 'function') {
      try {
        callback(detail);
      } catch (e) {
        console.error(`[Verts] on${name} callback error:`, e);
      }
    }

    if (typeof CustomEvent !== 'undefined' && typeof this.$el.dispatchEvent === 'function') {
      this.$el.dispatchEvent(new CustomEvent(`omega-vert:${name}`, { detail, bubbles: true }));
    }
  }
}

class Verts {
  constructor(manager) {
    this.manager = manager;

    // The AdSense script loads ONCE — the cached promise keeps a rejection
    // (adblock) sticky for every later unit on the page
    this._adsenseScript = null;
  }

  /**
   * Resolve the in-house ad source to a base URL.
   * @param {string} [source] - override; defaults to advertising.providers.inhouse.source
   * @returns {string|null} base URL (no trailing slash), or null when unconfigured
   */
  resolveSource(source) {
    const configured = source
      || this.manager.config.advertising?.providers?.inhouse?.source;

    if (!configured) {
      return null;
    }

    if (/^https?:\/\//i.test(configured)) {
      return configured.replace(/\/+$/, '');
    }

    if (configured === 'self') {
      return this.manager.getApiUrl();
    }

    if (configured === 'company') {
      const companyUrl = this.manager.config.company?.url;
      if (!companyUrl) {
        console.warn('[Verts] inhouse source is "company" but config.company.url is not set');
        return null;
      }
      return this.manager.getApiUrl(null, companyUrl);
    }

    console.warn('[Verts] Unsupported inhouse source:', configured);
    return null;
  }

  /**
   * Read a host element's data-omega-vert* attributes into render options.
   * @param {Element} $el - element carrying the data-omega-vert vocabulary
   * @returns {object} { type, size, vertId, tags }
   */
  parseElementOptions($el) {
    const attr = (name) => (typeof $el.getAttribute === 'function' && $el.getAttribute(name)) || '';

    return {
      type: attr('data-omega-vert') || 'display',
      size: attr('data-omega-vert-size'),
      vertId: attr('data-omega-vert-id'),
      tags: attr('data-omega-vert-tags')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
  }

  /**
   * Arm one host element lazily: the ladder runs only near the viewport
   * (IntersectionObserver; no observer support → immediately). Options are
   * read from the element's data-omega-vert* attributes; passed options win.
   * Idempotent — a mounted element never mounts twice.
   * @param {Element} $el - host element
   * @param {object} [options] - overrides merged over the element attributes
   * @returns {Promise<object|null>|null} the render result when armed
   *   immediately (no observer), null otherwise (armed lazily or repeat call)
   */
  mount($el, options = {}) {
    if (!$el || $el.__omegaVertMounted) {
      return null;
    }
    $el.__omegaVertMounted = true;

    const merged = { ...this.parseElementOptions($el), ...options };

    if (typeof IntersectionObserver === 'undefined') {
      return this.render($el, merged);
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) {
        return;
      }
      observer.disconnect();
      this.render($el, merged);
    }, { rootMargin: '200px 0px' });

    observer.observe($el);
    return null;
  }

  /**
   * Auto-bind every [data-omega-vert] element under a root — the surface hook
   * desktop/extension call (phase 4); the web section mounts per element.
   * @param {Element|Document} [root] - scan scope (defaults to document)
   * @returns {Element[]} the elements newly mounted by this call
   */
  bind(root) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope || typeof scope.querySelectorAll !== 'function') {
      return [];
    }

    const mounted = [];
    scope.querySelectorAll('[data-omega-vert]').forEach(($el) => {
      if ($el.__omegaVertMounted) {
        return;
      }
      this.mount($el);
      mounted.push($el);
    });

    return mounted;
  }

  /**
   * Run the full ladder into a host element: provider (AdSense) when
   * configured and the type is a provider type, then the fallback lane, then
   * no-fill collapse.
   * @param {Element} $el - host element
   * @param {object} [options] - VertUnit options + { type }
   * @returns {Promise<{ lane: string, unit?: VertUnit }|null>}
   */
  async render($el, options = {}) {
    const advertising = this.manager.config.advertising || {};
    const adsense = advertising.providers?.['google-adsense'];
    const type = options.type || 'display';

    if (type === 'house') {
      return this.renderHouse($el, options);
    }

    const format = ADSENSE_FORMATS[type];
    if (!format) {
      console.warn('[Verts] Unsupported ad type:', type);
      return this._fallback($el, options);
    }

    if (!adsense?.client) {
      return this._fallback($el, options);
    }

    // Script-load failure IS the adblock detector — no bait divs, no library
    try {
      await this._loadAdSenseScript(adsense.client);
    } catch (e) {
      console.warn('[Verts] AdSense script blocked/failed — fallback lane:', e?.message || e);
      return this._fallback($el, options);
    }

    const $ins = this._buildIns(adsense, type, format, options);
    const maxHeight = resolveSizePx(options.size);
    if (maxHeight) {
      $el.style.setProperty('max-height', `${maxHeight}px`, 'important');
      $el.style.setProperty('overflow', 'hidden');
    }
    $el.appendChild($ins);

    (window.adsbygoogle = window.adsbygoogle || []).push({});

    const status = await this._awaitFill($ins, options.fillTimeout || DEFAULT_FILL_TIMEOUT);
    if (status === 'filled') {
      this._emitHost($el, options, 'fill', { lane: 'provider' });
      return { lane: 'provider' };
    }

    // unfilled / timeout → clear the provider markup, fall through
    if (typeof $ins.remove === 'function') {
      $ins.remove();
    }
    return this._fallback($el, options);
  }

  /**
   * Mount the fallback lane directly (house/company inventory) — the lane
   * desktop/extension bind to (no AdSense in those surfaces).
   * @param {Element} $el - host element
   * @param {object} [options] - VertUnit options ({ source } overrides config)
   * @returns {{ lane: string, unit: VertUnit }|null} null when no source resolves
   */
  renderHouse($el, options = {}) {
    const source = this.resolveSource(options.source);

    if (!source) {
      this._collapse($el, options);
      return null;
    }

    const tags = options.tags?.length
      ? options.tags
      : this.manager.config.advertising?.tags || [];

    const unit = new VertUnit(this.manager, $el, { ...options, source, tags }).load();
    return { lane: 'house', unit };
  }

  /**
   * Provider miss → the configured fallback role, or collapse.
   * @param {Element} $el
   * @param {object} options
   * @returns {Promise<object|null>}
   */
  _fallback($el, options) {
    const fallback = this.manager.config.advertising?.fallback;

    if (fallback === 'inhouse') {
      return this.renderHouse($el, options);
    }

    this._collapse($el, options);
    return null;
  }

  _collapse($el, options) {
    $el.style.setProperty('display', 'none');
    this._emitHost($el, options, 'no-fill', {});
  }

  _emitHost($el, options, name, detail) {
    const callback = options[`on${name.replace(/(^|-)(\w)/g, (m, sep, ch) => ch.toUpperCase())}`];
    if (typeof callback === 'function') {
      try {
        callback(detail);
      } catch (e) {
        console.error(`[Verts] on${name} callback error:`, e);
      }
    }

    if (typeof CustomEvent !== 'undefined' && typeof $el.dispatchEvent === 'function') {
      $el.dispatchEvent(new CustomEvent(`omega-vert:${name}`, { detail, bubbles: true }));
    }
  }

  _loadAdSenseScript(client) {
    if (!this._adsenseScript) {
      this._adsenseScript = this.manager.dom().loadScript({
        src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`,
        async: true,
        crossorigin: 'anonymous',
      });
    }

    return this._adsenseScript;
  }

  _buildIns(adsense, type, format, options) {
    const $ins = document.createElement('ins');
    $ins.className = 'adsbygoogle';
    $ins.style.cssText = format.style;
    $ins.setAttribute('data-ad-client', adsense.client);

    for (const [key, value] of Object.entries(format.attributes)) {
      $ins.setAttribute(key, value);
    }

    // In-feed layout keys — one JS-side table (kills the duplicated include keys)
    if (format.layoutKeys) {
      const layoutKey = format.layoutKeys[options.layout || 'image-above'] || format.layoutKeys['image-above'];
      $ins.setAttribute('data-ad-layout-key', layoutKey);
    }

    const slot = adsense.slots?.[format.slotKey];
    if (slot) {
      $ins.setAttribute('data-ad-slot', slot);
    }

    return $ins;
  }

  /**
   * Await AdSense fill: a MutationObserver on data-ad-status (+ timeout) —
   * not the legacy 100 ms poll.
   * @param {Element} $ins
   * @param {number} timeout
   * @returns {Promise<string>} 'filled' | 'unfilled' | 'timeout'
   */
  _awaitFill($ins, timeout) {
    return new Promise((resolve) => {
      let observer = null;
      let timer = null;

      const settle = (status) => {
        if (observer) {
          observer.disconnect();
        }
        if (timer) {
          clearTimeout(timer);
        }
        resolve(status);
      };

      const check = () => {
        const status = typeof $ins.getAttribute === 'function' ? $ins.getAttribute('data-ad-status') : null;
        if (status === 'filled' || status === 'unfilled') {
          settle(status);
          return true;
        }
        return false;
      };

      if (check()) {
        return;
      }

      if (typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(() => check());
        observer.observe($ins, { attributes: true, attributeFilter: ['data-ad-status'] });
      }

      timer = setTimeout(() => settle('timeout'), timeout);
    });
  }
}

export default Verts;
export {
  VertUnit,
  SIZE_PRESETS,
  ADSENSE_FORMATS,
  MESSAGE_DIMENSIONS,
  MESSAGE_CLICK,
  IFRAME_SANDBOX,
  resolveSizePx,
  clampHeight,
};
