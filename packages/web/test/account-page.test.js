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
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { User } = require('@omega.js/account');

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
        build.onResolve({ filter: /^@omega\.js\/web\/runtime$/ }, () => {
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

module.exports = defineCases({
  type: 'group',
  description: 'account-page',
  tests: [
    {
      name: '#663: the location block ships an optional street and postal code',
      run: (ctx) => {
        const markup = fs.readFileSync(ACCOUNT_LAYOUT, 'utf8');

        const street = inputNamed(markup, 'personal.location.street');
        ctx.expect(street, 'the street input is on the page').toBeTruthy();
        ctx.expect(street, 'the id the label points at').toMatch(/id="street-input"/);
        ctx.expect(street, 'the browser can fill it').toMatch(/autocomplete="street-address"/);
        ctx.expect(street).toMatch(/placeholder="Street address"/);

        const postalCode = inputNamed(markup, 'personal.location.postalCode');
        ctx.expect(postalCode, 'the postal code input is on the page').toBeTruthy();
        ctx.expect(postalCode).toMatch(/id="postal-code-input"/);
        ctx.expect(postalCode).toMatch(/autocomplete="postal-code"/);
        ctx.expect(postalCode).toMatch(/placeholder="Postal code"/);

        // The schema's name is the international one, never the US-only `zip` the ad
        // platforms call their parameter.
        ctx.expect(inputNamed(markup, 'personal.location.zip'), 'no zip field anywhere').toBe(null);

        for (const id of ['street-input', 'postal-code-input']) {
          ctx.expect(markup.includes(`for="${id}"`), `the ${id} carries a label of its own`).toBeTruthy();
        }
      },
    },

    {
      name: '#663: the saved address is loaded back into the form',
      run: async (ctx) => {
        await bundleOnce();

        globalThis.window = { location: { href: 'https://example.com/dashboard/account', origin: 'https://example.com', search: '', hash: '#profile' } };
        globalThis.document = {
          getElementById: () => null,
          querySelector: () => null,
          querySelectorAll: () => [],
          addEventListener: () => {},
        };
        // The join date reads the Firebase session's own metadata; none here
        globalThis.__omegaClient = { firebaseAuth: { currentUser: null } };

        delete require.cache[require.resolve(BUNDLE)];
        const { profile } = require(BUNDLE);

        profile.init();
        profile.loadData(new User({
          personal: { location: { country: 'US', region: 'California', city: 'San Diego', postalCode: '90210', street: '123 Main Street' } },
        }, { uid: 'uid-1', email: 'buyer@example.com' }));

        const location = globalThis.__profileForm.data.personal.location;

        ctx.expect(location.street, 'the street comes back into its input').toBe('123 Main Street');
        ctx.expect(location.postalCode, 'and so does the postal code').toBe('90210');
        ctx.expect(location.city, 'the fields that already loaded still do').toBe('San Diego');
      },
    },

    {
      name: 'a profile save reloads the signed-in user once, after the write resolves',
      run: async (ctx) => {
        await bundleOnce();

        const order = [];
        let finishWrite;
        const write = new Promise((resolve) => { finishWrite = resolve; });

        globalThis.window = { location: { href: 'https://example.com/dashboard/account', origin: 'https://example.com', search: '', hash: '#profile' } };
        globalThis.document = {
          getElementById: () => null,
          querySelector: () => null,
          querySelectorAll: () => [],
          addEventListener: () => {},
        };
        // The write is held open, so the reload's place after it shows.
        globalThis.__omegaClient = {
          firebaseAuth: { currentUser: null },
          auth: {
            user: { uid: 'uid-1' },
            reload: async () => { order.push('reload'); },
          },
          firestore: {
            doc: () => ({
              set: async () => {
                order.push('write');
                await write;
                order.push('written');
              },
            }),
          },
        };

        delete require.cache[require.resolve(BUNDLE)];
        const { profile } = require(BUNDLE);

        profile.init();
        const saving = globalThis.__profileForm.submit({ data: { personal: { name: { first: 'Ada', last: 'Lovelace' } } } });

        await new Promise((resolve) => setImmediate(resolve));
        ctx.expect(order, 'nothing reloads while the write is in flight').toEqual(['write']);

        finishWrite();
        await saving;

        ctx.expect(order, 'the user is re-read exactly once, after the write lands').toEqual(['write', 'written', 'reload']);
      },
    },
  ],
});
