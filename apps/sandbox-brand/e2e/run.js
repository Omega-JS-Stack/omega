/**
 * Cross-stack e2e for the sandbox brand — `npm test` at the brand root.
 *
 * Uses the shared e2e harness from @omega.js/devkit for infrastructure
 * (emulator boot + persona seeding, website build + serve) and provides
 * brand-specific browser steps via puppeteer.
 */
const path = require('path');
const { E2eHarness } = require('@omega.js/devkit/test/e2e-harness');

const BRAND_ROOT = path.join(__dirname, '..');
const DOC_CREATE_TIMEOUT = 90000;

const EMAIL = `e2e-${Date.now()}@sandbox-brand.example.com`;
const PASSWORD = 'sandbox-password-123';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const harness = new E2eHarness(BRAND_ROOT);
  let browser = null;

  console.log('\nSandbox brand cross-stack e2e');
  console.log(`  site: ${harness.siteUrl}  |  user: ${EMAIL}\n`);

  try {
    await harness.boot();

    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({
      headless: true,
      args: process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
    });
    const page = await browser.newPage();
    harness.capturePageConsole(page);

    await harness.step('page boots @omega.js/client against the emulators', async () => {
      await page.goto(`${harness.siteUrl}/`, { waitUntil: 'load' });
      await page.waitForFunction('window.__omega && (window.__omega.isReady || window.__omega.initError)', { timeout: 30000 });
      const initError = await page.evaluate(() => window.__omega.initError);
      if (initError) {
        throw new Error(`@omega.js/client initialize failed: ${initError}`);
      }
      if (!harness.pageConsole.some((line) => line.includes('[Firebase] Emulators connected'))) {
        throw new Error('client did not auto-connect to the emulators (dev mode must connect with zero flags — check [Firebase] lines in page.log)');
      }
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
      await page.waitForFunction('window.__omega && (window.__omega.isReady || window.__omega.initError)', { timeout: 30000 });
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
  } catch (error) {
    // step() already reported it; fall through to teardown
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    await harness.teardown();
  }

  harness.exit();
}

main().catch((error) => {
  console.error('Harness error:', error);
  process.exit(1);
});
