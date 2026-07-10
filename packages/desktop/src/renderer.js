// Renderer-process Manager singleton.
// Consumer entry (per view): `new (require('@omegajs/desktop/renderer'))().initialize()`.
// Reads window.EM_BUILD_JSON.config (injected by webpack DefinePlugin), bootstraps web-manager + auth.
//
// Auth bridge:
//   - On init, asks main "I'm at UID X (or null), are we in sync?" via desktop:auth:sync-request.
//     If main returns a custom token, this renderer calls webManager.auth().signInWithCustomToken(token).
//     If main says "sign out," this renderer signs out.
//   - Listens for desktop:auth:sign-in-with-token broadcasts (fired when ANY renderer or main signs in)
//     and signs in with the provided token.
//   - Listens for desktop:auth:sign-out broadcasts and signs out.
//
// Pattern mirrors BXM: main is the source of truth, renderers reflect.

const LoggerLite = require('./lib/logger-lite.js');

function Manager() {
  const self = this;

  self.config = null;
  self.logger = new LoggerLite('renderer');
  self.webManager = null;

  // Bridges exposed by preload contextBridge (window.em.*)
  self.ipc     = (typeof window !== 'undefined' && window.em?.ipc)     || null;
  self.storage = (typeof window !== 'undefined' && window.em?.storage) || null;

  return self;
}

Manager.prototype.initialize = async function (overrides) {
  const self = this;

  // Merge runtime overrides on top of build-time config.
  // EM_BUILD_JSON is injected by webpack DefinePlugin; the BannerPlugin also makes it
  // available on globalThis.EM_BUILD_JSON for DevTools introspection.
  const buildJson = (typeof EM_BUILD_JSON !== 'undefined' && EM_BUILD_JSON) || {};
  self.config = Object.assign({}, buildJson.config || {}, overrides || {});

  self.logger.log('Initializing @omegajs/desktop (renderer)...');

  // Boot web-manager so Firebase Auth is available in this renderer.
  try {
    const wmMod = require('web-manager');
    self.webManager = wmMod.default || wmMod;
    if (self.webManager?.initialize) {
      await self.webManager.initialize(self.config);
    }
  } catch (e) {
    self.logger.warn('web-manager not available — auth bridge running in no-op mode.', e?.message);
  }

  // Wire the auth bridge: sync with main, listen for broadcasts.
  await self._wireAuthBridge();

  // Wire declarative theme controls ([data-em-theme-set]).
  self._wireThemeControls();

  // Auto-render FontAwesome icons (<i class="fa-solid fa-*">) and Bootstrap
  // tooltips ([data-bs-toggle="tooltip"]) — presence-driven, live via
  // MutationObserver, zero consumer setup.
  self._wireFontAwesome();
  self._wireTooltips();

  self.logger.log('@omegajs/desktop (renderer) initialized.');

  return self;
};

// Declarative theme switching — any element with `data-em-theme-set="system|light|dark"`
// becomes a theme control: clicking it calls main's theme setter (persisted, applied to
// every renderer live). The `<html data-bs-theme>` attribute itself is maintained by the
// preload's theme applier (src/preload.js) — consumers just drop plain buttons:
//
//   <button data-em-theme-set="light">Day</button>
//   <button data-em-theme-set="dark">Dusk</button>
//   <button data-em-theme-set="system">Auto</button>
//
// Delegated on document so controls rendered after initialize still work.
Manager.prototype._wireThemeControls = function () {
  const self = this;

  if (typeof document === 'undefined' || !window.em?.theme) {
    return;
  }

  document.addEventListener('click', (event) => {
    const control = event.target.closest('[data-em-theme-set]');
    if (!control) {
      return;
    }
    const source = control.getAttribute('data-em-theme-set');
    window.em.theme.set(source).catch((e) => {
      self.logger.warn(`theme set '${source}' failed:`, e?.message);
    });
  });
};

// FontAwesome auto-render — any `<i>` element carrying `fa-*` classes gets the
// bundled Font Awesome SVG injected inline (fetched from main over IPC, cached
// per icon). Style comes from `fa-solid` (default) / `fa-brands`; the icon name
// is the first `fa-*` class that isn't a known modifier. Works for markup
// present at init AND anything inserted later (MutationObserver). Unknown names
// resolve to null and the element is simply left empty — consumers that want a
// fallback check `window.em.fontawesome.get()` themselves.
//
//   <i class="fa-solid fa-rocket me-2"></i>   →   <i …><svg …>…</svg></i>
Manager.prototype._wireFontAwesome = function () {
  const self = this;

  if (typeof document === 'undefined' || !self.ipc) {
    return;
  }

  const cache = new Map(); // 'style/name' → Promise<svg|null>
  const resolve = (name, style) => {
    const key = `${style}/${name}`;
    if (!cache.has(key)) {
      cache.set(key, self.ipc.invoke('desktop:fontawesome:get', { name, style })
        .then((r) => r?.svg ?? null)
        .catch(() => null));
    }
    return cache.get(key);
  };

  // fa-* classes that are modifiers (style/size/animation/layout), not icon names.
  const MODIFIER = /^fa-(?:solid|brands|regular|light|thin|duotone|sharp|fw|xs|sm|lg|xl|2xl|[0-9]+x|spin|spin-pulse|spin-reverse|pulse|beat|fade|beat-fade|bounce|shake|flip(?:-horizontal|-vertical|-both)?|rotate-(?:90|180|270|by)|inverse|border|pull-left|pull-right|stack(?:-1x|-2x)?|li|ul|sr-only)$/;

  const render = (el) => {
    if (el.dataset.emFa || el.querySelector('svg')) {
      return;
    }

    let style = 'solid';
    let name = null;
    for (const cls of el.classList) {
      if (cls === 'fa-brands' || cls === 'fab') {
        style = 'brands';
      } else if (!name && cls.startsWith('fa-') && !MODIFIER.test(cls)) {
        name = cls.slice(3);
      }
    }
    if (!name) {
      return;
    }

    el.dataset.emFa = name;
    resolve(name, style).then((svg) => {
      if (svg && el.isConnected && !el.querySelector('svg')) {
        el.innerHTML = svg;
      }
    });
  };

  const scan = (root) => {
    if (root.matches?.('i[class*="fa-"]')) {
      render(root);
    }
    root.querySelectorAll?.('i[class*="fa-"]').forEach(render);
  };

  // Observe + initial scan. Deferred until the document exists — when this
  // runs from a preload (the @omegajs/desktop test harness does), documentElement isn't
  // built yet.
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
};

// Public alias — minimal surfaces that skip the full initialize() (no
// web-manager / auth bridge) can still enable the FontAwesome auto-render:
//   new (require('@omegajs/desktop/renderer'))().enableFontAwesome();
Manager.prototype.enableFontAwesome = Manager.prototype._wireFontAwesome;

// Bootstrap tooltips — auto-initialize every `[data-bs-toggle="tooltip"]`
// element (Bootstrap's JS + Popper ship inside @omegajs/desktop as a prebuilt bundle —
// assets/themes/bootstrap/js/bootstrap.bundle.js; consumers add ZERO setup).
// Live-managed via MutationObserver:
//   - elements inserted later get their tooltip on arrival
//   - `data-bs-title` / `title` changes update the live instance (emptying it
//     disposes — no tooltip is a valid state)
//   - removed elements have their instance disposed (no orphaned tips)
// The full Bootstrap namespace is exposed at `window.bootstrap` (and
// `manager.bootstrap`) for manual control — Tooltip, Collapse, Dropdown, etc.
// Only tooltips are auto-initialized (Bootstrap 5 makes them opt-in); the other
// components' standard data-api works out of the box on Bootstrap markup.
//
// Gotcha (Bootstrap's own): disabled elements don't fire hover events — wrap a
// disabled control in a <span data-bs-toggle="tooltip"> to tooltip it.
Manager.prototype._wireTooltips = function () {
  const self = this;

  if (typeof document === 'undefined') {
    return;
  }

  // Everything — including the require — is deferred until the document
  // exists: the Bootstrap bundle reads document.documentElement at import
  // time, which is null when this runs from a preload (the @omegajs/desktop test harness
  // does) before the DOM is built.
  const start = () => {
    let Tooltip;
    try {
      // Prebuilt UMD (Popper inlined) — loads via webpack AND plain require().
      const bootstrap = require('./assets/themes/bootstrap/js/bootstrap.bundle.js');
      Tooltip = bootstrap.Tooltip;
      window.bootstrap = Object.assign(window.bootstrap || {}, bootstrap);
    } catch (e) {
      self.logger.warn('bootstrap Tooltip unavailable — tooltips disabled.', e?.message);
      return;
    }

    self.bootstrap = window.bootstrap;

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
          // dispose → dispose RESTORES `title` → re-init → … — a pure
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
};

// Bridge between renderer's web-manager and main's web-manager-bridge.
// Mirrors BXM's foreground sync logic.
Manager.prototype._wireAuthBridge = async function () {
  const self = this;
  if (!self.ipc) return;

  const auth = self.webManager?.auth?.();
  const getCurrentUid = () => {
    try { return auth?.user?.()?.uid || null; }
    catch (e) { return null; }
  };

  // Listen for sign-in-with-token broadcasts (main signed in via deep link, or another renderer signed in).
  self.ipc.on('desktop:auth:sign-in-with-token', async ({ token }) => {
    if (!token || !auth?.signInWithCustomToken) return;
    try {
      await auth.signInWithCustomToken(token);
      self.logger.log('signed in via broadcast token.');
    } catch (e) {
      self.logger.error('signInWithCustomToken (broadcast) failed:', e?.message);
    }
  });

  // Listen for sign-out broadcasts.
  self.ipc.on('desktop:auth:sign-out', async () => {
    if (!auth?.signOut) return;
    try {
      await auth.signOut();
      self.logger.log('signed out via broadcast.');
    } catch (e) {
      self.logger.error('signOut (broadcast) failed:', e?.message);
    }
  });

  // Run web-manager's FULL auth cycle (UJM/BXM parity): listen() waits for auth to
  // settle, fetches the Firestore account, resolves the subscription, and auto-populates
  // the data-wm-bind bindings — so any @omegajs/desktop app can write UJM-style reactive HTML
  // (`@show auth.user`, `@text auth.account.plan.id`, ...). Persistent listener: fires
  // again on every subsequent sign-in/out (broadcast tokens included).
  //
  // Each settle pushes the resolution to main (desktop:auth:account-resolved) — main can't
  // run Firestore, so this is how main-side plan gates learn the REAL plan (BXM's
  // "browser contexts resolve, the authority caches" split). Main uid-guards the push.
  if (auth?.listen) {
    let lastState = null;

    const pushResolved = async (state) => {
      const uid = state?.user?.uid || null;
      if (!uid) return;
      try {
        await self.ipc.invoke('desktop:auth:account-resolved', {
          uid,
          resolved: state?.resolved || null,
          roles:    state?.account?.roles || null,
        });
      } catch (e) {
        self.logger.warn('account-resolved push failed (non-fatal):', e?.message);
      }
    };

    try {
      auth.listen({}, (state) => {
        lastState = state;
        pushResolved(state);
      });
    } catch (e) {
      self.logger.warn('auth listen failed (non-fatal):', e?.message);
    }

    // Re-push when MAIN's auth state changes: a renderer that resolved BEFORE main
    // signed in had its push uid-rejected (correctly — main was signed out). When
    // main comes up on the same user, offer the resolution again.
    self.ipc.on('desktop:auth:state-changed', (snap) => {
      if (snap?.uid && lastState?.user?.uid === snap.uid) {
        pushResolved(lastState);
      }
    });
  }

  // Sync with main on load. If main has a different state, it'll send back instructions.
  try {
    const result = await self.ipc.invoke('desktop:auth:sync-request', {
      contextUid: getCurrentUid(),
    });

    if (!result?.needsSync) return;

    if (result.signOut && auth?.signOut) {
      await auth.signOut();
      self.logger.log('synced: signed out (main was signed out).');
    } else if (result.customToken && auth?.signInWithCustomToken) {
      await auth.signInWithCustomToken(result.customToken);
      self.logger.log(`synced: signed in as ${result.user?.email || result.user?.uid}.`);
    }
  } catch (e) {
    self.logger.warn('auth sync failed (non-fatal):', e?.message);
  }
};

// Sign-out helper for renderer code (UI button etc.). Goes through main so all
// renderers + main stay in sync via the broadcast.
Manager.prototype.signOut = async function () {
  if (!this.ipc) return { success: false, error: 'no-ipc' };
  return this.ipc.invoke('desktop:auth:sign-out');
};

// Read main's current user (sync answer from main, not the renderer's local Firebase).
Manager.prototype.getMainUser = async function () {
  if (!this.ipc) return null;
  return this.ipc.invoke('desktop:auth:get-user');
};

// Mix in shared cross-context helpers — same code path used in main, preload, build.
require('./utils/mode-helpers.js').attachTo(Manager);
require('./utils/url-helpers.js').attachTo(Manager);

module.exports = Manager;
