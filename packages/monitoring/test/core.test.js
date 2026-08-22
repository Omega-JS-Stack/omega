/**
 * core tests — the policy every target inherits (#380).
 *
 * core.js is deliberately pure: no `process`, no SDK, no DOM. The first test
 * pins that (the browser bundle imports this file, where a `process.env` read
 * would be a page-breaking ReferenceError), and the rest pin the decisions —
 * off when unset, the one release format, the scrub default, and the
 * client-side bundle filter's accept/reject cases.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = require('../src/core.js');

const DSN = 'https://key@o1.ingest.sentry.io/1';

// A `monitoring` role section carrying these Sentry settings (#425): the knobs
// hang off the provider, so every resolveConfig fixture goes through here.
const section = (settings) => ({ providers: { sentry: settings } });

// A stack-frame event shaped the way the SDK builds one.
function eventWithFrames(...filenames) {
  return { exception: { values: [{ stacktrace: { frames: filenames.map((filename) => ({ filename })) } }] } };
}

test('core touches no host global — it is safe inside a page bundle', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core.js'), 'utf8');
  assert.ok(!/process\.env\.[A-Za-z_]/.test(source), 'no process.env read');
  assert.ok(!/require\(['"]@sentry/.test(source), 'no SDK require');
});

test('no dsn = fully off, whatever the gates say', () => {
  const sections = [
    undefined,
    {},
    { providers: {} },
    { providers: { sentry: false } },          // deliberately disabled (#425)
    { providers: { sentry: {} } },
    { providers: { sentry: { dsn: '' } } },
    { providers: { sentry: { dsn: null } } },
    { enabled: true, dsn: DSN },               // the RETIRED flat shape reads as nothing
  ];
  for (const section of sections) {
    const result = core.resolveConfig(section, { isProduction: true });
    assert.strictEqual(result.shouldEnable, false, `${JSON.stringify(section)} stays off`);
    assert.match(result.reason, /dsn/);
  }
});

test('a kill switch beats a perfectly good config', () => {
  const result = core.resolveConfig(section({ dsn: DSN }), { isProduction: true, killed: true, killedReason: 'test run' });
  assert.strictEqual(result.shouldEnable, false);
  assert.strictEqual(result.reason, 'test run');
});

test('a non-production run stays off unless the host allows dev', () => {
  const off = core.resolveConfig(section({ dsn: DSN }), { isProduction: false });
  assert.strictEqual(off.shouldEnable, false);
  assert.match(off.reason, /production/);

  const on = core.resolveConfig(section({ dsn: DSN }), { isProduction: false, allowInDev: true });
  assert.strictEqual(on.shouldEnable, true);
  assert.strictEqual(on.options.environment, 'development', 'a dev-allowed run tags itself development');
});

test('a production run resolves the init options out of the provider block (#425)', () => {
  const result = core.resolveConfig({ enabled: true, providers: { sentry: { dsn: DSN, sampleRate: 0.25 } } }, { isProduction: true });
  assert.strictEqual(result.shouldEnable, true);
  assert.strictEqual(result.reason, null);
  assert.strictEqual(result.options.dsn, DSN);
  assert.strictEqual(result.options.environment, 'production');
  assert.strictEqual(result.options.sampleRate, 0.25, 'the sampling knob overrides the default');
  assert.strictEqual(result.options.tracesSampleRate, core.DEFAULTS.tracesSampleRate);
  assert.strictEqual(result.options.enabled, undefined, 'the role level never reaches Sentry.init');
  assert.strictEqual(result.options.providers, undefined, 'the providers block never reaches Sentry.init');
});

test('an explicit environment survives the gate that would have named it', () => {
  const result = core.resolveConfig(section({ dsn: DSN, environment: 'staging' }), { isProduction: true });
  assert.strictEqual(result.options.environment, 'staging');
});

test('the email is scrubbed by default and the uid always rides', () => {
  const scrubbed = core.normalizeUser({ uid: 'abc123', email: 'user@example.com', displayName: 'ignored' });
  assert.deepEqual(scrubbed, { id: 'abc123' }, 'PII off by default: uid in, email out, nothing else');

  const explicit = core.normalizeUser({ uid: 'abc123', email: 'user@example.com' }, { scrubEmail: false });
  assert.deepEqual(explicit, { id: 'abc123', email: 'user@example.com' }, 'an explicit opt-in carries the email');

  const stillScrubbed = core.normalizeUser({ uid: 'abc123', email: 'user@example.com' }, { scrubEmail: true });
  assert.deepEqual(stillScrubbed, { id: 'abc123' });
});

test('an admin-shaped user maps its id, and nothing to say means nothing to send', () => {
  assert.deepEqual(core.normalizeUser({ id: 'admin-1' }), { id: 'admin-1' });
  assert.strictEqual(core.normalizeUser(null), null);
  assert.strictEqual(core.normalizeUser({}), null);
  assert.strictEqual(core.normalizeUser({ email: 'user@example.com' }), null, 'an email alone is never a reason to send a user');
});

test('the release tag is ONE format on every target: brand.id@version', () => {
  assert.strictEqual(core.releaseTag({ id: 'paperloom', version: '1.4.2' }), 'paperloom@1.4.2');
  assert.strictEqual(core.releaseTag({ id: 'paperloom', version: 1755648000000 }), 'paperloom@1755648000000');
  assert.strictEqual(core.releaseTag({ version: '1.4.2' }), undefined, 'no id = no release tag: a bare version is not a format any more');
  assert.strictEqual(core.releaseTag({ id: 'paperloom' }), undefined, 'no version = no release tag');
  assert.strictEqual(core.releaseTag(), undefined);
});

test('the bundle filter accepts an event thrown from our bundles', () => {
  const isFrameworkEvent = core.createBundleFilter();
  assert.strictEqual(isFrameworkEvent(eventWithFrames('https://paperloom.dev/assets/js/main.js')), true);
  assert.strictEqual(isFrameworkEvent(eventWithFrames('https://paperloom.dev/assets/js/chunks/chunk-ABC.js')), true);
  assert.strictEqual(isFrameworkEvent(eventWithFrames('chrome-extension://abcdef/assets/js/background.js')), true);
});

test('the bundle filter rejects user-land, third-party and frameless noise', () => {
  const isFrameworkEvent = core.createBundleFilter();
  assert.strictEqual(isFrameworkEvent(eventWithFrames('https://paperloom.dev/some-page')), false, 'an inline page script is not ours');
  assert.strictEqual(isFrameworkEvent(eventWithFrames('https://cdn.thirdparty.com/widget.js')), false, 'a widget is not ours');
  assert.strictEqual(isFrameworkEvent(eventWithFrames('moz-extension://xyz/injected.js')), false, "a visitor's browser extension is not ours");
  assert.strictEqual(isFrameworkEvent({ message: 'Script error.' }), false, 'cross-origin noise carries no frame and never reports');
  assert.strictEqual(isFrameworkEvent({}), false);
});

test('one framework frame anywhere on the stack is enough', () => {
  const isFrameworkEvent = core.createBundleFilter();
  const mixed = eventWithFrames('https://cdn.thirdparty.com/widget.js', 'https://paperloom.dev/assets/js/main.js');
  assert.strictEqual(isFrameworkEvent(mixed), true);
});

test('a host can name its own bundle URLs', () => {
  const isFrameworkEvent = core.createBundleFilter(['/dist/omega/']);
  assert.strictEqual(isFrameworkEvent(eventWithFrames('https://paperloom.dev/dist/omega/app.js')), true);
  assert.strictEqual(isFrameworkEvent(eventWithFrames('https://paperloom.dev/assets/js/main.js')), false, 'the default is replaced, not merged');
});
