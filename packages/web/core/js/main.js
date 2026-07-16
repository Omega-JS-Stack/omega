// Static imports for core modules (bundled together for efficiency)
// import initializeModule from '__main_assets__/js/core/initialize.js';
import authModule from '__main_assets__/js/core/auth.js';
import lazyLoadingModule from '__main_assets__/js/core/lazy-loading.js';
import queryStringsModule from '__main_assets__/js/core/query-strings.js';
import serviceWorkerModule from '__main_assets__/js/core/service-worker.js';
import appearanceModule from '__main_assets__/js/core/appearance.js';
import appShellModule from '__main_assets__/js/core/app-shell.js';
import motionModule from '__main_assets__/js/core/motion.js';
import completeModule from '__main_assets__/js/core/complete.js';

import omega from '@omega.js/client';

// Ultimate Jekyll Manager Module
export default async function ({ manager, options } = {}) {
  // Add Manager to global scope for easy access in modules
  // Removed because @omega.js/client is singleton and can be imported directly in modules, so no need to attach it to window
  // window.Manager = manager;

  // Initialize the UJ library on omega for programmatic access to UJ features
  // This allows other modules to call omega.uj().showExitPopup(), etc.
  const ujLibrary = {};
  omega.uj = function() {
    return ujLibrary;
  };
  // Also expose the internal object for modules to register their functions
  omega._ujLibrary = ujLibrary;

  // Log
  console.log('Global module loaded successfully (assets/js/ultimate-jekyll-manager.js)');

  // Initialize fixed modules synchronously (already loaded via static imports)
  // initializeModule({ manager, options });
  authModule({ manager, options });
  lazyLoadingModule({ manager, options });
  queryStringsModule({ manager, options });
  serviceWorkerModule({ manager, options });
  appearanceModule({ manager, options });
  appShellModule({ manager, options });
  motionModule({ manager, options });

  // Dev palette (development only): the yellow DEV pull-tab — persona
  // switcher + quick links. Dynamic import so production pages never load
  // the chunk; the branch itself is a two-line no-op there.
  if (omega.isDevelopment()) {
    import('__main_assets__/js/core/dev-palette.js')
      .then(({ default: devPalette }) => devPalette())
      .catch((error) => console.error('Failed to load dev-palette.js:', error));
  }

  // Conditionally loaded modules based on config. Static import paths (no
  // template literals) — esbuild resolves and inlines each dynamic import;
  // webpack-style expression contexts don't exist here.
  const conditionalModules = [
    { path: 'cookieconsent.js', configKey: 'cookieConsent', load: () => import('__main_assets__/js/core/cookieconsent.js') },
    { path: 'exit-popup.js', configKey: 'exitPopup', load: () => import('__main_assets__/js/core/exit-popup.js') },
    { path: 'social-sharing.js', configKey: 'socialSharing', load: () => import('__main_assets__/js/core/social-sharing.js') }
  ];

  // Load conditional modules in parallel
  const modulePromises = [];

  // Add conditional modules if enabled
  for (const module of conditionalModules) {
    const moduleConfig = omega.config[module.configKey];
    if (moduleConfig?.enabled) {
      modulePromises.push(
        module.load()
          .then(({ default: moduleFunc }) => moduleFunc({ manager, options }))
          .catch(error => console.error(`Failed to load ${module.path}:`, error))
      );
    } else {
      console.log(`Skipping ${module.path} (disabled in config)`);
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
