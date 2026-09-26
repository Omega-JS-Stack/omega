// The renderer runtime: ONE ready-made `omega` instance per view, built on @omega.js/client.
// Consumer entry (per view): `import omega from '@omega.js/desktop/renderer'; omega.initialize()`.
// Reads window.OMEGA_BUILD_JSON.config (the one dist/build.js the view's shell loads, #743),
// boots the client it extends, then wires the desktop surfaces.
//
// Auth bridge:
//   - On init, asks main "I'm at UID X (or null), are we in sync?" via desktop:auth:sync-request.
//     If main returns a custom token, this renderer signs in with it (auth.signInWithCustomToken).
//     If main says "sign out," this renderer signs out.
//   - Listens for desktop:auth:sign-in-with-token broadcasts (fired when ANY renderer or main signs in)
//     and signs in with the provided token.
//   - Listens for desktop:auth:sign-out broadcasts and signs out.
//   - Pushes every signed-in state's account to main (desktop:auth:account-resolved), which builds
//     main's `auth.user` from it.
//
// Main is the source of truth, renderers reflect.

const { Omega: ClientOmega } = require('@omega.js/client');
const { WAKEUP_ROUTE } = require('@omega.js/client/modules/request.js');
const { createShell } = require('./assets/js/core/app-shell.js');
const LoggerLite = require('./lib/logger-lite.js');
const { getVersion } = require('./utils/mode-helpers.js');
const { getWebsiteUrl, getAuthUrl } = require('./utils/url-helpers.js');

/**
 * The renderer runtime: @omega.js/client's base class (`auth`, `storage`,
 * `analytics`, `bindings`, ...) plus `desktop`, the preload's bridge to the main
 * process. This module exports ONE instance of it; a consumer never writes
 * `new`, and awaits `initialize()` or `ready`.
 */
class Omega extends ClientOmega {
  constructor() {
    // The preload exposes the bridge before any page script runs, so its absence
    // is a window built without @omega.js/desktop/preload: a programmer error
    if (typeof window === 'undefined' || !window.desktop) {
      throw new Error('@omega.js/desktop/renderer: window.desktop is missing, so this window did not load the @omega.js/desktop preload (src/preload.js).');
    }

    super();

    // Everything that crosses to the main process, under main's names: ipc,
    // storage (the APP store; `omega.storage` stays the client's page store),
    // theme, fontawesome, autoUpdater, analytics, context, usage, remoteConfig
    this.desktop = window.desktop;
    this.logger = new LoggerLite('renderer');
  }

  /**
   * Boot the client from the view's build snapshot plus `overrides`, then wire
   * the desktop surfaces: the auth bridge, theme controls, the app shell,
   * icons, tooltips and verts.
   * @param {object} [overrides] - runtime config merged over the build snapshot.
   * @returns {Promise<Omega>} the instance.
   */
  async initialize(overrides) {
    // Merge runtime overrides on top of build-time config.
    // OMEGA_BUILD_JSON comes off the window: the view's shell loads the ONE
    // `dist/build.js` ahead of this bundle (#743), which is also what makes it
    // readable from DevTools.
    const config = Object.assign({}, window.OMEGA_BUILD_JSON?.config || {}, overrides || {});

    // The RUNNING environment beats the baked one, exactly as it does in main
    // ([#925](https://github.com/Omega-JS-Stack/omega/issues/925)). A page has no
    // `process`, so `isTesting()` here reads `config.environment`, the word the
    // BUILD was for; the preload does have it and hands it over on the bridge, so a
    // test lane booting a production artifact gets the same answer in this renderer
    // that main gives. No second signal: it is the one input, one context removed.
    if (this.desktop.environment) {
      config.environment = this.desktop.environment;
    }

    this.logger.log('Initializing @omega.js/desktop (renderer)...');

    // `analyticsBridge` is the preload's analytics surface, handed over as config:
    // a renderer NEVER sends analytics itself. The client forwards every event
    // through this bridge to main, whose sender owns the one device id
    // (electron-store, MAC-seeded), the one session id minted per launch, and the
    // real engagement time ([#411](https://github.com/Omega-JS-Stack/omega/issues/411)).
    // The client reads this key alone, so nothing but THIS line can bridge it.
    //
    // 🚫 The GA Measurement Protocol secret must NEVER be injected into this
    // config. A second sender in a renderer would split one install into two GA
    // clients (the #396 class), which is why desktop's config carries the
    // measurement id alone, and why the client drops any secret handed to a
    // bridged renderer.
    await super.initialize(Object.assign({}, config, {
      analyticsBridge: this.desktop.analytics,
    }));

    // Wire the auth bridge: sync with main, listen for broadcasts.
    await this._wireAuthBridge();

    // Wire declarative theme controls ([data-omega-theme-set]).
    this._wireThemeControls();

    // The vendored app shell (@omega.js/web's core/js/core/app-shell.js), built
    // from this instance exactly as web builds it
    this.shell = createShell(this);

    // Auto-render FontAwesome icons (<i class="fa-solid fa-*">) and Bootstrap
    // tooltips ([data-bs-toggle="tooltip"]): presence-driven, live via
    // MutationObserver, zero consumer setup.
    this.enableFontAwesome();
    this._wireTooltips();

    // Auto-bind [data-omega-vert] elements to the client verts module
    // (house/company lane only, no AdSense in desktop surfaces).
    this._wireAds();

    this.logger.log('@omega.js/desktop (renderer) initialized.');

    return this;
  }

  // Declarative theme switching: any element with `data-omega-theme-set="system|light|dark"`
  // becomes a theme control: clicking it calls main's theme setter (persisted, applied to
  // every renderer live). The `<html data-bs-theme>` attribute itself is maintained by the
  // preload's theme applier (src/preload.js); consumers just drop plain buttons:
  //
  //   <button data-omega-theme-set="light">Day</button>
  //   <button data-omega-theme-set="dark">Dusk</button>
  //   <button data-omega-theme-set="system">Auto</button>
  //
  // Delegated on document so controls rendered after initialize still work.
  _wireThemeControls() {
    if (typeof document === 'undefined') {
      return;
    }

    document.addEventListener('click', (event) => {
      const control = event.target.closest('[data-omega-theme-set]');
      if (!control) {
        return;
      }
      const source = control.getAttribute('data-omega-theme-set');
      this.desktop.theme.set(source).catch((e) => {
        this.logger.warn(`theme set '${source}' failed:`, e?.message);
      });
    });
  }

  // FontAwesome auto-render: any `<i>` element carrying `fa-*` classes gets the
  // Font Awesome SVG injected inline, whether present at init, inserted later,
  // or re-classed via JS at any time (`el.className = 'fa-solid fa-stop'`
  // re-renders in place). The whole DOM mechanism (class parsing on FA's
  // family × weight model, MutationObserver, caching, re-render/clear) is
  // @omega.js/client's icon renderer, started through the instance's `icons`
  // module, the SAME one web pages run; desktop only supplies the transport
  // (IPC to main's icon server). Unknown names leave the element empty (marked
  // data-omega-fa); consumers that want a fallback check `omega.desktop.fontawesome.get()`.
  //
  //   <i class="fa-solid fa-rocket me-2"></i>   →   <i …><svg …>…</svg></i>
  //
  // Public because a minimal surface that skips initialize() can still enable
  // it: `omega.enableFontAwesome()` on the imported instance.
  enableFontAwesome() {
    if (typeof document === 'undefined') {
      return;
    }

    this.icons.start({
      resolve: (name, style) => this.desktop.fontawesome.get(name, style),
    }, document);
  }

  // Bootstrap tooltips: auto-initialize every `[data-bs-toggle="tooltip"]`
  // element (Bootstrap's JS + Popper ship inside @omega.js/desktop as a prebuilt bundle,
  // assets/js/bootstrap.bundle.js; consumers add ZERO setup).
  // Live-managed via MutationObserver:
  //   - elements inserted later get their tooltip on arrival
  //   - `data-bs-title` / `title` changes update the live instance (emptying it
  //     disposes: no tooltip is a valid state)
  //   - removed elements have their instance disposed (no orphaned tips)
  // The full Bootstrap namespace is exposed at `window.bootstrap` (and
  // `omega.bootstrap`) for manual control: Tooltip, Collapse, Dropdown, etc.
  // Only tooltips are auto-initialized (Bootstrap 5 makes them opt-in); the other
  // components' standard data-api works out of the box on Bootstrap markup.
  //
  // Gotcha (Bootstrap's own): disabled elements don't fire hover events, so wrap a
  // disabled control in a <span data-bs-toggle="tooltip"> to tooltip it.
  _wireTooltips() {
    if (typeof document === 'undefined') {
      return;
    }

    // Everything, including the require, is deferred until the document
    // exists: the Bootstrap bundle reads document.documentElement at import
    // time, which is null when this runs from a preload (the @omega.js/desktop test harness
    // does) before the DOM is built.
    const start = () => {
      let Tooltip;
      try {
        // Prebuilt UMD (Popper inlined): loads through the bundle task AND plain require().
        const bootstrap = require('./assets/js/bootstrap.bundle.js');
        Tooltip = bootstrap.Tooltip;
        window.bootstrap = Object.assign(window.bootstrap || {}, bootstrap);
      } catch (e) {
        this.logger.warn('bootstrap Tooltip unavailable: tooltips disabled.', e?.message);
        return;
      }

      this.bootstrap = window.bootstrap;

      const SELECTOR = '[data-bs-toggle="tooltip"]';

      const init = (el) => {
        Tooltip.getOrCreateInstance(el);
      };

      const scan = (root) => {
        if (root.matches?.(SELECTOR)) {
          init(root);
        }
        root.querySelectorAll?.(SELECTOR).forEach(init);
      };

      const dispose = (root) => {
        if (root.nodeType !== 1) {
          return;
        }
        const candidates = [root, ...(root.querySelectorAll?.(SELECTOR) || [])];
        for (const el of candidates) {
          Tooltip.getInstance(el)?.dispose();
        }
      };

      new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType === 1) {
                scan(node);
              }
            });
            mutation.removedNodes.forEach(dispose);
            continue;
          }

          // Attribute change on a (potential) tooltip host.
          const el = mutation.target;
          const instance = Tooltip.getInstance(el);
          if (!el.matches(SELECTOR)) {
            instance?.dispose();
            continue;
          }
          if (!instance) {
            init(el);
            continue;
          }
          if (mutation.attributeName !== 'data-bs-toggle') {
            // data-bs-original-title is Bootstrap's OWN bookkeeping: the
            // Tooltip constructor MOVES a plain `title` attribute there.
            // Without reading it, a title-only host infinite-loops the
            // renderer: init removes `title` → this handler sees no title →
            // dispose → dispose RESTORES `title` → re-init → …, a pure
            // MutationObserver microtask storm that starves the main thread
            // (found by Somiibo's session-limits boot suite: the settings
            // page froze solid on one badge).
            const title = el.getAttribute('data-bs-title') || el.getAttribute('title') || el.getAttribute('data-bs-original-title');
            if (title) {
              instance.setContent({ '.tooltip-inner': title });
            } else {
              instance.dispose();
            }
          }
        }
      }).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-bs-toggle', 'data-bs-title', 'title'],
      });

      scan(document.documentElement);
    };

    if (document.documentElement && document.readyState !== 'loading') {
      start();
    } else {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    }
  }

  // Vert auto-bind (ads-system phase 4): every `[data-omega-vert]` element,
  // present at init or inserted later (MutationObserver, same liveness as the
  // FontAwesome/tooltip wiring), is handed to the client's verts module,
  // which owns the WHOLE lifecycle: lazy arming near the viewport, sandboxed
  // iframe to the resolved in-house source's /omega/verts/serve, origin-validated
  // postMessage, host-owned rotation + staleness recovery, no-fill collapse.
  // The type is PINNED to 'house': desktop surfaces never run the AdSense
  // provider lane (policy: no web context), so even a shared omega.json5 that
  // carries `advertising.providers.adsense` can only ever take the
  // house/company inventory here. mount() merges passed options OVER the
  // element attributes, so the pin is absolute; bound hosts are marked
  // `data-omega-vert-bound="house"` for observability.
  //
  //   <div data-omega-vert data-omega-vert-size="banner"></div>
  _wireAds() {
    if (this._adsWired || typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return;
    }
    this._adsWired = true;

    const SELECTOR = '[data-omega-vert]';

    const mount = (el) => {
      this.verts.mount(el, { type: 'house' });
      el.setAttribute('data-omega-vert-bound', 'house');
    };

    const scan = (root) => {
      if (root.matches?.(SELECTOR)) {
        mount(root);
      }
      root.querySelectorAll?.(SELECTOR).forEach(mount);
    };

    const start = () => {
      new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              scan(node);
            }
          });
        }
      }).observe(document.documentElement, { childList: true, subtree: true });

      scan(document.documentElement);
    };

    if (document.documentElement && document.readyState !== 'loading') {
      start();
    } else {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    }
  }

  // Bridge between this renderer's auth and main's lib/auth.js.
  async _wireAuthBridge() {
    const { ipc } = this.desktop;

    // The auth click triggers the extension's pages carry, routed to main:
    // `omega-signin` opens the sign-in flow, `omega-account` the brand's
    // /account page, both in the user's browser. `omega-signout` is the
    // client's, and it runs this instance's signOut(): main signs out, and this
    // window's own sign-out arrives on the broadcast below.
    this.triggers.register('signin', () => ipc.invoke('desktop:auth:open-flow'));
    this.triggers.register('account', () => ipc.invoke('desktop:auth:open-account'));

    // Warm the backend before any of the waits below. This bridge ends in a
    // sync-request, and main answers it by POSTing `/omega/user/token`, the
    // app's first backend call, on a function that is cold every time the app
    // launches. Fire-and-forget and unauthenticated: the backend answers a wakeup
    // before it loads a route or authenticates
    // ([#644](https://github.com/Omega-JS-Stack/omega/issues/644)). A context
    // with no resolvable API base (a dev build with no stack) skips it.
    try {
      this.request(WAKEUP_ROUTE, { wakeup: true });
    } catch (e) {
      this.logger.warn('wakeup ping failed (non-fatal):', e?.message);
    }

    // Listen for sign-in-with-token broadcasts (main signed in via deep link, or another renderer signed in).
    ipc.on('desktop:auth:sign-in-with-token', async ({ token }) => {
      if (!token) return;
      try {
        await this.auth.signInWithCustomToken(token);
        this.logger.log('signed in via broadcast token.');
      } catch (e) {
        this.logger.error('signInWithCustomToken (broadcast) failed:', e?.message);
      }
    });

    // Listen for sign-out broadcasts.
    ipc.on('desktop:auth:sign-out', async () => {
      try {
        await this.auth.signOut();
        this.logger.log('signed out via broadcast.');
      } catch (e) {
        this.logger.error('signOut (broadcast) failed:', e?.message);
      }
    });

    // The client's FULL auth cycle already runs: each state
    // change fetches the Firestore account and lands one `User`, which the
    // data-omega-bind bindings read. Every signed-in state's account is pushed
    // to main (desktop:auth:account-resolved): main can't run Firestore, so this
    // is how its `auth.user` learns the REAL account (browser contexts
    // resolve, the authority caches). Main uid-guards the push.
    let lastUser = null;

    const push = async (user) => {
      if (!user.authenticated) return;
      try {
        await ipc.invoke('desktop:auth:account-resolved', {
          uid: user.uid,
          document: user.toJSON(),
          identity: identityOf(user),
        });
      } catch (e) {
        this.logger.warn('account-resolved push failed (non-fatal):', e?.message);
      }
    };

    this.auth.listen((state) => {
      lastUser = state.user;
      push(state.user);
    });

    // Re-push when MAIN's auth state changes: a renderer that resolved BEFORE main
    // signed in had its push uid-rejected (correctly: main was signed out). When
    // main comes up on the same user, offer the account again.
    ipc.on('desktop:auth:state-changed', (identity) => {
      if (identity && lastUser && lastUser.uid === identity.uid) {
        push(lastUser);
      }
    });

    // Sync with main on load. If main has a different state, it'll send back instructions.
    try {
      const current = this.firebaseAuth ? this.firebaseAuth.currentUser : null;
      const result = await ipc.invoke('desktop:auth:sync-request', {
        contextUid: current ? current.uid : null,
      });

      if (!result?.needsSync) return;

      if (result.signOut) {
        await this.auth.signOut();
        this.logger.log('synced: signed out (main was signed out).');
      } else if (result.customToken) {
        await this.auth.signInWithCustomToken(result.customToken);
        this.logger.log(`synced: signed in as ${result.user?.email || result.user?.uid}.`);
      }
    } catch (e) {
      this.logger.warn('auth sync failed (non-fatal):', e?.message);
    }
  }

  /**
   * Sign out through main, so main and every renderer sign out together (the
   * desktop:auth:sign-out broadcast). The `.omega-signout` trigger runs this;
   * `omega.auth.signOut()` signs out this renderer alone.
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  signOut() {
    return this.desktop.ipc.invoke('desktop:auth:sign-out');
  }

  /**
   * Main's account: `{ uid, document, identity }`, main's authoritative answer
   * rather than this renderer's own Firebase session.
   * @returns {Promise<{ uid: string|null, document: object, identity: object|null }>}
   */
  getMainUser() {
    return this.desktop.ipc.invoke('desktop:auth:get-user');
  }

  // Desktop's own helpers beside the client's environment four and
  // getFunctionsUrl/getApiUrl: the same plain functions main and preload call
  getVersion() {
    return getVersion();
  }

  getWebsiteUrl(environment) {
    return getWebsiteUrl(this, environment);
  }

  getAuthUrl(environment, returnUrl) {
    return getAuthUrl(this, environment, returnUrl);
  }
}

/**
 * The identity a `User` was built from, the shape main builds its own from.
 * @param {object} user - a signed-in `User`.
 * @returns {{ uid: string, email: string|null, displayName: string|null, photoURL: string|null, emailVerified: boolean }}
 */
function identityOf(user) {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.profile.displayName,
    photoURL: user.profile.photoURL,
    emailVerified: user.profile.emailVerified,
  };
}

// The ONE instance, initialized by the view's entry
const omega = new Omega();

module.exports = omega;
module.exports.Omega = Omega;
