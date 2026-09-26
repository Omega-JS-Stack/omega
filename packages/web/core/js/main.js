// Static imports for core modules (bundled together for efficiency)
import analyticsLoaderModule from '__main_assets__/js/core/analytics-loader.js';
import authModule from '__main_assets__/js/core/auth.js';
import lazyLoadingModule from '__main_assets__/js/core/lazy-loading.js';
import queryStringsModule from '__main_assets__/js/core/query-strings.js';
import serviceWorkerModule from '__main_assets__/js/core/service-worker.js';
import languageSwitcherModule from '__main_assets__/js/core/language-switcher.js';
import completeModule from '__main_assets__/js/core/complete.js';
import { setupPasswordToggle } from '__main_assets__/js/libs/auth/password-toggle.js';
import { setupAlertDismiss } from '__main_assets__/js/libs/alert-dismiss.js';
import { setupCopy } from '__main_assets__/js/libs/omega-copy.js';
import { configureAnalytics } from '__main_assets__/js/libs/analytics.js';

/**
 * A `when` for a config-gated module: loads when `omega.config[configKey]` is
 * enabled, and logs the truthful reason when it is not.
 * @param {string} configKey - the client config section that switches the module
 * @param {object} [gate]
 * @param {boolean} [gate.defaultOn] - an unmentioned section counts as enabled
 * @returns {function({ omega: object }, string): boolean}
 */
function configured(configKey, { defaultOn = false } = {}) {
  return ({ omega }, name) => {
    const moduleConfig = omega.config[configKey];
    const enabled = defaultOn ? moduleConfig?.enabled !== false : !!moduleConfig?.enabled;

    if (!enabled) {
      // Truthful either way (#23): an absent section and a section that says
      // `enabled: false` are different answers, so they get different words.
      const why = moduleConfig ? `${configKey} is disabled` : `${configKey} is not configured`;
      console.log(`Skipping ${name} (${why})`);
    }

    return enabled;
  };
}

/**
 * The site-wide wiring, in order. Each entry is `{ name, load, when }`: `when`
 * (optional) decides whether it runs, and `load({ omega, options })` runs it.
 * A load that returns a promise (a dynamic import: static paths only, so
 * esbuild resolves and splits each one) does not hold up the next entry; the
 * last entry, complete, runs once every one of them has settled.
 */
const MODULES = [
  // FIRST (#383): the consent gate queues Google Consent Mode's default before
  // any provider script can load, and nothing else may count an event ahead of
  // that decision.
  { name: 'analytics-loader.js', load: (context) => analyticsLoaderModule(context) },
  // …and the page's own analytics seams go in beside it (#386), so an event
  // fired by shared client code (a vert click, a notification prompt) is
  // gated on this visitor's consent and carries their attribution, on a page
  // whose own call sites never loaded.
  { name: 'configure-analytics', load: () => configureAnalytics() },
  { name: 'auth.js', load: (context) => authModule(context) },
  { name: 'lazy-loading.js', load: (context) => lazyLoadingModule(context) },
  { name: 'query-strings.js', load: (context) => queryStringsModule(context) },
  { name: 'service-worker.js', load: (context) => serviceWorkerModule(context) },
  { name: 'language-switcher.js', load: (context) => languageSwitcherModule(context) },

  // Web's own click trigger on the shared registry (#16), registered here so
  // every page has it (the auth pages and the styleguide both carry the eye)
  { name: 'password-toggle', load: ({ omega }) => setupPasswordToggle(omega) },

  // The site alerts' × (#719): delegated, so the banners body.html ships
  // hidden are dismissible on every page with no per-alert wiring
  { name: 'alert-dismiss', load: () => setupAlertDismiss() },

  // Every copy control on the site (#709): one delegated handler, so a
  // `data-omega-copy` button is wired on every page, including the rows a
  // page module renders after boot
  { name: 'copy', load: () => setupCopy() },

  // Dev palette: the yellow DEV pull-tab (persona switcher + quick links).
  // Development only, and never INSIDE a frame (#555, Ian's ruling
  // 2026-08-25): the showcase gallery stacks one embedded document per demo
  // variant, and a pull-tab in every frame is the same noise the cookie banner
  // and the chat widget already stopped making there. The iframe mark
  // core/_includes/core/body.html stamps before first paint is all this needs.
  {
    name: 'dev-palette.js',
    when: ({ omega }) => omega.isDevelopment() && document.documentElement.getAttribute('data-iframed') !== 'true',
    load: () => import('__main_assets__/js/core/dev-palette.js').then(({ default: devPalette }) => devPalette()),
  },

  // Missing-icon loudness (Ian 2026-07-16): every icon the build could not
  // resolve becomes a console.error in dev
  {
    name: 'dev-icon-audit.js',
    when: ({ omega }) => omega.isDevelopment(),
    load: () => import('__main_assets__/js/core/dev-icon-audit.js').then(({ default: devIconAudit }) => devIconAudit()),
  },

  // The consent gate is the one DEFAULT-ON module (`client.consent.enabled`,
  // schema default true): a config that never mentions it still ships the
  // banner, and only an explicit `false` drops it. Read strict-truthy, any
  // config assembled outside loadConfig()'s materialization shipped a site
  // with no consent gate while the schema promised one
  // ([#551](https://github.com/Omega-JS-Stack/omega/issues/551)).
  {
    name: 'consent.js',
    when: configured('consent', { defaultOn: true }),
    load: (context) => import('__main_assets__/js/core/consent.js').then(({ default: consentModule }) => consentModule(context)),
  },
  {
    name: 'exit-popup.js',
    when: configured('exitPopup'),
    load: ({ omega }) => import('__main_assets__/js/core/exit-popup.js').then(({ createExitPopup }) => {
      omega.exitPopup = createExitPopup(omega);
    }),
  },
  {
    name: 'social-sharing.js',
    when: configured('socialSharing'),
    load: (context) => import('__main_assets__/js/core/social-sharing.js').then(({ default: socialSharingModule }) => socialSharingModule(context)),
  },

  // The theme's own script (a dynamic import, since the active theme varies)
  { name: 'theme', load: ({ omega, options }) => import('__theme__/_theme.js').then((mod) => mod.default({ omega, options })) },

  // Finalize the page load state
  { name: 'complete.js', load: (context) => completeModule(context) },
];

// Global web module
export default async function ({ omega, options }) {
  const context = { omega, options };
  const pending = [];

  // Log
  console.log('Global module loaded successfully (assets/js/main.js)');

  for (const [index, module] of MODULES.entries()) {
    if (module.when && !module.when(context, module.name)) {
      continue;
    }

    // The last entry (complete) finalizes the page, so it waits for every
    // load still in flight
    if (index === MODULES.length - 1) {
      await Promise.all(pending);
    }

    const result = module.load(context);

    if (result instanceof Promise) {
      pending.push(result.catch((error) => console.error(`Failed to load ${module.name}:`, error)));
    }
  }
}
