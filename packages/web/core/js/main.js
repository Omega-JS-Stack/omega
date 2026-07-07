// Static imports for core modules (bundled together for efficiency)
// import initializeModule from '__main_assets__/js/core/initialize.js';
import authModule from '__main_assets__/js/core/auth.js';
import lazyLoadingModule from '__main_assets__/js/core/lazy-loading.js';
import queryStringsModule from '__main_assets__/js/core/query-strings.js';
import serviceWorkerModule from '__main_assets__/js/core/service-worker.js';
import appearanceModule from '__main_assets__/js/core/appearance.js';
import completeModule from '__main_assets__/js/core/complete.js';

import webManager from 'web-manager';

// Ultimate Jekyll Manager Module
export default async function ({ manager, options } = {}) {
  // Add Manager to global scope for easy access in modules
  // Removed because web-manager is singleton and can be imported directly in modules, so no need to attach it to window
  // window.Manager = manager;

  // Initialize the UJ library on webManager for programmatic access to UJ features
  // This allows other modules to call webManager.uj().showExitPopup(), etc.
  const ujLibrary = {};
  webManager.uj = function() {
    return ujLibrary;
  };
  // Also expose the internal object for modules to register their functions
  webManager._ujLibrary = ujLibrary;

  // Log
  console.log('Global module loaded successfully (assets/js/ultimate-jekyll-manager.js)');

  // Initialize fixed modules synchronously (already loaded via static imports)
  // initializeModule({ manager, options });
  authModule({ manager, options });
  lazyLoadingModule({ manager, options });
  queryStringsModule({ manager, options });
  serviceWorkerModule({ manager, options });
  appearanceModule({ manager, options });

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
    const moduleConfig = webManager.config[module.configKey];
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
