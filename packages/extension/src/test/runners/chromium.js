/**
 * The `background` and `view` drivers: one headless Chrome on the harness
 * extension, shared while both rows are live. Each suite travels as ONE payload
 * (devkit's run-case.js and expect.js inlined, the suite's bodies spliced in as
 * literal functions), evaluated in the live service worker or a harness page,
 * and every case event comes back as one envelope console line (devkit's test/events.js).
 */

const path = require('path');
const fs = require('fs');
const chalk = require('chalk').default;
const { serializeSuite, specKey } = require('@omega.js/devkit/test/serialize');
const { EVENT_PREFIX, parseEventLine, reportEvery, createEventTracker } = require('@omega.js/devkit/test/events');
const { attachLiveWorker, whileLive } = require('./service-worker.js');
const { loadPuppeteer, launchChrome, waitForTarget } = require('./helpers.js');

// The two engine files a payload inlines; both stand alone, with no `require` call.
const RUN_CASE_SRC = fs.readFileSync(require.resolve('@omega.js/devkit/test/run-case'), 'utf8');
const EXPECT_SRC = fs.readFileSync(require.resolve('@omega.js/devkit/test/expect'), 'utf8');

const HARNESS_DIR = path.join(__dirname, '..', 'harness', 'extension');

// How long a background suite waits for a live worker before failing by name.
const SW_LIVE_TIMEOUT_MS = 10000;

const literal = (value) => (value === undefined ? 'undefined' : JSON.stringify(value));
// A body spliced in as a literal function: an MV3 worker refuses every runtime compile (`eval`, `new Function`).
const fnLiteral = (source) => (source === undefined ? 'undefined' : `async (ctx) => {\n${source}\n}`);

/**
 * The script one suite runs as inside a worker or a page: devkit's engine
 * inlined, the suite rebuilt with its bodies as literals, `runSuite` reporting
 * each case event as one console line.
 * @param {object} suite - A normalized suite.
 * @param {{layer: string}} options - `background` (no extras) or a page layer (`ctx.page` is `window`).
 * @returns {string} The payload, an expression resolving once the suite has run.
 */
function suitePayload(suite, { layer }) {
  const data = serializeSuite(suite);
  const cases = data.cases.map((caseDef) => `    {
      id: ${literal(caseDef.id)},
      name: ${literal(caseDef.name)},
      timeout: ${literal(caseDef.timeout)},
      skip: ${literal(caseDef.skip)},
      run: ${fnLiteral(caseDef.runSource)},
      cleanup: ${fnLiteral(caseDef.cleanupSource)},
    },`).join('\n');

  return `(async function () {
  'use strict';
  const { runSuite } = (function (module) {
${RUN_CASE_SRC}
    return module.exports;
  })({ exports: {} });
  const expect = (function (module) {
${EXPECT_SRC}
    return module.exports;
  })({ exports: {} });

  const suite = {
    file: ${literal(data.file)},
    description: ${literal(data.description)},
    layer: ${literal(layer)},
    type: ${literal(data.type)},
    stopOnFailure: ${literal(data.stopOnFailure)},
    timeout: ${literal(data.timeout)},
    skip: ${literal(data.skip)},
    setup: ${fnLiteral(data.setupSource)},
    cleanup: ${fnLiteral(data.cleanupSource)},
    cases: [
${cases}
    ],
  };

  await runSuite(suite, {
    expect,
    extras: ${layer === 'background' ? '{}' : '{ page: window }'},
    report: (event) => console.log(${JSON.stringify(EVENT_PREFIX)} + JSON.stringify(event)),
  });
})()`;
}

/**
 * Run one suite in the app: its case events go to `report`, any other console
 * line to stdout. A load or harness failure fails every case not yet reported,
 * and so does a malformed envelope line once the suite has run.
 * @param {object} suite - A normalized suite.
 * @param {{layer: string, report: Function, evaluate: Function}} options - `evaluate(payload, onLine)` runs the payload where the suite belongs.
 * @returns {Promise<void>}
 */
async function runAppSuite(suite, { layer, report, evaluate }) {
  const events = createEventTracker(report);
  const onLine = (text, source) => {
    const event = parseEventLine(text);
    if (event) events.onEvent(event);
    else process.stdout.write(chalk.gray(`      [${source}] ${text}\n`));
  };
  const failure = await evaluate(suitePayload(suite, { layer }), onLine).then(() => null, (e) => e);
  events.settle(suite.cases, failure);
}

/**
 * An evaluator on the extension's live service worker, attached afresh per suite:
 * the worker a previous suite ran in may have been stopped or restarted since.
 * @param {object} browser - Puppeteer Browser.
 * @param {string} extId - The extension id.
 * @returns {Function} `evaluate(payload, onLine)`.
 */
function inWorker(browser, extId) {
  return async (payload, onLine) => {
    const session = await attachLiveWorker(browser, extId, SW_LIVE_TIMEOUT_MS);
    const onConsole = (evt) => onLine(evt.args.map((a) => (a.value !== undefined ? String(a.value) : (a.description || ''))).join(' '), `sw:${evt.type}`);
    session.on('Runtime.consoleAPICalled', onConsole);
    try {
      const { exceptionDetails } = await whileLive(session, extId, (async () => {
        // Enabling replays the worker's stored console lines, earlier suites' events included.
        await session.send('Runtime.discardConsoleEntries');
        await session.send('Runtime.enable');
        return session.send('Runtime.evaluate', { expression: payload, awaitPromise: true });
      })());
      if (exceptionDetails) {
        throw new Error((exceptionDetails.exception && exceptionDetails.exception.description) || exceptionDetails.text);
      }
    } finally {
      session.off('Runtime.consoleAPICalled', onConsole);
      // A worker that died mid-suite takes its session with it.
      await session.detach().catch(() => {});
    }
  };
}

/**
 * An evaluator on a fresh page at `url`, closed once the suite has run.
 * @param {object} browser - Puppeteer Browser.
 * @param {string} url - The page to open.
 * @returns {Function} `evaluate(payload, onLine)`.
 */
function inPage(browser, url) {
  return async (payload, onLine) => {
    const page = await browser.newPage();
    const onConsole = (msg) => onLine(msg.text(), `page:${msg.type()}`);
    page.on('console', onConsole);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.evaluate(payload);
    } finally {
      page.off('console', onConsole);
      // A page the browser already lost has nothing left to close.
      await page.close().catch(() => {});
    }
  };
}

// The one harness Chrome, held by every live chromium driver and closed by the last stop.
let harness = null;

async function launchHarness(puppeteer) {
  if (!fs.existsSync(path.join(HARNESS_DIR, 'manifest.json'))) {
    throw new Error(`the harness extension is not built at ${HARNESS_DIR}: run \`npm run prepare\` in @omega.js/extension`);
  }
  const browser = await launchChrome(puppeteer, HARNESS_DIR);
  const swTarget = await waitForTarget(browser, (t) => t.type() === 'service_worker' && t.url().includes('background.js'), 5000);
  if (!swTarget) {
    await browser.close();
    throw new Error('the harness service worker never came up');
  }
  return { browser, extId: swTarget.url().split('/')[2] };
}

function acquireHarness(puppeteer) {
  if (!harness) {
    const held = { users: 0, ready: launchHarness(puppeteer) };
    held.ready.catch(() => { if (harness === held) harness = null; });
    harness = held;
  }
  harness.users += 1;
  return harness.ready;
}

async function releaseHarness() {
  const held = harness;
  held.users -= 1;
  if (held.users > 0) return;
  harness = null;
  const { browser } = await held.ready;
  await browser.close();
}

/**
 * The driver of one harness row: `background` runs each suite in the live
 * worker, `view` each in a fresh page at `<context || 'popup'>.html`.
 * @param {'background'|'view'} layer - The row.
 * @returns {{start: Function}} The driver.
 */
function chromiumDriver(layer) {
  return {
    async start({ suites, report }) {
      const puppeteer = loadPuppeteer();
      if (!puppeteer) {
        reportEvery(suites.flatMap((suite) => suite.cases), report, { status: 'skip', reason: `puppeteer is not installed: the ${layer} layer runs in Chrome` });
        return { finished: Promise.resolve(), stop: async () => {} };
      }

      const { browser, extId } = await acquireHarness(puppeteer);
      const finished = (async () => {
        for (const suite of suites) {
          const evaluate = layer === 'background'
            ? inWorker(browser, extId)
            : inPage(browser, `chrome-extension://${extId}/${specKey(suite, 'context') || 'popup'}.html`);
          await runAppSuite(suite, { layer, report, evaluate });
        }
      })();
      return { finished, stop: releaseHarness };
    },
  };
}

module.exports = { chromiumDriver, suitePayload, runAppSuite, inPage, inWorker };
