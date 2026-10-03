const { describe, it, before, after, beforeEach } = require('node:test');
const { registerHooks } = require('node:module');
const { TEST_CONFIG, assert } = require('./helpers.js');
// Required before the SDK stub's hooks, which CJS would not survive
const { installEarlyErrorBuffer } = require('@omega.js/monitoring/browser');

// The test's own waits, kept off any timer stand-in a case installs
const realSetTimeout = setTimeout;

// Sentry starts once the page is idle, never on initialize()'s path, and the
// early-error buffer (`window.__OMEGA_EARLY_ERRORS`) holds what came before.
// The SDK is a stub counting imports and captures; the idle moment is the
// page's own `requestIdleCallback`, stood in and run by hand.
describe('Sentry: started when the page is idle, early errors replayed once', () => {

  const SDK_URL = 'omega-test-stub:sentry-browser';
  const BROKEN_SDK_URL = 'omega-test-stub:sentry-browser-broken';

  const SDK_SOURCE = `
    const S = () => globalThis.__omegaSentry;
    export const init = (options) => { S().inits.push(options); };
    export const captureException = (error, hint) => { S().captures.push(error); S().hints.push({ error, hint }); return 'event-id'; };
    export const captureEvent = (event) => { S().events.push(event); return 'event-id'; };
    export const captureMessage = () => 'event-id';
    export const setUser = () => {};
    export const setTag = () => {};
    export const browserTracingIntegration = () => ({ name: 'BrowserTracing' });
    export const replayIntegration = () => ({ name: 'Replay' });`;

  // Every import asked of the SDK: a dynamic import resolves on each call.
  // A broken SDK resolves to a fresh url whose evaluation throws, so its import rejects.
  let sdkAsked = 0;
  let sdkBroken = false;

  const stubSdk = () => registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '@sentry/browser') {
        sdkAsked += 1;
        return { url: sdkBroken ? `${BROKEN_SDK_URL}-${sdkAsked}` : SDK_URL, shortCircuit: true };
      }

      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === SDK_URL) {
        return { format: 'module', shortCircuit: true, source: SDK_SOURCE };
      }

      if (url.startsWith(BROKEN_SDK_URL)) {
        return { format: 'module', shortCircuit: true, source: `throw new Error('the Sentry chunk failed to load');` };
      }

      return nextLoad(url, context);
    },
  });

  // A DSN in the one error-reporting home is what turns Sentry on
  const SENTRY_ON = { monitoring: { providers: { sentry: { dsn: 'https://key@o1.ingest.sentry.io/1' } } } };

  let Omega;
  let idleCallbacks;

  // The page's own idle moment, held until the test says the page is idle
  function standInIdle() {
    idleCallbacks = [];
    const requestIdleCallback = (callback) => idleCallbacks.push(callback);

    global.window.requestIdleCallback = requestIdleCallback;
    globalThis.requestIdleCallback = requestIdleCallback;
  }

  const listeners = (type) => global.__omegaListeners.window[type] || [];
  const sdkStarted = () => globalThis.__omegaSentry.inits.length > 0;
  const pause = (ms) => new Promise((resolve) => realSetTimeout(resolve, ms));

  // What a browser does with a window event: every handler registered at dispatch runs
  function dispatch(type, event) {
    [...listeners(type)].forEach((handler) => handler({ type, preventDefault: () => {}, ...event }));
  }

  // A real removal, local to this file: setup.js's window ignores it, which
  // other suites rely on, and here a buffer that stops has to be seen stopping
  function removeListener(type, handler) {
    const registered = listeners(type);
    const index = registered.indexOf(handler);

    if (index !== -1) {
      registered.splice(index, 1);
    }
  }

  /** Run the page's idle callbacks (and `extra`, each round) until `until` holds or 3s pass. */
  async function runIdle(until, extra = () => {}) {
    const deadline = Date.now() + 3000;

    while (!until() && Date.now() < deadline) {
      extra();
      idleCallbacks.splice(0).forEach((callback) => callback({ didTimeout: false, timeRemaining: () => 50 }));
      await pause(10);
    }

    // Let what follows the SDK's arrival (or its failure) land
    await pause(20);
  }

  /** Let the page go idle: fire load, then run the idle callbacks until `until` holds. */
  function goIdle(until = sdkStarted) {
    dispatch('load', {});

    return runIdle(until);
  }

  // Whether a buffered entry holds the thrown value, itself or one level down
  const holds = (entry, value) => entry === value || Object.values(entry || {}).some((field) => (
    field === value || (field !== null && typeof field === 'object' && Object.values(field).includes(value))
  ));
  const buffered = (value) => (global.window.__OMEGA_EARLY_ERRORS || []).some((entry) => holds(entry, value));

  /** Boot a fresh instance the way a surface does; no Firebase, no version check. */
  async function boot(config = {}) {
    const omega = new Omega();

    await Promise.race([
      omega.initialize({ ...TEST_CONFIG, refreshNewVersion: { enabled: false }, ...config }),
      new Promise((resolve, reject) => realSetTimeout(() => reject(new Error('initialize() waited on something that never came')), 3000).unref()),
    ]);

    return omega;
  }

  const capturesOf = (error) => globalThis.__omegaSentry.captures.filter((captured) => captured === error).length;
  const hintOf = (error) => globalThis.__omegaSentry.hints.find((captured) => captured.error === error)?.hint;

  let savedRemoveListener;

  before(async () => {
    // Registered here, not at load: hooks route every later require through the
    // ESM loader, and the helpers' Omega import pulls in CJS that will not
    // survive the trip
    stubSdk();
    Omega = (await import('../src/index.js')).Omega;

    savedRemoveListener = global.window.removeEventListener;
    global.window.removeEventListener = removeListener;
  });

  after(() => {
    global.window.removeEventListener = savedRemoveListener;
  });

  // A fresh page per test: no buffer, no error listeners, a fresh SDK record
  beforeEach(() => {
    delete global.window.__OMEGA_EARLY_ERRORS;
    delete global.window.Sentry;
    ['error', 'unhandledrejection', 'load'].forEach((type) => { global.__omegaListeners.window[type] = []; });
    globalThis.__omegaSentry = { inits: [], captures: [], hints: [], events: [] };
    sdkAsked = 0;
    sdkBroken = false;
    standInIdle();
  });

  it('should install no buffer and import no SDK when Sentry is off (case 10)', async () => {
    await boot();
    await goIdle();

    assert.strictEqual(global.window.__OMEGA_EARLY_ERRORS, undefined, 'no early-error buffer');
    assert.strictEqual(sdkAsked, 0, 'the Sentry SDK was never imported');
  });

  it('should resolve initialize() without the SDK, and start Sentry once the page is idle (case 8)', async () => {
    await boot(SENTRY_ON);

    assert.strictEqual(sdkAsked, 0, 'initialize() neither awaited nor started the SDK import');
    assert.strictEqual(globalThis.__omegaSentry.inits.length, 0);

    await goIdle();

    assert.ok(sdkAsked >= 1, 'the idle page imported the SDK');
    assert.strictEqual(globalThis.__omegaSentry.inits.length, 1, 'and started it once');
    assert.strictEqual(globalThis.__omegaSentry.inits[0].dsn, 'https://key@o1.ingest.sentry.io/1');
  });

  it('should capture an error and a rejection from before the SDK loaded exactly once each (case 9)', async () => {
    await boot(SENTRY_ON);

    assert.ok(Array.isArray(global.window.__OMEGA_EARLY_ERRORS), 'a page with no inline buffer gets the client\'s');

    const thrown = new Error('thrown before the SDK');
    const rejected = new Error('rejected before the SDK');
    dispatch('error', { error: thrown, message: thrown.message });
    dispatch('unhandledrejection', { reason: rejected });

    await goIdle();

    assert.strictEqual(globalThis.__omegaSentry.inits.length, 1, 'the SDK loaded');
    assert.strictEqual(capturesOf(thrown), 1, 'the early error is captured once');
    assert.strictEqual(capturesOf(rejected), 1, 'the early rejection is captured once');

    // Replayed as the SDK's own global handlers would have caught them: unhandled
    assert.deepStrictEqual(hintOf(thrown)?.mechanism, { handled: false, type: 'auto.browser.global_handlers.onerror' });
    assert.deepStrictEqual(hintOf(rejected)?.mechanism, { handled: false, type: 'auto.browser.global_handlers.onunhandledrejection' });
  });

  it('should replay the page\'s inline buffer once and add no second one (case 9)', async () => {
    // What the head's inline script does before any module runs
    installEarlyErrorBuffer(global.window);
    const buffer = global.window.__OMEGA_EARLY_ERRORS;

    const thrown = new Error('thrown before the main script');
    dispatch('error', { error: thrown, message: thrown.message });

    await boot(SENTRY_ON);

    assert.strictEqual(global.window.__OMEGA_EARLY_ERRORS, buffer, 'the client keeps the page\'s buffer');
    assert.strictEqual(listeners('error').length, 1, 'and adds no second listener set');

    const rejected = new Error('rejected before the SDK');
    dispatch('unhandledrejection', { reason: rejected });

    await goIdle();

    assert.strictEqual(capturesOf(thrown), 1, 'the head\'s early error is captured once');
    assert.strictEqual(capturesOf(rejected), 1, 'the early rejection is captured once');
  });

  it('should stop buffering once the SDK has loaded, so a later error never rides the buffer (case 9)', async () => {
    await boot(SENTRY_ON);

    const early = new Error('thrown before the SDK');
    dispatch('error', { error: early, message: early.message });

    await goIdle();
    assert.strictEqual(capturesOf(early), 1, 'the early error is replayed once');

    assert.strictEqual(listeners('error').length, 0, 'the buffer\'s error listener is removed');
    assert.strictEqual(listeners('unhandledrejection').length, 0, 'and its rejection listener');

    const late = new Error('thrown after the SDK');
    dispatch('error', { error: late, message: late.message });
    await pause(20);

    assert.strictEqual(buffered(late), false, 'a live error is not pushed to the buffer');
    assert.strictEqual(capturesOf(late), 0, 'and the buffer path captures it zero times');
    assert.strictEqual(capturesOf(early), 1, 'nor is the early one replayed again');
  });

  it('should stop and empty the buffer when the SDK import fails', async () => {
    const omega = await boot(SENTRY_ON);
    const buffer = global.window.__OMEGA_EARLY_ERRORS;

    const early = new Error('thrown before the SDK');
    dispatch('error', { error: early, message: early.message });
    assert.strictEqual(buffer.length, 1, 'the buffer held the early error');

    sdkBroken = true;
    const stopped = () => listeners('error').length === 0 && listeners('unhandledrejection').length === 0;
    await goIdle(stopped);

    assert.ok(sdkAsked >= 1, 'the idle page asked for the SDK');
    assert.strictEqual(sdkStarted(), false, 'and it never started');
    assert.ok(stopped(), 'the buffer\'s listeners are removed');
    assert.strictEqual(buffer.length, 0, 'and its array emptied');

    omega.sentry.captureException(new Error('captured after the failure'));

    assert.strictEqual(buffer.length, 0, 'a later capture no longer pushes to it');
    assert.strictEqual((global.window.__OMEGA_EARLY_ERRORS || []).length, 0, 'nor to any buffer on the window');
  });

  it('should start the SDK after a ceiling on a page whose load never fires', async () => {
    // A page still loading, and every long wait held for the test to run by hand,
    // so no real seconds pass and no length of wait is pinned
    const held = [];
    const holdLongWaits = (callback, ms, ...args) => {
      if (ms >= 1000) {
        held.push(() => callback(...args));
        return { ref() { return this; }, unref() { return this; }, hasRef: () => false };
      }

      return realSetTimeout(callback, ms, ...args);
    };
    const readyState = global.document.readyState;

    global.document.readyState = 'loading';
    globalThis.setTimeout = holdLongWaits;
    global.window.setTimeout = holdLongWaits;

    try {
      await boot(SENTRY_ON);
      assert.strictEqual(sdkStarted(), false, 'nothing starts at boot');

      await runIdle(sdkStarted, () => held.splice(0).forEach((fire) => fire()));

      assert.strictEqual(globalThis.__omegaSentry.inits.length, 1, 'the SDK started with no load event');
    } finally {
      globalThis.setTimeout = realSetTimeout;
      delete global.window.setTimeout;
      global.document.readyState = readyState;
    }
  });
});
