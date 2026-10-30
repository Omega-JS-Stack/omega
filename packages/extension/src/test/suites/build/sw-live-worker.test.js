// Build-layer test for the background row's driver, against a REAL Chromium with
// the harness extension loaded: it runs serialized suites inside the live service
// worker, reports each case once by id, attaches a worker restarted under a stale
// client, and fails every case of a suite whose worker is gone, naming it.

const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');
const { normalizeSpec } = require('@omega.js/devkit/test/run-case');

const PACKAGE_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const VERB = path.join(__dirname, '..', '..', '..', 'commands', 'test.js');
const SW_CONTEXT_SUITE = path.join(__dirname, '..', 'background', 'sw-context.test.js');
const HARNESS_EXT = path.join(__dirname, '..', '..', 'harness', 'extension');

// The verb's background driver over `suites`; resolves to the events it reported.
async function driveBackground(suites) {
  const { runnerConfig } = require(VERB);
  const driver = runnerConfig({ projectRoot: PACKAGE_ROOT, selfTest: true }).drivers.background;
  const events = [];
  const handle = await driver.start({ projectRoot: PACKAGE_ROOT, options: {}, suites, hooks: [], report: (event) => { events.push(event); } });
  try {
    await handle.finished;
  } finally {
    await handle.stop();
  }
  return events;
}

// One spec, normalized under a file name of its own so its ids stay distinct.
function suiteAs(spec, name) {
  return normalizeSpec(spec, { file: path.join(path.dirname(SW_CONTEXT_SUITE), name) });
}

const statuses = (events) => events.map((event) => event.status);

// Stop every service worker in the browser through the real CDP domain.
async function stopAllWorkers(browser) {
  const page = await browser.newPage();
  const session = await page.createCDPSession();
  await session.send('ServiceWorker.enable');
  await session.send('ServiceWorker.stopAllWorkers');
  await session.detach();
  await page.close();
}

// A Chrome of this case's own on the harness extension, closed after the case.
async function harnessBrowser(ctx) {
  const { loadPuppeteer, launchChrome, waitForTarget } = require('../../runners/helpers.js');
  const browser = await launchChrome(loadPuppeteer(), HARNESS_EXT);
  ctx.after(() => browser.close());
  const target = await waitForTarget(browser, (t) => t.type() === 'service_worker', 5000);
  return { browser, target, extId: target.url().split('/')[2] };
}

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'background driver runs suites in the live service worker',
  timeout: 60000,
  tests: [
    {
      name: 'a suite runs in the harness worker and answers its own extension id',
      run: async (ctx) => {
        const suite = suiteAs({
          type: 'suite',
          layer: 'background',
          description: 'probe',
          tests: [{ name: 'the worker has an extension id', run: async (ctx) => { ctx.expect(chrome.runtime.id).toMatch(/^[a-z]{32}$/); } }],
        }, 'probe.test.js');

        const events = await driveBackground([suite]);
        ctx.expect(events.map((event) => [event.id, event.status])).toEqual([[suite.cases[0].id, 'pass']]);
      },
    },
    {
      name: 'suites back to back in one live worker report each case once',
      run: async (ctx) => {
        const spec = require(SW_CONTEXT_SUITE);
        const suites = [suiteAs(spec, 'sw-context-a.test.js'), suiteAs(spec, 'sw-context-b.test.js')];

        const events = await driveBackground(suites);
        const ids = suites.flatMap((suite) => suite.cases.map((caseDef) => caseDef.id));
        ctx.expect(events.map((event) => event.id).sort()).toEqual(ids.sort());
        ctx.expect(statuses(events)).toEqual(ids.map(() => 'pass'));
      },
    },
    {
      name: 'a suite\'s setup, shared state and stop-on-failure travel into the worker',
      run: async (ctx) => {
        const suite = suiteAs({
          type: 'suite',
          layer: 'background',
          description: 'state',
          setup: async (ctx) => { ctx.state.seeded = chrome.runtime.id; },
          tests: [
            { name: 'reads the seeded state', run: async (ctx) => { ctx.expect(ctx.state.seeded).toBe(chrome.runtime.id); } },
            { name: 'fails', run: async (ctx) => { ctx.expect(1).toBe(2); } },
            { name: 'is stopped', run: async (ctx) => { ctx.expect(true).toBe(true); } },
          ],
        }, 'state.test.js');

        const events = await driveBackground([suite]);
        const byId = Object.fromEntries(events.map((event) => [event.id, event]));
        ctx.expect(suite.cases.map((caseDef) => byId[caseDef.id].status)).toEqual(['pass', 'fail', 'skip']);
        ctx.expect(byId[suite.cases[1].id].error.name).toBe('AssertionError');
        ctx.expect(byId[suite.cases[2].id].reason).toBe('suite stopped');
      },
    },
    {
      name: 'a body that cannot be rebuilt fails that case naming the file, and the others run',
      run: async (ctx) => {
        const suite = suiteAs({
          type: 'group',
          layer: 'background',
          description: 'rebuild',
          tests: [
            // A parameter other than `ctx` cannot be rebuilt inside the worker.
            { name: 'takes (c)', run: async (c) => { c.expect(true).toBe(true); } },
            { name: 'takes (ctx)', run: async (ctx) => { ctx.expect(true).toBe(true); } },
          ],
        }, 'rebuild.test.js');

        const events = await driveBackground([suite]);
        const byId = Object.fromEntries(events.map((event) => [event.id, event]));
        ctx.expect(byId[suite.cases[0].id].status).toBe('fail');
        ctx.expect(byId[suite.cases[0].id].error.message).toContain('rebuild.test.js');
        ctx.expect(byId[suite.cases[1].id].status).toBe('pass');
      },
    },
    {
      name: 'a worker restarted under a stale attached client runs the next suite green',
      run: async (ctx) => {
        const { runAppSuite, inWorker } = require('../../runners/chromium.js');
        const { browser, target, extId } = await harnessBrowser(ctx);

        // The stale client: a handle attached before the restart, never released.
        await target.worker();
        await stopAllWorkers(browser);

        // A real event restarts the worker; its reply waits on the release, and a
        // failed run leaves it pending until the browser closes, so it settles to a value.
        const page = await browser.newPage();
        await page.goto(`chrome-extension://${extId}/popup.html`);
        const ping = page.evaluate(() => chrome.runtime.sendMessage({ type: 'extension:test:ping' }))
          .catch((e) => ({ error: e.message }));

        const suite = suiteAs(require(SW_CONTEXT_SUITE), 'sw-context-restarted.test.js');
        const events = [];
        await runAppSuite(suite, { layer: 'background', report: (event) => { events.push(event); }, evaluate: inWorker(browser, extId) });
        ctx.expect(statuses(events)).toEqual(suite.cases.map(() => 'pass'));
        ctx.expect((await ping).pong).toBe(true);
      },
    },
    {
      name: 'a worker that is gone fails the suite by name instead of an undefined read',
      run: async (ctx) => {
        // The first suite uninstalls the harness extension, so its worker never comes back.
        const gone = suiteAs({
          type: 'group',
          layer: 'background',
          description: 'gone',
          tests: [{ name: 'uninstalls the extension', run: async (ctx) => { chrome.management.uninstallSelf(); } }],
        }, 'gone.test.js');
        const next = suiteAs(require(SW_CONTEXT_SUITE), 'sw-context-after-gone.test.js');

        const events = await driveBackground([gone, next]);
        const byId = Object.fromEntries(events.map((event) => [event.id, event]));
        const after = next.cases.map((caseDef) => byId[caseDef.id]);
        ctx.expect(after.map((event) => event.status)).toEqual(next.cases.map(() => 'fail'));
        after.forEach((event) => ctx.expect(event.error.message).toMatch(/^service worker for [a-z]{32} is not active$/));
      },
    },
    {
      name: 'a worker that dies mid-suite fails that suite by name instead of waiting out the case timeout',
      run: async (ctx) => {
        // The case never settles, so the uninstall always lands while the evaluate is in flight.
        const dying = suiteAs({
          type: 'group',
          layer: 'background',
          description: 'dying',
          tests: [{ name: 'uninstalls the extension mid-case', run: async (ctx) => { chrome.management.uninstallSelf(); await new Promise(() => {}); } }],
        }, 'dying.test.js');

        const events = await driveBackground([dying]);
        ctx.expect(events.map((event) => [event.id, event.status])).toEqual([[dying.cases[0].id, 'fail']]);
        ctx.expect(events[0].error.message).toMatch(/^service worker for [a-z]{32} is not active$/);
      },
    },
    {
      name: 'attachLiveWorker on a worker that is gone rejects naming the extension',
      run: async (ctx) => {
        const { attachLiveWorker } = require('../../runners/service-worker.js');
        const { browser, extId } = await harnessBrowser(ctx);
        await stopAllWorkers(browser);
        await ctx.waitFor(() => !browser.targets().some((t) => t.type() === 'service_worker' && t.url().includes(extId)), 5000);

        let error = null;
        try { await attachLiveWorker(browser, extId, 1500); } catch (e) { error = e; }
        ctx.expect(error && error.message).toBe(`service worker for ${extId} is not active`);
      },
    },
  ],
});
