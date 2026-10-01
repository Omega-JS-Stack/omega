/**
 * OMEGA Playground's own browser lane, run by the brand-root `omega test` walk
 * after every target.
 *
 * Infrastructure is the shared harness from @omega.js/devkit: the classic-port
 * hold, the backend emulator with its seeded personas, the web target's real dev
 * server, and the browser (resolved from this brand root, which is why nothing
 * here installs puppeteer). This file is only the brand-specific STEPS.
 */
const path = require('path');

if (process.env.OMEGA_SKIP_E2E === '1') {
  console.log('⏭ OMEGA_SKIP_E2E=1: skipping the playground e2e');
  process.exit(0);
}

const { E2eHarness } = require('@omega.js/devkit/test/e2e-harness');

const BRAND_ROOT = path.join(__dirname, '..', '..');
const REDIRECT_TIMEOUT = 30000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const harness = new E2eHarness(BRAND_ROOT);

  console.log('\nOMEGA Playground e2e\n');

  try {
    await harness.boot();

    const browser = await harness.launchBrowser();
    const page = await browser.newPage();
    await harness.preparePage(page);

    await harness.step('a signed-out visit to /notes lands on /signup, carrying /notes back', async () => {
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
      const back = landed.searchParams.get('authReturnUrl');
      if (!back || new URL(back).pathname !== '/notes') {
        throw new Error(`authReturnUrl is ${back}, not the /notes page the visitor asked for`);
      }
      if (!harness.pageConsole.some((line) => line.includes('[@omega.js/client:firebase] Emulators connected'))) {
        throw new Error('the verdict did not come from this stack: the client never connected to the emulators');
      }
      return `${landed.pathname}?authReturnUrl=${new URL(back).pathname}`;
    });
  } catch (error) {
    // Errors thrown INSIDE harness.step() are already in harness.failures;
    // anything else (launch, newPage, preparePage) must be recorded here or
    // exit() would report a false PASSED with exit 0.
    if (!harness.failures.some((f) => f.error === error)) {
      console.error(`  ✗ harness setup failed: ${error.message}`);
      harness.failures.push({ name: 'harness setup', error });
    }
  } finally {
    await harness.teardown();
  }

  harness.exit();
}

main().catch((error) => {
  console.error('Harness error:', error);
  process.exit(1);
});
