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
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { get: _get, set: _set } = require('lodash');
const { resolvedBrandHost } = require('@omega.js/config');
const { User } = require('@omega.js/account');

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

// The resolved config the client hands the palette. The playground's, so every
// case that does not care about the brand host reads the same addresses it
// always did.
const CONFIG = { brand: { url: 'https://playground.omegajs.dev' } };

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
function makeClient(storage, roster, signedInAtBoot, config) {
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
    config,
    auth: {
      user: signedInAtBoot ? new User({}, { uid: 'u1', email: signedInAtBoot }) : new User(),
      // The real listener hands over the settled auth state the moment it is
      // registered. `signedInAtBoot` is that case, and it lands while the
      // roster fetch is still in flight.
      listen: (_options, handler) => {
        listeners.push(handler);

        if (signedInAtBoot) {
          handler();
        }
      },
      signInWithEmailAndPassword: async (email, password) => { signIns.push({ email, password }); },
    },
    // Lodash-pathed exactly like the real one (@omega.js/client's Storage), so
    // a nested path behaves as it does in a browser: no path reads (or wipes)
    // the WHOLE blob, and every write persists through JSON — which is what
    // makes a key removed by setting it undefined actually leave the object.
    storage: {
      get: (keyPath, defaultValue) => (keyPath ? _get(storage, keyPath, defaultValue) : storage),
      set: (keyPath, value) => { _set(storage, keyPath, value); persist(); },
      remove: (keyPath) => { _set(storage, keyPath, undefined); persist(); },
      clear: () => { Object.keys(storage).forEach((key) => delete storage[key]); },
    },
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
async function boot(storage = {}, { pathname = '/', roster = ROSTER, signedInAtBoot = null, config = CONFIG } = {}) {
  await bundleOnce();

  const doc = makeDocument();
  const client = makeClient(storage, roster, signedInAtBoot, config);
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
      client.auth.user = email ? new User({}, { uid: 'u1', email }) : new User();
      client.listeners[0]();
    },
  };
}

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

module.exports = defineCases({
  type: 'group',
  description: 'dev-palette',
  tests: [
    {
      name: 'dev palette: the four billing-journey personas are offered beside the lifecycle ones',
      run: async (ctx) => {
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
          ctx.expect(persona, `the palette should offer a "${label}" persona`).toBeTruthy();
          ctx.expect(persona.value, 'the option carries the persona it signs in as').toBe(localpart);
          ctx.expect(persona.title, 'the persona should sign in as its seeded email on the brand domain').toBe(`${localpart}@playground.omegajs.dev`);
        }

        // The lifecycle personas the journeys joined, not replaced.
        ctx.expect(option('Premium'), 'the existing personas should still be offered').toBeTruthy();

        // The referral pair (#363) is offered because the SEED labels it; that is
        // pinned where it is owned (packages/backend test/routes/test/roster.test.js).

        // The steady-state mid-trial persona (#301) sits among the lifecycle states,
        // between the plan it is trialing and the state a lapsed one lands in.
        const trialing = option('Trialing');
        ctx.expect(trialing, 'the palette should offer the mid-trial persona').toBeTruthy();
        ctx.expect(trialing.value, 'it signs in as the seeded trialing persona').toBe('_test.premium-trialing');
        ctx.expect(trialing.title, 'on the brand domain like every other persona').toBe('_test.premium-trialing@playground.omegajs.dev');
        ctx.expect(options.indexOf(trialing), 'it follows Premium').toBe(options.indexOf(option('Premium')) + 1);
        ctx.expect(options.indexOf(option('Expired')), 'and precedes Expired').toBe(options.indexOf(trialing) + 1);

        // The list opens on a placeholder, not on whichever persona happens to be
        // first — picking one has to be a deliberate choice.
        const [first] = options;
        ctx.expect(first.value, 'the first option is a placeholder').toBe('');
        ctx.expect(first.disabled, 'and it is not selectable').toBe(true);
        ctx.expect(options.length, 'one placeholder plus every persona the roster named').toBe(ROSTER.length + 1);
      },
    },

    {
      name: '#400: the dropdown is the seed\'s roster, fetched, not a list the palette keeps',
      run: async (ctx) => {
        const { client, personas } = await boot();

        ctx.expect(client.requests, 'the palette asks the backend for the roster on build, unauthenticated, because nobody is signed in yet').toEqual([{ url: ROSTER_URL, options: { auth: false } }]);

        const options = personas().children.slice(1);

        ctx.expect(options.map((option) => [option.value, option.textContent]), 'every option is a persona the roster named, in the order it named them').toEqual(ROSTER.map((persona) => [persona.localpart, persona.label]));
        ctx.expect(options.map((option) => option.title), 'each one signs in as its seeded email on the brand domain').toEqual(ROSTER.map((persona) => `${persona.localpart}@playground.omegajs.dev`));

        // The palette holds no copy of the list: a roster of one is a dropdown of one.
        const { personas: shortlist } = await boot({}, { roster: [{ localpart: '_test.admin', label: 'Admin' }] });

        ctx.expect(shortlist().children.map((option) => option.textContent), 'the dropdown offers exactly what the backend handed over').toEqual(['Switch account…', 'Admin']);
      },
    },

    {
      name: '#400: a roster the emulator cannot answer leaves the placeholder alone and says why',
      run: async (ctx) => {
        const { personas, signedInAs, who } = await boot({}, { roster: new Error('Failed to fetch') });

        ctx.expect(personas().children.map((option) => option.value), 'no fallback list: the placeholder stands on its own').toEqual(['']);
        ctx.expect(who().textContent, 'and the who line carries the same failure every other control reports').toBe('Checking auth…\n✕ Failed to fetch. Is the backend emulator running? (npm start at the brand root)');

        // Auth settles on its own schedule, and with no emulator up the fetch
        // rejects long before it does. The explanation has to SURVIVE that delivery:
        // it used to be overwritten by the identity line, so what a developer
        // actually saw was "Signed out" beside an empty dropdown and no reason.
        signedInAs(null);

        ctx.expect(who().textContent, 'the auth readout lands beside the failure, never on top of it').toBe('Signed out\n✕ Failed to fetch. Is the backend emulator running? (npm start at the brand root)');
      },
    },

    {
      name: '#400: signing in before the roster lands still preselects the persona',
      run: async (ctx) => {
        // The other order: auth settles while the fetch is in flight, so the options
        // the selection has to match do not exist yet. Filling the dropdown is what
        // resolves it, which is why appending the options syncs the selection again.
        const { personas, who } = await boot({}, { signedInAtBoot: '_test.referrer@playground.omegajs.dev' });

        ctx.expect(personas().value, 'the roster landing preselects the persona already signed in').toBe('_test.referrer');
        ctx.expect(who().textContent, 'and the readout is just the identity').toBe('_test.referrer@playground.omegajs.dev');
      },
    },

    {
      name: '#402: an unreachable backend shows a starting indicator and schedules another attempt',
      run: async (ctx) => {
        const { panel, retry, starting, timers, who } = await boot({}, { roster: new Error('Failed to fetch') });

        const indicator = starting();
        ctx.expect(indicator, 'the panel carries a starting indicator').toBeTruthy();
        ctx.expect(indicator.hidden, 'and it is on screen while the roster is unreachable').toBe(false);
        ctx.expect(panel.children.indexOf(indicator), 'at the top of the panel, right under the DEV header row').toBe(1);
        ctx.expect(indicator.children.map((child) => child.textContent).join(''), 'saying the backend is still coming up').toMatch(/starting/i);
        ctx.expect(indicator.children.some((child) => child.className === 'omega-devbar__spinner'), 'with a moving indicator beside the copy, never bare text (docs/shared/theming.md)').toBeTruthy();

        // The explanation stays where every other failure reports itself: the loop
        // says the backend is starting, the who line says how to start it.
        ctx.expect(who().textContent, 'the who line keeps carrying the reason during the retry loop').toBe('Checking auth…\n✕ Failed to fetch. Is the backend emulator running? (npm start at the brand root)');

        ctx.expect(timers.length, 'one retry is scheduled, not a storm of them').toBe(1);
        ctx.expect(timers[0].delay >= 1000, `the interval is gentle, not a busy loop (got ${timers[0].delay}ms)`).toBeTruthy();

        // Until it answers, not once: an attempt that fails again schedules the next,
        // which is the whole point of the loop.
        await retry();

        ctx.expect(timers.length, 'the backend is still down, so the next attempt is already scheduled').toBe(1);
        ctx.expect(starting().hidden, 'and the indicator stays up between attempts').toBe(false);
      },
    },

    {
      name: '#402: the attempt that lands fills the dropdown and clears the indicator',
      run: async (ctx) => {
        const { client, personas, retry, starting, timers, who } = await boot({}, {
          roster: new Error('Failed to fetch'),
          signedInAtBoot: '_test.referrer@playground.omegajs.dev',
        });

        ctx.expect(personas().children.map((option) => option.value), 'nothing to offer yet').toEqual(['']);

        // The emulator finishes booting between attempts.
        client.roster = ROSTER;
        await retry();

        ctx.expect(personas().children.slice(1).map((option) => option.value), 'the retry fills the dropdown exactly as a first attempt that landed would').toEqual(ROSTER.map((persona) => persona.localpart));
        ctx.expect(personas().value, 'including the select-sync with whoever is signed in').toBe('_test.referrer');
        ctx.expect(starting().hidden, 'the indicator is gone').toBe(true);
        ctx.expect(who().textContent, 'and so is the explanation for a failure that is over').toBe('_test.referrer@playground.omegajs.dev');
        ctx.expect(timers.length, 'nothing is scheduled once the backend answers').toBe(0);
      },
    },

    {
      name: '#402: a reachable backend never shows the indicator',
      run: async (ctx) => {
        const { starting, timers } = await boot();

        ctx.expect(starting().hidden, 'the first attempt landed, so the indicator never shows').toBe(true);
        ctx.expect(timers.length, 'and no retry is scheduled').toBe(0);

        // `hidden` is only as good as the CSS that honours it: the indicator's own
        // rule is display: flex, which OUTRANKS the UA sheet's [hidden] rule, so
        // losing this one line leaves a spinner turning forever on a working
        // backend while every assertion above stays green. Read from the source the
        // #375 way, because the styles are a string this module injects.
        const source = fs.readFileSync(path.join(PALETTE_DIR, 'dev-palette.js'), 'utf8');

        ctx.expect(source, 'the hidden indicator is display: none, not a flex row the UA sheet cannot suppress').toMatch(/\.omega-devbar__starting\[hidden\] \{ display: none; \}/);
      },
    },

    {
      name: 'dev palette: choosing a persona signs it in and reloads',
      run: async (ctx) => {
        const { personas, client, reloads } = await boot();

        const dropdown = personas();
        dropdown.value = '_test.journey-flows-trial';
        await dropdown.change();

        ctx.expect(client.signIns, 'the chosen persona should be signed in with the shared test password').toEqual([{ email: '_test.journey-flows-trial@playground.omegajs.dev', password: 'omega-test-password' }]);
        ctx.expect(reloads, 'and the page reloads as that persona').toEqual([true]);
      },
    },

    {
      name: '#708: the address a persona signs in on is the one the seeder seeded it on',
      run: async (ctx) => {
        // The switchboard config that found the bug: a support address on the apex —
        // a normal thing to publish — and the site on a subdomain of it. The seeder
        // used to split that contact address, so it created accounts on a domain the
        // palette never composes and every switch failed auth/user-not-found.
        const config = {
          brand: {
            url: 'https://switchboard.streamforge.app',
            contact: { email: 'support@streamforge.app' },
          },
        };

        const { personas, client } = await boot({}, { config });

        const dropdown = personas();
        dropdown.value = '_test.premium-active';
        await dropdown.change();

        ctx.expect(client.signIns, 'the palette signs in on the brand HOST, never on the support address\'s domain').toEqual([{ email: '_test.premium-active@switchboard.streamforge.app', password: 'omega-test-password' }]);

        // And the pin that keeps the two sides from drifting again: the address is
        // composed against the SAME derivation the seeder now runs — @omega.js/config's
        // resolvedBrandHost — not a lookalike of it. The seed side is pinned where it
        // is owned (packages/backend test/helpers/persona-domain.test.js).
        ctx.expect(client.signIns[0].email, 'the palette and the seeder compose the same address, function for function').toBe(`_test.premium-active@${resolvedBrandHost(config)}`);
      },
    },

    // #588 flipped the precedence this pins: the persona domain is a BRAND fact.
    // The seeder runs against the ONE backend every instance shares, so an admin
    // instance whose own url is admin.<brand host> still signs in at the brand
    // host, and asking for `@admin.<host>` would name an account nothing ever seeded.
    {
      name: '#708/#588: an instance signs in on the BRAND host, not its own',
      run: async (ctx) => {
        const config = { url: 'https://second.omegajs.dev', brand: { url: 'https://playground.omegajs.dev' } };

        const { personas, client } = await boot({}, { config });

        const dropdown = personas();
        dropdown.value = '_test.premium-active';
        await dropdown.change();

        ctx.expect(client.signIns[0].email).toBe('_test.premium-active@playground.omegajs.dev');
        ctx.expect(client.signIns[0].email, 'the palette and the seeder compose the same address, or the personas are unreachable again').toBe(`_test.premium-active@${resolvedBrandHost(config)}`);
      },
    },

    {
      name: 'dev palette: the placeholder does nothing, and a failed switch stays usable',
      run: async (ctx) => {
        const { personas, client, reloads } = await boot();

        const dropdown = personas();
        await dropdown.change();
        ctx.expect(client.signIns, 'landing back on the placeholder is not a sign-in').toEqual([]);

        client.auth = {
          user: new User(),
          listen: () => {},
          signInWithEmailAndPassword: async () => { throw new Error('auth/network-request-failed'); },
        };
        dropdown.value = '_test.premium-active';
        await dropdown.change();

        ctx.expect(reloads, 'a failed switch must not reload').toEqual([]);
        ctx.expect(dropdown.dataset.busy, 'and the dropdown is usable again').toBe('false');
      },
    },

    {
      name: 'dev palette: the dropdown shows the persona you are signed in as',
      run: async (ctx) => {
        const { personas, signedInAs } = await boot();

        const dropdown = personas();
        ctx.expect(dropdown.value, 'signed out, it sits on the placeholder').toBe('');
        // The stub's value defaults to '' either way — the explicit `selected` is the
        // assertable half: a real browser skips a disabled option at initial
        // selection and would land on the first persona without it.
        ctx.expect(dropdown.children[0].selected, 'the placeholder is explicitly selected').toBe(true);

        signedInAs('_test.premium-active@playground.omegajs.dev');
        ctx.expect(dropdown.value, 'a persona preselects itself').toBe('_test.premium-active');

        signedInAs('someone@playground.omegajs.dev');
        ctx.expect(dropdown.value, 'a real account is nobody in the list').toBe('');
      },
    },

    {
      name: 'dev palette: the reset control shows for a seeded persona and hides for anybody else',
      run: async (ctx) => {
        const { button, signedInAs } = await boot();

        const reset = button('Reset to seed');
        ctx.expect(reset, 'the palette should carry one reset control').toBeTruthy();
        ctx.expect(reset.hidden, 'it should be hidden until the auth state is known').toBe(true);

        signedInAs('_test.journey-flows-cancel@playground.omegajs.dev');
        ctx.expect(reset.hidden, 'a signed-in persona can be reset').toBe(false);

        signedInAs('someone@playground.omegajs.dev');
        ctx.expect(reset.hidden, 'a real account is never resettable').toBe(true);

        signedInAs(null);
        ctx.expect(reset.hidden, 'signed out, there is nothing to reset').toBe(true);
      },
    },

    {
      name: 'dev palette: resetting posts the dev route, signs the persona back in, and reloads',
      run: async (ctx) => {
        const { button, client, reloads, signedInAs } = await boot();

        signedInAs('_test.journey-flows-cancel@playground.omegajs.dev');
        await button('Reset to seed').click();

        ctx.expect(client.requests.filter((request) => request.url !== ROSTER_URL), 'the control should post the dev reset route for the signed-in account').toEqual([{ url: '/omega/test/reset-account', options: { method: 'POST' } }]);
        ctx.expect(client.signIns, 'the reset recreates the auth user, so the same persona must be signed back in').toEqual([{ email: '_test.journey-flows-cancel@playground.omegajs.dev', password: 'omega-test-password' }]);
        ctx.expect(reloads, 'the page should reload onto the seeded state').toEqual([true]);
      },
    },

    {
      name: 'dev palette: the checkout controls are not built in — they belong to the checkout page',
      run: async (ctx) => {
        // A built-in renders on EVERY page, which is what put "Decline next checkout"
        // in front of somebody reading the blog. It is a registered section now
        // (modules/dev-section.js), so it comes with the page or not at all.
        const { checkbox, labels, open } = await boot();

        await open();

        ctx.expect(checkbox('omega-devbar-decline'), 'no decline toggle on a page that is not the checkout').toBe(undefined);
        ctx.expect(!labels().includes('Checkout'), 'and no empty Checkout heading either').toBeTruthy();
      },
    },

    {
      name: '#234: a registered section renders on open, not before',
      run: async (ctx) => {
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

        ctx.expect(built, 'registering must not build anything — the palette may already be on screen').toBe(0);
        ctx.expect(button('Fixture control'), 'and nothing is in the panel yet').toBe(undefined);

        await open();

        ctx.expect(built, 'opening the panel is what builds the section').toBe(1);
        ctx.expect(button('Fixture control'), 'the registered control is in the panel').toBeTruthy();
      },
    },

    {
      name: '#234: a section whose page condition fails never renders',
      run: async (ctx) => {
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

        ctx.expect(button('Fixture control'), 'a section scoped to another page stays off this one').toBe(undefined);
        ctx.expect(!labels().includes('Fixture'), 'and it leaves no empty heading behind').toBeTruthy();
      },
    },

    {
      name: '#234: a section reusing a built-in id merges into it instead of repeating the heading',
      run: async (ctx) => {
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
        ctx.expect(headings.length, 'one "Go to" heading, not two').toBe(1);
        ctx.expect(button('Page link'), 'the registered control is rendered').toBeTruthy();
      },
    },

    {
      name: '#234: reopening the panel does not stack a second copy of a section',
      run: async (ctx) => {
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
        ctx.expect(copies.length, 'rendering is idempotent — the panel opens as often as you like').toBe(1);
      },
    },

    {
      name: '#375: the persona dropdown draws its own chevron, clear of the right edge',
      run: (ctx) => {
        // The native select arrow hugs the control's edge — every other dropdown on
        // the page draws its own. appearance: none suppresses the OS arrow; the
        // inline chevron sits in from the edge, and the right padding clears it.
        const source = fs.readFileSync(path.join(PALETTE_DIR, 'dev-palette.js'), 'utf8');
        const rule = source.match(/\.omega-devbar__select \{[^}]*\}/)[0];

        ctx.expect(rule, 'the OS arrow is suppressed').toMatch(/appearance: none;/);
        ctx.expect(rule, 'a drawn chevron replaces it').toMatch(/background-image: url\("data:image\/svg\+xml/);
        ctx.expect(rule, 'sitting in from the edge').toMatch(/background-position: right 0\.5rem center;/);
        ctx.expect(rule, 'with right padding clearing it').toMatch(/padding: 0\.3125rem 1\.75rem 0\.3125rem 0\.5rem;/);
      },
    },

    {
      name: '#390: the storage dropdown lists All first, then every LIVE top-level key',
      run: async (ctx) => {
        const { labels, open, storageTarget } = await boot({
          trackingConsent: { status: 'granted' },
          attribution: { utm_source: 'newsletter' },
        });

        await open();

        ctx.expect(labels().includes('Storage'), 'the panel carries a Storage section').toBeTruthy();
        const options = storageTarget().children;
        ctx.expect(options[0].textContent, 'All leads, counting the keys').toBe('All (2 keys)');
        ctx.expect(options[0].value, 'and its value is the empty target').toBe('');
        ctx.expect(options.slice(1).map((option) => option.value), 'every top-level key is a target').toEqual(['trackingConsent', 'attribution']);
      },
    },

    {
      name: '#390: the options are re-derived on every open, so a key written since is already there',
      run: async (ctx) => {
        const { open, storage, storageTarget } = await boot({ trackingConsent: { status: 'granted' } });

        const values = () => storageTarget().children.map((option) => option.value);

        await open();
        ctx.expect(!values().includes('appearance'), 'nothing wrote that key yet').toBeTruthy();

        // What a page does while the panel is closed — the option set is a snapshot
        // of the blob, never a list the palette holds onto.
        storage.appearance = 'dark';
        await open();

        ctx.expect(values().includes('appearance'), 'reopening picks up the key written since').toBeTruthy();
        const copies = values().filter((value) => value === 'trackingConsent');
        ctx.expect(copies.length, 'and re-rendering replaces the options rather than stacking them').toBe(1);
      },
    },

    {
      name: '#390: Clear on a selected key drops that key and leaves the rest',
      run: async (ctx) => {
        const { button, open, storage, storageTarget } = await boot({
          trackingConsent: { status: 'granted' },
          attribution: { utm_source: 'newsletter' },
        });

        await open();
        storageTarget().value = 'trackingConsent';
        await button('Clear').click();

        ctx.expect(storage, 'only the targeted key leaves the blob').toEqual({ attribution: { utm_source: 'newsletter' } });
        const values = storageTarget().children.map((option) => option.value);
        ctx.expect(!values.includes('trackingConsent'), 'and its option goes with it').toBeTruthy();
        ctx.expect(values.includes('attribution'), 'the surviving key keeps its option').toBeTruthy();
        ctx.expect(storageTarget().value, 'the selection falls back to All').toBe('');
      },
    },

    {
      name: '#390: Clear on All wipes the whole blob',
      run: async (ctx) => {
        const { button, open, storage, storageTarget } = await boot({
          trackingConsent: { status: 'granted' },
          attribution: { utm_source: 'newsletter' },
        });

        await open();
        await button('Clear').click();

        ctx.expect(storage, 'the blob is empty').toEqual({});
        const options = storageTarget().children;
        ctx.expect(options.length, 'no per-key option survives it').toBe(1);
        ctx.expect(options[0].textContent, 'and All says so').toBe('All (0 keys)');
      },
    },

    {
      name: '#390: Log prints the parsed target, not a string dump',
      run: async (ctx) => {
        const blob = { trackingConsent: { status: 'granted' } };
        const { button, open, storageTarget } = await boot(blob);

        await open();
        const all = await capturingLogs(() => button('Log').click());

        ctx.expect(all.length, 'one line').toBe(1);
        ctx.expect(all[0][0], 'carrying the runtime log tag (docs/shared/logging.md)').toBe('[@omega.js/web:dev-palette]');
        ctx.expect(all[0][1], 'saying what it is').toBe('storage:');
        ctx.expect(all[0][2], 'the object itself — devtools has to be able to explore it').toBe(blob);

        storageTarget().value = 'trackingConsent';
        const one = await capturingLogs(() => button('Log').click());

        ctx.expect(one[0][1], 'a keyed target says which key').toBe('storage.trackingConsent:');
        ctx.expect(one[0][2], 'and prints that value, still explorable').toBe(blob.trackingConsent);
      },
    },

    {
      name: '#234: a section without an id or a builder is a programmer error, loudly',
      run: async (ctx) => {
        const { register } = await boot();

        ctx.expect(() => register('', { buildNode: () => {} }), 'an id is required').toThrow(/dev-sections/);
        ctx.expect(() => register('fixture', {}), 'so is a buildNode').toThrow(/dev-sections/);
      },
    },
  ],
});
