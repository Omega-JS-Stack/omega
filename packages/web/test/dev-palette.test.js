/**
 * The dev palette (`core/js/core/dev-palette.js`) — the DEV pull-tab's panel:
 * the persona dropdown it offers, the reset-to-seed control (#215) that puts
 * the account you are signed in as back to its seeded shape, and the
 * page-scoped section seam (#234, `core/js/core/dev-sections.js`) that lets a
 * page module hand the palette its own controls. What a page owns lives with
 * the page: the checkout's decline toggle is checkout-dev-section.test.js.
 *
 * The module is browser code behind the `@omega.js/client` bundler alias, so
 * the harness drives the REAL file through esbuild with the client stubbed —
 * the convention auth-policy.test.js set — over a hand-rolled document that is
 * only what the palette touches (node has no DOM and web pulls in no jsdom).
 * The assertion is the rendered panel: which controls exist, and what using
 * one actually does.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { get: _get, set: _set } = require('lodash');

const CORE_DIR = path.join(__dirname, '..', 'core');
const PALETTE_DIR = path.join(CORE_DIR, 'js', 'core');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-dev-palette-'));
const BUNDLE = path.join(BUNDLE_DIR, 'dev-palette.cjs');

let building = null;

// One entry exposing the palette AND the registry it reads, so a test
// registers into the SAME module instance the panel renders from — which is
// what esbuild's `splitting: true` guarantees in a real build (the registry
// lands in the shared chunk both the palette and a page bundle import).
function bundleOnce() {
  building ||= esbuild.build({
    stdin: {
      contents: [
        `export { default } from './dev-palette.js';`,
        `export { registerDevSection } from './dev-sections.js';`,
      ].join('\n'),
      resolveDir: PALETTE_DIR,
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
    // Selects and inputs are read by `.value`; the palette's own controls
    // always seed it explicitly, so an unset field reads empty here just as a
    // browser reads its first option.
    value: '',
    dataset: {},
    style: {},
    attributes: {},
    listeners: {},
    append: (...nodes) => element.children.push(...nodes),
    appendChild: (node) => { element.children.push(node); return node; },
    setAttribute: (name, value) => { element.attributes[name] = value; },
    getAttribute: (name) => (name in element.attributes ? element.attributes[name] : null),
    addEventListener: (type, handler) => { (element.listeners[type] ||= []).push(handler); },
    click: () => Promise.all((element.listeners.click || []).map((handler) => handler())),
    change: () => Promise.all((element.listeners.change || []).map((handler) => handler())),
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
function makeClient(storage) {
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
    // Lodash-pathed exactly like the real one (@omega.js/client's Storage), so
    // a nested path behaves as it does in a browser.
    storage: () => ({
      get: (keyPath, defaultValue) => _get(storage, keyPath, defaultValue),
      set: (keyPath, value) => _set(storage, keyPath, value),
      remove: (keyPath) => _set(storage, keyPath, undefined),
    }),
    request: async (url, options) => { requests.push({ url, options }); return {}; },
  };

  return client;
}

/** Boot the real palette against one stub client + document; hand back the seams. */
async function boot(storage = {}, { pathname = '/' } = {}) {
  await bundleOnce();

  const doc = makeDocument();
  const client = makeClient(storage);
  const reloads = [];

  globalThis.document = doc;
  globalThis.window = {
    location: {
      hostname: 'localhost',
      pathname,
      search: '',
      reload: () => reloads.push(true),
    },
  };
  globalThis.__omegaClient = client;

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var). Re-requiring also gives
  // each boot a FRESH section registry, so tests never leak into each other.
  delete require.cache[require.resolve(BUNDLE)];
  const bundle = require(BUNDLE);
  bundle.default();

  // The panel grows when a registered section renders, so every lookup walks
  // the tree at call time rather than closing over a boot-time snapshot.
  const all = () => flatten(doc.body);
  const buttons = () => all().filter((element) => element.tagName === 'button');
  const tab = doc.body.children.find((element) => element.className === 'omega-devbar-tab');

  return {
    client,
    reloads,
    storage,
    // Registration happens AFTER boot on purpose: a page module loads on its
    // own schedule, and the palette must still pick it up.
    register: bundle.registerDevSection,
    buttons,
    button: (label) => buttons().find((candidate) => candidate.textContent === label),
    // The persona dropdown — the palette's own select, built before any
    // registered section, so the first one in the tree is always it.
    personas: () => all().find((candidate) => candidate.tagName === 'select'),
    checkbox: (id) => all().find((candidate) => candidate.tagName === 'input' && candidate.id === id),
    // Every section heading the panel shows, in order.
    labels: () => all().filter((element) => element.className === 'omega-devbar__label').map((element) => element.textContent),
    // Opening the panel is the moment a one-shot control re-reads its flag and
    // a registered section gets rendered.
    open: () => tab.click(),
    // The auth readout the palette registered — the panel's live state.
    signedInAs: (email) => {
      client.user = email ? { email } : null;
      client.listeners[0]();
    },
  };
}

test('dev palette: the four billing-journey personas are offered beside the lifecycle ones', async () => {
  const { personas } = await boot();

  const options = personas().children;
  const option = (label) => options.find((candidate) => candidate.textContent === label);

  const journeys = [
    ['Journey: Upgrade', '_test.journey-flows-upgrade'],
    ['Journey: Cancel', '_test.journey-flows-cancel'],
    ['Journey: Failure', '_test.journey-flows-failure'],
    ['Journey: Trial', '_test.journey-flows-trial'],
  ];

  for (const [label, localpart] of journeys) {
    const persona = option(label);
    assert.ok(persona, `the palette should offer a "${label}" persona`);
    assert.strictEqual(persona.value, localpart, 'the option carries the persona it signs in as');
    assert.strictEqual(
      persona.title,
      `${localpart}@playground.omegajs.dev`,
      'the persona should sign in as its seeded email on the brand domain',
    );
  }

  // The lifecycle personas the journeys joined, not replaced.
  assert.ok(option('Premium'), 'the existing personas should still be offered');

  // The list opens on a placeholder, not on whichever persona happens to be
  // first — picking one has to be a deliberate choice.
  const [first] = options;
  assert.strictEqual(first.value, '', 'the first option is a placeholder');
  assert.strictEqual(first.disabled, true, 'and it is not selectable');
  assert.strictEqual(options.length, 12, 'one placeholder plus the eleven personas');
});

test('dev palette: choosing a persona signs it in and reloads', async () => {
  const { personas, client, reloads } = await boot();

  const dropdown = personas();
  dropdown.value = '_test.journey-flows-trial';
  await dropdown.change();

  assert.deepStrictEqual(
    client.signIns,
    [{ email: '_test.journey-flows-trial@playground.omegajs.dev', password: 'omega-test-password' }],
    'the chosen persona should be signed in with the shared test password',
  );
  assert.deepStrictEqual(reloads, [true], 'and the page reloads as that persona');
});

test('dev palette: the placeholder does nothing, and a failed switch stays usable', async () => {
  const { personas, client, reloads } = await boot();

  const dropdown = personas();
  await dropdown.change();
  assert.deepStrictEqual(client.signIns, [], 'landing back on the placeholder is not a sign-in');

  client.auth = () => ({
    listen: () => {},
    getUser: () => null,
    signInWithEmailAndPassword: async () => { throw new Error('auth/network-request-failed'); },
  });
  dropdown.value = '_test.basic';
  await dropdown.change();

  assert.deepStrictEqual(reloads, [], 'a failed switch must not reload');
  assert.strictEqual(dropdown.dataset.busy, 'false', 'and the dropdown is usable again');
});

test('dev palette: the dropdown shows the persona you are signed in as', async () => {
  const { personas, signedInAs } = await boot();

  const dropdown = personas();
  assert.strictEqual(dropdown.value, '', 'signed out, it sits on the placeholder');
  // The stub's value defaults to '' either way — the explicit `selected` is the
  // assertable half: a real browser skips a disabled option at initial
  // selection and would land on the first persona without it.
  assert.strictEqual(dropdown.children[0].selected, true, 'the placeholder is explicitly selected');

  signedInAs('_test.premium-active@playground.omegajs.dev');
  assert.strictEqual(dropdown.value, '_test.premium-active', 'a persona preselects itself');

  signedInAs('someone@playground.omegajs.dev');
  assert.strictEqual(dropdown.value, '', 'a real account is nobody in the list');
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

test('dev palette: the checkout controls are not built in — they belong to the checkout page', async () => {
  // A built-in renders on EVERY page, which is what put "Decline next checkout"
  // in front of somebody reading the blog. It is a registered section now
  // (modules/dev-section.js), so it comes with the page or not at all.
  const { checkbox, labels, open } = await boot();

  await open();

  assert.strictEqual(checkbox('omega-devbar-decline'), undefined, 'no decline toggle on a page that is not the checkout');
  assert.ok(!labels().includes('Checkout'), 'and no empty Checkout heading either');
});

test('#234: a registered section renders on open, not before', async () => {
  const { register, button, open } = await boot();

  let built = 0;
  register('fixture', {
    title: 'Fixture',
    buildNode: (doc) => {
      built += 1;
      const node = doc.createElement('button');
      node.textContent = 'Fixture control';
      return node;
    },
  });

  assert.strictEqual(built, 0, 'registering must not build anything — the palette may already be on screen');
  assert.strictEqual(button('Fixture control'), undefined, 'and nothing is in the panel yet');

  await open();

  assert.strictEqual(built, 1, 'opening the panel is what builds the section');
  assert.ok(button('Fixture control'), 'the registered control is in the panel');
});

test('#234: a section whose page condition fails never renders', async () => {
  const { register, button, labels, open } = await boot({}, { pathname: '/pricing' });

  register('fixture', {
    title: 'Fixture',
    appliesTo: () => window.location.pathname.startsWith('/payment/checkout'),
    buildNode: (doc) => {
      const node = doc.createElement('button');
      node.textContent = 'Fixture control';
      return node;
    },
  });

  await open();

  assert.strictEqual(button('Fixture control'), undefined, 'a section scoped to another page stays off this one');
  assert.ok(!labels().includes('Fixture'), 'and it leaves no empty heading behind');
});

test('#234: a section reusing a built-in id merges into it instead of repeating the heading', async () => {
  const { register, button, labels, open } = await boot();

  register('links', {
    title: 'Go to',
    buildNode: (doc) => {
      const node = doc.createElement('button');
      node.textContent = 'Page link';
      return node;
    },
  });

  await open();

  // A section that landed in the extras instead would carry its own heading,
  // so the built-in's would be the second one.
  const headings = labels().filter((label) => label === 'Go to');
  assert.strictEqual(headings.length, 1, 'one "Go to" heading, not two');
  assert.ok(button('Page link'), 'the registered control is rendered');
});

test('#234: reopening the panel does not stack a second copy of a section', async () => {
  const { register, buttons, open } = await boot();

  register('fixture', {
    title: 'Fixture',
    buildNode: (doc) => {
      const node = doc.createElement('button');
      node.textContent = 'Fixture control';
      return node;
    },
  });

  await open();
  await open();

  const copies = buttons().filter((element) => element.textContent === 'Fixture control');
  assert.strictEqual(copies.length, 1, 'rendering is idempotent — the panel opens as often as you like');
});

test('#234: a section without an id or a builder is a programmer error, loudly', async () => {
  const { register } = await boot();

  assert.throws(() => register('', { buildNode: () => {} }), /dev-sections/, 'an id is required');
  assert.throws(() => register('fixture', {}), /dev-sections/, 'so is a buildNode');
});
