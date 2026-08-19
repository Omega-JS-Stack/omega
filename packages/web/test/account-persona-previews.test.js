/**
 * The account page's REFERRALS and SESSIONS panels, rendered from the data a
 * seeded persona actually carries
 * ([#343](https://github.com/Omega-JS-Stack/omega/issues/343)).
 *
 * Both lists used to be filled by client-side fixtures behind `?_dev_prefill`,
 * and that is precisely how they stayed wrong: the fixtures invented shapes the
 * backend never writes (a referral timestamp as EPOCH MILLIS, when a signup
 * appends an ISO string — routes/user/signup/post.js processAffiliate), so the
 * panel looked right in dev and printed `NaN years ago` for every real
 * referral. The fixtures are gone; the personas carry the data
 * (packages/backend src/test/test-accounts.js), and these are the shapes they
 * carry — asserted here, so the panels are pinned against the writer rather
 * than against a fixture that agreed with them.
 *
 * The harness is billing-winback-offer.test.js's: the REAL modules through
 * esbuild with @omega.js/client stubbed, over a hand-rolled document that is
 * only what the panels touch (node has no DOM and web pulls in no jsdom).
 */
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');

const CORE_DIR = path.join(__dirname, '..', 'core');
const SECTIONS_DIR = path.join(CORE_DIR, 'js', 'pages', 'dashboard', 'account', 'sections');

const BUNDLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-account-previews-'));
const BUNDLE = path.join(BUNDLE_DIR, 'sections.cjs');

let building = null;

// One entry exposing both panels, bundled the way a page bundle imports them.
function bundleOnce() {
  building ||= esbuild.build({
    stdin: {
      contents: [
        `export * as referrals from './referrals.js';`,
        `export * as security from './security.js';`,
      ].join('\n'),
      resolveDir: SECTIONS_DIR,
      loader: 'js',
    },
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
        build.onResolve({ filter: /^@omega\.js\/client$/ }, () => {
          return { path: 'client', namespace: 'omega-client-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-client-stub' }, () => {
          return { contents: 'export default globalThis.__omegaClient;' };
        });
        build.onResolve({ filter: /^@omega\.js\/client\/modules\/form-manager\.js$/ }, () => {
          return { path: 'form-manager', namespace: 'omega-form-manager-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-form-manager-stub' }, () => {
          return { contents: 'export class FormManager {}' };
        });
        // The security panel imports Firebase auth lazily, on a path only
        // init() reaches — never bundled against a real SDK here.
        build.onResolve({ filter: /^@firebase\/auth$/ }, () => {
          return { path: 'firebase-auth', namespace: 'omega-firebase-auth-stub' };
        });
        build.onLoad({ filter: /.*/, namespace: 'omega-firebase-auth-stub' }, () => {
          return { contents: 'export const getRedirectResult = async () => null;' };
        });
      },
    }],
  });

  return building;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * A referral as `routes/user/signup` appends it to the referrer's doc: the
 * referred account's uid and an ISO timestamp, and nothing else.
 */
function referral(uid, ago) {
  return { uid, timestamp: new Date(Date.now() - ago).toISOString() };
}

/**
 * A session as the seeder writes it and `GET /user/sessions` hands it back —
 * the Realtime Database record keyed by session id.
 */
function session(uid, platform, ip, ago) {
  const at = new Date(Date.now() - ago);

  return { uid, platform, ip, timestamp: at.toISOString(), timestampUNIX: Math.floor(at.getTime() / 1000) };
}

/** The pieces of a DOM element the panels use: text, HTML and a value. */
function makeEl(id) {
  return { id, textContent: '', innerHTML: '', value: '' };
}

// What `GET /user/sessions` answers for the case being run. Read at CALL time
// by the one client stub: the bundle captures `globalThis.__omegaClient` when
// it loads, so a second stub object would never reach the modules.
let sessionsPayload = {};

/**
 * Stand up the document + client stub the panels read, run `render`, and hand
 * back the elements. `sessions` is the ONE seam: the sessions panel fetches
 * them from the backend, and there is no server here.
 */
async function renderPanels(render, { sessions } = {}) {
  await bundleOnce();

  sessionsPayload = sessions || {};

  const ids = [
    'referral-code-input',
    'total-referrals',
    'recent-referrals',
    'referrals-badge',
    'referrals-list',
    'active-sessions-list',
  ];
  const elements = new Map(ids.map((id) => [id, makeEl(id)]));

  globalThis.window = {
    location: { href: 'https://example.com/dashboard/account', origin: 'https://example.com', search: '', hash: '#referrals' },
  };
  globalThis.window.top = globalThis.window;
  globalThis.document = {
    getElementById: (id) => elements.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  globalThis.__omegaClient = globalThis.__omegaClient || {
    isDevelopment: () => true,
    getApiUrl: () => 'https://example.com/api',
    request: async () => sessionsPayload,
    auth: () => ({ getUser: () => null }),
    utilities: () => ({
      escapeHTML: (value) => String(value).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`),
      showNotification: () => {},
    }),
  };

  const bundle = require(BUNDLE);

  await render(bundle);

  return elements;
}

/** Wait for a panel that renders after an awaited fetch. */
async function settle() {
  for (let tick = 0; tick < 10; tick++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test('#343: the referrals panel renders the referrals a persona carries', async () => {
  // The REFERRER persona's list — the only account seeded with referrals
  // ([#363](https://github.com/Omega-JS-Stack/omega/issues/363)): every persona
  // demonstrates its own scenario, so the affiliate story is told by the
  // account built for it, and this is the list it carries.
  const referrals = [
    referral('_test-premium-active', 2 * DAY),
    referral('_test-basic', 9 * DAY),
    referral('_test-premium-expired', 24 * DAY),
    referral('_test-refunded', 51 * DAY),
  ];

  const elements = await renderPanels(async (bundle) => {
    bundle.referrals.loadData({ affiliate: { code: 'TESTREF', referrals } });
  });

  const list = elements.get('referrals-list').innerHTML;

  for (const entry of referrals) {
    assert.ok(list.includes(entry.uid), `the panel lists ${entry.uid}`);
  }

  assert.equal(elements.get('total-referrals').textContent, '4', 'every referral is counted');
  assert.equal(elements.get('referrals-badge').textContent, '4', 'and the nav badge agrees');
  assert.equal(elements.get('referral-code-input').value, 'https://example.com?ref=TESTREF', 'the persona\'s own link');

  // The bug the fixtures hid: an ISO timestamp is what a signup writes, and the
  // panel did arithmetic on it — every real referral read `NaN years ago`.
  assert.ok(!/NaN/.test(list), 'no referral renders an unreadable date');
  assert.match(list, /2 days ago/, 'the newest referral is dated from its ISO timestamp');
  assert.match(list, /1 month ago/, 'and so is the oldest');
});

test('#343: the referrals panel counts this month from the same timestamps', async () => {
  // "This month" is a calendar month, so the recent referral is dated to keep
  // this assertion about the timestamp READ rather than about today's date.
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const withinThisMonth = Math.min(Date.now() - startOfMonth, 12 * HOUR);

  const elements = await renderPanels(async (bundle) => {
    bundle.referrals.loadData({
      affiliate: {
        code: 'TESTREF',
        referrals: [referral('_test-basic', withinThisMonth), referral('_test-refunded', 120 * DAY)],
      },
    });
  });

  assert.equal(elements.get('total-referrals').textContent, '2', 'both referrals are counted in the total');
  assert.equal(elements.get('recent-referrals').textContent, '1', 'only the recent one counts towards this month');
});

test('#343: an account that referred nobody still renders its empty state', async () => {
  const elements = await renderPanels(async (bundle) => {
    bundle.referrals.loadData({ affiliate: { code: 'FRESH', referrals: [] } });
  });

  assert.equal(elements.get('total-referrals').textContent, '0', 'nothing is counted');
  assert.match(elements.get('referrals-list').innerHTML, /No referrals yet/, 'and the panel says so');
});

test('#343: the sessions panel renders the devices a persona is signed in on', async () => {
  const sessions = {
    '_test-session-premium-active-1': session('_test-premium-active', 'ios', '198.51.100.229', 1 * HOUR),
    '_test-session-premium-active-2': session('_test-premium-active', 'linux', '198.51.100.230', 20 * HOUR),
    '_test-session-premium-active-3': session('_test-premium-active', 'mac', '198.51.100.227', 73 * HOUR),
  };

  const elements = await renderPanels(async (bundle) => {
    bundle.security.loadData({
      activity: {
        client: { platform: 'windows', mobile: false, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36' },
        geolocation: { ip: '198.51.100.12', city: 'Manchester', region: 'England', country: 'GB' },
        created: { timestamp: new Date(Date.now() - (2 * HOUR)).toISOString(), timestampUNIX: Math.floor((Date.now() - (2 * HOUR)) / 1000) },
      },
    });
    await settle();
  }, { sessions });

  const list = elements.get('active-sessions-list').innerHTML;

  // The seeded platforms, as the panel names them (getPlatformName).
  assert.ok(list.includes('iOS'), 'the phone is listed');
  assert.ok(list.includes('Linux'), 'the linux box is listed');
  assert.ok(list.includes('macOS'), 'the mac is listed');
  assert.ok(list.includes('198.51.100.229'), 'each device shows where it connected from');
  assert.ok(list.includes('Current'), 'and the browser in front of you is marked as the current session');
  assert.ok(!/NaN|Unknown Device/.test(list), 'every device reads as a real device at a real time');
});

test('#343: a persona signed in nowhere else still shows its current session', async () => {
  const elements = await renderPanels(async (bundle) => {
    bundle.security.loadData({
      activity: {
        client: { platform: 'mac', mobile: false, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126.0.0.0 Safari/537.36' },
        geolocation: { ip: '192.0.2.44', city: 'San Diego', region: 'California', country: 'US' },
        created: { timestamp: new Date().toISOString(), timestampUNIX: Math.floor(Date.now() / 1000) },
      },
    });
    await settle();
  }, { sessions: {} });

  const list = elements.get('active-sessions-list').innerHTML;

  assert.ok(list.includes('Current'), 'the current session is always there');
  assert.ok(!list.includes('No active sessions found'), 'so the panel is never empty for a signed-in account');
});
