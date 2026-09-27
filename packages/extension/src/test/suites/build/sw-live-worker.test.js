// Build-layer test for the background lane's worker resolution, against a REAL
// Chromium with the harness extension loaded. A worker that restarts while an
// old client stays attached pauses on start and the old handle hangs, so every
// background suite must attach the LIVE worker, or fail naming it.

const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const HARNESS_EXT = path.join(__dirname, '..', '..', 'harness', 'extension');
const SW_CONTEXT_SUITE = path.join(__dirname, '..', 'background', 'sw-context.test.js');

// Stop every service worker in the browser through the real CDP domain.
async function stopAllWorkers(browser) {
  const page = await browser.newPage();
  const session = await page.createCDPSession();
  await session.send('ServiceWorker.enable');
  await session.send('ServiceWorker.stopAllWorkers');
  await session.detach();
  await page.close();
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'background lane attaches the live service worker',
  timeout: 60000,
  tests: [
    {
      name: 'the harness worker attaches and answers its own extension id',
      run: async (ctx) => {
        const puppeteer = require('puppeteer');
        const { waitForTarget } = require('../../runners/helpers.js');
        const { attachLiveWorker } = require('../../runners/service-worker.js');

        ctx.state.browser = await puppeteer.launch({
          headless: 'new',
          args: [`--disable-extensions-except=${HARNESS_EXT}`, `--load-extension=${HARNESS_EXT}`, '--no-sandbox'],
        });
        const target = await waitForTarget(ctx.state.browser, (t) => t.type() === 'service_worker', 5000);
        ctx.expect(target).toBeTruthy();
        ctx.state.target = target;
        ctx.state.extId = target.url().split('/')[2];

        const session = await attachLiveWorker(ctx.state.browser, ctx.state.extId, 5000);
        const { result } = await session.send('Runtime.evaluate', { expression: 'chrome.runtime.id', returnByValue: true });
        await session.detach();
        ctx.expect(result.value).toBe(ctx.state.extId);
      },
    },
    {
      name: 'suites back to back in one live worker count each test once',
      run: async (ctx) => {
        const { runBackgroundSuites } = require('../../runners/chromium.js');
        const { browser, extId } = ctx.state;

        const counts = await runBackgroundSuites({ browser, extId, suiteFiles: [SW_CONTEXT_SUITE, SW_CONTEXT_SUITE] });
        ctx.expect(counts).toEqual({ passed: 10, failed: 0, skipped: 0 });
      },
    },
    {
      name: 'a worker restarted under a stale attached client runs the next suite green',
      run: async (ctx) => {
        const { runBackgroundSuites } = require('../../runners/chromium.js');
        const { browser, target, extId } = ctx.state;

        // The stale client: a handle attached before the restart, never released.
        await target.worker();
        await stopAllWorkers(browser);

        // A real event restarts the worker; its reply waits on the release, and a
        // failed run leaves it pending until the browser closes, so it settles to a value.
        const page = await browser.newPage();
        await page.goto(`chrome-extension://${extId}/popup.html`);
        const ping = page.evaluate(() => chrome.runtime.sendMessage({ type: 'extension:test:ping' }))
          .catch((e) => ({ error: e.message }));

        const counts = await runBackgroundSuites({ browser, extId, suiteFiles: [SW_CONTEXT_SUITE] });
        ctx.expect(counts).toEqual({ passed: 5, failed: 0, skipped: 0 });
        ctx.expect((await ping).pong).toBe(true);
        await page.close();
      },
    },
    {
      name: 'a worker that is gone fails the suite by name instead of an undefined read',
      run: async (ctx) => {
        const { attachLiveWorker } = require('../../runners/service-worker.js');
        const { runBackgroundSuites } = require('../../runners/chromium.js');
        const { browser, extId } = ctx.state;

        await stopAllWorkers(browser);

        let error = null;
        try { await attachLiveWorker(browser, extId, 1500); } catch (e) { error = e; }
        ctx.expect(error && error.message).toBe(`service worker for ${extId} is not active`);

        const counts = await runBackgroundSuites({ browser, extId, suiteFiles: [SW_CONTEXT_SUITE] });
        ctx.expect(counts).toEqual({ passed: 0, failed: 5, skipped: 0 });
      },
    },
  ],
  cleanup: async (ctx) => {
    if (ctx.state.browser) await ctx.state.browser.close();
  },
});
