/**
 * Cross-stack e2e for the sandbox brand — the brand's own lane, run by `npm
 * test` at the brand root and by the brand-root `omega test` walk (#775).
 *
 * Infrastructure is the shared harness from @omega.js/devkit: the classic-port
 * hold, the backend emulator with its seeded personas, the website's real dev
 * server, and the browser (resolved from this brand root, which is why nothing
 * here installs puppeteer). This file is only the brand-specific STEPS.
 */
const path = require('path');

if (process.env.OMEGA_SKIP_E2E === '1') {
  console.log('⏭ OMEGA_SKIP_E2E=1 — skipping sandbox e2e');
  process.exit(0);
}

const { E2eHarness } = require('@omega.js/devkit/test/e2e-harness');

const BRAND_ROOT = path.join(__dirname, '..', '..');
// The page whose module carries the `window.__omega` hooks these steps drive
const LANE_PATH = '/e2e';
const DOC_CREATE_TIMEOUT = 90000;
const WEBHOOK_TIMEOUT = 30000;

const EMAIL = `e2e-${Date.now()}@sandbox-brand.example.com`;
const PASSWORD = 'sandbox-password-123';
// Seeded persona credentials (personas seed during emulator boot — cp85):
// every persona shares the deterministic password from @omega.js/backend's
// test-accounts.js; the domain comes from the brand's contact email.
const PERSONA_EMAIL = '_test.basic@sandbox-brand.example.com';
const PERSONA_UID = '_test-basic';
const PERSONA_PASSWORD = 'omega-test-password';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Poll authState() until check(state) returns truthy (or time runs out).
// state = { user, account, resolved } — account re-fetches the user doc each
// call, which is how the driver observes webhook-trigger writes landing.
async function waitForAuthState(page, check, label, timeout = WEBHOOK_TIMEOUT) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => window.__omega.authState().then((s) => ({
      status: s.account.subscription.status,
      productId: s.account.subscription.product.id,
      provider: s.account.subscription.payment.provider,
      cancellationPending: s.account.subscription.cancellation.pending,
      resolved: s.resolved,
    })));
    if (check(last)) {
      return last;
    }
    await sleep(1000);
  }
  throw new Error(`${label} not reached within ${timeout / 1000}s (last: ${JSON.stringify(last)})`);
}

async function main() {
  const harness = new E2eHarness(BRAND_ROOT);

  // The site URL prints in the 'website serves' step detail — the port is
  // allocator-resolved during boot, so it isn't known (truthfully) yet here.
  console.log('\nSandbox brand cross-stack e2e');
  console.log(`  user: ${EMAIL}\n`);

  try {
    await harness.boot();

    const browser = await harness.launchBrowser();
    const page = await browser.newPage();
    // Known only after boot: the dev server reports its own origin (protocol
    // included — `omega dev` serves mkcert HTTPS).
    const lanePage = `${harness.siteUrl}${LANE_PATH}`;
    // Console capture + the resolved emulator port map (the fallback channel
    // for anything the dev server's own page chrome does not carry, #300)
    await harness.preparePage(page);

    await harness.step('page boots @omega.js/client against the emulators', async () => {
      // The lane's page is a REAL @omega.js/web page served by the real
      // `omega dev`; its module hangs the hooks below off the client the
      // framework boots (targets/website/src/assets/js/pages/e2e/index.js).
      await page.goto(lanePage, { waitUntil: 'load' });
      // A client that fails to boot never flips isReady; the boot's own
      // `Page module error:` line in page.log is the diagnosis
      await page.waitForFunction('window.__omega && window.__omega.isReady', { timeout: 30000 });
      if (!harness.pageConsole.some((line) => line.includes('[@omega.js/client:firebase] Emulators connected'))) {
        throw new Error('client did not auto-connect to the emulators (dev mode must connect with zero flags — check [@omega.js/client:firebase] lines in page.log)');
      }
    });

    await harness.step('the chart helper draws all four chart types as SVG marks', async () => {
      // #74/#772: node compiles a chart SCENE, but only a real browser lays a
      // host out, measures its guides and paints it. Here it does.
      const result = await page.evaluate(() => window.__omega.drawCharts());
      if (!result.loaded) {
        throw new Error('@tanstack/charts never loaded — the lazy chunk did not arrive');
      }
      const blank = Object.entries(result.drew).filter(([, chart]) => !chart.built || chart.marks === 0);
      if (blank.length) {
        throw new Error(`chart(s) drew no SVG marks: ${JSON.stringify(Object.fromEntries(blank))}`);
      }
      return Object.entries(result.drew).map(([name, chart]) => `${name} (${chart.marks} marks)`).join(', ');
    });

    await harness.step('seeded persona signs in with the known password', async () => {
      // The cp85 manual-dev DX, proven in a real browser: the emulator seeded
      // personas during boot, so email + TEST_ACCOUNT_PASSWORD just works.
      const personaUid = await page.evaluate(
        (email, password) => window.__omega.signIn(email, password),
        PERSONA_EMAIL, PERSONA_PASSWORD,
      );
      if (personaUid !== PERSONA_UID) {
        throw new Error(`persona uid mismatch: ${personaUid} !== ${PERSONA_UID}`);
      }
      await page.evaluate(() => window.__omega.signOut());
      return PERSONA_EMAIL;
    });

    let uid = null;

    await harness.step('signup creates the auth user', async () => {
      uid = await page.evaluate(
        (email, password) => window.__omega.signUp(email, password),
        EMAIL, PASSWORD,
      );
      if (!uid) {
        throw new Error('signup returned no uid');
      }
      return `uid: ${uid}`;
    });

    await harness.step('@omega.js/backend auth onCreate creates the Firestore user doc', async () => {
      const deadline = Date.now() + DOC_CREATE_TIMEOUT;
      let last = null;
      while (Date.now() < deadline) {
        last = await page.evaluate(() => window.__omega.authState().then((state) => ({
          uid: state.account.auth.uid,
          clientId: state.account.api.clientId,
        })));
        if (last.clientId) {
          if (last.uid !== uid) {
            throw new Error(`user doc uid mismatch: ${last.uid} !== ${uid}`);
          }
          return `api.clientId: ${last.clientId}`;
        }
        await sleep(1500);
      }
      throw new Error(`user doc not created within ${DOC_CREATE_TIMEOUT / 1000}s (last state: ${JSON.stringify(last)})`);
    });

    await harness.step('sign out', async () => {
      await page.evaluate(() => window.__omega.signOut());
      const user = await page.evaluate(() => window.__omega.currentUser());
      if (user) {
        throw new Error('currentUser still set after signOut');
      }
    });

    await harness.step('sign in via @omega.js/client', async () => {
      const signedInUid = await page.evaluate(
        (email, password) => window.__omega.signIn(email, password),
        EMAIL, PASSWORD,
      );
      if (signedInUid !== uid) {
        throw new Error(`signin uid mismatch: ${signedInUid} !== ${uid}`);
      }
    });

    await harness.step('session persists across reload', async () => {
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction('window.__omega && window.__omega.isReady', { timeout: 30000 });
      const state = await page.evaluate(() => window.__omega.authState().then((s) => ({
        uid: s.user && s.user.uid,
        clientId: s.account.api.clientId,
      })));
      if (state.uid !== uid) {
        throw new Error(`restored session uid mismatch: ${JSON.stringify(state)}`);
      }
      if (!state.clientId) {
        throw new Error('account doc not readable after reload');
      }
    });

    await harness.step('subscription resolves for a fresh user', async () => {
      const resolved = await page.evaluate(() => window.__omega.authState().then((s) => ({
        email: s.account.auth.email,
        plan: s.resolved.plan,
        active: s.resolved.active,
        everPaid: s.resolved.everPaid,
      })));
      if (resolved.email !== EMAIL || resolved.plan !== 'basic' || resolved.active !== false || resolved.everPaid !== false) {
        throw new Error(`unexpected resolved state: ${JSON.stringify(resolved)}`);
      }
      return `plan: ${resolved.plan}, active: ${resolved.active}`;
    });

    // -- Lifecycle flows (N6, cp86): the signed-in user drives subscribe →
    // cancel → refund → data-request → delete, all through the browser with
    // real backend routes + real webhook triggers. Mirrors the corpus's
    // test-provider journey (test/routes/payments/cancel.js + refund.js).

    await harness.step('subscribe via test-provider intent activates premium', async () => {
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
      return `plan: ${state.resolved.plan}, active: ${state.resolved.active}`;
    });

    await harness.step('cancel (confirmed) → webhook flips cancellation.pending', async () => {
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
      if (state.resolved.cancelling !== true) {
        throw new Error(`resolved.cancelling should be true: ${JSON.stringify(state.resolved)}`);
      }
    });

    await harness.step('refund (confirmed) → webhook cancels the subscription', async () => {
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
      if (state.resolved.active !== false) {
        throw new Error(`resolved.active should be false: ${JSON.stringify(state.resolved)}`);
      }
      return `refund: ${refund.json.refund.amount} (full)`;
    });

    let dataRequestId = null;

    await harness.step('data-request created (pending)', async () => {
      const created = await page.evaluate(() => window.__omega.api('POST', 'user/data-request', {
        confirmed: true,
        reason: 'e2e-data-request',
      }));
      if (!created.ok || !created.json || !created.json.request || created.json.request.status !== 'pending') {
        throw new Error(`data-request create failed (${created.status}): ${created.text}`);
      }
      dataRequestId = created.json.request.id;
      return `id: ${dataRequestId}`;
    });

    await harness.step('data-request status reports the pending request', async () => {
      const status = await page.evaluate(() => window.__omega.api('GET', 'user/data-request'));
      if (!status.ok || !status.json || !status.json.request) {
        throw new Error(`data-request status failed (${status.status}): ${status.text}`);
      }
      if (status.json.request.id !== dataRequestId || status.json.request.status !== 'pending') {
        throw new Error(`unexpected data-request status: ${JSON.stringify(status.json.request)}`);
      }
    });

    await harness.step('data-request cancel removes the pending request', async () => {
      const cancelled = await page.evaluate(() => window.__omega.api('DELETE', 'user/data-request'));
      if (!cancelled.ok || !cancelled.json || !cancelled.json.request || cancelled.json.request.id !== dataRequestId) {
        throw new Error(`data-request cancel failed (${cancelled.status}): ${cancelled.text}`);
      }
      const after = await page.evaluate(() => window.__omega.api('GET', 'user/data-request'));
      if (!after.ok || !after.json || after.json.request !== null) {
        throw new Error(`request should be gone after cancel: ${after.text}`);
      }
    });

    await harness.step('delete account (allowed post-refund) → signin fails', async () => {
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
      return `signin rejected: ${signinError.slice(0, 60)}`;
    });
  } catch (error) {
    // Errors thrown INSIDE harness.step() are already in harness.failures;
    // anything else (puppeteer.launch, newPage, preparePage) must be recorded
    // here or exit() would report a false PASSED with exit 0.
    if (!harness.failures.some((f) => f.error === error)) {
      console.error(`  ✗ harness setup failed: ${error.message}`);
      harness.failures.push({ name: 'harness setup', error });
    }
  } finally {
    // teardown closes the browser it launched, then the dev server, the
    // emulator and the held ports.
    await harness.teardown();
  }

  harness.exit();
}

main().catch((error) => {
  console.error('Harness error:', error);
  process.exit(1);
});
