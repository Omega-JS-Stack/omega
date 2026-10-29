/**
 * browser tests — the client-side send gate (#380).
 *
 * The doctrine under test: only errors from OUR bundles leave a page, the
 * environment gates still hold, and the user that rides is scrubbed.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const path = require('node:path');

const { buildInitOptions, scrubAuthParams, installEarlyErrorBuffer } = require('../src/browser.js');

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

// A page's window that records its listeners, set as the global for the call,
// since the head inlines the same function to run against the real one.
function onPage(fn) {
  const listeners = {};
  const page = {
    addEventListener: (type, handler) => { (listeners[type] = listeners[type] || []).push(handler); },
    removeEventListener: (type, handler) => {
      listeners[type] = (listeners[type] || []).filter((registered) => registered !== handler);
    },
  };
  const saved = globalThis.window;

  globalThis.window = page;
  try {
    return fn(page, listeners);
  } finally {
    globalThis.window = saved;
  }
}

// Whether a buffered entry holds the thrown value, itself or one level down
const holds = (entry, value) => entry === value || Object.values(entry || {}).some((field) => (
  field === value || (field !== null && typeof field === 'object' && Object.values(field).includes(value))
));

module.exports = defineCases({
  type: 'group',
  description: 'browser',
  tests: [
    {
      name: 'the browser entry never reaches for a host global — it is bundled into a page',
      run: (ctx) => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'browser.js'), 'utf8');
        ctx.expect(!/process\.env\.[A-Za-z_]/.test(source), 'no process.env read').toBeTruthy();
        ctx.expect(!/require\(['"]@sentry/.test(source), 'the SDK is passed in, never required').toBeTruthy();
      },
    },

    {
      name: 'the resolved options carry the release, environment and sampling knobs',
      run: (ctx) => {
        // `config` is the SENTRY PROVIDER BLOCK — @omega.js/web's page Configuration
        // and @omega.js/extension's build map `monitoring.providers.sentry` into the
        // client's `sentry.config` contract (#425), so nothing role-level arrives here.
        const options = buildInitOptions({
          Sentry: FakeSentry,
          config: { dsn: DSN, sampleRate: 0.5 },
          release: 'paperloom@1755648000000',
          environment: 'production',
        });

        ctx.expect(options.dsn).toBe(DSN);
        ctx.expect(options.release).toBe('paperloom@1755648000000');
        ctx.expect(options.environment).toBe('production');
        ctx.expect(options.sampleRate).toBe(0.5);
      },
    },

    {
      name: 'tracing always rides; replay only when a sample rate asks for it',
      run: (ctx) => {
        const bare = buildInitOptions({ Sentry: FakeSentry, config: { dsn: DSN } });
        ctx.expect(bare.integrations.map((i) => i.name)).toEqual(['BrowserTracing']);

        const withReplay = buildInitOptions({ Sentry: FakeSentry, config: { dsn: DSN, replaysOnErrorSampleRate: 0.1 } });
        ctx.expect(withReplay.integrations.map((i) => i.name)).toEqual(['BrowserTracing', 'Replay']);
        ctx.expect(withReplay.replaysOnErrorSampleRate).toBe(0.1);
      },
    },

    {
      name: 'an error from our bundle reports, tagged and carrying the scrubbed user',
      run: (ctx) => {
        const options = buildInitOptions({
          Sentry: FakeSentry,
          config: { dsn: DSN },
          isDevelopment: () => false,
          getUser: () => ({ uid: 'abc123', email: 'user@example.com' }),
        });

        const sent = quiet(() => options.beforeSend(frameworkEvent(), {}));

        ctx.expect(sent, 'the event survives the gate').toBeTruthy();
        ctx.expect(sent.tags['process.type']).toBe('browser');
        ctx.expect(sent.tags['usage.session.hours'], 'the session-hours tag rides').toBeTruthy();
        ctx.expect(sent.user, 'the uid rides, the email is scrubbed').toEqual({ id: 'abc123' });
      },
    },

    {
      name: 'an error from anyone else on the page never reports',
      run: (ctx) => {
        const options = buildInitOptions({ Sentry: FakeSentry, config: { dsn: DSN }, isDevelopment: () => false });

        ctx.expect(quiet(() => options.beforeSend(foreignEvent(), {})), 'a third-party widget is not ours to answer for').toBe(null);
        ctx.expect(quiet(() => options.beforeSend({ message: 'Script error.' }, {})), 'cross-origin noise carries no frame').toBe(null);
      },
    },

    {
      name: 'development never sends, however framework the stack is',
      run: (ctx) => {
        const options = buildInitOptions({ Sentry: FakeSentry, config: { dsn: DSN }, isDevelopment: () => true });
        ctx.expect(quiet(() => options.beforeSend(frameworkEvent(), {}))).toBe(null);
      },
    },

    {
      name: 'an explicit opt-in is what it takes to send an email',
      run: (ctx) => {
        const options = buildInitOptions({
          Sentry: FakeSentry,
          config: { dsn: DSN, scrubEmail: false },
          isDevelopment: () => false,
          getUser: () => ({ uid: 'abc123', email: 'user@example.com' }),
        });

        const sent = quiet(() => options.beforeSend(frameworkEvent(), {}));
        ctx.expect(sent.user).toEqual({ id: 'abc123', email: 'user@example.com' });
      },
    },

    {
      name: 'the auth params that ARE credentials never survive a url (#661)',
      run: (ctx) => {
        ctx.expect(scrubAuthParams('https://brand.test/signin?authPrivateKey=pk-test-abc'), 'the only param goes, and the empty query with it').toBe('https://brand.test/signin');
        ctx.expect(scrubAuthParams('https://brand.test/signin?returnUrl=%2Fdashboard&authPrivateKey=pk-test-abc&utm_source=dock'), 'its neighbours stay put').toBe('https://brand.test/signin?returnUrl=%2Fdashboard&utm_source=dock');
        ctx.expect(scrubAuthParams('https://brand.test/signin?authCustomToken=tok-test-abc'), 'the custom-token lane has the identical exposure').toBe('https://brand.test/signin');
        ctx.expect(scrubAuthParams('https://brand.test/signin?authPrivateKey=pk-test-abc&authCustomToken=tok-test-abc'), 'both names, one pass').toBe('https://brand.test/signin');
        ctx.expect(scrubAuthParams('https://brand.test/dashboard/account?tab=billing'), 'a url carrying neither comes back byte-identical').toBe('https://brand.test/dashboard/account?tab=billing');
        // Sentry's history breadcrumbs record same-origin urls RELATIVE.
        ctx.expect(scrubAuthParams('/signin?authPrivateKey=pk-test-abc&returnUrl=%2Fdashboard'), 'a relative url is scrubbed and stays relative').toBe('/signin?returnUrl=%2Fdashboard');
      },
    },

    {
      name: 'a navigation breadcrumb carries no key — not even the strip that removed it (#661)',
      run: (ctx) => {
        const options = buildInitOptions({ Sentry: FakeSentry, config: { dsn: DSN } });

        // What the SDK records when session-params.js calls history.replaceState to
        // drop the key: `from` is the PRE-strip url, query included.
        const crumb = options.beforeBreadcrumb({
          category: 'navigation',
          data: { from: '/signin?authPrivateKey=pk-test-abc', to: '/signin' },
        }, {});

        ctx.expect(crumb.data).toEqual({ from: '/signin', to: '/signin' });

        const other = options.beforeBreadcrumb({ category: 'console', message: 'Signing in with private key' }, {});
        ctx.expect(other, 'nothing else is touched').toEqual({ category: 'console', message: 'Signing in with private key' });
      },
    },

    {
      name: 'the request url an event ships carries no key either (#661)',
      run: (ctx) => {
        const options = buildInitOptions({
          Sentry: FakeSentry,
          config: { dsn: DSN },
          isDevelopment: () => false,
          getUser: () => ({ uid: 'abc123', email: 'user@example.com' }),
        });

        const event = frameworkEvent();
        event.request = { url: 'https://brand.test/signin?authPrivateKey=pk-test-abc', headers: { Referer: 'https://brand.test/' } };

        const sent = quiet(() => options.beforeSend(event, {}));

        ctx.expect(sent.request.url, 'httpContext attaches the address bar at capture time').toBe('https://brand.test/signin');
        ctx.expect(sent.user, 'and the email scrub still holds').toEqual({ id: 'abc123' });
      },
    },

    {
      name: 'a host can add its own tags per event',
      run: (ctx) => {
        const options = buildInitOptions({
          Sentry: FakeSentry,
          config: { dsn: DSN },
          isDevelopment: () => false,
          getTags: () => ({ 'page.id': 'checkout' }),
        });

        const sent = quiet(() => options.beforeSend(frameworkEvent(), {}));
        ctx.expect(sent.tags['page.id']).toBe('checkout');
      },
    },

    {
      name: 'the early-error buffer fills window.__OMEGA_EARLY_ERRORS with errors and rejections',
      run: (ctx) => {
        onPage((page, listeners) => {
          installEarlyErrorBuffer(page);

          ctx.expect(Array.isArray(page.__OMEGA_EARLY_ERRORS), 'the buffer is an array on the window').toBeTruthy();
          ctx.expect(page.__OMEGA_EARLY_ERRORS.length).toBe(0);

          const thrown = new Error('thrown early');
          const rejected = new Error('rejected early');
          (listeners.error || []).forEach((handler) => handler({ type: 'error', error: thrown, message: thrown.message }));
          (listeners.unhandledrejection || []).forEach((handler) => handler({ type: 'unhandledrejection', reason: rejected }));

          ctx.expect(page.__OMEGA_EARLY_ERRORS.length, 'one entry per event').toBe(2);
          ctx.expect(page.__OMEGA_EARLY_ERRORS.some((entry) => holds(entry, thrown)), 'the error is kept').toBeTruthy();
          ctx.expect(page.__OMEGA_EARLY_ERRORS.some((entry) => holds(entry, rejected)), 'the rejection is kept').toBeTruthy();
        });
      },
    },

    {
      name: 'a second install of the early-error buffer adds no second listener set',
      run: (ctx) => {
        onPage((page, listeners) => {
          installEarlyErrorBuffer(page);
          const buffer = page.__OMEGA_EARLY_ERRORS;
          buffer.push('already caught');

          installEarlyErrorBuffer(page);

          ctx.expect((listeners.error || []).length, 'one error listener').toBe(1);
          ctx.expect((listeners.unhandledrejection || []).length, 'one rejection listener').toBe(1);
          ctx.expect(page.__OMEGA_EARLY_ERRORS, 'and the buffer, with what it caught, is kept').toBe(buffer);
          ctx.expect(buffer).toEqual(['already caught']);
        });
      },
    },

    {
      name: 'a stopped early-error buffer hears no more events',
      run: (ctx) => {
        onPage((page, listeners) => {
          installEarlyErrorBuffer(page);
          const buffer = page.__OMEGA_EARLY_ERRORS;

          buffer.stop();

          const thrown = new Error('thrown after the stop');
          (listeners.error || []).forEach((handler) => handler({ type: 'error', error: thrown, message: thrown.message }));
          (listeners.unhandledrejection || []).forEach((handler) => handler({ type: 'unhandledrejection', reason: thrown }));

          ctx.expect((listeners.error || []).length, 'no error listener is left').toBe(0);
          ctx.expect((listeners.unhandledrejection || []).length, 'no rejection listener is left').toBe(0);
          ctx.expect(buffer.length, 'and nothing reached the buffer').toBe(0);
        });
      },
    },
  ],
});
