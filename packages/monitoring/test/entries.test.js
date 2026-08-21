/**
 * Entry tests — the platform wrappers (#380).
 *
 * The load-bearing one: when the config says off, the SDK is never require()d
 * at all. That is the standard @omega.js/desktop set (a brand with no DSN must
 * not pay for a dependency it never uses), and it is checked against the real
 * require cache, not a stub.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const node = require('../src/node.js');
const main = require('../src/main.js');
const renderer = require('../src/renderer.js');
const preload = require('../src/preload.js');

// Silence the disabled-reason log lines these entries print.
function quiet(fn) {
  const saved = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, saved);
  }
}

function sentryModulesLoaded() {
  return Object.keys(require.cache).filter((file) => file.includes(`${require('node:path').sep}@sentry${require('node:path').sep}`));
}

test('an off config never loads an SDK — not @sentry/node, not @sentry/electron', () => {
  assert.deepEqual(sentryModulesLoaded(), [], 'nothing is loaded before the first initialize');

  quiet(() => {
    assert.strictEqual(node.initialize({ config: { provider: 'sentry', dsn: '' } }), null, 'the node entry hands back no SDK');
    main.initialize({ config: { monitoring: { provider: 'sentry', dsn: '' } }, getVersion: () => '1.0.0' });
    preload.initialize({ config: { monitoring: { provider: 'sentry', dsn: '' } } });
  });

  assert.strictEqual(main._enabled, false);
  assert.strictEqual(preload._enabled, false);
  assert.deepEqual(sentryModulesLoaded(), [], 'and still nothing is loaded after');
});

test('a disabled main captures nothing and throws nothing', () => {
  quiet(() => {
    main.shutdown();
    main.captureException(new Error('never reported'));
    main.captureMessage('never reported');
    main.setUser({ uid: 'abc' });
    preload.shutdown();
    preload.captureException(new Error('never reported'));
  });
});

test('the node entry runs its host gates: a test run reports nothing', () => {
  const saved = process.env.OMEGA_TEST_RUNNER;
  process.env.OMEGA_TEST_RUNNER = '1';
  try {
    const Sentry = quiet(() => node.initialize({
      config: { provider: 'sentry', dsn: 'https://key@o1.ingest.sentry.io/1' },
      isProduction: true,
    }));
    assert.strictEqual(Sentry, null);
    assert.deepEqual(sentryModulesLoaded(), [], 'a killed run never loads the SDK either');
  } finally {
    if (saved === undefined) delete process.env.OMEGA_TEST_RUNNER;
    else process.env.OMEGA_TEST_RUNNER = saved;
  }
});

test('the package entry resolves to the main-process module outside a renderer', () => {
  assert.strictEqual(require('../src/index.js'), main);
});

// The electron SDK is the ONE thing stubbed here: booting @sentry/electron in a
// bare Node process (no app, no ipc) would take the run down. Everything the
// test asserts — the gates, the identity read, the tag — is the real code path.
function withStubbedElectronSDK(entry, run) {
  const saved = { ...process.env };
  const stubbed = [];

  for (const request of ['@sentry/electron/main', '@sentry/electron/renderer']) {
    const file = require.resolve(request);
    require.cache[file] = { id: file, filename: file, loaded: true, exports: { init: (options) => { stubbed.init = options; } } };
    stubbed.push(file);
  }

  delete process.env.OMEGA_SENTRY_ENABLED;
  delete process.env.OMEGA_TEST_RUNNER;
  process.env.OMEGA_BUILD_MODE = 'true';

  try {
    quiet(run);
    return stubbed.init;
  } finally {
    entry.shutdown();
    for (const file of stubbed) delete require.cache[file];
    for (const key of ['OMEGA_SENTRY_ENABLED', 'OMEGA_TEST_RUNNER', 'OMEGA_BUILD_MODE']) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('the electron entries tag the release brand.id@version, the one format every target uses', () => {
  const host = {
    config:     { brand: { id: 'paperloom' }, monitoring: { provider: 'sentry', dsn: 'https://key@o1.ingest.sentry.io/1' } },
    getVersion: () => '1.4.2',
  };

  const mainInit = withStubbedElectronSDK(main, () => main.initialize(host));
  assert.strictEqual(mainInit.release, 'paperloom@1.4.2', 'main tags the app version under the brand id');

  const rendererInit = withStubbedElectronSDK(renderer, () => renderer.initialize(host));
  assert.strictEqual(rendererInit.release, 'paperloom@1.4.2', 'the renderer reports the same release as its main process');
});
