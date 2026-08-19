/**
 * Browser boot runtime — the module every generated bundle imports.
 *
 * All bundles (main + one per page) come out of ONE esbuild call with
 * splitting enabled, so this module — and the @omega.js/client singleton it pulls
 * in — lands in a shared chunk and evaluates exactly once per page, no matter
 * how many bundles the page loads. That is the load-bearing property: it is
 * what makes `import omega from '@omega.js/client'` inside any page module
 * resolve to the SAME initialized instance the main bundle booted (UJM got
 * this from webpack's single module graph).
 *
 * Handshake (UJM src/index.js parity, minus runtime module dispatch):
 *   1. main bundle  → bootMain(globalModule):
 *      omega.initialize(window.Configuration) → dev lib (development
 *      only) → globalModule({ manager, options }).
 *   2. page bundle  → bootPage(pageModule): awaits the main boot, then
 *      pageModule({ manager, options }). Both scripts are `type="module"`
 *      (deferred, document order), so bootMain always registers first.
 */
import omega from '@omega.js/client';
import { createIconRenderer } from '@omega.js/client/modules/icon-renderer.js';
import { Manager } from './manager.js';
// Relative, not the __main_assets__ alias: this runtime is bundled by every
// esbuild pass, and a package-root-relative path resolves the same in the
// monorepo and in a published install (both ship runtime/ and core/).
import { siteUrl } from '../core/js/libs/path-prefix.js';

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

  // Initialize the @omega.js/client singleton with the page-baked config
  await omega.initialize(window.Configuration);

  // Font Awesome auto-render (C4 cp112) — the same shared watcher desktop
  // runs; web's transport is the site's OWN emitted icon set (assets/fa/,
  // the brand's Pro chain + free floor). Static fa-* markup and classes
  // set or changed via JS both render; only used icons ever transfer.
  createIconRenderer({
    resolve: (name, style) => fetch(siteUrl(`/assets/fa/${style}/${name}.svg`))
      .then((response) => (response.ok ? response.text() : null)),
  }).start(document);

  // Development helpers — code-split, only ever fetched in development
  if (manager.isDevelopment()) {
    await import('__main_assets__/js/libs/dev.js')
      .then((mod) => mod.default({ manager, options }))
      .catch((e) => console.error('Failed to load dev.js:', e));
  }

  return context;
}

/**
 * Boot the main bundle: initialize @omega.js/client, then run the global module.
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

/**
 * Boot the section-JS registry (spec §7): after the main boot, init every
 * section/component whose markup is PRESENT on the page — one init call per
 * [data-omega-section="<id>"] / [data-omega-component="<id>"] element, with
 * the element and the shared context. Absent sections cost nothing; one
 * section's failure never blocks another's.
 * @param {{section: object, component: object}} registry - id → init fn maps
 *   (generated into the main boot stub by the asset pipeline)
 * @returns {Promise<void>}
 */
export function bootSections(registry) {
  if (!ready) ready = initialize();

  return ready
    .then(async () => {
      const { manager, options } = getContext();
      for (const [kind, inits] of Object.entries(registry)) {
        for (const [id, init] of Object.entries(inits)) {
          for (const el of document.querySelectorAll(`[data-omega-${kind}="${id}"]`)) {
            try {
              await init(el, { manager, options });
            } catch (e) {
              console.error(`Section init error (${kind} "${id}"):`, e);
            }
          }
        }
      }
    })
    .catch((e) => console.error('Section boot error:', e));
}
