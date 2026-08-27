// Static imports for core modules (bundled together for efficiency)
// import initializeModule from '__main_assets__/js/core/initialize.js';
import analyticsLoaderModule from '__main_assets__/js/core/analytics-loader.js';
import authModule from '__main_assets__/js/core/auth.js';
import lazyLoadingModule from '__main_assets__/js/core/lazy-loading.js';
import queryStringsModule from '__main_assets__/js/core/query-strings.js';
import serviceWorkerModule from '__main_assets__/js/core/service-worker.js';
import appearanceModule from '__main_assets__/js/core/appearance.js';
import appShellModule from '__main_assets__/js/core/app-shell.js';
import motionModule from '__main_assets__/js/core/motion.js';
import languageSwitcherModule from '__main_assets__/js/core/language-switcher.js';
import completeModule from '__main_assets__/js/core/complete.js';
import { setupPasswordToggle } from '__main_assets__/js/libs/auth/password-toggle.js';
import { configureAnalytics } from '__main_assets__/js/libs/analytics.js';

import omega from '@omega.js/client';

// Global web module
export default async function ({ manager, options } = {}) {
  // Add Manager to global scope for easy access in modules
  // Removed because @omega.js/client is singleton and can be imported directly in modules, so no need to attach it to window
  // window.Manager = manager;

  // Initialize the web library on omega for programmatic access to its features
  // This allows other modules to call omega.library().showExitPopup(), etc.
  const omegaLibrary = {};
  omega.library = function() {
    return omegaLibrary;
  };
  // Also expose the internal object for modules to register their functions
  omega._library = omegaLibrary;

  // Log
  console.log('Global module loaded successfully (assets/js/main.js)');

  // Initialize fixed modules synchronously (already loaded via static imports)
  // initializeModule({ manager, options });
  // FIRST (#383): the consent gate queues Google Consent Mode's default before
  // any provider script can load, and nothing else may count an event ahead of
  // that decision.
  analyticsLoaderModule({ manager, options });
  // …and the page's own analytics seams go in beside it (#386), so an event
  // fired by shared client code — a vert click, a notification prompt — is
  // gated on this visitor's consent and carries their attribution, on a page
  // whose own call sites never loaded.
  configureAnalytics();
  authModule({ manager, options });
  lazyLoadingModule({ manager, options });
  queryStringsModule({ manager, options });
  serviceWorkerModule({ manager, options });
  appearanceModule({ manager, options });
  appShellModule({ manager, options });
  motionModule({ manager, options });
  languageSwitcherModule({ manager, options });

  // Web's own click triggers on the shared registry (#16) — registered here so
  // every page has them (the auth pages and the styleguide both carry the eye)
  setupPasswordToggle();

  // Dev palette (development only): the yellow DEV pull-tab — persona
  // switcher + quick links. Dynamic import so production pages never load
  // the chunk; the branch itself is a two-line no-op there.
  if (omega.isDevelopment()) {
    // …but never INSIDE a frame (#555, Ian's ruling 2026-08-25): the showcase
    // gallery stacks one embedded document per demo variant, and a pull-tab in
    // every frame is the same noise the cookie banner and the chat widget
    // already stopped making there. Those two ride the frame page's own
    // frontmatter (the client mounts chatsy before this module runs, so a
    // runtime flag could never reach it); the palette is imported HERE, so the
    // iframe mark core/_includes/core/body.html stamps before first paint is
    // all this needs.
    if (document.documentElement.getAttribute('data-iframed') !== 'true') {
      import('__main_assets__/js/core/dev-palette.js')
        .then(({ default: devPalette }) => devPalette())
        .catch((error) => console.error('Failed to load dev-palette.js:', error));
    }

    // Missing-icon loudness (Ian 2026-07-16): every fallback triangle the
    // build stamped becomes a console.error in dev
    import('__main_assets__/js/core/dev-icon-audit.js')
      .then(({ default: devIconAudit }) => devIconAudit())
      .catch((error) => console.error('Failed to load dev-icon-audit.js:', error));
  }

  // Conditionally loaded modules based on config. Static import paths (no
  // template literals) — esbuild resolves and inlines each dynamic import;
  // webpack-style expression contexts don't exist here.
  const conditionalModules = [
    // The consent gate is the one DEFAULT-ON module (`client.consent.enabled`,
    // schema default true): a config that never mentions it still ships the
    // banner, and only an explicit `false` drops it. Read strict-truthy, any
    // config assembled outside loadConfig()'s materialization shipped a site
    // with no consent gate while the schema promised one
    // ([#551](https://github.com/Omega-JS-Stack/omega/issues/551)).
    { path: 'consent.js', configKey: 'consent', defaultOn: true, load: () => import('__main_assets__/js/core/consent.js') },
    { path: 'exit-popup.js', configKey: 'exitPopup', load: () => import('__main_assets__/js/core/exit-popup.js') },
    { path: 'social-sharing.js', configKey: 'socialSharing', load: () => import('__main_assets__/js/core/social-sharing.js') }
  ];

  // Load conditional modules in parallel
  const modulePromises = [];

  // Add conditional modules if enabled
  for (const module of conditionalModules) {
    const moduleConfig = omega.config[module.configKey];
    const enabled = module.defaultOn ? moduleConfig?.enabled !== false : !!moduleConfig?.enabled;

    if (enabled) {
      modulePromises.push(
        module.load()
          .then(({ default: moduleFunc }) => moduleFunc({ manager, options }))
          .catch(error => console.error(`Failed to load ${module.path}:`, error))
      );
    } else {
      // Truthful either way (#23): an absent section and a section that says
      // `enabled: false` are different answers, so they get different words.
      const why = moduleConfig ? `${module.configKey} is disabled` : `${module.configKey} is not configured`;
      console.log(`Skipping ${module.path} (${why})`);
    }
  }

  // Add theme loading (keep as dynamic import since themes can vary)
  modulePromises.push(
    import('__theme__/_theme.js')
      .catch(error => console.error('Failed to load theme:', error))
  );

  // Wait for all conditional modules to load
  await Promise.all(modulePromises);

  // Run the complete module to finalize page load state
  completeModule({ manager, options });
}
