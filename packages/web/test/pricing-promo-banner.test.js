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
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const cheerio = require('cheerio');
const { User } = require('@omega.js/account');

const { buildWith, miniData } = require('./lib/build.js');

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
        build.onResolve({ filter: /^@omega\.js\/web\/runtime$/ }, () => {
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

/**
 * A document over the RENDERED /pricing page that answers only the promo
 * banner's subtree, the site nav and the page's sections, each element live
 * enough for the banner path: attributes, classes, style, listeners and a
 * bubbling click. Scripts never run here, so an inline handler does nothing.
 *
 * @param {string} html - the built pricing page
 * @returns {object} { document, banner, nav, firstSection, close, isHidden }
 */
function renderedDocument(html) {
  const $ = cheerio.load(html);
  const bannerNode = $('#pricing-promo-banner')[0];
  const navNode = $('.omega-nav')[0];
  const closeNode = $(bannerNode).find('button')[0];
  const wrappers = new Map();
  const documentListeners = {};

  const answers = (node) => node === navNode
    || node.name === 'section'
    || $(node).closest('#pricing-promo-banner').length > 0;
  const wrapAll = (nodes) => nodes.toArray().filter(answers).map(wrap);

  function wrap(node) {
    if (!node) return null;
    if (wrappers.has(node)) return wrappers.get(node);

    const listeners = {};
    const element = {
      node,
      listeners,
      style: {},
      removed: false,
      offsetHeight: node === bannerNode ? BANNER_HEIGHT : 0,
      get id() { return node.attribs.id || ''; },
      get hidden() { return 'hidden' in node.attribs; },
      set hidden(value) { element.toggleAttribute('hidden', Boolean(value)); },
      get textContent() { return $(node).text(); },
      set textContent(value) { $(node).text(String(value)); },
      get parentElement() { return wrap(node.parent && node.parent.type === 'tag' ? node.parent : null); },
      getAttribute: (name) => (name in node.attribs ? node.attribs[name] : null),
      hasAttribute: (name) => name in node.attribs,
      setAttribute: (name, value) => { node.attribs[name] = String(value); },
      removeAttribute: (name) => { delete node.attribs[name]; },
      toggleAttribute: (name, force) => {
        const on = force === undefined ? !(name in node.attribs) : force;
        if (on) node.attribs[name] = '';
        else delete node.attribs[name];
        return on;
      },
      classList: {
        contains: (name) => $(node).hasClass(name),
        add: (...names) => { $(node).addClass(names.join(' ')); },
        remove: (...names) => { $(node).removeClass(names.join(' ')); },
        toggle: (name, force) => { $(node).toggleClass(name, force); return $(node).hasClass(name); },
      },
      matches: (selector) => $(node).is(selector),
      closest: (selector) => wrap($(node).closest(selector)[0]),
      querySelector: (selector) => wrapAll($(node).find(selector))[0] || null,
      querySelectorAll: (selector) => wrapAll($(node).find(selector)),
      contains: (other) => Boolean(other) && (other.node === node || $(other.node).parents().toArray().includes(node)),
      remove: () => { element.removed = true; },
      addEventListener: (type, handler) => { (listeners[type] ||= []).push(handler); },
      removeEventListener: (type, handler) => {
        listeners[type] = (listeners[type] || []).filter((entry) => entry !== handler);
      },
      click: () => dispatchClick(element),
    };

    wrappers.set(node, element);
    return element;
  }

  // The click bubbles from the button through every wrapped ancestor to the
  // document, so a delegated listener answers it the way a browser's would.
  function dispatchClick(target) {
    const event = { type: 'click', target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    const path = [target.node, ...$(target.node).parents().toArray()];

    for (const node of path) {
      const element = wrappers.get(node);
      for (const handler of (element && element.listeners.click) || []) handler.call(element, { ...event, currentTarget: element });
    }
    for (const handler of documentListeners.click || []) handler({ ...event, currentTarget: null });
  }

  const document = {
    getElementById: (id) => wrapAll($(`[id="${id}"]`))[0] || null,
    querySelector: (selector) => wrapAll($(selector))[0] || null,
    querySelectorAll: (selector) => wrapAll($(selector)),
    addEventListener: (type, handler) => { (documentListeners[type] ||= []).push(handler); },
    removeEventListener: () => {},
  };

  const banner = wrap(bannerNode);
  const isHidden = () => banner.removed || banner.hidden || banner.style.display === 'none' || banner.classList.contains('d-none');

  return { document, banner, nav: wrap(navNode), firstSection: wrap($('main section')[0]), close: wrap(closeNode), isHidden };
}

/**
 * Load the REAL pricing page over a document and hand back what the page did to
 * it.
 *
 * @param {object} parts - a document and the elements a case reads back
 * @returns {Promise<object>} the same parts, plus every element the page measured
 */
async function loadPricingPage(parts) {
  await bundleOnce();

  // Every element the page asked the browser to MEASURE: reading the opening
  // section's padding is the first half of moving it.
  const computedReads = [];

  globalThis.document = parts.document;

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
    dom: { ready: async () => {} },
    request: async () => {},
    auth: {
      listen: (options, handler) => handler({ user: new User(), denied: false }),
    },
    sentry: { captureException: () => {} },
    storage: { get: (key, fallback) => fallback, set: () => {} },
  };

  // The page waits a second before it shows the banner, then polls a countdown
  // forever: this suite is about the push, so both schedulers run inline.
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

  return { ...parts, computedReads };
}

// Built once, before any case puts browser globals on the process.
let pricingHtml;

module.exports = defineCases({
  type: 'group',
  description: 'pricing-promo-banner',
  setup: async () => {
    const pages = await buildWith(miniData, { activeTheme: 'classy' }, 'pricing-promo-banner');
    pricingHtml = pages.get('/pricing');
  },
  tests: [
    {
      name: 'the promo banner pushes the NAV down and leaves the page where it is (#764)',
      run: async (ctx) => {
        const page = await loadPricingPage(renderedDocument(pricingHtml));

        ctx.expect(page.isHidden(), 'the banner is shown').toBe(false);
        ctx.expect(page.nav.style.marginTop, 'the fixed nav takes the banner\'s full height').toBe(`${BANNER_HEIGHT}px`);

        // The bug: the opening section took that height as extra top padding too, so
        // the masthead — and everything under it — dropped a banner's worth a second
        // into the page.
        ctx.expect(page.firstSection.style.paddingTop, 'the opening section keeps the padding it painted with').toBe(undefined);
        ctx.expect(!page.computedReads.includes(page.firstSection), 'and the page never measures it: the banner is nav chrome, not page layout').toBeTruthy();
      },
    },

    {
      name: 'closing the open promo banner hides it and hands the nav its margin back, with no inline handler in the page',
      run: async (ctx) => {
        const page = await loadPricingPage(renderedDocument(pricingHtml));

        ctx.expect(page.close, 'the rendered banner carries its close button').toBeTruthy();
        ctx.expect(page.close.getAttribute('onclick'), 'the close is the module\'s listener, not markup').toBe(null);
        ctx.expect(page.isHidden(), 'the banner is open').toBe(false);
        ctx.expect(page.nav.style.marginTop, 'and the nav is pushed down by it').toBe(`${BANNER_HEIGHT}px`);

        page.close.click();

        ctx.expect(page.isHidden(), 'the click hides the banner').toBe(true);
        ctx.expect(page.nav.style.marginTop || '', 'and the nav sits back at the top').toBe('');
      },
    },
  ],
});
