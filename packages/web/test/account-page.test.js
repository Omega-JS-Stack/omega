/**
 * The account page's ADDRESS fields
 * ([#663](https://github.com/Omega-JS-Stack/omega/issues/663)).
 *
 * Every server conversion sends every match key the account holds, and the two
 * the ad platforms wanted most — the postal code and the street — had no home:
 * not in the schema, not on the page. They are optional inputs in the location
 * block now, and the page's promise is a round trip: what a user typed is what
 * the form hands back the next time the page loads.
 *
 * Which is where the real regression lives. The profile section's `loadData()`
 * builds the form payload FIELD BY FIELD, so an input the page ships and that
 * literal does not name is written once and never seen again. The markup half
 * reads the layout; the load half runs the REAL section over a FormManager stub,
 * the harness account-orders.test.js uses.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const SECTIONS_DIR = path.join(CORE_DIR, 'js', 'pages', 'dashboard', 'account', 'sections');
const ACCOUNT_LAYOUT = path.join(__dirname, '..', 'themes', 'base', '_layouts', 'frontend', 'pages', 'account', 'index.html');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-account-page-'));
const BUNDLE = path.join(BUNDLE_DIR, 'profile.cjs');

let building = null;

// The profile section, bundled the way the page bundle imports it — with the
// client and its FormManager stubbed, because neither exists off a page.
function bundleOnce() {
  building ||= esbuild.build({
    stdin: {
      contents: `export * as profile from './profile.js';`,
      resolveDir: SECTIONS_DIR,
      loader: 'js',
    },
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
        // The profile form's manager: it keeps the payload the section sets, which
        // is the only way to see which fields the page is loaded with.
        build.onResolve({ filter: /^@omega\.js\/client\/modules\/form-manager\.js$/ }, () => {
          return { path: 'form-manager', namespace: 'omega-form-manager-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-form-manager-stub' }, () => {
          return {
            contents: [
              'export class FormManager {',
              '  constructor() { globalThis.__profileForm = this; }',
              '  on(name, handler) { if (name === \'submit\') { this.submit = handler; } }',
              '  setData(data) { this.data = data; }',
              '  ready() { this.isReady = true; }',
              '  showSuccess(message) { this.success = message; }',
              '}',
            ].join('\n'),
          };
        });
      },
    }],
  });

  return building;
}

/** The attributes of the one input the layout names `name`. */
function inputNamed(markup, name) {
  const tag = markup.match(new RegExp(`<input[^>]*name="${name.replace(/\./g, '\\.')}"[^>]*>`));

  return tag ? tag[0] : null;
}

test('#663: the location block ships an optional street and postal code', () => {
  const markup = fs.readFileSync(ACCOUNT_LAYOUT, 'utf8');

  const street = inputNamed(markup, 'personal.location.street');
  assert.ok(street, 'the street input is on the page');
  assert.match(street, /id="street-input"/, 'the id the label points at');
  assert.match(street, /autocomplete="street-address"/, 'the browser can fill it');
  assert.match(street, /placeholder="Street address"/);

  const postalCode = inputNamed(markup, 'personal.location.postalCode');
  assert.ok(postalCode, 'the postal code input is on the page');
  assert.match(postalCode, /id="postal-code-input"/);
  assert.match(postalCode, /autocomplete="postal-code"/);
  assert.match(postalCode, /placeholder="Postal code"/);

  // The schema's name is the international one, never the US-only `zip` the ad
  // platforms call their parameter.
  assert.equal(inputNamed(markup, 'personal.location.zip'), null, 'no zip field anywhere');

  for (const id of ['street-input', 'postal-code-input']) {
    assert.ok(markup.includes(`for="${id}"`), `the ${id} carries a label of its own`);
  }
});

test('#663: the saved address is loaded back into the form', async () => {
  await bundleOnce();

  globalThis.window = { location: { href: 'https://example.com/dashboard/account', origin: 'https://example.com', search: '', hash: '#profile' } };
  globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  globalThis.__omegaClient = globalThis.__omegaClient || {};

  delete require.cache[require.resolve(BUNDLE)];
  const { profile } = require(BUNDLE);

  profile.init();
  profile.loadData({
    auth: { uid: 'uid-1', email: 'buyer@example.com' },
    personal: { location: { country: 'US', region: 'California', city: 'San Diego', postalCode: '90210', street: '123 Main Street' } },
  }, { uid: 'uid-1', email: 'buyer@example.com' });

  const location = globalThis.__profileForm.data.personal.location;

  assert.equal(location.street, '123 Main Street', 'the street comes back into its input');
  assert.equal(location.postalCode, '90210', 'and so does the postal code');
  assert.equal(location.city, 'San Diego', 'the fields that already loaded still do');
});
