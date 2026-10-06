/**
 * /payment/confirmation — a one-time purchase is a PURCHASE, not a subscription
 * ([#282](https://github.com/Omega-JS-Stack/omega/issues/282)).
 *
 * The bug this pins: `buildBindingsState()` read `isSubscription = !!state.frequency`,
 * and a one-time buy arrives from checkout as `frequency=once`. Every one-time
 * receipt therefore rendered the SUBSCRIPTION sentence with its cycle slots
 * empty: "Your  subscription is now active. You'll be charged automatically
 * each ." The slots come from a cadence map that has no `once` in it, because
 * `once` is not a cadence.
 *
 * The cadences checkout actually sells are `FREQUENCIES` (the checkout state
 * module owns that list, and verify.js already reads it to decide what can be
 * polled for, #232) — so the same list decides what may say "subscription".
 *
 * The modules are browser code behind two bundler aliases (`@omega.js/client`,
 * `__main_assets__/*`), so the harness drives the REAL state module through
 * esbuild — the convention confirmation-verify.test.js sets — with the client
 * stubbed. The layout assertions run against the real build.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const MODULES_DIR = path.join(CORE_DIR, 'js', 'pages', 'payment', 'confirmation', 'modules');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-confirmation-copy-'));
const BUNDLE = path.join(BUNDLE_DIR, 'state.cjs');

let building = null;

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [path.join(MODULES_DIR, 'state.js')],
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

/** The bindings state for one redirect, as the page would build it. */
async function bindingsFor({ frequency, hasFreeTrial = false, status = 'confirmed' }) {
  await bundleOnce();

  globalThis.__omegaClient = {};

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const modules = require(BUNDLE);

  Object.assign(modules.state, {
    orderId: 'ORD-282',
    productId: 'launch-kit',
    productName: 'Launch Kit',
    amount: 49,
    currency: 'USD',
    frequency,
    paymentMethod: 'stripe',
    hasFreeTrial,
    status,
    loaded: true,
  });

  return modules.buildBindingsState().confirmation;
}

let builtPage = null;

function confirmationPage() {
  builtPage ||= (async () => {
    const { buildWith, miniData } = require('./lib/build.js');
    const pages = await buildWith(miniData, {}, 'confirmation-purchase-copy-test');
    return pages.get('/payment/confirmation');
  })();

  return builtPage;
}

module.exports = defineCases({
  type: 'group',
  description: 'confirmation-purchase-copy',
  tests: [
    {
      name: '#282: a one-time purchase is never told it has a subscription',
      run: async (ctx) => {
        const bound = await bindingsFor({ frequency: 'once' });

        ctx.expect(bound.subscription.show, 'no subscription note on a one-time buy').toBe(false);
        ctx.expect(bound.subscription.infoText, 'and the subscription sentence is never even built').toBe('');
        ctx.expect(bound.purchase.show, 'the purchase note is what a one-time buy gets').toBe(true);
        ctx.expect(bound.purchase.infoText, 'the note names what was actually bought').toMatch(/one-time/i);
        ctx.expect(bound.purchase.infoText, 'and claims no recurring billing').not.toMatch(/subscription|you'?ll be charged/i);

        // The receipt's own label: a one-time buy bought an item, not a plan.
        ctx.expect(bound.order.itemLabel, 'the receipt names what was bought, not a plan').toBe('Item');
      },
    },

    {
      name: '#282: a subscription keeps its copy exactly as it was',
      run: async (ctx) => {
        const annual = await bindingsFor({ frequency: 'annually' });

        ctx.expect(annual.subscription.show, 'a real cadence still shows the subscription note').toBe(true);
        ctx.expect(annual.subscription.billingCycle, 'with its cycle').toBe('annually');
        ctx.expect(annual.subscription.infoText, 'the subscription sentence reads as grammar, not a raw cadence key').toBe("Your annual subscription is now active. You'll be charged automatically each year.");
        ctx.expect(annual.purchase.show, 'and no purchase note beside it').toBe(false);
        ctx.expect(annual.order.itemLabel, 'a subscription bought a plan').toBe('Plan');

        const trial = await bindingsFor({ frequency: 'monthly', hasFreeTrial: true });

        ctx.expect(trial.subscription.infoText, 'the trial sentence is unchanged too').toBe("Free Trial Active! Your trial period has begun. You'll be charged monthly after the trial ends.");
      },
    },

    {
      name: '#282: no receipt note ever renders with an empty slot',
      run: async (ctx) => {
        // The live symptom was the sentence itself: slots the state could not fill
        // reached the customer as gaps. Whatever branch a frequency lands in, the
        // sentence it produces has to read as a sentence.
        for (const frequency of ['once', 'daily', 'weekly', 'monthly', 'annually']) {
          const bound = await bindingsFor({ frequency });
          const note = bound.subscription.infoText || bound.purchase.infoText;

          ctx.expect(note, `${frequency}: the receipt says something about the billing`).toBeTruthy();
          ctx.expect(note, `${frequency}: no empty slot survives into the copy`).not.toMatch(/ {2}| \.|undefined/);
          ctx.expect(note, `${frequency}: product copy carries no em dash`).not.toMatch(/—/);
        }

        // A redirect with no frequency at all claims nothing either way.
        const unknown = await bindingsFor({ frequency: '' });
        ctx.expect(unknown.subscription.show, 'an unknown frequency is not a subscription').toBe(false);
        ctx.expect(unknown.purchase.show, 'and is not claimed as a one-time buy either').toBe(false);
      },
    },

    {
      name: '#282: the built page renders the purchase note and the bound item label',
      run: async (ctx) => {
        // The state module can only refuse to build subscription copy — the PAGE is
        // what renders the branch, so both bindings have to survive into the markup.
        const page = await confirmationPage();
        ctx.expect(page, 'confirmation page built').toBeTruthy();

        ctx.expect(page.includes('data-omega-bind="@show confirmation.purchase.show"'), 'the purchase note has its own gate').toBeTruthy();
        ctx.expect(page.includes('data-omega-bind="@text confirmation.purchase.infoText"'), 'and renders the purchase sentence').toBeTruthy();
        ctx.expect(page.includes('data-omega-bind="@text confirmation.order.itemLabel"'), 'the receipt label is bound, not hard-coded to "Plan"').toBeTruthy();
      },
    },
  ],
});
