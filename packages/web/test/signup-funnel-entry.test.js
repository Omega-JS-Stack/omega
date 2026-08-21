/**
 * The signup funnel's ENTRY event
 * ([#408](https://github.com/Omega-JS-Stack/omega/issues/408), inventory gap 1
 * of [#328](https://github.com/Omega-JS-Stack/omega/issues/328)).
 *
 * `sign_up_started` is what gives the funnel a top: without it the only signal
 * is `sign_up`, so every visitor who reached the form and left again was
 * invisible. The honest entry is the first real ENGAGEMENT with the form — the
 * first keystroke, or the press of a provider button — which is why the three
 * things pinned here are the ones a regression would break: it fires on the
 * first interaction, it fires EXACTLY once per page view (two listeners feed
 * one flag), and the neighboring signin form fires nothing at all.
 *
 * The module is browser code behind the two bundler aliases, so the harness
 * drives the REAL `core/js/libs/auth/forms.js` through esbuild — the convention
 * auth-policy.test.js sets — with the client and FormManager stubbed and the
 * DOM hand-rolled to the minimum the module touches.
 *
 * The one thing stubbed that analytics-blocked.test.js drives for real is the
 * facade itself: `sign_up_started` maps to NO provider (the signup funnel is
 * ours to read, not an ad platform's), so there is no gtag/fbq/ttq call
 * downstream to observe. The CANONICAL call is the whole contract here, and the
 * last test holds it to the real catalog so the capture cannot drift from it.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { entryFor } = require('@omega.js/analytics/catalog');

const CORE_DIR = path.join(__dirname, '..', 'core');
const FORMS_ENTRY = path.join(CORE_DIR, 'js', 'libs', 'auth', 'forms.js');
const ANALYTICS_LIB = path.join(CORE_DIR, 'js', 'libs', 'analytics.js');

const BUNDLE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-signup-funnel-')), 'forms.cjs');

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [FORMS_ENTRY],
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    // The email/oauth paths import it lazily and no test walks there.
    external: ['@firebase/auth'],
    plugins: [{
      name: 'harness-aliases',
      setup(build) {
        build.onResolve({ filter: /^__main_assets__\// }, (args) => {
          const resolved = path.join(CORE_DIR, args.path.slice('__main_assets__/'.length));

          if (resolved === ANALYTICS_LIB) {
            return { path: 'analytics', namespace: 'omega-analytics-stub' };
          }

          return { path: resolved };
        });
        // Every canonical event this page fires, in order — the capture the
        // facade's zero-provider entry leaves nothing else to see.
        build.onLoad({ filter: /.*/, namespace: 'omega-analytics-stub' }, () => {
          return {
            contents: `
              export function event(name, params) { globalThis.__omegaEvents.push([name, params]); }
              export function identify() {}
              export function reset() {}
              export function configureAnalytics() {}
            `,
          };
        });
        build.onResolve({ filter: /^@omega\.js\/client$/ }, () => {
          return { path: 'client', namespace: 'omega-client-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-client-stub' }, () => {
          return { contents: 'export default globalThis.__omegaClient;' };
        });
        // Same reason analytics-blocked.test.js keeps it a name: the published
        // FormManager build's `module.exports =` tail clobbers the harness
        // bundle's own exports. The stub keeps the one thing this suite needs —
        // the `$form` the funnel listeners are attached to.
        build.onResolve({ filter: /^@omega\.js\/client\/modules\/form-manager\.js$/ }, () => {
          return { path: 'form-manager', namespace: 'omega-form-manager-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-form-manager-stub' }, () => {
          return {
            contents: `
              export class FormManager {
                constructor() { this.$form = globalThis.__omegaFormElement; }
                on() {}
              }
            `,
          };
        });
      },
    }],
  });

  return building;
}

/** The `<form>` the auth pages render, recording what got listened for. */
function makeFormElement() {
  const listeners = {};

  return {
    listeners,
    addEventListener(type, handler) {
      (listeners[type] ||= []).push(handler);
    },
    querySelectorAll: () => [],
    /** Hand the form a real browser event the way the browser would. */
    dispatch(type, domEvent) {
      (listeners[type] || []).forEach((handler) => handler(domEvent));
    },
  };
}

/** Typing in a field: the target is inside no provider button. */
function typing() {
  return { target: { closest: () => null } };
}

/** Pressing a provider button: the method rides on the button itself. */
function providerClick(provider) {
  return { target: { closest: (selector) => (selector === '[data-provider]' ? { getAttribute: () => provider } : null) } };
}

/** Wire one of the two auth forms over a fresh DOM, and hand back the form. */
async function wireForm(initializer) {
  await bundleOnce();

  const $form = makeFormElement();

  globalThis.__omegaEvents = [];
  globalThis.__omegaFormElement = $form;
  globalThis.__omegaClient = {
    isDevelopment: () => false,
    storage: () => ({ get: (key, fallback) => fallback, set: () => {} }),
    utilities: () => ({ showNotification: () => {} }),
  };
  globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const forms = require(BUNDLE);

  forms[initializer]({});

  return { $form, events: globalThis.__omegaEvents };
}

test('#408: the first keystroke in the signup form counts the funnel entry, once', async () => {
  const { $form, events } = await wireForm('initializeSignupForm');

  assert.deepStrictEqual(events, [], 'reaching the form is not starting a signup — a bounce would count as one');

  $form.dispatch('input', typing());

  assert.deepStrictEqual(events, [['sign_up_started', { method: 'email' }]], 'the first keystroke is the entry');

  // Every later keystroke, and the click that submits: one visitor, one entry.
  $form.dispatch('input', typing());
  $form.dispatch('input', typing());
  $form.dispatch('click', typing());

  assert.strictEqual(events.length, 1, 'one fire per page view, not one per keystroke');
});

test('#408: pressing a provider button counts the entry under that provider', async () => {
  // The two listeners are what makes a provider signup countable at all — that
  // visitor never types. The method is the button's, not the email default.
  const { $form, events } = await wireForm('initializeSignupForm');

  $form.dispatch('click', providerClick('google.com'));

  assert.deepStrictEqual(events, [['sign_up_started', { method: 'google.com' }]]);

  $form.dispatch('input', typing());

  assert.strictEqual(events.length, 1, 'the flag is shared across both listeners');
});

test('#408: the signin form counts no funnel entry — it is not the signup page', async () => {
  const { $form, events } = await wireForm('initializeSigninForm');

  $form.dispatch('input', typing());
  $form.dispatch('click', providerClick('google.com'));

  assert.deepStrictEqual(events, [], 'a returning user signing in never entered the signup funnel');
});

test('#408: the entry speaks the catalog — name and params, not a local invention', async () => {
  const { $form, events } = await wireForm('initializeSignupForm');

  $form.dispatch('input', typing());

  const [[name, params]] = events;
  const entry = entryFor(name);

  assert.ok(entry, `${name} is in the catalog`);
  assert.strictEqual(entry.placement, 'client', 'the funnel entry is the page\'s to fire');

  for (const key of Object.keys(params)) {
    assert.ok(entry.params.includes(key), `${name} declares the "${key}" param`);
  }
});
