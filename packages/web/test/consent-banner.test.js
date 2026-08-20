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
const assert = require('node:assert');
const { test } = require('node:test');
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
        build.onResolve({ filter: /^@omega\.js\/client$/ }, () => {
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

test.after(() => {
  process.env.TZ = ORIGINAL_TZ;
  delete globalThis.window;
  delete globalThis.document;
  for (const name of ['gtag', 'fbq', 'ttq']) delete globalThis[name];
});

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
    dom: () => ({ ready: () => Promise.resolve() }),
    storage: () => ({
      get: (keyPath, defaultValue) => _get(storage, keyPath, defaultValue),
      set: (keyPath, value) => _set(storage, keyPath, value),
      remove: (keyPath) => _set(storage, keyPath, undefined),
    }),
  };

  // The providers ARE loaded here, so the banner's own events are visible. In an
  // opt-in region none of them would exist yet — which is what makes a
  // banner_show safe there (#306's guards read an absent global as a no-op).
  globalThis.gtag = (...args) => tracked.push(['gtag', ...args]);
  globalThis.fbq = (...args) => tracked.push(['fbq', ...args]);
  globalThis.ttq = { track: (...args) => tracked.push(['ttq', ...args]) };

  delete require.cache[require.resolve(BUNDLE)];
  require(BUNDLE).default();

  // omega.dom().ready() resolves in a microtask; the mount happens behind it.
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


test('the banner mounts with one big Accept and one small Customize, and nothing else', async () => {
  const page = await boot();

  const banner = page.banner();
  assert.ok(banner, 'the panel mounts on a page with no decision');
  assert.strictEqual(banner.getAttribute('role'), 'dialog');
  assert.strictEqual(banner.getAttribute('aria-label'), 'Cookie consent');
  assert.ok(banner.classList.contains('omega-consent--bottom-left'), 'placement comes off the config');

  const buttons = page.all().filter((element) => element.tagName === 'button');
  assert.deepStrictEqual(
    buttons.map((element) => element.textContent),
    ['Accept all', 'Accept none', 'Accept', 'Customize'],
    'the two controls, plus the pair that lives inside the hidden options panel — and no Save (#391)',
  );
  // Real <button type="button">s, never a div with a click handler.
  buttons.forEach((element) => assert.strictEqual(element.type, 'button', `${element.textContent} is a real button`));

  assert.strictEqual(page.find('omega-consent__options').hidden, true, 'the per-category switches start closed');
  assert.deepStrictEqual(page.events(), [], 'nothing is counted in an opt-in region before the answer — not even the banner itself (#328: the gate is asked for every fire, and the providers are not loaded there anyway)');
});

test('the cookie icon lives on the tab, not the open banner', async () => {
  const page = await boot({ timeZone: 'America/New_York' });

  const icon = page.find('omega-consent__icon');
  assert.ok(icon, 'the tab has the icon');
  assert.strictEqual(icon.parent, page.tab(), 'and it sits inside the tab button');
  assert.strictEqual(icon.tagName, 'i', 'a real <i> the shared renderer swaps for an inline SVG');
  // fa-cookie-bite is a FREE glyph — framework markup may never name a Pro-only
  // icon, because a consumer without Pro cannot fix it (docs/shared/icons.md).
  assert.ok(icon.classList.contains('fa-solid'), 'the free solid family');
  assert.ok(icon.classList.contains('fa-cookie-bite'));
  assert.strictEqual(icon.getAttribute('aria-hidden'), 'true', 'decorative — the button text is the name');
  assert.strictEqual(page.tab().textContent, 'Cookies Settings', 'the tab says settings, because that is what it opens');

  page.tab().click();
  const bannerIcons = page.all().filter((element) => element.classList.contains('omega-consent__icon') && element.parent !== null && page.banner() && element.parent === page.banner());
  assert.deepStrictEqual(bannerIcons, [], 'the open banner carries no icon — it only shoved the message over');
});

test('an opt-out region is never interrupted: the tab, and no banner at all', async () => {
  // Everything is granted there by default, so there is no gate to hold and
  // nothing worth interrupting a first visit for (#391). The banner used to
  // mount informationally and count itself.
  const page = await boot({ timeZone: 'America/New_York' });

  assert.strictEqual(page.banner(), undefined, 'no banner on a first visit');
  assert.ok(page.tab(), 'the small policy tab is the whole surface');
  assert.deepStrictEqual(page.events(), [], 'and cookie_banner_show is not fired for a banner nobody saw');
  assert.strictEqual(page.storage.trackingConsent, undefined, 'nothing is stored either — the region default is not a decision');
});

test('the opt-out tab still reopens the full banner', async () => {
  const page = await boot({ timeZone: 'America/New_York' });

  page.tab().click();

  assert.ok(page.banner(), 'the way to turn things off is still one click away');
  assert.strictEqual(page.tab(), undefined, 'and the tab steps aside');
  assert.ok(page.events().includes('cookie_policy_reopen'));
});

test('the auto-accept-on-scroll behavior is GONE', async () => {
  const page = await boot();

  // The old banner listened for scroll and for any click outside itself, then
  // stored consent on the visitor's behalf. No consent regime survives that.
  assert.deepStrictEqual(Object.keys(page.windowListeners), [], 'the banner registers no window listeners at all');
  assert.strictEqual(page.storage.trackingConsent, undefined, 'and nothing is stored until a control is pressed');
});

test('Accept grants both categories', async () => {
  const page = await boot();

  page.find('omega-consent__accept').click();

  assert.strictEqual(page.storage.trackingConsent.analytics, true);
  assert.strictEqual(page.storage.trackingConsent.marketing, true);
  assert.strictEqual(page.storage.trackingConsent.region, 'opt-in');
  assert.strictEqual(page.storage.trackingConsent.version, 1);
  assert.ok(page.events().includes('cookie_consent_accept'));

  await settle();
  assert.strictEqual(page.banner(), undefined, 'the panel leaves');
  assert.ok(page.tab(), 'and the small policy tab takes its place');
});

test('a double-click on Accept answers once', async () => {
  const page = await boot();

  const accept = page.find('omega-consent__accept');
  accept.click();
  // The hide animation keeps the button on screen for a beat — the latch is
  // what makes this second click a no-op instead of a double-count.
  accept.click();

  const accepts = page.events().filter((name) => name === 'cookie_consent_accept');
  assert.strictEqual(accepts.length, 1, 'one answer, one event');

  await settle();
  assert.ok(page.tab(), 'and the one dismissal still lands the tab');
});

test('Customize opens the panel and takes the whole Accept row with it', async () => {
  const page = await boot();

  page.find('omega-consent__customize').click();

  const options = page.find('omega-consent__options');
  assert.strictEqual(options.hidden, false, 'the panel opens in place');
  // Accept all inside the panel IS the big Accept, at the same one click, so
  // the row that carried it steps aside rather than offering it twice (#391).
  const actions = page.find('omega-consent__actions');
  assert.strictEqual(actions.hidden, true, 'the original Accept row hides');
  assert.ok(
    actions.children.includes(page.find('omega-consent__accept')),
    'and the big Accept is what went with it',
  );
  assert.ok(
    actions.children.includes(page.find('omega-consent__customize')),
    'the control that opened the panel hides with the row it lives in',
  );

  const necessary = page.checkbox('omega-consent-necessary');
  assert.strictEqual(necessary.checked, true, 'Necessary is shown');
  assert.strictEqual(necessary.disabled, true, 'and locked on');

  const analytics = page.checkbox('omega-consent-analytics');
  const marketing = page.checkbox('omega-consent-marketing');
  assert.strictEqual(analytics.checked, false, 'an opt-in region starts with nothing granted');
  assert.strictEqual(marketing.checked, false);
  assert.strictEqual(analytics.focused, true, 'the keyboard follows the panel that just appeared');

  // Every switch is a REAL checkbox with a label bound to it — an unnamed
  // checkbox is unusable by voice or screen reader, and a div wearing a pill
  // has no keyboard at all.
  for (const id of ['omega-consent-necessary', 'omega-consent-analytics', 'omega-consent-marketing']) {
    const input = page.checkbox(id);
    assert.strictEqual(input.type, 'checkbox', `${id} is a real checkbox`);
    assert.ok(input.classList.contains('omega-consent__switch'), `${id} is styled as a switch, not replaced by one`);
    assert.ok(page.all().some((element) => element.tagName === 'label' && element.htmlFor === id), `${id} has a label`);
  }
});

test('the panel intro carries the legal copy and links both policies', async () => {
  const page = await boot();

  page.find('omega-consent__customize').click();

  const intro = page.find('omega-consent__intro');
  assert.ok(intro, 'the disclosure sits above the categories');
  assert.ok(intro.innerHTML.includes('href="/cookies"'), 'the {cookies} placeholder becomes a real link');
  assert.ok(intro.innerHTML.includes('href="/terms"'), 'and {terms} still does too');
});

test('flipping a switch saves on the spot, and the panel stays open', async () => {
  const page = await boot();

  page.find('omega-consent__customize').click();
  page.checkbox('omega-consent-analytics').click();

  // No Save to press: the flip IS the answer (#391).
  assert.strictEqual(page.storage.trackingConsent.analytics, true, 'exactly the switch that was flipped');
  assert.strictEqual(page.storage.trackingConsent.marketing, false, 'and exactly the one that was not');
  assert.ok(page.events().includes('cookie_consent_accept'), 'a save that grants something is an accept');

  assert.ok(page.banner(), 'the banner stays open so the next flip is one click away');
  assert.strictEqual(page.find('omega-consent__options').hidden, false, 'and so does the panel');
  assert.strictEqual(page.tab(), undefined, 'nothing collapsed');

  // Flipping it back is the same instant write, in the other direction.
  page.checkbox('omega-consent-analytics').click();

  assert.strictEqual(page.storage.trackingConsent.analytics, false, 'the withdrawal is stored as immediately as the grant');
  assert.ok(page.banner(), 'and the panel is still there');
});

test('a panel flipped to nothing is the denial', async () => {
  // An opt-out visitor arrives with both granted, so turning them off one at a
  // time is what walks an accept into a denial.
  const page = await boot({ timeZone: 'America/New_York' });

  page.tab().click();
  page.find('omega-consent__customize').click();

  page.checkbox('omega-consent-analytics').click();

  assert.strictEqual(page.storage.trackingConsent.analytics, false, 'the flip is stored on the spot');
  assert.strictEqual(page.storage.trackingConsent.marketing, true, 'the switch beside it is untouched');
  assert.strictEqual(page.metaEvents().pop(), 'CookieConsentAccept', 'a partial grant is still an accept');

  page.checkbox('omega-consent-marketing').click();

  assert.strictEqual(page.storage.trackingConsent.marketing, false, 'the last switch off is the refusal');
  // The denial is recorded in STORAGE and counted nowhere: the fire is made
  // after the record is written, so the gate the visitor just closed is the one
  // it is asked about. Honoring the answer beats counting it (#328).
  assert.ok(!page.events().includes('cookie_consent_deny'), 'a denied visitor is counted by nobody, the denial included');
  assert.ok(!page.metaEvents().includes('CookieConsentDeny'));
  assert.strictEqual(page.metaEvents().pop(), 'CookieConsentAccept', 'and no second accept was counted on the way out');
});

test('the locked Necessary switch cannot be pressed into an answer', async () => {
  const page = await boot();

  page.find('omega-consent__customize').click();
  page.checkbox('omega-consent-necessary').click();

  assert.strictEqual(page.checkbox('omega-consent-necessary').checked, true, 'it stays on');
  assert.strictEqual(page.storage.trackingConsent, undefined, 'and pressing it never wrote an answer');
});

test('Accept all flips every switch, saves, and collapses to the tab', async () => {
  const page = await boot();

  page.find('omega-consent__customize').click();
  page.find('omega-consent__accept-all').click();

  assert.strictEqual(page.checkbox('omega-consent-analytics').checked, true, 'the switches match what was pressed');
  assert.strictEqual(page.checkbox('omega-consent-marketing').checked, true);
  assert.strictEqual(page.storage.trackingConsent.analytics, true);
  assert.strictEqual(page.storage.trackingConsent.marketing, true);
  assert.strictEqual(page.events().pop(), 'cookie_consent_accept');

  await settle();
  assert.strictEqual(page.banner(), undefined, 'the panel leaves');
  assert.ok(page.tab(), 'and the tab takes its place');
});

test('Accept none is the same one click, in the other direction', async () => {
  // The refusal is never a longer path than the grant — the EU equal-ease rule,
  // and the reason the pair sits side by side.
  const page = await boot({ timeZone: 'America/New_York' });

  page.tab().click();
  page.find('omega-consent__customize').click();

  assert.strictEqual(page.checkbox('omega-consent-analytics').checked, true, 'an opt-out region opens already granted');
  assert.strictEqual(page.checkbox('omega-consent-marketing').checked, true);

  page.find('omega-consent__accept-none').click();

  assert.strictEqual(page.checkbox('omega-consent-analytics').checked, false, 'every switch flips to match');
  assert.strictEqual(page.checkbox('omega-consent-marketing').checked, false);
  assert.strictEqual(page.storage.trackingConsent.analytics, false);
  assert.strictEqual(page.storage.trackingConsent.marketing, false);
  // A refusal is a deny whatever button carried it — and a deny reaches nobody,
  // because it is fired after the record that blocks it (#328).
  assert.ok(!page.events().includes('cookie_consent_accept'), 'Accept none never counts as an accept');
  assert.ok(!page.metaEvents().includes('CookieConsentAccept'));
  assert.deepStrictEqual(page.metaEvents(), ['CookiePolicyReopen'], 'the reopen that started this is the only thing counted');

  await settle();
  assert.ok(page.tab(), 'a refusal settles the banner exactly like a grant does');
});

test('a settled visitor gets the tab, and reopening it asks again', async () => {
  const storage = {
    trackingConsent: { analytics: true, marketing: true, region: 'opt-out', timestamp: '2026-08-19T00:00:00.000Z', version: 1 },
  };

  const page = await boot({ timeZone: 'America/New_York', storage });

  assert.strictEqual(page.banner(), undefined, 'an answered visitor is not asked again');
  const tab = page.tab();
  assert.ok(tab, 'the policy tab is the way back in');
  assert.strictEqual(tab.getAttribute('aria-label'), 'Cookies Settings');

  tab.click();

  assert.ok(page.banner(), 'the panel comes back');
  assert.strictEqual(page.tab(), undefined, 'and the tab steps aside');
  assert.strictEqual(storage.trackingConsent, undefined, 'the old answer is cleared — this is a fresh question');
  assert.ok(page.events().includes('cookie_policy_reopen'));
  assert.ok(!page.events().includes('cookie_banner_show'), 'a reopen is counted as a reopen, never as a second impression');
});

test('an opt-in visitor who has answered is not asked again either', async () => {
  const storage = {
    trackingConsent: { analytics: false, marketing: false, region: 'opt-in', timestamp: '2026-08-19T00:00:00.000Z', version: 1 },
  };

  const page = await boot({ storage });

  assert.strictEqual(page.banner(), undefined, 'the stored decision wins over the region');
  assert.ok(page.tab(), 'and the tab is the way back in');
});

test('the message links the terms page instead of naming it', async () => {
  const page = await boot();

  assert.ok(
    page.find('omega-consent__message').innerHTML.includes('href="/terms"'),
    'the {terms} placeholder becomes a real link',
  );
});
