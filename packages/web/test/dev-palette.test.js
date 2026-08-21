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

// What the emulator answers `/omega/test/roster` with (#400): the personas the
// SEED labels as human-facing, in the seeder's own order. A fixture, not a copy
// of the seed: the palette holds no list of its own any more, so what these
// tests pin is that it renders whatever the backend hands over. The real roster
// is pinned where it is owned (packages/backend test/routes/test/roster.test.js).
const ROSTER = [
  { localpart: '_test.premium-active', label: 'Premium' },
  { localpart: '_test.premium-trialing', label: 'Trialing' },
  { localpart: '_test.premium-expired', label: 'Expired' },
  { localpart: '_test.referrer', label: 'Referrer' },
  { localpart: '_test.referred', label: 'Referred' },
  { localpart: '_test.journey-flows-upgrade', label: 'Journey: Upgrade' },
  { localpart: '_test.journey-flows-cancel', label: 'Journey: Cancel' },
  { localpart: '_test.journey-flows-failure', label: 'Journey: Failure' },
  { localpart: '_test.journey-flows-trial', label: 'Journey: Trial' },
];

const ROSTER_URL = '/omega/test/roster';

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
    replaceChildren: (...nodes) => { element.children = nodes; },
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
function makeClient(storage, roster, signedInAtBoot) {
  const signIns = [];
  const requests = [];
  const listeners = [];

  // The real Storage writes through JSON.stringify, which DROPS a key whose
  // value is undefined. The round trip reproduces that in place, so the test's
  // own reference to the blob stays the object the palette is reading.
  const persist = () => {
    const kept = JSON.parse(JSON.stringify(storage));
    Object.keys(storage).forEach((key) => delete storage[key]);
    Object.assign(storage, kept);
  };

  const client = {
    signIns,
    requests,
    listeners,
    // The roster answer, MUTABLE: the retry loop (#402) asks again, and a test
    // that swaps this between attempts is an emulator finishing its boot.
    roster,
    user: signedInAtBoot ? { email: signedInAtBoot } : null,
    config: { brand: { url: 'https://playground.omegajs.dev' } },
    auth: () => ({
      // The real listener hands over the settled auth state the moment it is
      // registered. `signedInAtBoot` is that case, and it lands while the
      // roster fetch is still in flight.
      listen: (_options, handler) => {
        listeners.push(handler);

        if (signedInAtBoot) {
          handler();
        }
      },
      getUser: () => client.user,
      signInWithEmailAndPassword: async (email, password) => { signIns.push({ email, password }); },
    }),
    // Lodash-pathed exactly like the real one (@omega.js/client's Storage), so
    // a nested path behaves as it does in a browser: no path reads (or wipes)
    // the WHOLE blob, and every write persists through JSON — which is what
    // makes a key removed by setting it undefined actually leave the object.
    storage: () => ({
      get: (keyPath, defaultValue) => (keyPath ? _get(storage, keyPath, defaultValue) : storage),
      set: (keyPath, value) => { _set(storage, keyPath, value); persist(); },
      remove: (keyPath) => { _set(storage, keyPath, undefined); persist(); },
      clear: () => { Object.keys(storage).forEach((key) => delete storage[key]); },
    }),
    // The roster route answers the persona list the palette builds its dropdown
    // from; an emulator that is not up rejects, which is what `roster` carries
    // when it is an Error.
    request: async (url, options) => {
      requests.push({ url, options });

      if (url === ROSTER_URL) {
        if (client.roster instanceof Error) {
          throw client.roster;
        }

        return { personas: client.roster };
      }

      return {};
    },
  };

  return client;
}

/** Boot the real palette against one stub client + document; hand back the seams. */
async function boot(storage = {}, { pathname = '/', roster = ROSTER, signedInAtBoot = null } = {}) {
  await bundleOnce();

  const doc = makeDocument();
  const client = makeClient(storage, roster, signedInAtBoot);
  const reloads = [];
  const timers = [];

  globalThis.document = doc;
  globalThis.window = {
    location: {
      hostname: 'localhost',
      pathname,
      search: '',
      reload: () => reloads.push(true),
    },
    // The retry seam (#402): the palette schedules its next roster attempt
    // through window.setTimeout, which is the stub the harness already owns —
    // so a test decides when the retry runs instead of waiting out a real one.
    setTimeout: (handler, delay) => timers.push({ handler, delay }),
  };
  globalThis.__omegaClient = client;

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var). Re-requiring also gives
  // each boot a FRESH section registry, so tests never leak into each other.
  delete require.cache[require.resolve(BUNDLE)];
  const bundle = require(BUNDLE);
  bundle.default();

  // The palette builds the panel and THEN fetches its roster (#400), so every
  // test looks at the dropdown the emulator answered with rather than at the
  // half-second where it holds nothing but the placeholder.
  await new Promise((resolve) => setImmediate(resolve));

  // The panel grows when a registered section renders, so every lookup walks
  // the tree at call time rather than closing over a boot-time snapshot.
  const all = () => flatten(doc.body);
  const buttons = () => all().filter((element) => element.tagName === 'button');
  const tab = doc.body.children.find((element) => element.className === 'omega-devbar-tab');
  const panel = doc.body.children.find((element) => element.className === 'omega-devbar');

  return {
    client,
    reloads,
    storage,
    panel,
    // Every retry the palette has scheduled and not yet run.
    timers,
    // Run the scheduled retry and let its fetch settle, exactly as the boot
    // above lets the first attempt settle.
    retry: async () => {
      timers.shift().handler();
      await new Promise((resolve) => setImmediate(resolve));
    },
    // The "backend starting" indicator (#402) — present from boot, shown only
    // while the roster is unreachable.
    starting: () => all().find((element) => element.className === 'omega-devbar__starting'),
    // Registration happens AFTER boot on purpose: a page module loads on its
    // own schedule, and the palette must still pick it up.
    register: bundle.registerDevSection,
    buttons,
    button: (label) => buttons().find((candidate) => candidate.textContent === label),
    // The persona dropdown — the palette's own select, built before any
    // registered section, so the first one in the tree is always it.
    personas: () => all().find((candidate) => candidate.tagName === 'select'),
    // The storage target dropdown (#390) — found by its name, not its order.
    storageTarget: () => all().find((candidate) => candidate.tagName === 'select' && candidate.getAttribute('aria-label') === 'Storage target'),
    checkbox: (id) => all().find((candidate) => candidate.tagName === 'input' && candidate.id === id),
    // Every section heading the panel shows, in order.
    labels: () => all().filter((element) => element.className === 'omega-devbar__label').map((element) => element.textContent),
    // The "Signed in as" line: the panel's one readout, and where a failed
    // call reports itself.
    who: () => all().find((element) => element.className === 'omega-devbar__who'),
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

  // The referral pair (#363) is offered because the SEED labels it; that is
  // pinned where it is owned (packages/backend test/routes/test/roster.test.js).

  // The steady-state mid-trial persona (#301) sits among the lifecycle states,
  // between the plan it is trialing and the state a lapsed one lands in.
  const trialing = option('Trialing');
  assert.ok(trialing, 'the palette should offer the mid-trial persona');
  assert.strictEqual(trialing.value, '_test.premium-trialing', 'it signs in as the seeded trialing persona');
  assert.strictEqual(
    trialing.title,
    '_test.premium-trialing@playground.omegajs.dev',
    'on the brand domain like every other persona',
  );
  assert.strictEqual(options.indexOf(trialing), options.indexOf(option('Premium')) + 1, 'it follows Premium');
  assert.strictEqual(options.indexOf(option('Expired')), options.indexOf(trialing) + 1, 'and precedes Expired');

  // The list opens on a placeholder, not on whichever persona happens to be
  // first — picking one has to be a deliberate choice.
  const [first] = options;
  assert.strictEqual(first.value, '', 'the first option is a placeholder');
  assert.strictEqual(first.disabled, true, 'and it is not selectable');
  assert.strictEqual(options.length, ROSTER.length + 1, 'one placeholder plus every persona the roster named');
});

test('#400: the dropdown is the seed\'s roster, fetched, not a list the palette keeps', async () => {
  const { client, personas } = await boot();

  assert.deepStrictEqual(
    client.requests,
    [{ url: ROSTER_URL, options: { auth: false } }],
    'the palette asks the backend for the roster on build, unauthenticated, because nobody is signed in yet',
  );

  const options = personas().children.slice(1);

  assert.deepStrictEqual(
    options.map((option) => [option.value, option.textContent]),
    ROSTER.map((persona) => [persona.localpart, persona.label]),
    'every option is a persona the roster named, in the order it named them',
  );
  assert.deepStrictEqual(
    options.map((option) => option.title),
    ROSTER.map((persona) => `${persona.localpart}@playground.omegajs.dev`),
    'each one signs in as its seeded email on the brand domain',
  );

  // The palette holds no copy of the list: a roster of one is a dropdown of one.
  const { personas: shortlist } = await boot({}, { roster: [{ localpart: '_test.admin', label: 'Admin' }] });

  assert.deepStrictEqual(
    shortlist().children.map((option) => option.textContent),
    ['Switch account…', 'Admin'],
    'the dropdown offers exactly what the backend handed over',
  );
});

test('#400: a roster the emulator cannot answer leaves the placeholder alone and says why', async () => {
  const { personas, signedInAs, who } = await boot({}, { roster: new Error('Failed to fetch') });

  assert.deepStrictEqual(
    personas().children.map((option) => option.value),
    [''],
    'no fallback list: the placeholder stands on its own',
  );
  assert.strictEqual(
    who().textContent,
    'Checking auth…\n✕ Failed to fetch. Is the backend emulator running? (npm run emulator)',
    'and the who line carries the same failure every other control reports',
  );

  // Auth settles on its own schedule, and with no emulator up the fetch
  // rejects long before it does. The explanation has to SURVIVE that delivery:
  // it used to be overwritten by the identity line, so what a developer
  // actually saw was "Signed out" beside an empty dropdown and no reason.
  signedInAs(null);

  assert.strictEqual(
    who().textContent,
    'Signed out\n✕ Failed to fetch. Is the backend emulator running? (npm run emulator)',
    'the auth readout lands beside the failure, never on top of it',
  );
});

test('#400: signing in before the roster lands still preselects the persona', async () => {
  // The other order: auth settles while the fetch is in flight, so the options
  // the selection has to match do not exist yet. Filling the dropdown is what
  // resolves it, which is why appending the options syncs the selection again.
  const { personas, who } = await boot({}, { signedInAtBoot: '_test.referrer@playground.omegajs.dev' });

  assert.strictEqual(personas().value, '_test.referrer', 'the roster landing preselects the persona already signed in');
  assert.strictEqual(who().textContent, '_test.referrer@playground.omegajs.dev', 'and the readout is just the identity');
});

test('#402: an unreachable backend shows a starting indicator and schedules another attempt', async () => {
  const { panel, retry, starting, timers, who } = await boot({}, { roster: new Error('Failed to fetch') });

  const indicator = starting();
  assert.ok(indicator, 'the panel carries a starting indicator');
  assert.strictEqual(indicator.hidden, false, 'and it is on screen while the roster is unreachable');
  assert.strictEqual(panel.children.indexOf(indicator), 1, 'at the top of the panel, right under the DEV header row');
  assert.match(
    indicator.children.map((child) => child.textContent).join(''),
    /starting/i,
    'saying the backend is still coming up',
  );
  assert.ok(
    indicator.children.some((child) => child.className === 'omega-devbar__spinner'),
    'with a moving indicator beside the copy, never bare text (docs/shared/theming.md)',
  );

  // The explanation stays where every other failure reports itself: the loop
  // says the backend is starting, the who line says how to start it.
  assert.strictEqual(
    who().textContent,
    'Checking auth…\n✕ Failed to fetch. Is the backend emulator running? (npm run emulator)',
    'the who line keeps carrying the reason during the retry loop',
  );

  assert.strictEqual(timers.length, 1, 'one retry is scheduled, not a storm of them');
  assert.ok(timers[0].delay >= 1000, `the interval is gentle, not a busy loop (got ${timers[0].delay}ms)`);

  // Until it answers, not once: an attempt that fails again schedules the next,
  // which is the whole point of the loop.
  await retry();

  assert.strictEqual(timers.length, 1, 'the backend is still down, so the next attempt is already scheduled');
  assert.strictEqual(starting().hidden, false, 'and the indicator stays up between attempts');
});

test('#402: the attempt that lands fills the dropdown and clears the indicator', async () => {
  const { client, personas, retry, starting, timers, who } = await boot({}, {
    roster: new Error('Failed to fetch'),
    signedInAtBoot: '_test.referrer@playground.omegajs.dev',
  });

  assert.deepStrictEqual(personas().children.map((option) => option.value), [''], 'nothing to offer yet');

  // The emulator finishes booting between attempts.
  client.roster = ROSTER;
  await retry();

  assert.deepStrictEqual(
    personas().children.slice(1).map((option) => option.value),
    ROSTER.map((persona) => persona.localpart),
    'the retry fills the dropdown exactly as a first attempt that landed would',
  );
  assert.strictEqual(personas().value, '_test.referrer', 'including the select-sync with whoever is signed in');
  assert.strictEqual(starting().hidden, true, 'the indicator is gone');
  assert.strictEqual(who().textContent, '_test.referrer@playground.omegajs.dev', 'and so is the explanation for a failure that is over');
  assert.strictEqual(timers.length, 0, 'nothing is scheduled once the backend answers');
});

test('#402: a reachable backend never shows the indicator', async () => {
  const { starting, timers } = await boot();

  assert.strictEqual(starting().hidden, true, 'the first attempt landed, so the indicator never shows');
  assert.strictEqual(timers.length, 0, 'and no retry is scheduled');

  // `hidden` is only as good as the CSS that honours it: the indicator's own
  // rule is display: flex, which OUTRANKS the UA sheet's [hidden] rule, so
  // losing this one line leaves a spinner turning forever on a working
  // backend while every assertion above stays green. Read from the source the
  // #375 way, because the styles are a string this module injects.
  const source = fs.readFileSync(path.join(PALETTE_DIR, 'dev-palette.js'), 'utf8');

  assert.match(
    source,
    /\.omega-devbar__starting\[hidden\] \{ display: none; \}/,
    'the hidden indicator is display: none, not a flex row the UA sheet cannot suppress',
  );
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
  dropdown.value = '_test.premium-active';
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
    // Every boot reads the roster first (#400); this is about what RESETTING sends.
    client.requests.filter((request) => request.url !== ROSTER_URL),
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

test('#375: the persona dropdown draws its own chevron, clear of the right edge', () => {
  // The native select arrow hugs the control's edge — every other dropdown on
  // the page draws its own. appearance: none suppresses the OS arrow; the
  // inline chevron sits in from the edge, and the right padding clears it.
  const source = fs.readFileSync(path.join(PALETTE_DIR, 'dev-palette.js'), 'utf8');
  const rule = source.match(/\.omega-devbar__select \{[^}]*\}/)[0];

  assert.match(rule, /appearance: none;/, 'the OS arrow is suppressed');
  assert.match(rule, /background-image: url\("data:image\/svg\+xml/, 'a drawn chevron replaces it');
  assert.match(rule, /background-position: right 0\.5rem center;/, 'sitting in from the edge');
  assert.match(rule, /padding: 0\.3125rem 1\.75rem 0\.3125rem 0\.5rem;/, 'with right padding clearing it');
});

/** Run one function with console.log captured; hand back what it was called with. */
async function capturingLogs(run) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args);

  try {
    await run();
  } finally {
    console.log = original;
  }

  return lines;
}

test('#390: the storage dropdown lists All first, then every LIVE top-level key', async () => {
  const { labels, open, storageTarget } = await boot({
    trackingConsent: { status: 'granted' },
    attribution: { utm_source: 'newsletter' },
  });

  await open();

  assert.ok(labels().includes('Storage'), 'the panel carries a Storage section');
  const options = storageTarget().children;
  assert.strictEqual(options[0].textContent, 'All (2 keys)', 'All leads, counting the keys');
  assert.strictEqual(options[0].value, '', 'and its value is the empty target');
  assert.deepStrictEqual(
    options.slice(1).map((option) => option.value),
    ['trackingConsent', 'attribution'],
    'every top-level key is a target',
  );
});

test('#390: the options are re-derived on every open, so a key written since is already there', async () => {
  const { open, storage, storageTarget } = await boot({ trackingConsent: { status: 'granted' } });

  const values = () => storageTarget().children.map((option) => option.value);

  await open();
  assert.ok(!values().includes('appearance'), 'nothing wrote that key yet');

  // What a page does while the panel is closed — the option set is a snapshot
  // of the blob, never a list the palette holds onto.
  storage.appearance = 'dark';
  await open();

  assert.ok(values().includes('appearance'), 'reopening picks up the key written since');
  const copies = values().filter((value) => value === 'trackingConsent');
  assert.strictEqual(copies.length, 1, 'and re-rendering replaces the options rather than stacking them');
});

test('#390: Clear on a selected key drops that key and leaves the rest', async () => {
  const { button, open, storage, storageTarget } = await boot({
    trackingConsent: { status: 'granted' },
    attribution: { utm_source: 'newsletter' },
  });

  await open();
  storageTarget().value = 'trackingConsent';
  await button('Clear').click();

  assert.deepStrictEqual(
    storage,
    { attribution: { utm_source: 'newsletter' } },
    'only the targeted key leaves the blob',
  );
  const values = storageTarget().children.map((option) => option.value);
  assert.ok(!values.includes('trackingConsent'), 'and its option goes with it');
  assert.ok(values.includes('attribution'), 'the surviving key keeps its option');
  assert.strictEqual(storageTarget().value, '', 'the selection falls back to All');
});

test('#390: Clear on All wipes the whole blob', async () => {
  const { button, open, storage, storageTarget } = await boot({
    trackingConsent: { status: 'granted' },
    attribution: { utm_source: 'newsletter' },
  });

  await open();
  await button('Clear').click();

  assert.deepStrictEqual(storage, {}, 'the blob is empty');
  const options = storageTarget().children;
  assert.strictEqual(options.length, 1, 'no per-key option survives it');
  assert.strictEqual(options[0].textContent, 'All (0 keys)', 'and All says so');
});

test('#390: Log prints the parsed target, not a string dump', async () => {
  const blob = { trackingConsent: { status: 'granted' } };
  const { button, open, storageTarget } = await boot(blob);

  await open();
  const all = await capturingLogs(() => button('Log').click());

  assert.strictEqual(all.length, 1, 'one line');
  assert.strictEqual(all[0][0], '[@omega.js/web:dev-palette]', 'carrying the runtime log tag (docs/shared/logging.md)');
  assert.strictEqual(all[0][1], 'storage:', 'saying what it is');
  assert.strictEqual(all[0][2], blob, 'the object itself — devtools has to be able to explore it');

  storageTarget().value = 'trackingConsent';
  const one = await capturingLogs(() => button('Log').click());

  assert.strictEqual(one[0][1], 'storage.trackingConsent:', 'a keyed target says which key');
  assert.strictEqual(one[0][2], blob.trackingConsent, 'and prints that value, still explorable');
});

test('#234: a section without an id or a builder is a programmer error, loudly', async () => {
  const { register } = await boot();

  assert.throws(() => register('', { buildNode: () => {} }), /dev-sections/, 'an id is required');
  assert.throws(() => register('fixture', {}), /dev-sections/, 'so is a buildNode');
});
