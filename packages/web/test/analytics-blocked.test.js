/**
 * Every analytics call in web core is GUARDED
 * ([#306](https://github.com/Omega-JS-Stack/omega/issues/306)) and CANONICAL
 * ([#328](https://github.com/Omega-JS-Stack/omega/issues/328)).
 *
 * `gtag`, `fbq` and `ttq` are page-level snippets. An ad blocker does not stub
 * them, it keeps them from ever being defined, so a bare call throws a
 * ReferenceError — and because the counting runs BEFORE the work on every one
 * of these paths, the throw takes the customer's action with it.
 * [#283](https://github.com/Omega-JS-Stack/omega/issues/283) fixed that inside
 * the billing card; 19 other files carried the same shape, the refund form
 * among them: its submit handler counts and only then calls the refund route,
 * so a blocked page means the money never moves.
 *
 * Three things hold here:
 *  - the refund form, the representative call site, still refunds with all
 *    three globals absent — and still counts every provider the CATALOG maps;
 *  - `core/js` contains no bare provider call at all, so the pattern cannot
 *    regrow one file at a time;
 *  - and no file names a provider at all any more: the guarded wrappers retired
 *    with the rewire, so a call site speaks canonical events or nothing.
 *
 * The module is browser code behind two bundler aliases (`@omega.js/client`,
 * `__main_assets__/*`), so the harness drives the REAL file through esbuild —
 * the convention billing-actions.test.js sets — and through the REAL catalog,
 * adapters and transport, which is what decides who hears an event.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
const { resolveSubscription } = require('@omega.js/account');

const PKG = path.join(__dirname, '..');
const ROOT = path.resolve(PKG, '..', '..');
const CORE_DIR = path.join(PKG, 'core');
const CORE_JS = path.join(CORE_DIR, 'js');
const THEMES_DIR = path.join(PKG, 'themes');
const REFUND_ENTRY = path.join(CORE_JS, 'pages', 'dashboard', 'account', 'sections', 'refund.js');

// The client's built module — the door web core reaches the analytics package
// (catalog, adapters, guarded transport) through.
const CLIENT_ANALYTICS = path.join(ROOT, 'packages', 'client', 'dist', 'modules', 'analytics.js');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-analytics-blocked-'));
const BUNDLE = path.join(BUNDLE_DIR, 'refund.cjs');

let building = null;

/** The file with its comments blanked, line structure intact. */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, (match, before) => before + ' '.repeat(match.length - before.length));
}

function bundleOnce() {
  building ||= esbuild.build({
    entryPoints: [REFUND_ENTRY],
    outfile: BUNDLE,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    plugins: [{
      name: 'harness-aliases',
      setup(build) {
        build.onResolve({ filter: /^__main_assets__\// }, (args) => {
          return { path: path.join(CORE_DIR, args.path.slice('__main_assets__/'.length)) };
        });
        // The REAL client module: the catalog is what decides which provider
        // hears an event, so stubbing it would prove nothing.
        build.onResolve({ filter: /^@omega\.js\/client\/modules\/analytics\.js$/ }, () => {
          return { path: CLIENT_ANALYTICS };
        });
        build.onResolve({ filter: /^@omega\.js\/client$/ }, () => {
          return { path: 'client', namespace: 'omega-client-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-client-stub' }, () => {
          return { contents: 'export default globalThis.__omegaClient;' };
        });
        // Same reason billing-actions.test.js keeps it a name: the published
        // FormManager build's `module.exports =` tail clobbers the harness
        // bundle's own exports. The stub keeps the ONE thing this suite needs
        // — the submit handler the page registers, so the test can press the
        // button the way the form does.
        build.onResolve({ filter: /^@omega\.js\/client\/modules\/form-manager\.js$/ }, () => {
          return { path: 'form-manager', namespace: 'omega-form-manager-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-form-manager-stub' }, () => {
          return {
            contents: `
              export class FormManager {
                constructor() { this.handlers = {}; this.successes = []; globalThis.__omegaForms.push(this); }
                on(event, handler) { this.handlers[event] = handler; }
                showSuccess(message) { this.successes.push(message); }
              }
            `,
          };
        });
      },
    }],
  });

  return building;
}

/** A cancelled subscription — the state the refund form is offered for. */
function refundableAccount() {
  return {
    subscription: {
      product: { id: 'premium', name: 'Premium' },
      status: 'cancelled',
      payment: { frequency: 'monthly', price: 10, processor: 'stripe' },
    },
  };
}

/**
 * Drive the REAL init() over a document built from ids, with the page's
 * analytics globals either present or blocked.
 *
 * `analyticsBlocked` is what an ad blocker leaves behind: the snippets never
 * run, so the names are simply not there.
 */
async function wireRefund({ analyticsBlocked }) {
  await bundleOnce();

  const requests = [];
  const tracked = [];
  const elements = new Map();

  const makeEl = (id) => ({
    id,
    innerHTML: '',
    classList: { contains: () => false, add: () => {}, remove: () => {}, toggle: () => {} },
    addEventListener() {},
    querySelector: () => null,
  });

  for (const id of ['refund-form', 'refund-reasons-container', 'refund-eligible', 'refund-ineligible']) {
    elements.set(id, makeEl(id));
  }

  globalThis.document = {
    getElementById: (id) => elements.get(id) || null,
    // The reason the customer picked before pressing the button.
    querySelector: (selector) => (selector.includes('refund_reason') ? { value: 'Too expensive' } : null),
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  globalThis.window = {
    location: { pathname: '/dashboard/account', search: '', hash: '#refund' },
    history: { replaceState: () => {} },
  };
  globalThis.__omegaForms = [];
  globalThis.__omegaClient = {
    config: { analytics: { providers: {} } },
    auth: () => ({ resolveSubscription: (account) => resolveSubscription(account) }),
    bindings: () => ({ update: () => {} }),
    utilities: () => ({ showNotification: () => {}, escapeHTML: (value) => value }),
    // The visitor consented to everything — a denied category is its own suite
    // (consent-gating.test.js); this one is about blocked GLOBALS.
    storage: () => ({
      get: (key, fallback) => (key === 'trackingConsent'
        ? { analytics: true, marketing: true, region: 'opt-out', version: 1 }
        : fallback),
      set: () => {},
    }),
    request: async (route, options) => {
      requests.push({ route, options });
      return { refund: { amount: 10, currency: 'usd', full: true } };
    },
  };

  for (const name of ['gtag', 'fbq', 'ttq']) {
    delete globalThis[name];
  }
  if (!analyticsBlocked) {
    globalThis.gtag = (...args) => tracked.push(['gtag', ...args]);
    globalThis.fbq = (...args) => tracked.push(['fbq', ...args]);
    globalThis.ttq = { track: (...args) => tracked.push(['ttq', ...args]) };
  }

  // require.resolve, not BUNDLE: the cache is keyed by the REAL path, and
  // macOS's tmpdir is a symlink (/var → /private/var).
  delete require.cache[require.resolve(BUNDLE)];
  const refund = require(BUNDLE);

  await refund.init();
  await refund.loadData(refundableAccount());

  const [form] = globalThis.__omegaForms;

  /** Press "Request refund" the way FormManager does. */
  const submit = () => form.handlers.submit({ data: { feedback: '' } });

  return { requests, tracked, form, submit };
}

test('#306: a blocked analytics global never stops the refund', async () => {
  // The repro: `gtag` is not a function that fails, it is a name that does not
  // exist. trackRefund() runs first, so the throw meant the customer's refund
  // request was never sent at all.
  const { requests, form, submit } = await wireRefund({ analyticsBlocked: true });

  await assert.doesNotReject(submit, 'the submit handler survives the blocked scripts');

  assert.deepStrictEqual(
    requests.map((request) => request.route),
    ['/omega/payments/refund'],
    'the refund route is called with the analytics scripts blocked',
  );
  assert.strictEqual(requests[0].options.body.confirmed, true, 'and carries the confirmation the backend expects');
  assert.strictEqual(requests[0].options.body.reason, 'Too expensive', 'with the reason the customer picked');
  assert.strictEqual(form.successes.length, 1, 'and the customer is told it went through');
});

test('#328: with the scripts present, every provider the CATALOG maps is counted', async () => {
  // The guard must not become a silent opt-out: an unblocked page still counts
  // the refund action. WHO hears it is the catalog's call, and `refund_action`
  // is a GA4-only action bucket by ruling — an ad platform has nothing to do
  // with a support click, and the pre-catalog site's `RefundAction` /
  // `ViewContent` pair was noise in two ad accounts.
  const { tracked, submit } = await wireRefund({ analyticsBlocked: false });

  await submit();

  assert.deepStrictEqual(tracked.map(([provider]) => provider), ['gtag'], 'the mapped provider counted the refund');
  assert.deepStrictEqual(tracked[0], ['gtag', 'event', 'refund_action', { action: 'submit' }], 'gtag is called exactly as before');
});

test('#306: a half-blocked page counts what it can and still refunds', async () => {
  // Blockers are per-provider: one list blocks Meta and leaves Google alone.
  // Each provider is checked on its own inside the transport, which a single
  // try/catch around all three would not do.
  const { tracked, requests, submit } = await wireRefund({ analyticsBlocked: false });

  delete globalThis.fbq;
  globalThis.ttq = {};

  await submit();

  assert.deepStrictEqual(tracked.map(([provider]) => provider), ['gtag'], 'the provider that loaded still counts');
  assert.deepStrictEqual(requests.map((request) => request.route), ['/omega/payments/refund'], 'and the refund went through');
});

test('#328: no call site names a provider — the guarded wrappers are gone', () => {
  // The wrappers were the #306 fix: one guarded pass-through per provider. They
  // are retired, because a call site that knows a provider's name is a call
  // site that can drift from the catalog (a `track` where the platform defines
  // no such event, a payload in the wrong dialect). The ONE canonical call is
  // the replacement, and this is what keeps a new page from reaching past it.
  const RETIRED = /\btrack(Google|Meta|TikTok)\b|\bidentifyTikTok\b/;

  const offenders = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.m?js$/.test(entry.name)) {
        continue;
      }

      // Comments blanked, line structure intact: a retired name MENTIONED in
      // prose (the facade's own header says what it replaced) is documentation,
      // not a call.
      codeOnly(fs.readFileSync(full, 'utf8')).split('\n').forEach((line, index) => {
        if (RETIRED.test(line)) {
          offenders.push(`${path.relative(PKG, full)}:${index + 1}: ${line.trim()}`);
        }
      });
    }
  };

  walk(CORE_JS);
  walk(THEMES_DIR);

  assert.deepStrictEqual(
    offenders,
    [],
    `fire the canonical event instead — event('<catalog name>', params) from __main_assets__/js/libs/analytics.js (#328):\n${offenders.join('\n')}`,
  );
});

test('#306: no file in core/js or the theme layer calls a provider global bare', async () => {
  // Static by design: one guarded helper is only the SSOT while nothing walks
  // around it, and the shape regrows one new page module at a time.
  const BARE_CALL = /\bgtag\(|\bfbq\(|\bttq\./;

  // The two files that may name the globals, each for a reason that is not a
  // bare call: libs/analytics.js is the page's own host of the facade, and the
  // IDENTITY calls it makes (gtag set, fbq init, ttq identify) are settings
  // rather than events, so they have no catalog entry to ride — each one is
  // `typeof`-guarded there. analytics-loader.js is the file that DEFINES the
  // globals (#383): it installs each provider's queue on `window` and calls it
  // through `window.`, which cannot throw a ReferenceError the way a bare name
  // can. (dev.js is no longer on this list: its interceptors retired with the
  // rewire — the facade logs the whole walk itself.)
  const ALLOWED = new Set([
    path.join(CORE_JS, 'libs', 'analytics.js'),
    path.join(CORE_JS, 'core', 'analytics-loader.js'),
  ]);

  const offenders = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.m?js$/.test(entry.name) || ALLOWED.has(full)) {
        continue;
      }

      const lines = fs.readFileSync(full, 'utf8').split('\n');

      lines.forEach((line, index) => {
        if (BARE_CALL.test(line)) {
          offenders.push(`${path.relative(path.join(__dirname, '..'), full)}:${index + 1}: ${line.trim()}`);
        }
      });
    }
  };

  // Theme section behaviors are call sites too — the newsletter band proved it
  // (a blocked provider turned a successful subscribe into an error alert).
  walk(CORE_JS);
  walk(THEMES_DIR);

  assert.deepStrictEqual(
    offenders,
    [],
    `fire the canonical event instead — event('<catalog name>', params) from __main_assets__/js/libs/analytics.js — so a blocked provider cannot take the action with it (#306):\n${offenders.join('\n')}`,
  );
});
