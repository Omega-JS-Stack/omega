/**
 * browser tests — the client-side send gate (#380).
 *
 * The doctrine under test: only errors from OUR bundles leave a page, the
 * environment gates still hold, and the user that rides is scrubbed.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildInitOptions, scrubAuthParams } = require('../src/browser.js');

const DSN = 'https://key@o1.ingest.sentry.io/1';

// The shape @sentry/browser presents — integrations are factories returning a named object.
const FakeSentry = {
  browserTracingIntegration: () => ({ name: 'BrowserTracing' }),
  replayIntegration: (options) => ({ name: 'Replay', options }),
};

function frameworkEvent() {
  return { exception: { values: [{ stacktrace: { frames: [{ filename: 'https://paperloom.dev/assets/js/main.js' }] } }] } };
}

function foreignEvent() {
  return { exception: { values: [{ stacktrace: { frames: [{ filename: 'https://cdn.thirdparty.com/widget.js' }] } }] } };
}

// The logger writes every caught error to the console — silence it per test.
function quiet(fn) {
  const saved = { log: console.log, error: console.error };
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    Object.assign(console, saved);
  }
}

test('the browser entry never reaches for a host global — it is bundled into a page', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'browser.js'), 'utf8');
  assert.ok(!/process\.env\.[A-Za-z_]/.test(source), 'no process.env read');
  assert.ok(!/require\(['"]@sentry/.test(source), 'the SDK is passed in, never required');
});

test('the resolved options carry the release, environment and sampling knobs', () => {
  // `config` is the SENTRY PROVIDER BLOCK — @omega.js/web's page Configuration
  // and @omega.js/extension's build map `monitoring.providers.sentry` into the
  // client's `sentry.config` contract (#425), so nothing role-level arrives here.
  const options = buildInitOptions({
    Sentry: FakeSentry,
    config: { dsn: DSN, sampleRate: 0.5 },
    release: 'paperloom@1755648000000',
    environment: 'production',
  });

  assert.strictEqual(options.dsn, DSN);
  assert.strictEqual(options.release, 'paperloom@1755648000000');
  assert.strictEqual(options.environment, 'production');
  assert.strictEqual(options.sampleRate, 0.5);
});

test('tracing always rides; replay only when a sample rate asks for it', () => {
  const bare = buildInitOptions({ Sentry: FakeSentry, config: { dsn: DSN } });
  assert.deepEqual(bare.integrations.map((i) => i.name), ['BrowserTracing']);

  const withReplay = buildInitOptions({ Sentry: FakeSentry, config: { dsn: DSN, replaysOnErrorSampleRate: 0.1 } });
  assert.deepEqual(withReplay.integrations.map((i) => i.name), ['BrowserTracing', 'Replay']);
  assert.strictEqual(withReplay.replaysOnErrorSampleRate, 0.1);
});

test('an error from our bundle reports, tagged and carrying the scrubbed user', () => {
  const options = buildInitOptions({
    Sentry: FakeSentry,
    config: { dsn: DSN },
    isDevelopment: () => false,
    getUser: () => ({ uid: 'abc123', email: 'user@example.com' }),
  });

  const sent = quiet(() => options.beforeSend(frameworkEvent(), {}));

  assert.ok(sent, 'the event survives the gate');
  assert.strictEqual(sent.tags['process.type'], 'browser');
  assert.ok(sent.tags['usage.session.hours'], 'the session-hours tag rides');
  assert.deepEqual(sent.user, { id: 'abc123' }, 'the uid rides, the email is scrubbed');
});

test('an error from anyone else on the page never reports', () => {
  const options = buildInitOptions({ Sentry: FakeSentry, config: { dsn: DSN }, isDevelopment: () => false });

  assert.strictEqual(quiet(() => options.beforeSend(foreignEvent(), {})), null, 'a third-party widget is not ours to answer for');
  assert.strictEqual(quiet(() => options.beforeSend({ message: 'Script error.' }, {})), null, 'cross-origin noise carries no frame');
});

test('development never sends, however framework the stack is', () => {
  const options = buildInitOptions({ Sentry: FakeSentry, config: { dsn: DSN }, isDevelopment: () => true });
  assert.strictEqual(quiet(() => options.beforeSend(frameworkEvent(), {})), null);
});

test('an explicit opt-in is what it takes to send an email', () => {
  const options = buildInitOptions({
    Sentry: FakeSentry,
    config: { dsn: DSN, scrubEmail: false },
    isDevelopment: () => false,
    getUser: () => ({ uid: 'abc123', email: 'user@example.com' }),
  });

  const sent = quiet(() => options.beforeSend(frameworkEvent(), {}));
  assert.deepEqual(sent.user, { id: 'abc123', email: 'user@example.com' });
});

test('the auth params that ARE credentials never survive a url (#661)', () => {
  assert.strictEqual(
    scrubAuthParams('https://brand.test/signin?authPrivateKey=pk-test-abc'),
    'https://brand.test/signin',
    'the only param goes, and the empty query with it'
  );
  assert.strictEqual(
    scrubAuthParams('https://brand.test/signin?authReturnUrl=%2Fdashboard&authPrivateKey=pk-test-abc&utm_source=dock'),
    'https://brand.test/signin?authReturnUrl=%2Fdashboard&utm_source=dock',
    'its neighbours stay put'
  );
  assert.strictEqual(
    scrubAuthParams('https://brand.test/signin?authCustomToken=tok-test-abc'),
    'https://brand.test/signin',
    'the custom-token lane has the identical exposure'
  );
  assert.strictEqual(
    scrubAuthParams('https://brand.test/signin?authPrivateKey=pk-test-abc&authCustomToken=tok-test-abc'),
    'https://brand.test/signin',
    'both names, one pass'
  );
  assert.strictEqual(
    scrubAuthParams('https://brand.test/dashboard/account?tab=billing'),
    'https://brand.test/dashboard/account?tab=billing',
    'a url carrying neither comes back byte-identical'
  );
  // Sentry's history breadcrumbs record same-origin urls RELATIVE.
  assert.strictEqual(
    scrubAuthParams('/signin?authPrivateKey=pk-test-abc&authReturnUrl=%2Fdashboard'),
    '/signin?authReturnUrl=%2Fdashboard',
    'a relative url is scrubbed and stays relative'
  );
});

test('a navigation breadcrumb carries no key — not even the strip that removed it (#661)', () => {
  const options = buildInitOptions({ Sentry: FakeSentry, config: { dsn: DSN } });

  // What the SDK records when session-params.js calls history.replaceState to
  // drop the key: `from` is the PRE-strip url, query included.
  const crumb = options.beforeBreadcrumb({
    category: 'navigation',
    data: { from: '/signin?authPrivateKey=pk-test-abc', to: '/signin' },
  }, {});

  assert.deepEqual(crumb.data, { from: '/signin', to: '/signin' });

  const other = options.beforeBreadcrumb({ category: 'console', message: 'Signing in with private key' }, {});
  assert.deepEqual(other, { category: 'console', message: 'Signing in with private key' }, 'nothing else is touched');
});

test('the request url an event ships carries no key either (#661)', () => {
  const options = buildInitOptions({
    Sentry: FakeSentry,
    config: { dsn: DSN },
    isDevelopment: () => false,
    getUser: () => ({ uid: 'abc123', email: 'user@example.com' }),
  });

  const event = frameworkEvent();
  event.request = { url: 'https://brand.test/signin?authPrivateKey=pk-test-abc', headers: { Referer: 'https://brand.test/' } };

  const sent = quiet(() => options.beforeSend(event, {}));

  assert.strictEqual(sent.request.url, 'https://brand.test/signin', 'httpContext attaches the address bar at capture time');
  assert.deepEqual(sent.user, { id: 'abc123' }, 'and the email scrub still holds');
});

test('a host can add its own tags per event', () => {
  const options = buildInitOptions({
    Sentry: FakeSentry,
    config: { dsn: DSN },
    isDevelopment: () => false,
    getTags: () => ({ 'page.id': 'checkout' }),
  });

  const sent = quiet(() => options.beforeSend(frameworkEvent(), {}));
  assert.strictEqual(sent.tags['page.id'], 'checkout');
});
