/**
 * OMEGA Playground's own browser lane, run by the brand-root `omega test` walk
 * after every target.
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
const REDIRECT_TIMEOUT = 30000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = defineCases({
  type: 'suite',
  description: 'OMEGA Playground e2e',
  timeout: 300000,
  async setup(ctx) {
    if (process.env.OMEGA_SKIP_E2E === '1') ctx.skip('OMEGA_SKIP_E2E=1');

    const harness = new E2eHarness(BRAND_ROOT);
    ctx.state.harness = harness;
    await harness.boot();

    const browser = await harness.launchBrowser();
    ctx.state.page = await browser.newPage();
    await harness.preparePage(ctx.state.page);
  },
  async cleanup(ctx) {
    // Unset only when setup skipped before building it.
    if (ctx.state.harness) await ctx.state.harness.teardown();
  },
  tests: [
    {
      name: 'a signed-out visit to /notes lands on /signup, carrying /notes back',
      async run(ctx) {
        const { harness, page } = ctx.state;
        // The build suite reads the policy off the page; only a browser runs it:
        // the client boots, asks the auth emulator, finds nobody, and redirects.
        await page.goto(`${harness.siteUrl}/notes`, { waitUntil: 'load' });

        const deadline = Date.now() + REDIRECT_TIMEOUT;
        while (Date.now() < deadline && new URL(page.url()).pathname !== '/signup') {
          await sleep(250);
        }

        const landed = new URL(page.url());
        if (landed.pathname !== '/signup') {
          throw new Error(`still on ${landed.pathname} after ${REDIRECT_TIMEOUT / 1000}s: the auth policy never redirected (see page.log)`);
        }
        const back = landed.searchParams.get('returnUrl');
        if (!back || new URL(back).pathname !== '/notes') {
          throw new Error(`returnUrl is ${back}, not the /notes page the visitor asked for`);
        }
        // Auth connects at boot; Firestore connects inside its loader, on first use
        if (!harness.pageConsole.some((line) => line.includes('[@omega.js/client:firebase] Connecting the auth emulator'))) {
          throw new Error('the verdict did not come from this stack: the client never connected to the emulators');
        }
        console.log(`      ${landed.pathname}?returnUrl=${new URL(back).pathname}`);
      },
    },
  ],
});
