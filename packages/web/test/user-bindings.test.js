/**
 * The account's ONE bindings root is `auth.user`, a live `User` from
 * @omega.js/account ([#945](https://github.com/Omega-JS-Stack/omega/issues/945)).
 * A User is always truthy, so "signed in" is `auth.user.authenticated`, and the
 * sign-in identity lives on `auth.user.profile`.
 *
 * These pins run the REAL built markup through the REAL client bindings over a
 * real User: the account page shows the profile's name and avatar, the app
 * sidebar keeps its signed-in block hidden for the signed-out User, and the
 * first-paint script in core/_includes/core/foot.html reads the STORED User
 * document and matches the exact binding strings the nav ships. Node has no
 * DOM, so the bound elements are parsed out of the page into the minimum
 * surface the bindings module touches.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const expect = require('@omega.js/devkit/test/expect');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const { User } = require('@omega.js/account');

const { buildWith, buildSite, miniData } = require('./lib/build.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-user-bindings-'));
const BUNDLE = path.join(BUNDLE_DIR, 'bindings.cjs');
const SELECTOR_FIXTURE = path.join(__dirname, 'fixtures', 'selector-site');

const SIGNED_IN = () => new User({}, {
  uid: 'u1',
  email: 'ada@brand.test',
  displayName: 'Ada Lovelace',
  photoURL: 'https://img.brand.test/ada.png',
});

let bundling = null;

// The client's REAL bindings module, bundled to CommonJS for node
function bindingsModule() {
  bundling ||= esbuild.build({
    entryPoints: [require.resolve('@omega.js/client/modules/bindings.js')],
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
  }).then(() => require(BUNDLE).default);

  return bundling;
}

let pagesBuilding = null;

// The mini site, built once for every page this suite reads
function miniPages() {
  pagesBuilding ||= buildWith(miniData, {}, 'user-bindings-test');

  return pagesBuilding;
}

/** One bound element: the attributes it opened with, and what the bindings write. */
class BoundElement {
  constructor(attributes) {
    this.attributes = attributes;
    this.textContent = '';
    this.classList = { add: () => {}, remove: () => {} };
    this.style = { setProperty: () => {}, removeProperty: () => {} };
  }

  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  get hidden() {
    return 'hidden' in this.attributes;
  }
}

/** Every element in `html` that carries a data-omega-bind, in document order. */
function boundElements(html) {
  const elements = [];

  for (const [, attributeText] of html.matchAll(/<[a-zA-Z][\w-]*(\s[^>]*data-omega-bind="[^"]*"[^>]*)>/g)) {
    const attributes = {};

    for (const [, name, value] of attributeText.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) {
      attributes[name] = value === undefined ? '' : value;
    }

    elements.push(new BoundElement(attributes));
  }

  return elements;
}

/** Run the real bindings over `html` with `auth.user` set to `user`; hand back the elements. */
async function bind(html, user) {
  const Bindings = await bindingsModule();
  const elements = boundElements(html);

  globalThis.document = { querySelectorAll: () => elements };
  new Bindings({}).update({ auth: { user } });
  delete globalThis.document;

  return elements;
}

/** The first element bound with exactly `binding`. */
function boundWith(elements, binding) {
  const element = elements.find((candidate) => candidate.attributes['data-omega-bind'] === binding);
  expect(element, `the page carries an element bound with "${binding}"`).toBeTruthy();

  return element;
}

/**
 * Run the built page's first-paint nav script over its own nav, with `stored`
 * as the client's `_manager` storage blob. Hands back the two nav elements.
 */
function runFirstPaint(page, stored) {
  const start = page.indexOf('<!-- Script to quickly handle nav user state -->');
  expect(start > -1, 'the page carries the first-paint nav script').toBeTruthy();
  const source = page.slice(page.indexOf('<script', start), page.indexOf('</script>', start));
  const script = source.slice(source.indexOf('>') + 1);

  const elements = boundElements(page);

  vm.runInNewContext(script, {
    localStorage: { getItem: (key) => (key === '_manager' ? JSON.stringify(stored) : null) },
    document: { querySelectorAll: () => elements },
    console,
  });

  return {
    signedInOnly: boundWith(elements, '@show auth.user.authenticated'),
    signedOutOnly: boundWith(elements, '@hide auth.user.authenticated'),
  };
}

module.exports = defineCases({
  type: 'group',
  description: 'user-bindings',
  tests: [
    {
      name: '#945: the account page shows the User\'s profile name and avatar',
      run: async (ctx) => {
        const pages = await miniPages();
        const page = pages.get('/dashboard/account');
        ctx.expect(page, 'account page built').toBeTruthy();

        // The profile card's own markup: the nav's account dropdown binds the same paths
        const opens = page.indexOf('<form id="profile-form"');
        ctx.expect(opens > -1, 'the profile form rendered').toBeTruthy();
        const profile = page.slice(opens, page.indexOf('</form>', opens));

        const elements = await bind(profile, SIGNED_IN());

        ctx.expect(boundWith(elements, '@text auth.user.profile.displayName').textContent).toBe('Ada Lovelace');
        ctx.expect(boundWith(elements, '@attr src auth.user.profile.photoURL').getAttribute('src')).toBe('https://img.brand.test/ada.png');
      },
    },

    {
      name: '#945: the app sidebar hides its signed-in block for the signed-out User',
      run: async (ctx) => {
        const selectorData = JSON.parse(fs.readFileSync(path.join(SELECTOR_FIXTURE, 'site-data.json'), 'utf8'));
        const pages = await buildSite(SELECTOR_FIXTURE, selectorData, {}, 'user-bindings-sidebar');
        const app = pages.get('/app');
        ctx.expect(app, 'app surface built').toBeTruthy();

        const opens = app.indexOf('<aside class="omega-shell__sidebar"');
        const sidebar = app.slice(opens, app.indexOf('</aside>', opens));

        const signedOut = await bind(sidebar, new User());
        ctx.expect(boundWith(signedOut, '@show auth.user.authenticated').hidden, 'a User is always truthy: only `authenticated` says signed in').toBe(true);

        const signedIn = await bind(sidebar, SIGNED_IN());
        ctx.expect(boundWith(signedIn, '@show auth.user.authenticated').hidden, 'the signed-in block shows for a signed-in User').toBe(false);
        ctx.expect(boundWith(signedIn, '@text auth.user.profile.displayName').textContent).toBe('Ada Lovelace');
      },
    },

    {
      name: '#945: the first-paint nav script reads the stored User and flips the nav before boot',
      run: async (ctx) => {
        const pages = await miniPages();
        const page = pages.get('/');
        ctx.expect(page, 'home page built').toBeTruthy();

        // The client stores its auth state as-is, and a User serializes to its document
        const signedIn = runFirstPaint(page, { auth: { user: SIGNED_IN(), denied: false } });
        ctx.expect(signedIn.signedInOnly.hidden, 'the account dropdown shows for a stored signed-in User').toBe(false);
        ctx.expect(signedIn.signedOutOnly.hidden, 'and the sign-up button hides').toBe(true);

        const signedOut = runFirstPaint(page, { auth: { user: new User(), denied: false } });
        ctx.expect(signedOut.signedInOnly.hidden, 'a stored signed-out User leaves the dropdown hidden').toBe(true);
        ctx.expect(signedOut.signedOutOnly.hidden, 'and the sign-up button showing').toBe(false);
      },
    },
  ],
});
