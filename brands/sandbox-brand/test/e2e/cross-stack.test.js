/**
 * Cross-stack e2e for the sandbox brand: the brand's own lane, run by the
 * brand-root `omega test` walk and by the monorepo's `npm run test:e2e`.
 *
 * Infrastructure is the shared harness from @omega.js/devkit: the classic-port
 * hold, the backend emulator with its seeded personas, the web target's real dev
 * server, and the browser (resolved from this brand root, which is why nothing
 * here installs puppeteer). This file is only the brand-specific cases.
 */
const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { E2eHarness } = require('@omega.js/devkit/test/e2e-harness');

const BRAND_ROOT = path.join(__dirname, '..', '..');
// The page whose module carries the `window.__omega` hooks these cases drive
const LANE_PATH = '/e2e';
const DOC_CREATE_TIMEOUT = 90000;
const WEBHOOK_TIMEOUT = 30000;

const EMAIL = `e2e-${Date.now()}@sandbox-brand.example.com`;
const PASSWORD = 'sandbox-password-123';
// Seeded persona credentials (personas seed during emulator boot): every
// persona shares the deterministic password from @omega.js/backend's
// test-accounts.js; the domain comes from the brand's contact email.
const PERSONA_EMAIL = '_test.basic@sandbox-brand.example.com';
const PERSONA_UID = '_test-basic';
const PERSONA_PASSWORD = 'omega-test-password';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Poll authState() until check(state) returns truthy (or time runs out).
// state = { user, denied }, with user re-read from the user doc each call,
// which is how the driver observes webhook-trigger writes landing. A User
// serializes to its document only, so the getters are read in the browser.
async function waitForAuthState(page, check, label, timeout = WEBHOOK_TIMEOUT) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => window.__omega.authState().then((s) => ({
      status: s.user.subscription.status,
      productId: s.user.subscription.product.id,
      provider: s.user.subscription.payment.provider,
      cancellationPending: s.user.subscription.cancellation.pending,
      plan: s.user.plan,
      active: s.user.active,
      cancelling: s.user.cancelling,
    })));
    if (check(last)) {
      return last;
    }
    await sleep(1000);
  }
  throw new Error(`${label} not reached within ${timeout / 1000}s (last: ${JSON.stringify(last)})`);
}

module.exports = defineCases({
  type: 'suite',
  description: 'Sandbox brand cross-stack e2e',
  timeout: 300000,
  async setup(ctx) {
    if (process.env.OMEGA_SKIP_E2E === '1') ctx.skip('OMEGA_SKIP_E2E=1');
    console.log(`  user: ${EMAIL}`);

    const harness = new E2eHarness(BRAND_ROOT);
    ctx.state.harness = harness;
    await harness.boot();

    const browser = await harness.launchBrowser();
    ctx.state.page = await browser.newPage();
    // Console capture + the resolved emulator port map (the fallback channel
    // for anything the dev server's own page chrome does not carry)
    await harness.preparePage(ctx.state.page);
  },
  async cleanup(ctx) {
    // Unset only when setup skipped before building it.
    if (ctx.state.harness) await ctx.state.harness.teardown();
  },
  tests: [
    {
      name: 'page boots @omega.js/client against the emulators',
      async run(ctx) {
        const { harness, page } = ctx.state;
        // The lane's page is a REAL @omega.js/web page served by the real
        // `omega dev` (mkcert HTTPS); its module hangs the hooks below off the
        // client the framework boots (targets/web/src/assets/js/pages/e2e/index.js).
        await page.goto(`${harness.siteUrl}${LANE_PATH}`, { waitUntil: 'load' });
        // A client that fails to boot never flips isReady; the boot's own
        // `Page module error:` line in page.log is the diagnosis
        await page.waitForFunction('window.__omega && window.__omega.isReady', { timeout: 30000 });
        // Auth connects at boot; Firestore connects inside its loader, on first use
        if (!harness.pageConsole.some((line) => line.includes('[@omega.js/client:firebase] Connecting the auth emulator'))) {
          throw new Error('client did not auto-connect to the emulators (dev mode must connect with zero flags: check [@omega.js/client:firebase] lines in page.log)');
        }
      },
    },
    {
      name: 'the chart helper draws all four chart types as SVG marks',
      async run(ctx) {
        // Node compiles a chart SCENE, but only a real browser lays a host out,
        // measures its guides and paints it. Here it does.
        const result = await ctx.state.page.evaluate(() => window.__omega.drawCharts());
        if (!result.loaded) {
          throw new Error('@tanstack/charts never loaded: the lazy chunk did not arrive');
        }
        const blank = Object.entries(result.drew).filter(([, chart]) => !chart.built || chart.marks === 0);
        if (blank.length) {
          throw new Error(`chart(s) drew no SVG marks: ${JSON.stringify(Object.fromEntries(blank))}`);
        }
        console.log(`      ${Object.entries(result.drew).map(([name, chart]) => `${name} (${chart.marks} marks)`).join(', ')}`);
      },
    },
    {
      name: 'seeded persona signs in with the known password',
      async run(ctx) {
        const { page } = ctx.state;
        // The manual-dev DX, proven in a real browser: the emulator seeded
        // personas during boot, so email + TEST_ACCOUNT_PASSWORD just works.
        const personaUid = await page.evaluate(
          (email, password) => window.__omega.signIn(email, password),
          PERSONA_EMAIL, PERSONA_PASSWORD,
        );
        if (personaUid !== PERSONA_UID) {
          throw new Error(`persona uid mismatch: ${personaUid} !== ${PERSONA_UID}`);
        }
        await page.evaluate(() => window.__omega.signOut());
        console.log(`      ${PERSONA_EMAIL}`);
      },
    },
    {
      name: 'signup creates the auth user',
      async run(ctx) {
        ctx.state.uid = await ctx.state.page.evaluate(
          (email, password) => window.__omega.signUp(email, password),
          EMAIL, PASSWORD,
        );
        if (!ctx.state.uid) {
          throw new Error('signup returned no uid');
        }
        console.log(`      uid: ${ctx.state.uid}`);
      },
    },
    {
      name: '@omega.js/backend auth onCreate creates the Firestore user doc',
      async run(ctx) {
        const { page, uid } = ctx.state;
        const deadline = Date.now() + DOC_CREATE_TIMEOUT;
        let last = null;
        while (Date.now() < deadline) {
          last = await page.evaluate(() => window.__omega.authState().then((state) => ({
            uid: state.user.auth.uid,
            clientId: state.user.api.clientId,
          })));
          if (last.clientId) {
            if (last.uid !== uid) {
              throw new Error(`user doc uid mismatch: ${last.uid} !== ${uid}`);
            }
            console.log(`      api.clientId: ${last.clientId}`);
            return;
          }
          await sleep(1500);
        }
        throw new Error(`user doc not created within ${DOC_CREATE_TIMEOUT / 1000}s (last state: ${JSON.stringify(last)})`);
      },
    },
    {
      name: 'sign out',
      async run(ctx) {
        const { page } = ctx.state;
        await page.evaluate(() => window.__omega.signOut());
        const authenticated = await page.evaluate(() => window.__omega.currentUser().authenticated);
        if (authenticated) {
          throw new Error('currentUser still set after signOut');
        }
      },
    },
    {
      name: 'sign in via @omega.js/client',
      async run(ctx) {
        const signedInUid = await ctx.state.page.evaluate(
          (email, password) => window.__omega.signIn(email, password),
          EMAIL, PASSWORD,
        );
        if (signedInUid !== ctx.state.uid) {
          throw new Error(`signin uid mismatch: ${signedInUid} !== ${ctx.state.uid}`);
        }
      },
    },
    {
      name: 'session persists across reload',
      async run(ctx) {
        const { page, uid } = ctx.state;
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction('window.__omega && window.__omega.isReady', { timeout: 30000 });
        const state = await page.evaluate(() => window.__omega.authState().then((s) => ({
          uid: s.user.uid,
          clientId: s.user.api.clientId,
        })));
        if (state.uid !== uid) {
          throw new Error(`restored session uid mismatch: ${JSON.stringify(state)}`);
        }
        if (!state.clientId) {
          throw new Error('account doc not readable after reload');
        }
      },
    },
    {
      name: 'subscription resolves for a fresh user',
      async run(ctx) {
        const resolved = await ctx.state.page.evaluate(() => window.__omega.authState().then((s) => ({
          email: s.user.auth.email,
          plan: s.user.plan,
          active: s.user.active,
          everPaid: s.user.everPaid,
        })));
        if (resolved.email !== EMAIL || resolved.plan !== 'basic' || resolved.active !== false || resolved.everPaid !== false) {
          throw new Error(`unexpected resolved state: ${JSON.stringify(resolved)}`);
        }
        console.log(`      plan: ${resolved.plan}, active: ${resolved.active}`);
      },
    },
    // Lifecycle flows: the signed-in user drives subscribe, cancel, refund,
    // data-request and delete through the browser, on real backend routes and
    // real webhook triggers, mirroring the corpus's test-provider journey.
    {
      name: 'subscribe via test-provider intent activates premium',
      async run(ctx) {
        const { page } = ctx.state;
        const intent = await page.evaluate(() => window.__omega.api('POST', 'payments/intent', {
          provider: 'test',
          productId: 'premium',
          frequency: 'monthly',
        }));
        if (!intent.ok) {
          throw new Error(`intent failed (${intent.status}): ${intent.text}`);
        }
        const state = await waitForAuthState(
          page,
          (s) => s.status === 'active' && s.provider === 'test' && s.productId === 'premium',
          'active test-provider subscription',
        );
        console.log(`      plan: ${state.plan}, active: ${state.active}`);
      },
    },
    {
      name: 'cancel (confirmed) → webhook flips cancellation.pending',
      async run(ctx) {
        const { page } = ctx.state;
        const cancel = await page.evaluate(() => window.__omega.api('POST', 'payments/cancel', {
          confirmed: true,
          skipGuards: true, // sub is seconds old; the 24h guard is for humans
          reason: 'e2e-cancel',
        }));
        if (!cancel.ok || !cancel.json || cancel.json.success !== true) {
          throw new Error(`cancel failed (${cancel.status}): ${cancel.text}`);
        }
        const state = await waitForAuthState(
          page,
          (s) => s.cancellationPending === true && s.status === 'active',
          'cancellation pending (status stays active until period end)',
        );
        if (state.cancelling !== true) {
          throw new Error(`user.cancelling should be true: ${JSON.stringify(state)}`);
        }
      },
    },
    {
      name: 'refund (confirmed) → webhook cancels the subscription',
      async run(ctx) {
        const { page } = ctx.state;
        const refund = await page.evaluate(() => window.__omega.api('POST', 'payments/refund', {
          confirmed: true,
          reason: 'e2e-refund',
          feedback: 'cross-stack lifecycle test',
        }));
        if (!refund.ok || !refund.json || refund.json.success !== true) {
          throw new Error(`refund failed (${refund.status}): ${refund.text}`);
        }
        if (!refund.json.refund || refund.json.refund.full !== true) {
          throw new Error(`refund response missing full refund: ${refund.text}`);
        }
        const state = await waitForAuthState(
          page,
          (s) => s.status === 'cancelled',
          'subscription cancelled after refund webhook',
        );
        if (state.active !== false) {
          throw new Error(`user.active should be false: ${JSON.stringify(state)}`);
        }
        console.log(`      refund: ${refund.json.refund.amount} (full)`);
      },
    },
    {
      name: 'data-request created (pending)',
      async run(ctx) {
        const created = await ctx.state.page.evaluate(() => window.__omega.api('POST', 'user/data-request', {
          confirmed: true,
          reason: 'e2e-data-request',
        }));
        if (!created.ok || !created.json || !created.json.request || created.json.request.status !== 'pending') {
          throw new Error(`data-request create failed (${created.status}): ${created.text}`);
        }
        ctx.state.dataRequestId = created.json.request.id;
        console.log(`      id: ${ctx.state.dataRequestId}`);
      },
    },
    {
      name: 'data-request status reports the pending request',
      async run(ctx) {
        const status = await ctx.state.page.evaluate(() => window.__omega.api('GET', 'user/data-request'));
        if (!status.ok || !status.json || !status.json.request) {
          throw new Error(`data-request status failed (${status.status}): ${status.text}`);
        }
        if (status.json.request.id !== ctx.state.dataRequestId || status.json.request.status !== 'pending') {
          throw new Error(`unexpected data-request status: ${JSON.stringify(status.json.request)}`);
        }
      },
    },
    {
      name: 'data-request cancel removes the pending request',
      async run(ctx) {
        const { page, dataRequestId } = ctx.state;
        const cancelled = await page.evaluate(() => window.__omega.api('DELETE', 'user/data-request'));
        if (!cancelled.ok || !cancelled.json || !cancelled.json.request || cancelled.json.request.id !== dataRequestId) {
          throw new Error(`data-request cancel failed (${cancelled.status}): ${cancelled.text}`);
        }
        const after = await page.evaluate(() => window.__omega.api('GET', 'user/data-request'));
        if (!after.ok || !after.json || after.json.request !== null) {
          throw new Error(`request should be gone after cancel: ${after.text}`);
        }
      },
    },
    {
      name: 'delete account (allowed post-refund) → signin fails',
      async run(ctx) {
        const { page } = ctx.state;
        const deleted = await page.evaluate(() => window.__omega.api('DELETE', 'user'));
        if (!deleted.ok || !deleted.json || deleted.json.success !== true) {
          throw new Error(`delete failed (${deleted.status}): ${deleted.text}`);
        }
        await page.evaluate(() => window.__omega.signOut());
        const signinError = await page.evaluate(
          (email, password) => window.__omega.signIn(email, password)
            .then(() => null)
            .catch((error) => error.message || 'rejected'),
          EMAIL, PASSWORD,
        );
        if (!signinError) {
          throw new Error('signin succeeded for a deleted account');
        }
        console.log(`      signin rejected: ${signinError.slice(0, 60)}`);
      },
    },
  ],
});
