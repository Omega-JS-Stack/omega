/**
 * /payment/confirmation — the page must not call a purchase successful until
 * the purchase actually EXISTS ([#232](https://github.com/Omega-JS-Stack/omega/issues/232)).
 *
 * The bug this pins: entitlement is granted by the payment WEBHOOK, which lands
 * after the processor has already redirected the browser here. The page read
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
const assert = require('node:assert');
const { test } = require('node:test');
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
        build.onResolve({ filter: /^@omega\.js\/client$/ }, () => {
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

// The REAL subscription derivation — the same @omega.js/account math the client
// singleton exposes, so "does the account reflect the purchase" is answered here
// exactly as it is in a browser.
const resolveSubscription = require('@omega.js/account/subscription');

/**
 * @param {object} [options]
 * @param {object|null} [options.cached] - what the client's stored auth state
 *   holds. The REAL `auth().resolveSubscription(account)` answers from
 *   `account || storage().get('auth').account` (client/src/modules/auth.js), so
 *   handing it nothing reads the plan the shopper walked in with — the stub has
 *   to carry that fallback or it proves the opposite of the shipped code.
 */
async function loadModules({ cached = null } = {}) {
  await bundleOnce();

  globalThis.__omegaClient = {
    auth: () => ({
      getUser: () => ({ uid: 'test-uid' }),
      resolveSubscription: (account) => resolveSubscription(account || cached),
    }),
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
    dom: () => ({
      ready: async () => {},
      loadScript: async () => {
        events.push('celebration');
        globalThis.window.confetti = () => {};
      },
    }),
    bindings: () => ({
      update: (bound) => events.push({ bind: bound.confirmation }),
    }),
    auth: () => ({
      listen: (options, callback) => {
        listens++;
        callback();
      },
      getUser: () => ({ uid: 'test-uid' }),
      resolveSubscription: (account) => resolveSubscription(account),
    }),
    firestore: () => ({
      doc: () => ({
        get: async () => {
          const account = accounts[Math.min(reads, accounts.length - 1)];
          reads++;
          return { exists: () => !!account, data: () => account };
        },
      }),
    }),
    notifications: () => ({ subscribe: async () => {} }),
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
  assert.ok(at > -1, `the page renders ${marker}`);
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
      return answer;
    },
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
    intervalMs: 1000,
    timeoutMs: 10000,
  });

  return { outcome, reads, clock };
}

test('#232: the page waits for the webhook rather than trusting the redirect', async () => {
  const modules = await loadModules();

  // The account is still basic for the first two reads — the webhook is in
  // flight — then the entitlement lands.
  const { outcome, reads } = await runPoll(modules, [BASIC, BASIC, PREMIUM]);

  assert.strictEqual(outcome, 'confirmed', 'the purchase is confirmed once the account actually carries it');
  assert.strictEqual(reads.length, 3, 'and it kept asking until then, rather than answering off the redirect');
});

test('#232: a webhook that never lands times out instead of claiming success', async () => {
  const modules = await loadModules();

  // Local dev with no webhook delivery — the exact shape Ian hit.
  const { outcome, clock } = await runPoll(modules, [BASIC]);

  assert.strictEqual(outcome, 'timeout', 'no entitlement, no success');
  assert.ok(clock >= 10000, 'the whole budget was spent asking before giving up');
});

test('#232: a DECLINED checkout never renders success', async () => {
  const modules = await loadModules();

  // The live repro: the backend declined, `checkout-declined` suspended the
  // account, and the test processor still returned the normal confirmation URL.
  const { outcome } = await runPoll(modules, [SUSPENDED]);

  assert.strictEqual(outcome, 'timeout', 'a suspended account is not a completed purchase');
});

test('#232: a read that fails is not a NO — the poll keeps asking', async () => {
  const modules = await loadModules();

  // A network blip mid-poll must not fabricate a verdict in either direction.
  const { outcome, reads } = await runPoll(modules, [new Error('offline'), new Error('offline'), PREMIUM]);

  assert.strictEqual(outcome, 'confirmed', 'the answer comes from the account, not from a failed read');
  assert.strictEqual(reads.length, 3, 'both failures were retried');
});

test('#232: the purchase must be the plan that was bought, not merely any plan', async () => {
  const modules = await loadModules();

  // A user who already held `premium` buying `pro` must not be confirmed by the
  // plan they walked in with.
  const { outcome } = await runPoll(modules, [PREMIUM], { productId: 'pro', frequency: 'annually' });

  assert.strictEqual(outcome, 'timeout', 'the wrong plan is not this purchase landing');
});

test('#232: a one-time purchase has no account state to wait for', async () => {
  const modules = await loadModules();

  // A one-time buy arrives as `frequency=once` and writes nothing to the
  // account doc, so there is nothing to poll for — the receipt is the answer.
  const { outcome, reads } = await runPoll(modules, [BASIC], { productId: 'launch-kit', frequency: 'once' });

  assert.strictEqual(outcome, 'confirmed', 'a one-time purchase is not held behind a subscription poll');
  assert.strictEqual(reads.length, 0, 'and nothing is read at all');
  assert.strictEqual(modules.isVerifiable({ frequency: 'once' }), false, 'one-time is not verifiable against the account');
  assert.strictEqual(modules.isVerifiable({ frequency: 'annually' }), true, 'a real cadence is');
});

test('#232: the receipt renders processing, then success — never success first', async () => {
  const modules = await loadModules();

  modules.state.productId = 'premium';
  modules.state.frequency = 'annually';

  // The page opens unsure: the redirect has told it nothing it can trust.
  const opening = modules.buildBindingsState().confirmation;
  assert.strictEqual(opening.verification.processing, true, 'the page opens in processing');
  assert.strictEqual(opening.verification.confirmed, false, 'and claims nothing');
  assert.strictEqual(opening.verification.timedOut, false, 'and blames nothing yet');

  modules.state.status = 'confirmed';
  const confirmed = modules.buildBindingsState().confirmation;
  assert.strictEqual(confirmed.verification.confirmed, true, 'the success chrome is gated on the landed state');
  assert.strictEqual(confirmed.verification.processing, false, 'and the processing chrome goes away');

  modules.state.status = 'timeout';
  const timedOut = modules.buildBindingsState().confirmation;
  assert.strictEqual(timedOut.verification.timedOut, true, 'the timeout chrome is its own state');
  assert.strictEqual(timedOut.verification.confirmed, false, 'and is never success');
});

test('#232: the built page gates its success chrome and offers support on timeout', async () => {
  // The state module can only refuse to say "confirmed" — the PAGE is what
  // renders it, so the gating has to survive into the built markup.
  const page = await confirmationPage();
  assert.ok(page, 'confirmation page built');

  // Every one of the three moments is rendered by the layout.
  for (const flag of ['processing', 'confirmed', 'timedOut']) {
    assert.ok(
      page.includes(`data-omega-bind="@show confirmation.verification.${flag}"`),
      `the layout renders the ${flag} moment`,
    );
  }

  // The success language must sit INSIDE the confirmed block. Anything after
  // the timeout block's open tag is no longer success chrome.
  const confirmedAt = page.indexOf('@show confirmation.verification.confirmed');
  const successAt = page.indexOf('Payment received');
  assert.ok(successAt > confirmedAt, '"Payment received" is gated behind the confirmed state');

  // The processing moment is the DEFAULT render — the other two start hidden,
  // so a page whose JS never runs shows the neutral state, not a false success.
  const confirmedTag = page.slice(page.lastIndexOf('<', confirmedAt), confirmedAt + 200);
  assert.match(confirmedTag, /hidden/, 'the success block starts hidden');

  // The timeout moment points at support, which is the whole point of having one.
  // Bounded by the next binding rather than a character count — the icons
  // inline their whole SVG, which is longer than any window worth guessing.
  const timedOutAt = page.indexOf('@show confirmation.verification.timedOut');
  const nextBindingAt = page.indexOf('data-omega-bind', timedOutAt + 1);
  const timeoutBlock = page.slice(timedOutAt, nextBindingAt === -1 ? undefined : nextBindingAt);
  assert.match(timeoutBlock, /\/contact/, 'the timeout message points at support');

  // Every confirmation binding the layout reads is one the state module builds.
  const modules = await loadModules();
  const built = modules.buildBindingsState();
  const paths = [...page.matchAll(/data-omega-bind="@(?:show|hide|text) (confirmation[\w.]*)"/g)].map((m) => m[1]);
  assert.ok(paths.length > 0, 'the layout binds confirmation state at all');

  for (const bindingPath of new Set(paths)) {
    const value = bindingPath.split('.').reduce((node, key) => (node == null ? undefined : node[key]), { confirmation: built.confirmation });
    assert.notStrictEqual(value, undefined, `the state module builds ${bindingPath}`);
  }
});

test('#232: purchaseLanded reads the account, not the URL', async () => {
  const modules = await loadModules();

  assert.strictEqual(modules.purchaseLanded(PREMIUM, 'premium'), true, 'the bought plan, active');
  assert.strictEqual(modules.purchaseLanded(BASIC, 'premium'), false, 'still basic');
  assert.strictEqual(modules.purchaseLanded(SUSPENDED, 'premium'), false, 'suspended is not entitled');
  assert.strictEqual(modules.purchaseLanded(null, 'premium'), false, 'no account doc at all');
});

test('#232: no account doc is never answered out of cached storage', async () => {
  // A signed-out read, or a user doc that does not exist yet, hands the page
  // `null`. The client's own resolveSubscription answers a null account from
  // the STORED auth state, so passing it through would confirm the purchase off
  // whatever plan localStorage still remembers — the receipt would congratulate
  // a returning premium subscriber on a checkout that never landed.
  const modules = await loadModules({ cached: PREMIUM });

  assert.strictEqual(modules.purchaseLanded(null, 'premium'), false, 'a missing account doc is not a confirmation');
  assert.strictEqual(modules.purchaseLanded(undefined, 'premium'), false, 'and neither is no answer at all');

  const { outcome, reads } = await runPoll(modules, [null]);

  assert.strictEqual(outcome, 'timeout', 'the poll keeps waiting rather than reading the cache');
  assert.ok(reads.length > 1, 'and it really did keep asking');
});

/**
 * Ian's live QA (2026-08-15): the page rendered the order numbers off the
 * redirect the instant it loaded, then sat there for seconds under "Confirming
 * your payment" until the poll landed and the confetti fired. A receipt beside
 * a spinner reads as broken. The details are part of the ANSWER, so they wait
 * for it and arrive with the celebration, in one reveal.
 */

test('#232 QA: the order details wait for the answer — the processing moment is alone on the page', async () => {
  const page = await confirmationPage();

  // The receipt panel is gated on the processing moment, and starts hidden so
  // the numbers never flash before the bindings run.
  const panelTag = enclosingTag(page, 'omega-receipt__panel');
  assert.match(panelTag, /@hide confirmation\.verification\.processing/, 'the receipt panel is gated on the processing moment');
  assert.match(panelTag, /\bhidden\b/, 'and starts hidden, so the order never flashes before the answer');

  // Every order number lives inside that gate — none of them renders early.
  const panelAt = page.indexOf('omega-receipt__panel');
  for (const binding of ['confirmation.order.id', 'confirmation.order.productName', 'confirmation.order.total']) {
    assert.ok(page.indexOf(`@text ${binding}`) > panelAt, `${binding} renders inside the gated receipt`);
  }

  // The post-purchase ritual is the same claim in prose — it waits too.
  // The rendered TEXT, not the marker's first occurrence — the layout's own
  // comments survive into the output.
  const stepsTag = enclosingTag(page, '>What happens now<');
  assert.match(stepsTag, /@hide confirmation\.verification\.processing/, 'the "what happens now" block waits for the answer');
  assert.match(stepsTag, /\bhidden\b/, 'and starts hidden');
});

test('#232 QA: the details and the celebration are the same reveal', async () => {
  // The webhook has already landed by the time the browser asks, so the poll
  // answers on its first read — the flip is what this pins, not the waiting.
  const { events, listens } = await runPage({
    search: '?orderId=ORD-1&productId=premium&productName=Premium&amount=99&currency=USD&frequency=annually&paymentMethod=stripe',
    accounts: [PREMIUM],
  });

  const celebrationAt = events.indexOf('celebration');
  assert.ok(celebrationAt > -1, 'the celebration fired for a purchase that landed');

  const binds = events.filter((event) => event.bind).map((event) => event.bind);
  assert.strictEqual(binds[0].verification.processing, true, 'the page opens in the processing moment');

  // Exactly one update flips the page to confirmed, and the celebration rides
  // it — nothing renders between the reveal and the confetti.
  const reveals = binds.filter((bind) => bind.verification.confirmed);
  assert.strictEqual(reveals.length, 1, 'one update reveals the answer');
  assert.strictEqual(events[celebrationAt - 1].bind, reveals[0], 'the celebration rides that same update');
  assert.strictEqual(listens, 1, 'and the page waited for auth before asking the account');
});

test('#232 QA: a one-time purchase renders immediately — there is nothing to wait for', async () => {
  const modules = await loadModules();

  assert.strictEqual(modules.initialStatus({ frequency: 'once' }), 'confirmed', 'a purchase with no poll opens answered');
  assert.strictEqual(modules.initialStatus({ frequency: 'annually' }), 'processing', 'a purchase with a poll opens unsure');

  const { events, listens, reads } = await runPage({
    search: '?orderId=ORD-2&productId=launch-kit&productName=Launch%20Kit&amount=49&currency=USD&frequency=once&paymentMethod=stripe',
    accounts: [BASIC],
  });

  const binds = events.filter((event) => event.bind).map((event) => event.bind);
  assert.strictEqual(binds[0].verification.confirmed, true, 'the very first render is the answer');
  assert.strictEqual(binds[0].verification.processing, false, 'no processing moment at all');
  assert.strictEqual(events.indexOf('celebration'), events.length - 1, 'and the celebration follows that render');
  assert.strictEqual(listens, 0, 'nothing is waited on');
  assert.strictEqual(reads, 0, 'and no account is read');
});

test('#232 QA: the timeout keeps the order reference but nothing celebratory', async () => {
  // The decision (#232, Ian's QA): a timeout SHOWS the receipt. The customer is
  // being pointed at support, and the order number is what support asks for —
  // it is a reference, not a claim that the payment went through.
  const modules = await loadModules();

  modules.state.productId = 'premium';
  modules.state.frequency = 'annually';
  modules.state.status = 'timeout';

  const timedOut = modules.buildBindingsState().confirmation;
  assert.strictEqual(timedOut.verification.processing, false, 'the details gate opens — the order number reaches support');
  assert.strictEqual(timedOut.verification.confirmed, false, 'and nothing says the payment landed');
  assert.strictEqual(timedOut.subscription.show, false, 'no "your subscription is active" on a timeout');

  // The celebratory rows live behind gates that both include `confirmed`
  // (subscription.show / purchase.show, #282), so revealing the receipt on a
  // timeout reveals no congratulation with it.
  const page = await confirmationPage();
  const unlockedTag = enclosingTag(page, "Everything's unlocked");
  assert.match(unlockedTag, /@show confirmation\.subscription\.show/, 'the plan row belongs to a confirmed subscription');
  const purchaseTag = enclosingTag(page, 'your purchase is ready');
  assert.match(purchaseTag, /@show confirmation\.purchase\.show/, 'the purchase row belongs to a confirmed one-time buy');
});

/**
 * Ian's live QA (2026-08-15): the waiting moment sat there as static text.
 * A page that is doing something has to LOOK like it is doing something, so the
 * processing block carries the framework's spinner idiom (Bootstrap's
 * `spinner-border`, the same one /status and the account page wait with), and
 * the reduced-motion visitor gets that indicator held still beside copy that
 * says what is happening (docs/shared/theming.md).
 */

test('#232 QA: the processing moment carries a live waiting indicator, not static text', async () => {
  const page = await confirmationPage();

  // Bounded by the next moment: only the block that WAITS is under test.
  const processingAt = page.indexOf('@show confirmation.verification.processing');
  const confirmedAt = page.indexOf('@show confirmation.verification.confirmed');
  assert.ok(processingAt > -1 && confirmedAt > processingAt, 'the processing moment opens the three');
  const processingBlock = page.slice(processingAt, confirmedAt);

  assert.match(processingBlock, /class="[^"]*\bspinner-border\b/, 'the waiting moment spins while it waits');
  assert.match(processingBlock, /role="status"/, 'and announces itself as a live status');
  assert.match(processingBlock, /class="visually-hidden">[^<]+</, 'with a label for a screen reader that cannot see it spin');

  // The visible copy is the waiting state's own label, so a held-still spinner
  // is never a bare ring with nothing to explain it.
  assert.match(processingBlock, /Confirming your/, 'the headline says what is being waited on');
});

test('#232 QA: the confirmation spinner parks under reduced motion, leaving a labeled still state', () => {
  // Vendored Bootstrap only SLOWS its spinner for reduced motion
  // (themes/bootstrap/scss/_spinners.scss keeps upstream's behavior), so the
  // page that uses it owns the park — the ruling is a static state, not a
  // slower loop.
  const sheet = path.join(CORE_DIR, 'css', 'pages', 'payment', 'confirmation', 'index.scss');
  const { css } = require('sass').compile(sheet);

  const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{(.*?)\n\}/gs)].map((block) => block[1]).join('\n');
  assert.match(reduced, /\.spinner-border/, 'the page parks the spinner it renders');
  assert.match(reduced, /animation: none/, "and the park stops the loop outright, rather than slowing it");
});
