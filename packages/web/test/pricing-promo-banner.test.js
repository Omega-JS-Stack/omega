/**
 * The PRICING promo banner's push
 * ([#764](https://github.com/Omega-JS-Stack/omega/issues/764)).
 *
 * The banner is fixed chrome above the nav, and it used to move the whole page
 * when it arrived: the script pushed the fixed nav down by the banner height
 * AND added that height to the first section's top padding, so a visitor a
 * second into /pricing watched the masthead jump. Ian's ruling (2026-09-02):
 * the banner joins the NAV chrome — the nav moves, the page does not.
 *
 * Same harness convention as the other browser suites (pricing-switch-cta,
 * consent-banner): the REAL module through esbuild behind its bundler aliases,
 * over a document that answers only the selectors the page reads.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const PRICING_ENTRY = path.join(CORE_DIR, 'js', 'pages', 'pricing', 'index.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-pricing-promo-'));
const BUNDLE = path.join(BUNDLE_DIR, 'pricing.cjs');

/** The banner height a wrapped mobile banner reports. */
const BANNER_HEIGHT = 118;

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [PRICING_ENTRY],
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    plugins: [{
      name: 'harness-aliases',
      setup(build) {
        build.onResolve({ filter: /^__main_assets__\// }, (args) => {
          return { path: path.join(CORE_DIR, args.path.slice('__main_assets__/'.length)) };
        });
        build.onResolve({ filter: /^@omega\.js\/client$/ }, () => {
          return { path: 'client', namespace: 'omega-client-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-client-stub' }, () => {
          return { contents: 'export default globalThis.__omegaClient;' };
        });
        // The price TWEEN is the motion module's job and nothing this suite
        // touches renders a price.
        build.onResolve({ filter: /^@omega\.js\/client\/modules\/motion\.js$/ }, () => {
          return { path: 'motion', namespace: 'omega-motion-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-motion-stub' }, () => {
          return { contents: 'export function parseCountTarget() { return null; } export function formatCount() { return \'\'; }' };
        });
      },
    }],
  });

  return building;
}

/** One element, as much of it as the banner path reads and writes. */
function makeElement(overrides = {}) {
  return {
    style: {},
    textContent: '',
    attributes: { hidden: true },
    offsetHeight: 0,
    removeAttribute(name) { delete this.attributes[name]; },
    matches: () => false,
    ...overrides,
  };
}

/**
 * Load the REAL pricing page over a document that has the banner, the nav and
 * the opening section, and hand back what the page did to each of them.
 *
 * @returns {Promise<object>} { banner, nav, firstSection, computedReads }
 */
async function loadPricingPage() {
  await bundleOnce();

  const banner = makeElement({ offsetHeight: BANNER_HEIGHT });
  const countdown = makeElement();
  const promoText = makeElement();
  const nav = makeElement();
  const firstSection = makeElement();
  // Every element the page asked the browser to MEASURE — reading the opening
  // section's padding is the first half of moving it.
  const computedReads = [];

  globalThis.document = {
    getElementById: (id) => ({
      'pricing-promo-banner': banner,
      'pricing-promo-countdown': countdown,
      'pricing-promo-text': promoText,
    }[id] || null),
    querySelector: (selector) => {
      if (selector === 'nav') return nav;
      if (selector.includes('.omega-nav')) return nav;
      if (selector.includes('section:first-of-type')) return firstSection;
      return null;
    },
    querySelectorAll: () => [],
    addEventListener: () => {},
  };

  globalThis.window = {
    location: { origin: 'https://brand.test', href: 'https://brand.test/pricing' },
    matchMedia: () => ({ matches: false }),
  };

  globalThis.getComputedStyle = (element) => {
    computedReads.push(element);
    return { paddingTop: '160px' };
  };

  globalThis.__omegaClient = {
    config: { analytics: { providers: {} } },
    dom: () => ({ ready: async () => {} }),
    request: async () => {},
    auth: () => ({
      listen: (options, handler) => handler({ account: null }),
      resolveSubscription: () => ({ active: false }),
    }),
    sentry: () => ({ captureException: () => {} }),
    storage: () => ({ get: (key, fallback) => fallback, set: () => {} }),
  };

  // The page waits a second before it shows the banner, then polls a countdown
  // forever — this suite is about the push, so both schedulers run inline.
  const realSetTimeout = globalThis.setTimeout;
  const realSetInterval = globalThis.setInterval;
  globalThis.setTimeout = (handler) => { handler(); return 0; };
  globalThis.setInterval = () => 0;

  try {
    delete require.cache[require.resolve(BUNDLE)];
    await require(BUNDLE).default();
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.setInterval = realSetInterval;
  }

  return { banner, nav, firstSection, computedReads };
}

test('the promo banner pushes the NAV down and leaves the page where it is (#764)', async () => {
  const page = await loadPricingPage();

  assert.equal(page.banner.attributes.hidden, undefined, 'the banner is shown');
  assert.equal(page.nav.style.marginTop, `${BANNER_HEIGHT}px`, 'the fixed nav takes the banner\'s full height');

  // The bug: the opening section took that height as extra top padding too, so
  // the masthead — and everything under it — dropped a banner's worth a second
  // into the page.
  assert.equal(page.firstSection.style.paddingTop, undefined, 'the opening section keeps the padding it painted with');
  assert.ok(!page.computedReads.includes(page.firstSection), 'and the page never measures it: the banner is nav chrome, not page layout');
});
