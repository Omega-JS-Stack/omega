/**
 * The consent banner (`core/js/core/consent.js`, #383/#391) — the rebuilt UI
 * and, more to the point, what pressing each control actually WRITES.
 *
 * The old banner is what this replaces: it auto-accepted on the first scroll or
 * stray click, and its one "I Understand" button stored a bare `accepted: true`
 * that nothing read. What is pinned here is Ian's UX — one big Accept granting
 * both categories, a small Customize opening the panel, every switch in that
 * panel saving the moment it is flipped, and an Accept all / Accept none pair
 * that answers the whole thing either direction in one click (#391 retired the
 * Save button that used to sit there) — plus the absence of the auto-accept
 * listeners, and the #391 rule that an opt-out region is never interrupted at
 * all.
 *
 * Browser code behind two bundler aliases, so the harness drives the REAL file
 * through esbuild over a hand-rolled document that is only what the banner
 * touches (node has no DOM and web pulls in no jsdom) — the convention
 * dev-palette.test.js set.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { get: _get, set: _set } = require('lodash');

const CORE_DIR = path.join(__dirname, '..', 'core');
const ENTRY = path.join(CORE_DIR, 'js', 'core', 'consent.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-consent-banner-'));
const BUNDLE = path.join(BUNDLE_DIR, 'consent.cjs');

// The shape @omega.js/client normalizes `client.consent` into.
const CONFIG = {
  position: 'bottom-left',
  content: {
    message: 'We use cookies. See our { terms }.',
    panelIntro: 'We and our partners use cookies and similar technologies. See our { cookies } and { terms }.',
    accept: 'Accept',
    customize: 'Customize',
    acceptAll: 'Accept all',
    acceptNone: 'Accept none',
  },
};

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [ENTRY],
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
      },
    }],
  });

  return building;
}

/** The minimum element the banner builds with. */
function makeElement(tagName) {
  const classes = new Set();

  const element = {
    tagName,
    parent: null,
    children: [],
    textContent: '',
    innerHTML: '',
    hidden: false,
    checked: false,
    disabled: false,
    focused: false,
    attributes: {},
    listeners: {},
    get className() { return [...classes].join(' '); },
    set className(value) { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach((name) => classes.add(name)); },
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    appendChild: (node) => { node.parent = element; element.children.push(node); return node; },
    prepend: (node) => { node.parent = element; element.children.unshift(node); return node; },
    remove: () => {
      if (!element.parent) return;
      element.parent.children = element.parent.children.filter((child) => child !== element);
      element.parent = null;
    },
    setAttribute: (name, value) => { element.attributes[name] = String(value); },
    getAttribute: (name) => (name in element.attributes ? element.attributes[name] : null),
    addEventListener: (type, handler) => { (element.listeners[type] ||= []).push(handler); },
    focus: () => { element.focused = true; },
    click: () => {
      // A disabled control is inert, which is the whole point of the locked
      // Necessary switch: pressing it must not become an answer.
      if (element.disabled) return;

      // A checkbox click flips it and fires `change` — the browser's own order,
      // and the one the instant-save switches ride (#391).
      if (element.type === 'checkbox') element.checked = !element.checked;

      (element.listeners.click || []).forEach((handler) => handler());
      if (element.type === 'checkbox') (element.listeners.change || []).forEach((handler) => handler());
    },
  };

  return element;
}

function makeDocument() {
  return {
    documentElement: { dataset: {} },
    body: makeElement('body'),
    head: makeElement('head'),
    createElement: (tagName) => makeElement(tagName),
    addEventListener: () => {},
  };
}

/** Every element under a node, depth-first. */
function flatten(node) {
  return (node.children || []).flatMap((child) => [child, ...flatten(child)]);
}

const ORIGINAL_TZ = process.env.TZ;

/** Boot the real banner over one document, one storage, one region. */
async function boot({ timeZone = 'Europe/Berlin', storage = {} } = {}) {
  await bundleOnce();

  process.env.TZ = timeZone;

  const doc = makeDocument();
  const tracked = [];
  const windowListeners = {};

  globalThis.document = doc;
  globalThis.window = {
    addEventListener: (type, handler) => { (windowListeners[type] ||= []).push(handler); },
    removeEventListener: () => {},
  };
  globalThis.__omegaClient = {
    config: { consent: { config: CONFIG } },
    dom: { ready: () => Promise.resolve() },
    storage: {
      get: (keyPath, defaultValue) => _get(storage, keyPath, defaultValue),
      set: (keyPath, value) => _set(storage, keyPath, value),
      remove: (keyPath) => _set(storage, keyPath, undefined),
    },
  };

  // The providers ARE loaded here, so the banner's own events are visible. In an
  // opt-in region none of them would exist yet — which is what makes a
  // banner_show safe there (#306's guards read an absent global as a no-op).
  globalThis.gtag = (...args) => tracked.push(['gtag', ...args]);
  globalThis.fbq = (...args) => tracked.push(['fbq', ...args]);
  globalThis.ttq = { track: (...args) => tracked.push(['ttq', ...args]) };

  delete require.cache[require.resolve(BUNDLE)];
  require(BUNDLE).default({ omega: globalThis.__omegaClient });

  // omega.dom.ready() resolves in a microtask; the mount happens behind it.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const all = () => flatten(doc.body);
  const find = (className) => all().find((element) => element.classList.contains(className));

  return {
    doc,
    storage,
    tracked,
    windowListeners,
    all,
    find,
    banner: () => doc.body.children.find((child) => child.classList.contains('omega-consent')),
    tab: () => doc.body.children.find((child) => child.classList.contains('omega-consent__tab')),
    checkbox: (id) => all().find((element) => element.tagName === 'input' && element.id === id),
    events: () => tracked.filter(([provider]) => provider === 'gtag').map(([, , name]) => name),
    // Meta rides `marketing` where GA4 rides `analytics`, which is the only way
    // to WATCH a half-granted panel: a fire made after analytics went off is
    // blocked at gtag and delivered at fbq.
    metaEvents: () => tracked.filter(([provider]) => provider === 'fbq').map(([, , name]) => name),
  };
}

/** Let the dismiss animation finish so the reopen tab has been built. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 350));

module.exports = defineCases({
  type: 'group',
  description: 'consent-banner',
  cleanup: () => {
    process.env.TZ = ORIGINAL_TZ;
    delete globalThis.window;
    delete globalThis.document;
    for (const name of ['gtag', 'fbq', 'ttq']) delete globalThis[name];
  },
  tests: [
    {
      name: 'the banner mounts with one big Accept and one small Customize, and nothing else',
      run: async (ctx) => {
        const page = await boot();

        const banner = page.banner();
        ctx.expect(banner, 'the panel mounts on a page with no decision').toBeTruthy();
        ctx.expect(banner.getAttribute('role')).toBe('dialog');
        ctx.expect(banner.getAttribute('aria-label')).toBe('Cookie consent');
        ctx.expect(banner.classList.contains('omega-consent--bottom-left'), 'placement comes off the config').toBeTruthy();

        const buttons = page.all().filter((element) => element.tagName === 'button');
        ctx.expect(buttons.map((element) => element.textContent), 'the two controls, plus the pair that lives inside the hidden options panel — and no Save (#391)').toEqual(['Accept all', 'Accept none', 'Accept', 'Customize']);
        // Real <button type="button">s, never a div with a click handler.
        buttons.forEach((element) => ctx.expect(element.type, `${element.textContent} is a real button`).toBe('button'));

        ctx.expect(page.find('omega-consent__options').hidden, 'the per-category switches start closed').toBe(true);
        ctx.expect(page.events(), 'nothing is counted in an opt-in region before the answer — not even the banner itself (#328: the gate is asked for every fire, and the providers are not loaded there anyway)').toEqual([]);
      },
    },

    {
      name: 'the cookie icon lives on the tab, not the open banner',
      run: async (ctx) => {
        const page = await boot({ timeZone: 'America/New_York' });

        const icon = page.find('omega-consent__icon');
        ctx.expect(icon, 'the tab has the icon').toBeTruthy();
        ctx.expect(icon.parent, 'and it sits inside the tab button').toBe(page.tab());
        ctx.expect(icon.tagName, 'a real <i> the shared renderer swaps for an inline SVG').toBe('i');
        // fa-cookie-bite is a FREE glyph — framework markup may never name a Pro-only
        // icon, because a consumer without Pro cannot fix it (docs/shared/icons.md).
        ctx.expect(icon.classList.contains('fa-solid'), 'the free solid family').toBeTruthy();
        ctx.expect(icon.classList.contains('fa-cookie-bite')).toBeTruthy();
        ctx.expect(icon.getAttribute('aria-hidden'), 'decorative — the button text is the name').toBe('true');
        ctx.expect(page.tab().textContent, 'the tab says settings, because that is what it opens').toBe('Cookies Settings');

        page.tab().click();
        const bannerIcons = page.all().filter((element) => element.classList.contains('omega-consent__icon') && element.parent !== null && page.banner() && element.parent === page.banner());
        ctx.expect(bannerIcons, 'the open banner carries no icon — it only shoved the message over').toEqual([]);
      },
    },

    {
      name: 'an opt-out region is never interrupted: the tab, and no banner at all',
      run: async (ctx) => {
        // Everything is granted there by default, so there is no gate to hold and
        // nothing worth interrupting a first visit for (#391). The banner used to
        // mount informationally and count itself.
        const page = await boot({ timeZone: 'America/New_York' });

        ctx.expect(page.banner(), 'no banner on a first visit').toBe(undefined);
        ctx.expect(page.tab(), 'the small policy tab is the whole surface').toBeTruthy();
        ctx.expect(page.events(), 'and cookie_banner_show is not fired for a banner nobody saw').toEqual([]);
        ctx.expect(page.storage.trackingConsent, 'nothing is stored either — the region default is not a decision').toBe(undefined);
      },
    },

    {
      name: 'the opt-out tab still reopens the full banner',
      run: async (ctx) => {
        const page = await boot({ timeZone: 'America/New_York' });

        page.tab().click();

        ctx.expect(page.banner(), 'the way to turn things off is still one click away').toBeTruthy();
        ctx.expect(page.tab(), 'and the tab steps aside').toBe(undefined);
        ctx.expect(page.events().includes('cookie_policy_reopen')).toBeTruthy();
      },
    },

    {
      name: 'the auto-accept-on-scroll behavior is GONE',
      run: async (ctx) => {
        const page = await boot();

        // The old banner listened for scroll and for any click outside itself, then
        // stored consent on the visitor's behalf. No consent regime survives that.
        ctx.expect(Object.keys(page.windowListeners), 'the banner registers no window listeners at all').toEqual([]);
        ctx.expect(page.storage.trackingConsent, 'and nothing is stored until a control is pressed').toBe(undefined);
      },
    },

    {
      name: 'Accept grants both categories',
      run: async (ctx) => {
        const page = await boot();

        page.find('omega-consent__accept').click();

        ctx.expect(page.storage.trackingConsent.analytics).toBe(true);
        ctx.expect(page.storage.trackingConsent.marketing).toBe(true);
        ctx.expect(page.storage.trackingConsent.region).toBe('opt-in');
        ctx.expect(page.storage.trackingConsent.version).toBe(1);
        ctx.expect(page.events().includes('cookie_consent_accept')).toBeTruthy();

        await settle();
        ctx.expect(page.banner(), 'the panel leaves').toBe(undefined);
        ctx.expect(page.tab(), 'and the small policy tab takes its place').toBeTruthy();
      },
    },

    {
      name: 'a double-click on Accept answers once',
      run: async (ctx) => {
        const page = await boot();

        const accept = page.find('omega-consent__accept');
        accept.click();
        // The hide animation keeps the button on screen for a beat — the latch is
        // what makes this second click a no-op instead of a double-count.
        accept.click();

        const accepts = page.events().filter((name) => name === 'cookie_consent_accept');
        ctx.expect(accepts.length, 'one answer, one event').toBe(1);

        await settle();
        ctx.expect(page.tab(), 'and the one dismissal still lands the tab').toBeTruthy();
      },
    },

    {
      name: 'Customize opens the panel and takes the whole Accept row with it',
      run: async (ctx) => {
        const page = await boot();

        page.find('omega-consent__customize').click();

        const options = page.find('omega-consent__options');
        ctx.expect(options.hidden, 'the panel opens in place').toBe(false);
        // Accept all inside the panel IS the big Accept, at the same one click, so
        // the row that carried it steps aside rather than offering it twice (#391).
        const actions = page.find('omega-consent__actions');
        ctx.expect(actions.hidden, 'the original Accept row hides').toBe(true);
        ctx.expect(actions.children.includes(page.find('omega-consent__accept')), 'and the big Accept is what went with it').toBeTruthy();
        ctx.expect(actions.children.includes(page.find('omega-consent__customize')), 'the control that opened the panel hides with the row it lives in').toBeTruthy();

        const necessary = page.checkbox('omega-consent-necessary');
        ctx.expect(necessary.checked, 'Necessary is shown').toBe(true);
        ctx.expect(necessary.disabled, 'and locked on').toBe(true);

        const analytics = page.checkbox('omega-consent-analytics');
        const marketing = page.checkbox('omega-consent-marketing');
        ctx.expect(analytics.checked, 'an opt-in region starts with nothing granted').toBe(false);
        ctx.expect(marketing.checked).toBe(false);
        ctx.expect(analytics.focused, 'the keyboard follows the panel that just appeared').toBe(true);

        // Every switch is a REAL checkbox with a label bound to it — an unnamed
        // checkbox is unusable by voice or screen reader, and a div wearing a pill
        // has no keyboard at all.
        for (const id of ['omega-consent-necessary', 'omega-consent-analytics', 'omega-consent-marketing']) {
          const input = page.checkbox(id);
          ctx.expect(input.type, `${id} is a real checkbox`).toBe('checkbox');
          ctx.expect(input.classList.contains('omega-consent__switch'), `${id} is styled as a switch, not replaced by one`).toBeTruthy();
          ctx.expect(page.all().some((element) => element.tagName === 'label' && element.htmlFor === id), `${id} has a label`).toBeTruthy();
        }
      },
    },

    {
      name: 'the panel intro carries the legal copy and links both policies',
      run: async (ctx) => {
        const page = await boot();

        page.find('omega-consent__customize').click();

        const intro = page.find('omega-consent__intro');
        ctx.expect(intro, 'the disclosure sits above the categories').toBeTruthy();
        ctx.expect(intro.innerHTML.includes('href="/cookies"'), 'the {cookies} placeholder becomes a real link').toBeTruthy();
        ctx.expect(intro.innerHTML.includes('href="/terms"'), 'and {terms} still does too').toBeTruthy();
      },
    },

    {
      name: 'flipping a switch saves on the spot, and the panel stays open',
      run: async (ctx) => {
        const page = await boot();

        page.find('omega-consent__customize').click();
        page.checkbox('omega-consent-analytics').click();

        // No Save to press: the flip IS the answer (#391).
        ctx.expect(page.storage.trackingConsent.analytics, 'exactly the switch that was flipped').toBe(true);
        ctx.expect(page.storage.trackingConsent.marketing, 'and exactly the one that was not').toBe(false);
        ctx.expect(page.events().includes('cookie_consent_accept'), 'a save that grants something is an accept').toBeTruthy();

        ctx.expect(page.banner(), 'the banner stays open so the next flip is one click away').toBeTruthy();
        ctx.expect(page.find('omega-consent__options').hidden, 'and so does the panel').toBe(false);
        ctx.expect(page.tab(), 'nothing collapsed').toBe(undefined);

        // Flipping it back is the same instant write, in the other direction.
        page.checkbox('omega-consent-analytics').click();

        ctx.expect(page.storage.trackingConsent.analytics, 'the withdrawal is stored as immediately as the grant').toBe(false);
        ctx.expect(page.banner(), 'and the panel is still there').toBeTruthy();
      },
    },

    {
      name: 'a panel flipped to nothing is the denial',
      run: async (ctx) => {
        // An opt-out visitor arrives with both granted, so turning them off one at a
        // time is what walks an accept into a denial.
        const page = await boot({ timeZone: 'America/New_York' });

        page.tab().click();
        page.find('omega-consent__customize').click();

        page.checkbox('omega-consent-analytics').click();

        ctx.expect(page.storage.trackingConsent.analytics, 'the flip is stored on the spot').toBe(false);
        ctx.expect(page.storage.trackingConsent.marketing, 'the switch beside it is untouched').toBe(true);
        ctx.expect(page.metaEvents().pop(), 'a partial grant is still an accept').toBe('CookieConsentAccept');

        page.checkbox('omega-consent-marketing').click();

        ctx.expect(page.storage.trackingConsent.marketing, 'the last switch off is the refusal').toBe(false);
        // The denial is recorded in STORAGE and counted nowhere: the fire is made
        // after the record is written, so the gate the visitor just closed is the one
        // it is asked about. Honoring the answer beats counting it (#328).
        ctx.expect(!page.events().includes('cookie_consent_deny'), 'a denied visitor is counted by nobody, the denial included').toBeTruthy();
        ctx.expect(!page.metaEvents().includes('CookieConsentDeny')).toBeTruthy();
        ctx.expect(page.metaEvents().pop(), 'and no second accept was counted on the way out').toBe('CookieConsentAccept');
      },
    },

    {
      name: 'the locked Necessary switch cannot be pressed into an answer',
      run: async (ctx) => {
        const page = await boot();

        page.find('omega-consent__customize').click();
        page.checkbox('omega-consent-necessary').click();

        ctx.expect(page.checkbox('omega-consent-necessary').checked, 'it stays on').toBe(true);
        ctx.expect(page.storage.trackingConsent, 'and pressing it never wrote an answer').toBe(undefined);
      },
    },

    {
      name: 'Accept all flips every switch, saves, and collapses to the tab',
      run: async (ctx) => {
        const page = await boot();

        page.find('omega-consent__customize').click();
        page.find('omega-consent__accept-all').click();

        ctx.expect(page.checkbox('omega-consent-analytics').checked, 'the switches match what was pressed').toBe(true);
        ctx.expect(page.checkbox('omega-consent-marketing').checked).toBe(true);
        ctx.expect(page.storage.trackingConsent.analytics).toBe(true);
        ctx.expect(page.storage.trackingConsent.marketing).toBe(true);
        ctx.expect(page.events().pop()).toBe('cookie_consent_accept');

        await settle();
        ctx.expect(page.banner(), 'the panel leaves').toBe(undefined);
        ctx.expect(page.tab(), 'and the tab takes its place').toBeTruthy();
      },
    },

    {
      name: 'Accept none is the same one click, in the other direction',
      run: async (ctx) => {
        // The refusal is never a longer path than the grant — the EU equal-ease rule,
        // and the reason the pair sits side by side.
        const page = await boot({ timeZone: 'America/New_York' });

        page.tab().click();
        page.find('omega-consent__customize').click();

        ctx.expect(page.checkbox('omega-consent-analytics').checked, 'an opt-out region opens already granted').toBe(true);
        ctx.expect(page.checkbox('omega-consent-marketing').checked).toBe(true);

        page.find('omega-consent__accept-none').click();

        ctx.expect(page.checkbox('omega-consent-analytics').checked, 'every switch flips to match').toBe(false);
        ctx.expect(page.checkbox('omega-consent-marketing').checked).toBe(false);
        ctx.expect(page.storage.trackingConsent.analytics).toBe(false);
        ctx.expect(page.storage.trackingConsent.marketing).toBe(false);
        // A refusal is a deny whatever button carried it — and a deny reaches nobody,
        // because it is fired after the record that blocks it (#328).
        ctx.expect(!page.events().includes('cookie_consent_accept'), 'Accept none never counts as an accept').toBeTruthy();
        ctx.expect(!page.metaEvents().includes('CookieConsentAccept')).toBeTruthy();
        ctx.expect(page.metaEvents(), 'the reopen that started this is the only thing counted').toEqual(['CookiePolicyReopen']);

        await settle();
        ctx.expect(page.tab(), 'a refusal settles the banner exactly like a grant does').toBeTruthy();
      },
    },

    {
      name: 'a settled visitor gets the tab, and reopening it asks again',
      run: async (ctx) => {
        const storage = {
          trackingConsent: { analytics: true, marketing: true, region: 'opt-out', timestamp: '2026-08-19T00:00:00.000Z', version: 1 },
        };

        const page = await boot({ timeZone: 'America/New_York', storage });

        ctx.expect(page.banner(), 'an answered visitor is not asked again').toBe(undefined);
        const tab = page.tab();
        ctx.expect(tab, 'the policy tab is the way back in').toBeTruthy();
        ctx.expect(tab.getAttribute('aria-label')).toBe('Cookies Settings');

        tab.click();

        ctx.expect(page.banner(), 'the panel comes back').toBeTruthy();
        ctx.expect(page.tab(), 'and the tab steps aside').toBe(undefined);
        ctx.expect(storage.trackingConsent, 'the old answer is cleared — this is a fresh question').toBe(undefined);
        ctx.expect(page.events().includes('cookie_policy_reopen')).toBeTruthy();
        ctx.expect(!page.events().includes('cookie_banner_show'), 'a reopen is counted as a reopen, never as a second impression').toBeTruthy();
      },
    },

    {
      name: 'an opt-in visitor who has answered is not asked again either',
      run: async (ctx) => {
        const storage = {
          trackingConsent: { analytics: false, marketing: false, region: 'opt-in', timestamp: '2026-08-19T00:00:00.000Z', version: 1 },
        };

        const page = await boot({ storage });

        ctx.expect(page.banner(), 'the stored decision wins over the region').toBe(undefined);
        ctx.expect(page.tab(), 'and the tab is the way back in').toBeTruthy();
      },
    },

    {
      name: 'the message links the terms page instead of naming it',
      run: async (ctx) => {
        const page = await boot();

        ctx.expect(page.find('omega-consent__message').innerHTML.includes('href="/terms"'), 'the {terms} placeholder becomes a real link').toBeTruthy();
      },
    },
  ],
});
