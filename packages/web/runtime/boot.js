/**
 * Browser boot runtime — the module every generated bundle imports.
 *
 * All bundles (main + one per page) come out of ONE esbuild call with
 * splitting enabled, so this module — and the @omegajs/client singleton it pulls
 * in — lands in a shared chunk and evaluates exactly once per page, no matter
 * how many bundles the page loads. That is the load-bearing property: it is
 * what makes `import webManager from '@omegajs/client'` inside any page module
 * resolve to the SAME initialized instance the main bundle booted (UJM got
 * this from webpack's single module graph).
 *
 * Handshake (UJM src/index.js parity, minus runtime module dispatch):
 *   1. main bundle  → bootMain(globalModule):
 *      webManager.initialize(window.Configuration) → dev lib (development
 *      only) → globalModule({ manager, options }).
 *   2. page bundle  → bootPage(pageModule): awaits the main boot, then
 *      pageModule({ manager, options }). Both scripts are `type="module"`
 *      (deferred, document order), so bootMain always registers first.
 */
import webManager from '@omegajs/client';
import { Manager } from './manager.js';

let context = null;
let ready = null;

function getContext() {
  if (!context) {
    // Set by core/root.html on <html>: data-page-path="{{ page.url }}"
    const pagePath = (document.documentElement.dataset.pagePath || '/').replace(/^\/+/, '');
    context = {
      manager: new Manager(),
      options: {
        paths: {
          pagePath: `/${pagePath}`,
        },
      },
    };
  }
  return context;
}

async function initialize() {
  const { manager, options } = getContext();

  // Initialize the @omegajs/client singleton with the page-baked config
  await webManager.initialize(window.Configuration);

  // Development helpers — code-split, only ever fetched in development
  if (manager.isDevelopment()) {
    await import('__main_assets__/js/libs/dev.js')
      .then((mod) => mod.default({ manager, options }))
      .catch((e) => console.error('Failed to load dev.js:', e));
  }

  return context;
}

/**
 * Boot the main bundle: initialize @omegajs/client, then run the global module.
 * A global-module failure is logged but does NOT block page modules.
 * @param {Function} mod - the global module's default export
 * @returns {Promise<object>} the shared { manager, options } context
 */
export function bootMain(mod) {
  ready = (async () => {
    const { manager, options } = await initialize();

    try {
      if (typeof mod === 'function') await mod({ manager, options });
    } catch (e) {
      console.error('Global module error:', e);
    }

    return context;
  })();

  return ready;
}

/**
 * Boot a page bundle: wait for the main boot, then run the page module.
 * Pages built without a main bundle (minimal fixtures) still get an
 * initialized manager.
 * @param {Function} mod - the page module's default export
 * @returns {Promise<void>}
 */
export function bootPage(mod) {
  if (!ready) ready = initialize();

  return ready
    .then(() => {
      const { manager, options } = getContext();
      if (typeof mod === 'function') return mod({ manager, options });
    })
    .catch((e) => console.error('Page module error:', e));
}
