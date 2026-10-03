/**
 * core tests — the policy every target inherits (#380).
 *
 * core.js is deliberately pure: no `process`, no SDK, no DOM. The first test
 * pins that (the browser bundle imports this file, where a `process.env` read
 * would be a page-breaking ReferenceError), and the rest pin the decisions —
 * off when unset, the one release format, the scrub default, and the
 * client-side bundle filter's accept/reject cases.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'core',
  tests: [
    {
      name: 'core touches no host global — it is safe inside a page bundle',
      run: (ctx) => {
        const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core.js'), 'utf8');
        ctx.expect(!/process\.env\.[A-Za-z_]/.test(source), 'no process.env read').toBeTruthy();
        ctx.expect(!/require\(['"]@sentry/.test(source), 'no SDK require').toBeTruthy();
      },
    },

    {
      name: 'no dsn = fully off, whatever the gates say',
      run: (ctx) => {
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
          ctx.expect(result.shouldEnable, `${JSON.stringify(section)} stays off`).toBe(false);
          ctx.expect(result.reason).toMatch(/dsn/);
        }
      },
    },

    {
      name: 'a kill switch beats a perfectly good config',
      run: (ctx) => {
        const result = core.resolveConfig(section({ dsn: DSN }), { isProduction: true, killed: true, killedReason: 'test run' });
        ctx.expect(result.shouldEnable).toBe(false);
        ctx.expect(result.reason).toBe('test run');
      },
    },

    {
      name: 'a non-production run stays off unless the host allows dev',
      run: (ctx) => {
        const off = core.resolveConfig(section({ dsn: DSN }), { isProduction: false });
        ctx.expect(off.shouldEnable).toBe(false);
        ctx.expect(off.reason).toMatch(/production/);

        const on = core.resolveConfig(section({ dsn: DSN }), { isProduction: false, allowInDev: true });
        ctx.expect(on.shouldEnable).toBe(true);
        ctx.expect(on.options.environment, 'a dev-allowed run tags itself development').toBe('development');
      },
    },

    {
      name: 'a production run resolves the init options out of the provider block (#425)',
      run: (ctx) => {
        const result = core.resolveConfig({ enabled: true, providers: { sentry: { dsn: DSN, sampleRate: 0.25 } } }, { isProduction: true });
        ctx.expect(result.shouldEnable).toBe(true);
        ctx.expect(result.reason).toBe(null);
        ctx.expect(result.options.dsn).toBe(DSN);
        ctx.expect(result.options.environment).toBe('production');
        ctx.expect(result.options.sampleRate, 'the sampling knob overrides the default').toBe(0.25);
        ctx.expect(result.options.tracesSampleRate).toBe(core.DEFAULTS.tracesSampleRate);
        ctx.expect(result.options.enabled, 'the role level never reaches Sentry.init').toBe(undefined);
        ctx.expect(result.options.providers, 'the providers block never reaches Sentry.init').toBe(undefined);
      },
    },

    {
      name: 'an explicit environment survives the gate that would have named it',
      run: (ctx) => {
        const result = core.resolveConfig(section({ dsn: DSN, environment: 'staging' }), { isProduction: true });
        ctx.expect(result.options.environment).toBe('staging');
      },
    },

    {
      name: 'the email is scrubbed by default and the uid always rides',
      run: (ctx) => {
        const scrubbed = core.normalizeUser({ uid: 'abc123', email: 'user@example.com', displayName: 'ignored' });
        ctx.expect(scrubbed, 'PII off by default: uid in, email out, nothing else').toEqual({ id: 'abc123' });

        const explicit = core.normalizeUser({ uid: 'abc123', email: 'user@example.com' }, { scrubEmail: false });
        ctx.expect(explicit, 'an explicit opt-in carries the email').toEqual({ id: 'abc123', email: 'user@example.com' });

        const stillScrubbed = core.normalizeUser({ uid: 'abc123', email: 'user@example.com' }, { scrubEmail: true });
        ctx.expect(stillScrubbed).toEqual({ id: 'abc123' });
      },
    },

    {
      name: 'an admin-shaped user maps its id, and nothing to say means nothing to send',
      run: (ctx) => {
        ctx.expect(core.normalizeUser({ id: 'admin-1' })).toEqual({ id: 'admin-1' });
        ctx.expect(core.normalizeUser(null)).toBe(null);
        ctx.expect(core.normalizeUser({})).toBe(null);
        ctx.expect(core.normalizeUser({ email: 'user@example.com' }), 'an email alone is never a reason to send a user').toBe(null);
      },
    },

    {
      name: 'the release tag is ONE format on every target: brand.id@version',
      run: (ctx) => {
        ctx.expect(core.releaseTag({ id: 'paperloom', version: '1.4.2' })).toBe('paperloom@1.4.2');
        ctx.expect(core.releaseTag({ id: 'paperloom', version: 1755648000000 })).toBe('paperloom@1755648000000');
        ctx.expect(core.releaseTag({ version: '1.4.2' }), 'no id = no release tag: a bare version is not a format any more').toBe(undefined);
        ctx.expect(core.releaseTag({ id: 'paperloom' }), 'no version = no release tag').toBe(undefined);
        ctx.expect(core.releaseTag()).toBe(undefined);
      },
    },

    {
      name: 'the bundle filter accepts an event thrown from our bundles',
      run: (ctx) => {
        const isFrameworkEvent = core.createBundleFilter();
        ctx.expect(isFrameworkEvent(eventWithFrames('https://paperloom.dev/assets/js/main.js'))).toBe(true);
        ctx.expect(isFrameworkEvent(eventWithFrames('https://paperloom.dev/assets/js/chunks/chunk-ABC.js'))).toBe(true);
        ctx.expect(isFrameworkEvent(eventWithFrames('chrome-extension://abcdef/assets/js/background.js'))).toBe(true);
      },
    },

    {
      name: 'the bundle filter rejects user-land, third-party and frameless noise',
      run: (ctx) => {
        const isFrameworkEvent = core.createBundleFilter();
        ctx.expect(isFrameworkEvent(eventWithFrames('https://paperloom.dev/some-page')), 'an inline page script is not ours').toBe(false);
        ctx.expect(isFrameworkEvent(eventWithFrames('https://cdn.thirdparty.com/widget.js')), 'a widget is not ours').toBe(false);
        ctx.expect(isFrameworkEvent(eventWithFrames('moz-extension://xyz/injected.js')), "a visitor's browser extension is not ours").toBe(false);
        ctx.expect(isFrameworkEvent({ message: 'Script error.' }), 'cross-origin noise carries no frame and never reports').toBe(false);
        ctx.expect(isFrameworkEvent({})).toBe(false);
      },
    },

    {
      name: 'one framework frame anywhere on the stack is enough',
      run: (ctx) => {
        const isFrameworkEvent = core.createBundleFilter();
        const mixed = eventWithFrames('https://cdn.thirdparty.com/widget.js', 'https://paperloom.dev/assets/js/main.js');
        ctx.expect(isFrameworkEvent(mixed)).toBe(true);
      },
    },

    {
      name: 'a host can name its own bundle URLs',
      run: (ctx) => {
        const isFrameworkEvent = core.createBundleFilter(['/dist/omega/']);
        ctx.expect(isFrameworkEvent(eventWithFrames('https://paperloom.dev/dist/omega/app.js'))).toBe(true);
        ctx.expect(isFrameworkEvent(eventWithFrames('https://paperloom.dev/assets/js/main.js')), 'the default is replaced, not merged').toBe(false);
      },
    },
  ],
});
