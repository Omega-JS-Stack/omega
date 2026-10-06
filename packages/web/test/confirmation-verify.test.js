/**
 * /payment/confirmation — the page must not call a purchase successful until
 * the purchase actually EXISTS ([#232](https://github.com/Omega-JS-Stack/omega/issues/232)).
 *
 * The bug this pins: entitlement is granted by the payment WEBHOOK, which lands
 * after the provider has already redirected the browser here. The page read
 * the redirect's own URL params and rendered "You're in" off them — so a
 * checkout with no webhook delivery (local dev), and a checkout the backend
 * DECLINED (Ian's QA repro: `checkout-declined` fired, the account was
 * suspended, no entitlement) both showed success while the account never
 * changed.
 *
 * The modules are browser code behind two bundler aliases (`@omega.js/client`,
 * `__main_assets__/*`), so the harness drives the REAL files through esbuild —
 * the convention checkout-discount.test.js sets — with the client stubbed. The
 * poll's I/O seams (the account read, the sleep, the clock) are injected, so
 * the loop runs for real here at full speed rather than being simulated.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const expect = require('@omega.js/devkit/test/expect');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const MODULES_DIR = path.join(CORE_DIR, 'js', 'pages', 'payment', 'confirmation', 'modules');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-confirmation-verify-'));
const BUNDLE = path.join(BUNDLE_DIR, 'verify.cjs');

let building = null;

// Bundle one browser entry through the two aliases the app build resolves.
function bundleEntry({ contents, resolveDir, outfile }) {
  return esbuild.build({
    stdin: {
      contents,
      resolveDir,
      loader: 'js',
    },
    outfile,
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
}

// One entry exporting both seams, so the REAL verify module and the REAL state
// module it reports against stay the same instance.
function bundleOnce() {
  building ||= bundleEntry({
    contents: [
      `export { verifyPurchase, purchaseLanded, isVerifiable, initialStatus } from './verify.js';`,
      `export { state, buildBindingsState } from './state.js';`,
    ].join('\n'),
    resolveDir: MODULES_DIR,
    outfile: BUNDLE,
  });

  return building;
}

// The REAL User, the class the client builds, so "does the account reflect the
// purchase" is answered by the same getters here as in a browser.
const { User } = require('@omega.js/account');

// The shopper the page reads for: every doc read is built into a User for them.
const IDENTITY = { uid: 'test-uid' };
const asUser = (document) => new User(document, IDENTITY);

/**
 * @param {object} [options]
 * @param {object} [options.signedIn] - the document the signed-in User was built
 *   from: the plan the shopper walked in with, which must never answer the poll
 */
async function loadModules({ signedIn = {} } = {}) {
  await bundleOnce();

  globalThis.__omegaClient = {
    auth: {
      user: asUser(signedIn),
    },
  };

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  return require(BUNDLE);
}

const PAGE_DIR = path.join(CORE_DIR, 'js', 'pages', 'payment', 'confirmation');
const PAGE_BUNDLE = path.join(BUNDLE_DIR, 'page.cjs');

let buildingPage = null;

// The whole page module, so the ORDER of what it does — what it binds, when it
// celebrates — is observable (Ian's QA, #232).
function bundlePageOnce() {
  buildingPage ||= bundleEntry({
    contents: [
      `export { default as initConfirmation } from './index.js';`,
      `export { state } from './modules/state.js';`,
    ].join('\n'),
    resolveDir: PAGE_DIR,
    outfile: PAGE_BUNDLE,
  });

  return buildingPage;
}

/**
 * Run the real page against a scripted account, recording every binding update
 * and the celebration in the order they happen.
 *
 * @param {object} options
 * @param {string} options.search - the redirect's query string
 * @param {Array<object|null>} options.accounts - one entry per account read
 * @returns {Promise<{events: Array, listens: number, reads: number}>}
 */
async function runPage({ search, accounts }) {
  await bundlePageOnce();

  const events = [];
  let listens = 0;
  let reads = 0;

  globalThis.window = { location: { search } };
  globalThis.document = { querySelectorAll: () => [] };

  globalThis.__omegaClient = {
    dom: {
      ready: async () => {},
      loadScript: async () => {
        events.push('celebration');
        globalThis.window.confetti = () => {};
      },
    },
    bindings: {
      update: (bound) => events.push({ bind: bound.confirmation }),
    },
    auth: {
      listen: (options, callback) => {
        listens++;
        callback();
      },
      user: asUser({}),
      // The one re-read a page gets: the next scripted account, built as the
      // client builds it (a doc not written yet lands the empty signed-in User)
      reload: async () => {
        const account = accounts[Math.min(reads, accounts.length - 1)];
        reads++;
        return { user: asUser(account || {}), denied: false };
      },
    },
    notifications: { subscribe: async () => {} },
  };

  delete require.cache[require.resolve(PAGE_BUNDLE)];
  const page = require(PAGE_BUNDLE);

  await page.initConfirmation();

  return { events, listens, reads };
}

let builtPage = null;

// The rendered confirmation page, built once for every layout assertion here.
function confirmationPage() {
  builtPage ||= (async () => {
    const { buildWith, miniData } = require('./lib/build.js');
    const pages = await buildWith(miniData, {}, 'confirmation-verify-test');
    return pages.get('/payment/confirmation');
  })();

  return builtPage;
}

// The opening tag of the element that encloses `marker` in the rendered page.
function enclosingTag(page, marker, tagName = '<div') {
  const at = page.indexOf(marker);
  expect(at > -1, `the page renders ${marker}`).toBeTruthy();
  const openAt = page.lastIndexOf(tagName, at);

  return page.slice(openAt, page.indexOf('>', openAt) + 1);
}

// Account shapes the webhook produces, as the client would read them.
const BASIC = { subscription: { product: { id: 'basic', name: 'Basic' }, status: 'active' } };
const PREMIUM = { subscription: { product: { id: 'premium', name: 'Premium' }, status: 'active' } };
const SUSPENDED = { subscription: { product: { id: 'premium', name: 'Premium' }, status: 'suspended' } };

// A subscription confirmation, as the intent route builds the redirect.
const SUBSCRIPTION = { productId: 'premium', frequency: 'annually' };

/**
 * Run the real poll with scripted account reads and a clock that only advances
 * when the loop sleeps — so a test never actually waits.
 *
 * @param {object} modules - the bundled modules
 * @param {Array} answers - one entry per read: an account, or an Error to throw
 * @param {object} [state] - the page state (defaults to a subscription buy)
 */
async function runPoll(modules, answers, state = SUBSCRIPTION) {
  const reads = [];
  let clock = 0;

  const outcome = await modules.verifyPurchase(state, {
    read: async () => {
      const answer = answers[Math.min(reads.length, answers.length - 1)];
      reads.push(answer);
      if (answer instanceof Error) throw answer;
      // What readAccount hands back: the reloaded User, or null when signed out
      return answer && asUser(answer);
    },
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
    intervalMs: 1000,
    timeoutMs: 10000,
  });

  return { outcome, reads, clock };
}

module.exports = defineCases({
  type: 'group',
  description: 'confirmation-verify',
  tests: [
    {
      name: '#232: the page waits for the webhook rather than trusting the redirect',
      run: async (ctx) => {
        const modules = await loadModules();

        // The account is still basic for the first two reads — the webhook is in
        // flight — then the entitlement lands.
        const { outcome, reads } = await runPoll(modules, [BASIC, BASIC, PREMIUM]);

        ctx.expect(outcome, 'the purchase is confirmed once the account actually carries it').toBe('confirmed');
        ctx.expect(reads.length, 'and it kept asking until then, rather than answering off the redirect').toBe(3);
      },
    },

    {
      name: '#232: a webhook that never lands times out instead of claiming success',
      run: async (ctx) => {
        const modules = await loadModules();

        // Local dev with no webhook delivery — the exact shape Ian hit.
        const { outcome, clock } = await runPoll(modules, [BASIC]);

        ctx.expect(outcome, 'no entitlement, no success').toBe('timeout');
        ctx.expect(clock >= 10000, 'the whole budget was spent asking before giving up').toBeTruthy();
      },
    },

    {
      name: '#232: a DECLINED checkout never renders success',
      run: async (ctx) => {
        const modules = await loadModules();

        // The live repro: the backend declined, `checkout-declined` suspended the
        // account, and the test provider still returned the normal confirmation URL.
        const { outcome } = await runPoll(modules, [SUSPENDED]);

        ctx.expect(outcome, 'a suspended account is not a completed purchase').toBe('timeout');
      },
    },

    {
      name: '#232: a read that fails is not a NO — the poll keeps asking',
      run: async (ctx) => {
        const modules = await loadModules();

        // A network blip mid-poll must not fabricate a verdict in either direction.
        const { outcome, reads } = await runPoll(modules, [new Error('offline'), new Error('offline'), PREMIUM]);

        ctx.expect(outcome, 'the answer comes from the account, not from a failed read').toBe('confirmed');
        ctx.expect(reads.length, 'both failures were retried').toBe(3);
      },
    },

    {
      name: '#232: the purchase must be the plan that was bought, not merely any plan',
      run: async (ctx) => {
        const modules = await loadModules();

        // A user who already held `premium` buying `pro` must not be confirmed by the
        // plan they walked in with.
        const { outcome } = await runPoll(modules, [PREMIUM], { productId: 'pro', frequency: 'annually' });

        ctx.expect(outcome, 'the wrong plan is not this purchase landing').toBe('timeout');
      },
    },

    {
      name: '#232: a one-time purchase has no account state to wait for',
      run: async (ctx) => {
        const modules = await loadModules();

        // A one-time buy arrives as `frequency=once` and writes nothing to the
        // account doc, so there is nothing to poll for — the receipt is the answer.
        const { outcome, reads } = await runPoll(modules, [BASIC], { productId: 'launch-kit', frequency: 'once' });

        ctx.expect(outcome, 'a one-time purchase is not held behind a subscription poll').toBe('confirmed');
        ctx.expect(reads.length, 'and nothing is read at all').toBe(0);
        ctx.expect(modules.isVerifiable({ frequency: 'once' }), 'one-time is not verifiable against the account').toBe(false);
        ctx.expect(modules.isVerifiable({ frequency: 'annually' }), 'a real cadence is').toBe(true);
      },
    },

    {
      name: '#668: the product TYPE outranks the cadence — a one-time buy never polls',
      run: async (ctx) => {
        const modules = await loadModules();

        // The live failure (order 5434-3892-3088): checkout sent `frequency=annually`
        // on a one-time product, so the redirect said `type=one-time,
        // frequency=annually` and the page polled for a plan the purchase never
        // writes — 30 seconds of "still processing" on a payment that had completed.
        const stranded = { productId: 'launch-kit', type: 'one-time', frequency: 'annually' };
        const { outcome, reads } = await runPoll(modules, [BASIC], stranded);

        ctx.expect(outcome, 'the receipt opens answered, whatever cadence rode along with it').toBe('confirmed');
        ctx.expect(reads.length, 'and the account is never asked about a plan this purchase has nothing to do with').toBe(0);
        ctx.expect(modules.initialStatus(stranded), 'so the page opens confirmed rather than processing').toBe('confirmed');

        // The type is a second guard, never a replacement: the cadence still answers
        // a redirect old enough to carry no type at all.
        ctx.expect(modules.isVerifiable({ type: 'subscription', frequency: 'annually' }), 'a subscription still waits for its webhook').toBe(true);
        ctx.expect(modules.isVerifiable({ frequency: 'annually' }), 'and so does a redirect with no type on it').toBe(true);
      },
    },

    {
      name: '#232: the receipt renders processing, then success — never success first',
      run: async (ctx) => {
        const modules = await loadModules();

        modules.state.productId = 'premium';
        modules.state.frequency = 'annually';

        // The page opens unsure: the redirect has told it nothing it can trust.
        const opening = modules.buildBindingsState().confirmation;
        ctx.expect(opening.verification.processing, 'the page opens in processing').toBe(true);
        ctx.expect(opening.verification.confirmed, 'and claims nothing').toBe(false);
        ctx.expect(opening.verification.timedOut, 'and blames nothing yet').toBe(false);

        modules.state.status = 'confirmed';
        const confirmed = modules.buildBindingsState().confirmation;
        ctx.expect(confirmed.verification.confirmed, 'the success chrome is gated on the landed state').toBe(true);
        ctx.expect(confirmed.verification.processing, 'and the processing chrome goes away').toBe(false);

        modules.state.status = 'timeout';
        const timedOut = modules.buildBindingsState().confirmation;
        ctx.expect(timedOut.verification.timedOut, 'the timeout chrome is its own state').toBe(true);
        ctx.expect(timedOut.verification.confirmed, 'and is never success').toBe(false);
      },
    },

    {
      name: '#232: the built page gates its success chrome and offers support on timeout',
      run: async (ctx) => {
        // The state module can only refuse to say "confirmed" — the PAGE is what
        // renders it, so the gating has to survive into the built markup.
        const page = await confirmationPage();
        ctx.expect(page, 'confirmation page built').toBeTruthy();

        // Every one of the three moments is rendered by the layout.
        for (const flag of ['processing', 'confirmed', 'timedOut']) {
          ctx.expect(page.includes(`data-omega-bind="@show confirmation.verification.${flag}"`), `the layout renders the ${flag} moment`).toBeTruthy();
        }

        // The success language must sit INSIDE the confirmed block. Anything after
        // the timeout block's open tag is no longer success chrome.
        const confirmedAt = page.indexOf('@show confirmation.verification.confirmed');
        const successAt = page.indexOf('Payment received');
        ctx.expect(successAt > confirmedAt, '"Payment received" is gated behind the confirmed state').toBeTruthy();

        // The processing moment is the DEFAULT render — the other two start hidden,
        // so a page whose JS never runs shows the neutral state, not a false success.
        const confirmedTag = page.slice(page.lastIndexOf('<', confirmedAt), confirmedAt + 200);
        ctx.expect(confirmedTag, 'the success block starts hidden').toMatch(/hidden/);

        // The timeout moment points at support, which is the whole point of having one.
        // Bounded by the next binding rather than a character count — the icons
        // inline their whole SVG, which is longer than any window worth guessing.
        const timedOutAt = page.indexOf('@show confirmation.verification.timedOut');
        const nextBindingAt = page.indexOf('data-omega-bind', timedOutAt + 1);
        const timeoutBlock = page.slice(timedOutAt, nextBindingAt === -1 ? undefined : nextBindingAt);
        ctx.expect(timeoutBlock, 'the timeout message points at support').toMatch(/\/contact/);

        // Every confirmation binding the layout reads is one the state module builds.
        const modules = await loadModules();
        const built = modules.buildBindingsState();
        const paths = [...page.matchAll(/data-omega-bind="@(?:show|hide|text) (confirmation[\w.]*)"/g)].map((m) => m[1]);
        ctx.expect(paths.length > 0, 'the layout binds confirmation state at all').toBeTruthy();

        for (const bindingPath of new Set(paths)) {
          const value = bindingPath.split('.').reduce((node, key) => (node == null ? undefined : node[key]), { confirmation: built.confirmation });
          ctx.expect(value, `the state module builds ${bindingPath}`).not.toBe(undefined);
        }
      },
    },

    {
      name: '#232: purchaseLanded reads the account, not the URL',
      run: async (ctx) => {
        const modules = await loadModules();

        ctx.expect(modules.purchaseLanded(asUser(PREMIUM), 'premium'), 'the bought plan, active').toBe(true);
        ctx.expect(modules.purchaseLanded(asUser(BASIC), 'premium'), 'still basic').toBe(false);
        ctx.expect(modules.purchaseLanded(asUser(SUSPENDED), 'premium'), 'suspended is not entitled').toBe(false);
        ctx.expect(modules.purchaseLanded(null, 'premium'), 'no account doc at all').toBe(false);
      },
    },

    {
      name: '#232: no account doc is never answered by the plan the shopper walked in with',
      run: async (ctx) => {
        // A signed-out read hands the page `null`. Answering it from the signed-in
        // User would confirm the purchase off the plan the shopper walked in with:
        // the receipt would congratulate a returning premium subscriber on a
        // checkout that never landed.
        const modules = await loadModules({ signedIn: PREMIUM });

        ctx.expect(modules.purchaseLanded(null, 'premium'), 'a missing account doc is not a confirmation').toBe(false);
        ctx.expect(modules.purchaseLanded(undefined, 'premium'), 'and neither is no answer at all').toBe(false);

        const { outcome, reads } = await runPoll(modules, [null]);

        ctx.expect(outcome, 'the poll keeps waiting rather than reading the signed-in plan').toBe('timeout');
        ctx.expect(reads.length > 1, 'and it really did keep asking').toBeTruthy();
      },
    },

    /**
     * Ian's live QA (2026-08-15): the page rendered the order numbers off the
     * redirect the instant it loaded, then sat there for seconds under "Confirming
     * your payment" until the poll landed and the confetti fired. A receipt beside
     * a spinner reads as broken. The details are part of the ANSWER, so they wait
     * for it and arrive with the celebration, in one reveal.
     */

    {
      name: '#232 QA: the order details wait for the answer — the processing moment is alone on the page',
      run: async (ctx) => {
        const page = await confirmationPage();

        // The receipt panel is gated on the processing moment, and starts hidden so
        // the numbers never flash before the bindings run.
        const panelTag = enclosingTag(page, 'omega-receipt__panel');
        ctx.expect(panelTag, 'the receipt panel is gated on the processing moment').toMatch(/@hide confirmation\.verification\.processing/);
        ctx.expect(panelTag, 'and starts hidden, so the order never flashes before the answer').toMatch(/\bhidden\b/);

        // Every order number lives inside that gate — none of them renders early.
        const panelAt = page.indexOf('omega-receipt__panel');
        for (const binding of ['confirmation.order.id', 'confirmation.order.productName', 'confirmation.order.total']) {
          ctx.expect(page.indexOf(`@text ${binding}`) > panelAt, `${binding} renders inside the gated receipt`).toBeTruthy();
        }

        // The post-purchase ritual is the same claim in prose — it waits too.
        // The rendered TEXT, not the marker's first occurrence — the layout's own
        // comments survive into the output.
        const stepsTag = enclosingTag(page, '>What happens now<');
        ctx.expect(stepsTag, 'the "what happens now" block waits for the answer').toMatch(/@hide confirmation\.verification\.processing/);
        ctx.expect(stepsTag, 'and starts hidden').toMatch(/\bhidden\b/);
      },
    },

    {
      name: '#232 QA: the details and the celebration are the same reveal',
      run: async (ctx) => {
        // The webhook has already landed by the time the browser asks, so the poll
        // answers on its first read — the flip is what this pins, not the waiting.
        const { events, listens } = await runPage({
          search: '?orderId=ORD-1&productId=premium&productName=Premium&amount=99&currency=USD&frequency=annually&paymentMethod=stripe',
          accounts: [PREMIUM],
        });

        const celebrationAt = events.indexOf('celebration');
        ctx.expect(celebrationAt > -1, 'the celebration fired for a purchase that landed').toBeTruthy();

        const binds = events.filter((event) => event.bind).map((event) => event.bind);
        ctx.expect(binds[0].verification.processing, 'the page opens in the processing moment').toBe(true);

        // Exactly one update flips the page to confirmed, and the celebration rides
        // it — nothing renders between the reveal and the confetti.
        const reveals = binds.filter((bind) => bind.verification.confirmed);
        ctx.expect(reveals.length, 'one update reveals the answer').toBe(1);
        ctx.expect(events[celebrationAt - 1].bind, 'the celebration rides that same update').toBe(reveals[0]);
        ctx.expect(listens, 'and the page waited for auth before asking the account').toBe(1);
      },
    },

    {
      name: '#232 QA: a one-time purchase renders immediately — there is nothing to wait for',
      run: async (ctx) => {
        const modules = await loadModules();

        ctx.expect(modules.initialStatus({ frequency: 'once' }), 'a purchase with no poll opens answered').toBe('confirmed');
        ctx.expect(modules.initialStatus({ frequency: 'annually' }), 'a purchase with a poll opens unsure').toBe('processing');

        const { events, listens, reads } = await runPage({
          search: '?orderId=ORD-2&productId=launch-kit&productName=Launch%20Kit&amount=49&currency=USD&frequency=once&paymentMethod=stripe',
          accounts: [BASIC],
        });

        const binds = events.filter((event) => event.bind).map((event) => event.bind);
        ctx.expect(binds[0].verification.confirmed, 'the very first render is the answer').toBe(true);
        ctx.expect(binds[0].verification.processing, 'no processing moment at all').toBe(false);
        ctx.expect(events.indexOf('celebration'), 'and the celebration follows that render').toBe(events.length - 1);
        ctx.expect(listens, 'nothing is waited on').toBe(0);
        ctx.expect(reads, 'and no account is read').toBe(0);
      },
    },

    {
      name: '#232 QA: the timeout keeps the order reference but nothing celebratory',
      run: async (ctx) => {
        // The decision (#232, Ian's QA): a timeout SHOWS the receipt. The customer is
        // being pointed at support, and the order number is what support asks for —
        // it is a reference, not a claim that the payment went through.
        const modules = await loadModules();

        modules.state.productId = 'premium';
        modules.state.frequency = 'annually';
        modules.state.status = 'timeout';

        const timedOut = modules.buildBindingsState().confirmation;
        ctx.expect(timedOut.verification.processing, 'the details gate opens — the order number reaches support').toBe(false);
        ctx.expect(timedOut.verification.confirmed, 'and nothing says the payment landed').toBe(false);
        ctx.expect(timedOut.subscription.show, 'no "your subscription is active" on a timeout').toBe(false);

        // The celebratory rows live behind gates that both include `confirmed`
        // (subscription.show / purchase.show, #282), so revealing the receipt on a
        // timeout reveals no congratulation with it.
        const page = await confirmationPage();
        const unlockedTag = enclosingTag(page, "Everything's unlocked");
        ctx.expect(unlockedTag, 'the plan row belongs to a confirmed subscription').toMatch(/@show confirmation\.subscription\.show/);
        const purchaseTag = enclosingTag(page, 'your purchase is ready');
        ctx.expect(purchaseTag, 'the purchase row belongs to a confirmed one-time buy').toMatch(/@show confirmation\.purchase\.show/);
      },
    },

    /**
     * Ian's live QA (2026-08-15): the waiting moment sat there as static text.
     * A page that is doing something has to LOOK like it is doing something, so the
     * processing block carries the framework's spinner idiom (Bootstrap's
     * `spinner-border`, the same one /status and the account page wait with), and
     * the reduced-motion visitor gets that indicator held still beside copy that
     * says what is happening (docs/shared/theming.md).
     */

    {
      name: '#232 QA: the processing moment carries a live waiting indicator, not static text',
      run: async (ctx) => {
        const page = await confirmationPage();

        // Bounded by the next moment: only the block that WAITS is under test.
        const processingAt = page.indexOf('@show confirmation.verification.processing');
        const confirmedAt = page.indexOf('@show confirmation.verification.confirmed');
        ctx.expect(processingAt > -1 && confirmedAt > processingAt, 'the processing moment opens the three').toBeTruthy();
        const processingBlock = page.slice(processingAt, confirmedAt);

        ctx.expect(processingBlock, 'the waiting moment spins while it waits').toMatch(/class="[^"]*\bspinner-border\b/);
        ctx.expect(processingBlock, 'and announces itself as a live status').toMatch(/role="status"/);
        ctx.expect(processingBlock, 'with a label for a screen reader that cannot see it spin').toMatch(/class="visually-hidden">[^<]+</);

        // The visible copy is the waiting state's own label, so a held-still spinner
        // is never a bare ring with nothing to explain it.
        ctx.expect(processingBlock, 'the headline says what is being waited on').toMatch(/Confirming your/);
      },
    },

    {
      name: '#232 QA: the confirmation spinner parks under reduced motion, leaving a labeled still state',
      run: (ctx) => {
        // Vendored Bootstrap only SLOWS its spinner for reduced motion
        // (themes/bootstrap/scss/_spinners.scss keeps upstream's behavior), so the
        // page that uses it owns the park — the ruling is a static state, not a
        // slower loop.
        const sheet = path.join(CORE_DIR, 'css', 'pages', 'payment', 'confirmation', 'index.scss');
        const { css } = require('sass').compile(sheet);

        const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{(.*?)\n\}/gs)].map((block) => block[1]).join('\n');
        ctx.expect(reduced, 'the page parks the spinner it renders').toMatch(/\.spinner-border/);
        ctx.expect(reduced, "and the park stops the loop outright, rather than slowing it").toMatch(/animation: none/);
      },
    },

    {
      name: '#668: a one-time redirect renders its receipt without a single account read',
      run: async (ctx) => {
        // End to end through the REAL page, from the URL the intent route now builds.
        const { events, listens, reads } = await runPage({
          search: '?orderId=ORD-668&productId=launch-kit&productName=Starter%20Library&amount=49.99&currency=USD&type=one-time&frequency=annually&paymentMethod=stripe&trial=false',
          accounts: [BASIC],
        });

        ctx.expect(reads, 'nothing is polled').toBe(0);
        ctx.expect(listens, 'and nothing waits on auth to poll with').toBe(0);

        const binds = events.filter((event) => event.bind);
        ctx.expect(binds.length, 'the receipt is written once, on the first paint').toBe(1);
        ctx.expect(binds[0].bind.verification.confirmed, 'and it opens confirmed').toBe(true);
        ctx.expect(binds[0].bind.verification.processing, 'never on the processing chrome the live buy was stuck behind').toBe(false);
        ctx.expect(events.includes('celebration'), 'a purchase that landed still gets its confetti').toBeTruthy();
      },
    },
  ],
});
