/**
 * The dev palette (`core/js/core/dev-palette.js`) — the DEV pull-tab's panel:
 * the persona switcher it offers, and the reset-to-seed control (#215) that
 * puts the account you are signed in as back to its seeded shape.
 *
 * The module is browser code behind the `@omega.js/client` bundler alias, so
 * the harness drives the REAL file through esbuild with the client stubbed —
 * the convention auth-policy.test.js set — over a hand-rolled document that is
 * only what the palette touches (node has no DOM and web pulls in no jsdom).
 * The assertion is the rendered panel: which buttons exist, and what a click
 * on the reset control actually does.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const PALETTE_ENTRY = path.join(__dirname, '..', 'core', 'js', 'core', 'dev-palette.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-dev-palette-'));
const BUNDLE = path.join(BUNDLE_DIR, 'dev-palette.cjs');

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [PALETTE_ENTRY],
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    plugins: [{
      name: 'harness-aliases',
      setup(build) {
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

/** The minimum element the palette builds with: children, text, listeners. */
function makeElement(tagName) {
  const element = {
    tagName,
    children: [],
    className: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    dataset: {},
    style: {},
    attributes: {},
    listeners: {},
    append: (...nodes) => element.children.push(...nodes),
    appendChild: (node) => { element.children.push(node); return node; },
    setAttribute: (name, value) => { element.attributes[name] = value; },
    addEventListener: (type, handler) => { (element.listeners[type] ||= []).push(handler); },
    click: () => Promise.all((element.listeners.click || []).map((handler) => handler())),
  };

  return element;
}

/** Every element in the tree, depth-first — the panel as a flat list. */
function flatten(node) {
  return (node.children || []).flatMap((child) => [child, ...flatten(child)]);
}

/** The minimum document the palette mounts into. */
function makeDocument() {
  const doc = {
    head: makeElement('head'),
    body: makeElement('body'),
    createElement: (tagName) => makeElement(tagName),
    querySelector: () => null,
    addEventListener: () => {},
  };

  return doc;
}

/** The minimum client the palette reaches for, plus the captured calls. */
function makeClient() {
  const signIns = [];
  const requests = [];
  const listeners = [];

  const client = {
    signIns,
    requests,
    listeners,
    user: null,
    config: { brand: { url: 'https://playground.omegajs.dev' } },
    auth: () => ({
      listen: (options, handler) => listeners.push(handler),
      getUser: () => client.user,
      signInWithEmailAndPassword: async (email, password) => { signIns.push({ email, password }); },
    }),
    request: async (url, options) => { requests.push({ url, options }); return {}; },
  };

  return client;
}

/** Boot the real palette against one stub client + document; hand back the seams. */
async function boot() {
  await bundleOnce();

  const doc = makeDocument();
  const client = makeClient();
  const reloads = [];

  globalThis.document = doc;
  globalThis.window = {
    location: {
      hostname: 'localhost',
      reload: () => reloads.push(true),
    },
  };
  globalThis.__omegaClient = client;

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  require(BUNDLE).default();

  const elements = flatten(doc.body);
  const buttons = elements.filter((element) => element.tagName === 'button');

  return {
    client,
    reloads,
    buttons,
    button: (label) => buttons.find((candidate) => candidate.textContent === label),
    // The auth readout the palette registered — the panel's live state.
    signedInAs: (email) => {
      client.user = email ? { email } : null;
      client.listeners[0]();
    },
  };
}

test('dev palette: the four billing-journey personas are offered beside the lifecycle ones', async () => {
  const { button } = await boot();

  const journeys = [
    ['Journey: Upgrade', '_test.journey-flows-upgrade'],
    ['Journey: Cancel', '_test.journey-flows-cancel'],
    ['Journey: Failure', '_test.journey-flows-failure'],
    ['Journey: Trial', '_test.journey-flows-trial'],
  ];

  for (const [label, localpart] of journeys) {
    const persona = button(label);
    assert.ok(persona, `the palette should offer a "${label}" persona`);
    assert.strictEqual(
      persona.title,
      `${localpart}@playground.omegajs.dev`,
      'the persona should sign in as its seeded email on the brand domain',
    );
  }

  // The lifecycle personas the journeys joined, not replaced.
  assert.ok(button('Premium'), 'the existing personas should still be offered');
});

test('dev palette: the reset control shows for a seeded persona and hides for anybody else', async () => {
  const { button, signedInAs } = await boot();

  const reset = button('Reset to seed');
  assert.ok(reset, 'the palette should carry one reset control');
  assert.strictEqual(reset.hidden, true, 'it should be hidden until the auth state is known');

  signedInAs('_test.journey-flows-cancel@playground.omegajs.dev');
  assert.strictEqual(reset.hidden, false, 'a signed-in persona can be reset');

  signedInAs('someone@playground.omegajs.dev');
  assert.strictEqual(reset.hidden, true, 'a real account is never resettable');

  signedInAs(null);
  assert.strictEqual(reset.hidden, true, 'signed out, there is nothing to reset');
});

test('dev palette: resetting posts the dev route, signs the persona back in, and reloads', async () => {
  const { button, client, reloads, signedInAs } = await boot();

  signedInAs('_test.journey-flows-cancel@playground.omegajs.dev');
  await button('Reset to seed').click();

  assert.deepStrictEqual(
    client.requests,
    [{ url: '/omega/test/reset-account', options: { method: 'POST' } }],
    'the control should post the dev reset route for the signed-in account',
  );
  assert.deepStrictEqual(
    client.signIns,
    [{ email: '_test.journey-flows-cancel@playground.omegajs.dev', password: 'omega-test-password' }],
    'the reset recreates the auth user, so the same persona must be signed back in',
  );
  assert.deepStrictEqual(reloads, [true], 'the page should reload onto the seeded state');
});
