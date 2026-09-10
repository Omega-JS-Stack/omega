/**
 * Root `npm run test:flows` — the CRUCIAL USER FLOWS in a REAL browser
 * against the FULL local stack (#155).
 *
 * Ian's Google-signin click (2026-07-31) found a flow-breaking bug no suite
 * could see: every auth lane before this one signed in through the SDK or the
 * custom-token path, so the provider picker, the password FORMS, checkout, the
 * vert ladder and the signed-in policy pages had no committed end-to-end
 * coverage at all. This lane drives them the way a user does — real Chromium,
 * real forms, real emulator — and is the promotion of that session's scripted
 * Google-picker proof into the suite.
 *
 * The stack it owns (never a developer's live boot):
 *   1. Every CLASSIC port (4000/9099/8080/5001/5002/5443/4050/4443/…) is HELD
 *      by a placeholder listener for the whole run, so the N7 allocator in
 *      both children bumps past them onto fresh ports. A classic port that is
 *      already busy is somebody else's stack: the hold fails, the allocator
 *      bumps around it exactly the same, and nothing of theirs is touched.
 *   2. The playground backend's full emulator suite (auth, functions, firestore,
 *      database, hosting, pubsub) WITH persona seeding — the lane signs in as
 *      seeded personas only, never a hand-made account.
 *   3. The website's REAL `omega dev` — not a static server: the #156 auth
 *      proxy (the emulator's OAuth handler served under the SITE origin) only
 *      exists there, and the provider redirect leg is what it makes possible.
 *      The website port is allocated HERE and handed to BOTH children as
 *      OMEGA_WEBSITE_PORT, because the backend builds its checkout
 *      confirmation URLs from it and boots before the site does.
 *
 * On top of those single flows it runs the BILLING JOURNEYS (#209): the paid
 * lifecycle a brand's money actually moves through — upgrade, cancel, a
 * declined renewal, a trial converting — each on its OWN dedicated seeded
 * persona, so no journey can inherit another's subscription state. It also
 * talks to the emulator's Firestore directly (firebase-admin, host-side
 * only): reading the provider ids a journey's webhook needs, and writing the
 * purchase records persona seeding cannot.
 *
 * The browser is headless and refuses every host but the local stack and the
 * provider flow's irreducible externals (AUTH_FLOW_HOSTS), so ad and analytics
 * scripts never load and the vert ladder runs the same everywhere. Every
 * failing step drops a screenshot in .temp/flows-e2e/screenshots/.
 *
 * Knobs: OMEGA_SKIP_E2E=1 skips (matches the sibling e2e lanes).
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const { createRequire } = require('module');
const assert = require('assert');

if (process.env.OMEGA_SKIP_E2E === '1') {
  console.log('⏭ OMEGA_SKIP_E2E=1 — skipping user-flows e2e');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const PLAYGROUND = path.join(ROOT, 'brands', 'omega-playground');
const PLAYGROUND_BACKEND = path.join(PLAYGROUND, 'targets', 'backend');
const PLAYGROUND_WEBSITE = path.join(PLAYGROUND, 'targets', 'website');
// The hoisted local bins, spawned DIRECTLY (see @omega.js/devkit/test/boot-child)
const MGR_BIN = path.join(ROOT, 'node_modules', '.bin', 'mgr');
const OMEGA_BIN = path.join(ROOT, 'node_modules', '.bin', 'omega');
const LOG_DIR = path.join(ROOT, '.temp', 'flows-e2e');
const SHOT_DIR = path.join(LOG_DIR, 'screenshots');

const { CLASSIC_PORTS, readPortsFile, resolvePorts, composeTargetConfig, loadEnv } = require('@omega.js/config');
// The boot mechanism is ONE mechanism (#775): child boot/stop on a ready
// marker, the classic-port hold, and the browser launcher all live in devkit,
// so this lane and every brand's own lane share them instead of drifting.
const { startChild, stopChild } = require('@omega.js/devkit/test/boot-child');
const { holdClassicPorts, releasePorts, CLASSIC_HOLD_PORTS } = require('@omega.js/devkit/test/port-hold');
const { launchBrowser, resolvePuppeteer } = require('@omega.js/devkit/test/browser');
const { createStepsLog } = require('./steps-log');

// The billing journeys hand-build the provider webhooks no UI can produce (a
// declined renewal, a trial converting), and the webhook route authenticates
// them with the SAME shared key the backend's own test provider uses — it
// lives in the brand's .env cascade, never in this file. Loaded inside main()
// AFTER the children's environment is snapshotted: loadEnv mutates this
// process's env, and the children resolve their own cascade already.
let WEBHOOK_KEY = null;

const EMULATOR_READY_TIMEOUT = 300000;
const DEV_READY_TIMEOUT = 300000;
const EMULATOR_READY_MARKER = /Emulator ready\. Press Ctrl\+C/i;
const DEV_READY_MARKER = /Dev server: (https?:\/\/localhost:\d+)/;

// Seeded personas (@omega.js/backend's test-accounts.js — every persona shares
// the deterministic password, and the domain comes from the brand's contact
// email). One persona per area, so no area's writes can perturb another's.
const { TEST_ACCOUNT_PASSWORD: PASSWORD, TEST_ACCOUNTS, seedOrderFixture } = require('@omega.js/backend/src/test/test-accounts.js');
const PERSONA_IDS = {
  password: '_test.basic',
  checkout: '_test.premium-expired',
  account: '_test.premium-active',
  googleOne: '_test.google.one',
  googleTwo: '_test.google.two',
  // One DEDICATED persona per billing journey (#209) — never shared with
  // another journey, so no journey inherits another's subscription state.
  journeyUpgrade: '_test.journey-flows-upgrade',
  journeyCancel: '_test.journey-flows-cancel',
  journeyFailure: '_test.journey-flows-failure',
  journeyTrial: '_test.journey-flows-trial',
};

/**
 * A journey persona's own seed definition. The lane reads uids and seeded
 * payment ids straight off test-accounts.js — the seeder's SSOT — so a
 * renamed persona breaks loudly here instead of silently missing its account.
 * @param {string} key - the test-accounts.js account key
 * @returns {object} the account definition ({ id, uid, email, properties })
 */
function personaSeed(key) {
  const account = TEST_ACCOUNTS[key];
  if (!account) {
    throw new Error(`no seeded persona named ${key} — test-accounts.js and this lane have drifted`);
  }
  return account;
}

// The only hosts a page may reach. Everything else — ad scripts, analytics,
// avatar services, CDNs — is refused, which is what keeps the vert ladder and
// the page timings the same on every machine.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
// The provider sign-in leg's two irreducible externals:
//   - unpkg + Google Fonts: the Auth EMULATOR's own picker page is built with
//     Material Web; without that script its account rows ignore clicks.
//   - apis.google.com + gstatic: the Firebase Auth SDK's redirect resolver
//     loads gapi even against the emulator, and getRedirectResult() fails with
//     auth/internal-error when it cannot — the credential never comes home.
const AUTH_FLOW_HOSTS = new Set([
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'apis.google.com',
  'www.gstatic.com',
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const failures = [];
const stepsLog = createStepsLog(LOG_DIR);
let activePage = null;

/**
 * Run a named step. A failure screenshots whatever page is active and keeps
 * going — one broken area must not hide the state of the other three. Every
 * verdict also lands in .temp/flows-e2e/steps.log as it happens, so a crashed
 * run still names the step that broke.
 * @param {string} name - step label
 * @param {Function} fn - the step body
 * @returns {Promise<boolean>} true when the step passed
 */
async function step(name, fn) {
  try {
    const detail = await fn();
    stepsLog.pass(name, detail);
    console.log(`  ✓ ${name}${detail ? ` (${detail})` : ''}`);
    return true;
  } catch (error) {
    failures.push({ name, error });
    stepsLog.fail(name, error);
    console.log(`  ✗ ${name}\n      ${error.message}`);
    await screenshot(name);
    return false;
  }
}

/**
 * Screenshot the active page into the artifacts dir (best effort).
 * @param {string} label - step label the shot is named after
 */
async function screenshot(label) {
  if (!activePage) {
    return;
  }
  const file = path.join(SHOT_DIR, `${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await activePage.screenshot({ path: file, fullPage: false });
    console.log(`      shot: ${path.relative(ROOT, file)}`);
  } catch (e) {
    // A dead page cannot be photographed — the assertion message is the record
  }
}

function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

// -- Browser helpers --------------------------------------------------------

/**
 * A fresh, isolated browser context + page: every area signs in on its own
 * profile, so no area inherits another's session.
 * @param {object} browser - puppeteer browser
 * @param {string} label - context label, used in the console log file
 * @param {string[]} consoleLog - collector for the page's console lines
 * @returns {Promise<object>} the page
 */
async function newPage(browser, label, consoleLog) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // Local stack only, plus the provider flow's irreducible externals
  // (AUTH_FLOW_HOSTS). A provider lane that cannot load its ad script is a
  // provider lane that cannot fill, which is exactly the vert state this lane
  // asserts on.
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    let host = null;
    try {
      host = new URL(request.url()).hostname;
    } catch (e) {
      return request.continue();
    }
    if (!host || LOCAL_HOSTS.has(host) || AUTH_FLOW_HOSTS.has(host)) {
      return request.continue();
    }
    return request.abort();
  });
  page.on('console', (message) => consoleLog.push(`[${label}][${message.type()}] ${message.text()}`));
  page.on('pageerror', (error) => consoleLog.push(`[${label}][pageerror] ${error.message}`));
  // A failing request is the usual root cause behind a stalled flow — the
  // console line alone never says WHICH url died.
  page.on('response', (response) => {
    if (response.status() >= 400) {
      consoleLog.push(`[${label}][http ${response.status()}] ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    consoleLog.push(`[${label}][netfail] ${request.url()} (${request.failure()?.errorText})`);
  });
  // A form left dirty by a redirecting sign-in can raise a beforeunload
  // prompt; an unanswered dialog freezes the renderer.
  page.on('dialog', async (dialog) => {
    consoleLog.push(`[${label}][dialog] ${dialog.type()}: ${dialog.message()}`);
    await dialog.accept().catch(() => {});
  });
  return page;
}

/**
 * Click an element from INSIDE the page instead of with the mouse. The site's
 * exit-intent popup listens for `mouseleave`, and puppeteer's real pointer
 * movement trips it — the modal then covers the form and every later click
 * waits forever on an obscured target. A dispatched click runs the same
 * handlers with no pointer to trip anything.
 * @param {object} page - puppeteer page
 * @param {string} selector - the element to click
 */
async function clickElement(page, selector) {
  await page.waitForSelector(selector, { timeout: 60000 });
  const clicked = await page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) {
      return false;
    }
    element.click();
    return true;
  }, selector);

  if (!clicked) {
    throw new Error(`no element matched ${selector}`);
  }
}

/** Wait for an auth page's FormManager to finish booting. */
function waitForAuthForm(page) {
  return page.waitForSelector('#auth-form[data-form-state="ready"]', { timeout: 60000 });
}

/**
 * Drive the Firebase Auth emulator's Google picker: wait for the handler,
 * then click the row for a seeded persona.
 * @param {object} page - puppeteer page
 * @param {string} email - the seeded Google persona's email
 * @returns {Promise<string>} the picked row's text
 */
async function pickGoogleAccount(page, email) {
  await page.waitForFunction(
    () => /\/emulator\/auth\/handler/.test(window.location.href),
    { timeout: 60000 },
  );
  await page.waitForFunction(
    (wanted) => document.body.innerText.includes(wanted),
    { timeout: 60000 },
    email,
  );

  // The rows exist in the markup BEFORE the picker's Material Web script has
  // wired their handlers, so an early click is a click into the void: choose,
  // then give the page a few seconds to leave, and choose again if it didn't.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const picked = await page.evaluate((wanted) => {
      // Each account renders as a list row; the innermost match is the
      // clickable one.
      const rows = [...document.querySelectorAll('li, .mdc-list-item, button')]
        .filter((element) => element.textContent.includes(wanted));
      const row = rows[rows.length - 1];
      if (!row) {
        return null;
      }
      row.click();
      return row.textContent.replace(/\s+/g, ' ').trim();
    }, email);

    if (!picked) {
      throw new Error(`the picker never offered ${email}`);
    }

    const left = await page
      .waitForFunction(() => !/\/emulator\/auth\/handler/.test(window.location.href), { timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    if (left) {
      return picked;
    }
  }

  throw new Error(`the picker never acted on the choice of ${email}`);
}

/** Wait until the page has left the auth pages (the signed-in landing). */
async function waitForLanding(page, timeout = 60000) {
  await page.waitForFunction(
    () => !/\/(signin|signup|reset)(\?|$|\/)/.test(window.location.pathname + window.location.search)
      && !/emulator\/auth\/handler/.test(window.location.href),
    { timeout },
  );
  return page.url();
}

/**
 * The account page's rendered account state — the live half of the
 * signed-in policy contract (bindings fed from the emulator's user doc).
 * The two alert flags are the journeys' only way to tell a cancelling or
 * trialing subscription apart: web core's billing.js renders BOTH of those as
 * the plain "Active" status label, so plan + status alone cannot see them. A
 * `@show` binding toggles the `hidden` attribute, so visibility is read off
 * the attribute — the billing SECTION itself is display-hidden until it is
 * navigated to, which no journey needs to do.
 *
 * @param {object} page - puppeteer page
 * @param {string} siteUrl - the dev site origin
 * @returns {Promise<object>} { url, email, plan, status, cancelling, trialing }
 */
async function readAccountPage(page, siteUrl) {
  await page.goto(`${siteUrl}/dashboard/account`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => {
      const element = document.querySelector('[data-omega-bind="@text auth.user.email"]');
      return !!element && element.textContent.includes('@');
    },
    { timeout: 60000 },
  ).catch(() => {});

  return page.evaluate(() => {
    const shown = (binding) => {
      const element = document.querySelector(`[data-omega-bind="@show ${binding}"]`);
      return !!element && !element.hasAttribute('hidden');
    };

    return {
      url: window.location.href,
      email: document.querySelector('[data-omega-bind="@text auth.user.email"]')?.textContent.trim() || null,
      plan: document.querySelector('[data-omega-bind="@text billing.plan.name"]')?.textContent.trim() || null,
      status: document.querySelector('[data-omega-bind="@text billing.status.label"]')?.textContent.trim() || null,
      cancelling: shown('billing.alerts.cancelling'),
      trialing: shown('billing.alerts.trialing'),
    };
  });
}

/**
 * Re-read the account page until its rendered billing state agrees with
 * `predicate`. Every billing journey ends on an ASYNCHRONOUS pipeline
 * (provider webhook → Firestore trigger → the page's auth listener), so a
 * journey's verdict is the first render that agrees — not the first render.
 * @param {object} page - puppeteer page
 * @param {string} siteUrl - the dev site origin
 * @param {Function} predicate - receives the readAccountPage result
 * @param {string} wanted - what the predicate is waiting for (error text)
 * @returns {Promise<object>} the agreeing account state
 */
async function waitForAccountState(page, siteUrl, predicate, wanted) {
  const deadline = Date.now() + 120000;
  let account = null;

  while (Date.now() < deadline) {
    account = await readAccountPage(page, siteUrl);
    if (predicate(account)) {
      return account;
    }
    await sleep(3000);
  }

  throw new Error(`the account page never showed ${wanted} (last: ${JSON.stringify(account)})`);
}

/**
 * Sign a persona in through the REAL /signin form. Every billing journey
 * opens this way — a journey that reached its account through the SDK would
 * not be the path a customer takes to it.
 * @param {object} page - puppeteer page
 * @param {string} siteUrl - the dev site origin
 * @param {string} email - the seeded persona's email
 */
async function signInWithPassword(page, siteUrl, email) {
  await page.goto(`${siteUrl}/signin`, { waitUntil: 'networkidle2' });
  await waitForAuthForm(page);
  await page.type('#email', email);
  await page.type('#password', PASSWORD);
  await clickElement(page, 'button[data-provider="email"]:not(.d-none)');
  await waitForLanding(page);
}

/**
 * Buy a plan on the TEST card provider and wait for the confirmation
 * surface. `params` carries the journey's own checkout knobs on top of the
 * monthly test-card defaults (the trial journey forces its own eligibility).
 * @param {object} page - puppeteer page
 * @param {string} siteUrl - the dev site origin
 * @param {object} params - extra checkout query params (must include product)
 * @returns {Promise<string>} the orderId the confirmation URL carries
 */
async function payWithTestCard(page, siteUrl, params) {
  const query = new URLSearchParams({ frequency: 'monthly', _dev_cardProvider: 'test', ...params });
  await page.goto(`${siteUrl}/payment/checkout?${query}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#checkout-form[data-form-state="ready"]', { timeout: 60000 });

  // One click is not enough on the trial page: its eligibility answer
  // re-renders the terms a beat after ready and the form manager swallows any
  // click landing in that window ("Click prevented (disabled)"). A swallowed
  // click is a no-op, so re-click until the redirect actually starts.
  const cardButton = '#checkout-form button[data-payment-method="card"]:not([hidden])';
  for (let attempt = 0; attempt < 8; attempt++) {
    await clickElement(page, cardButton);
    const redirected = await page.waitForFunction(
      () => window.location.pathname.startsWith('/payment/confirmation'),
      { timeout: 8000 },
    ).then(() => true).catch(() => false);
    if (redirected) break;
  }
  await page.waitForFunction(
    () => window.location.pathname.startsWith('/payment/confirmation'),
    { timeout: 90000 },
  );

  const orderId = new URL(page.url()).searchParams.get('orderId');
  if (!orderId) {
    throw new Error(`the confirmation URL carried no orderId (${page.url()})`);
  }
  return orderId;
}

/**
 * POST a hand-built provider webhook at the backend exactly as a provider
 * would. Two of the four journeys' end states — a declined renewal, a trial
 * converting — have NO user-facing surface that can produce them; a webhook
 * is the only way they ever arrive, in production or here.
 * @param {string} apiUrl - the emulator's hosting origin (rewrites /omega/**)
 * @param {object} event - the Stripe-shaped event body
 */
async function postTestWebhook(apiUrl, event) {
  const response = await fetch(`${apiUrl}/omega/payments/webhook?provider=test&key=${WEBHOOK_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    throw new Error(`the ${event.type} webhook was refused (${response.status}: ${(await response.text()).slice(0, 200)})`);
  }
}

/**
 * firebase-admin from the backend app's own resolution, initialised ONCE for
 * the whole run (host-side only). Each caller sets the emulator host its own
 * service reads (`FIREBASE_AUTH_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST`)
 * before its first call; setting one only affects THIS process, since both
 * children were spawned with their environment already snapshotted.
 * @returns {object} the firebase-admin namespace, default app live
 */
function adminApp() {
  const backendRequire = createRequire(path.join(PLAYGROUND_BACKEND, 'package.json'));
  const admin = backendRequire('firebase-admin');

  if (admin.apps.length === 0) {
    const firebaserc = JSON.parse(fs.readFileSync(path.join(PLAYGROUND_BACKEND, '.firebaserc'), 'utf8'));
    admin.initializeApp({ projectId: firebaserc.projects.default });
  }

  return admin;
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('\nUser-flows e2e (real Chromium: auth, checkout, verts, account, billing journeys)\n');

  // Resolved from the monorepo root, the same walk a brand's lane makes to its
  // own root. No browser is a SKIP here, never a failure — this lane cannot
  // run without one, and a machine without Chrome is not a broken product.
  let puppeteer = null;
  try {
    puppeteer = resolvePuppeteer(ROOT);
  } catch (error) {
    console.log(`⏭ SKIPPED — ${error.message}\n`);
    process.exit(0);
  }

  const backendConfig = composeTargetConfig(PLAYGROUND_BACKEND, 'backend').config;
  const contactEmail = backendConfig.brand?.contact?.email || '';
  const personaDomain = contactEmail.split('@')[1];
  if (!personaDomain) {
    throw new Error('brand.contact.email is missing — persona emails cannot be derived');
  }
  const persona = (id) => `${PERSONA_IDS[id]}@${personaDomain}`;
  const brandId = backendConfig.brand?.id;
  // The billing journeys' paid tier — the same product the checkout area buys
  const paidProduct = (backendConfig.payment?.products || []).find((product) => product.id === 'premium');
  // The id a provider puts on the plan. Brands with no real Stripe product
  // carry the `_test_<id>` sentinel the resolver maps back (see the backend's
  // test intent provider) — either way the pipeline resolves the same plan.
  const planProductId = paidProduct?.stripe?.productId || `_test_${paidProduct?.id}`;

  let hold = null;
  let emulator = null;
  let dev = null;
  let browser = null;
  const consoleLog = [];

  try {
    // Never clobber a live playground stack (its ports file + a listening
    // hosting port = someone's dev session).
    const incumbent = readPortsFile(PLAYGROUND_BACKEND);
    if (incumbent?.hosting && await isPortListening(incumbent.hosting)) {
      throw new Error(`a playground emulator stack is already running (hosting :${incumbent.hosting}) — stop it and re-run`);
    }

    let sitePort = null;
    let siteUrl = null;
    let apiUrl = null;
    let firestorePort = null;
    let authPort = null;

    await step('the classic ports are held so the stack boots beside a live dev', async () => {
      hold = await holdClassicPorts();
      // The website port is allocated HERE (past the held classics) because
      // the emulator needs it at BOOT time: the backend builds the checkout
      // confirmation URL from OMEGA_WEBSITE_PORT, and it starts first.
      const { ports } = await resolvePorts({ wanted: { website: CLASSIC_PORTS.website } });
      sitePort = ports.website;
      assert.notEqual(sitePort, CLASSIC_PORTS.website, 'the lane must never take the classic website port');
      return `held ${hold.held.length}/${CLASSIC_HOLD_PORTS.length}${hold.busy.length ? ` (busy, left alone: ${hold.busy.join(', ')})` : ''}; website :${sitePort}`;
    });

    const childEnv = { ...process.env, OMEGA_WEBSITE_PORT: String(sitePort) };

    // Only NOW: the children carry the environment they always did, and this
    // process gains the brand's secrets the billing journeys need.
    loadEnv(PLAYGROUND_BACKEND);
    WEBHOOK_KEY = process.env.OMEGA_WEBHOOK_KEY;
    if (!WEBHOOK_KEY) {
      throw new Error('OMEGA_WEBHOOK_KEY is missing from the playground backend\'s .env cascade — the billing journeys cannot post their webhooks');
    }

    await step('the playground emulator boots + personas seed', async () => {
      emulator = startChild({
        bin: MGR_BIN,
        args: ['emulator'],
        cwd: PLAYGROUND_BACKEND,
        env: childEnv,
        logFile: path.join(LOG_DIR, 'emulator.log'),
        marker: EMULATOR_READY_MARKER,
        timeout: EMULATOR_READY_TIMEOUT,
        relativeTo: ROOT,
      });
      await emulator.ready;
      const ports = readPortsFile(PLAYGROUND_BACKEND);
      if (!ports?.auth || !ports?.hosting || !ports?.firestore) {
        throw new Error(`resolved port map incomplete: ${JSON.stringify(ports)}`);
      }
      assert.notEqual(ports.auth, CLASSIC_PORTS.auth, 'the emulator must not take the classic auth port');
      // Hosting rewrites /omega/** at the api function — the origin the
      // billing journeys post their provider webhooks to.
      apiUrl = `http://127.0.0.1:${ports.hosting}`;
      firestorePort = ports.firestore;
      authPort = ports.auth;
      return `auth :${ports.auth}, hosting :${ports.hosting}, functions :${ports.functions}`;
    });

    await step('the website serves through the REAL `omega dev` (auth proxy live)', async () => {
      dev = startChild({
        bin: OMEGA_BIN,
        args: ['dev', `--port=${sitePort}`],
        cwd: PLAYGROUND_WEBSITE,
        env: childEnv,
        logFile: path.join(LOG_DIR, 'dev.log'),
        marker: DEV_READY_MARKER,
        timeout: DEV_READY_TIMEOUT,
        relativeTo: ROOT,
      });
      siteUrl = await dev.ready;
      return siteUrl;
    });

    browser = await launchBrowser({ puppeteer });

    // ---- Area 1: auth -----------------------------------------------------

    console.log('\n  Auth');

    const authPage = await newPage(browser, 'auth', consoleLog);
    activePage = authPage;

    await step('a Google signup runs the REAL redirect leg: picker → account → landing', async () => {
      await authPage.goto(`${siteUrl}/signup`, { waitUntil: 'networkidle2' });
      await waitForAuthForm(authPage);
      await clickElement(authPage, '#consent-legal');
      await clickElement(authPage, 'button[data-provider="google.com"]');

      const picked = await pickGoogleAccount(authPage, persona('googleOne'));
      const landing = await waitForLanding(authPage);

      const account = await readAccountPage(authPage, siteUrl);
      assert.equal(account.email, persona('googleOne'), `the signed-in account should be the picked persona (got ${account.email})`);
      return `${picked.split(' ').slice(-1)[0]} → ${landing}`;
    });

    await step('signout (?authSignout=true) ends the session and the account page kicks out', async () => {
      await authPage.goto(`${siteUrl}/signin?authSignout=true`, { waitUntil: 'networkidle2' });
      await waitForAuthForm(authPage);

      await authPage.goto(`${siteUrl}/dashboard/account`, { waitUntil: 'networkidle2' });
      await authPage.waitForFunction(
        () => /\/(signin|signup)/.test(window.location.pathname),
        { timeout: 60000 },
      );
      return authPage.url().replace(siteUrl, '');
    });

    await step('the authReturnUrl leg returns a Google sign-in to its destination', async () => {
      const destination = `${siteUrl}/pricing`;
      await authPage.goto(`${siteUrl}/signin?authReturnUrl=${encodeURIComponent(destination)}`, { waitUntil: 'networkidle2' });
      await waitForAuthForm(authPage);
      await clickElement(authPage, 'button[data-provider="google.com"]');
      await pickGoogleAccount(authPage, persona('googleTwo'));

      await authPage.waitForFunction(
        (wanted) => window.location.pathname === new URL(wanted).pathname,
        { timeout: 60000 },
        destination,
      );
      return authPage.url().replace(siteUrl, '');
    });

    await step('a RELATIVE authReturnUrl is honored the same as the absolute form (#160)', async () => {
      const destination = '/pricing';
      await authPage.goto(`${siteUrl}/signin?authSignout=true`, { waitUntil: 'networkidle2' });
      await waitForAuthForm(authPage);

      await authPage.goto(`${siteUrl}/signin?authReturnUrl=${encodeURIComponent(destination)}`, { waitUntil: 'networkidle2' });
      await waitForAuthForm(authPage);
      await clickElement(authPage, 'button[data-provider="google.com"]');
      await pickGoogleAccount(authPage, persona('googleTwo'));

      await authPage.waitForFunction(
        (wanted) => window.location.pathname === wanted,
        { timeout: 60000 },
        destination,
      );
      return authPage.url().replace(siteUrl, '');
    });

    await step('an empty OAuth return fails LOUDLY instead of showing a blank form', async () => {
      const emptyReturnPage = await newPage(browser, 'empty-return', consoleLog);
      activePage = emptyReturnPage;
      // The one-shot marker `signInWithRedirect` writes before leaving: this
      // page load IS a return from a redirect, with no credential behind it.
      await emptyReturnPage.evaluateOnNewDocument(() => {
        try { sessionStorage.setItem('omega:authRedirectPending', String(Date.now())); } catch (e) { /* denied storage */ }
      });
      await emptyReturnPage.goto(`${siteUrl}/signin`, { waitUntil: 'networkidle2' });

      await emptyReturnPage.waitForFunction(
        () => /Sign-in did not complete/i.test(document.body.innerText),
        { timeout: 60000 },
      );
      await emptyReturnPage.close();
      activePage = authPage;
      return 'Sign-in did not complete. Please try again.';
    });

    await step('the /signin FORM signs a persona in with email + password', async () => {
      const passwordPage = await newPage(browser, 'password', consoleLog);
      activePage = passwordPage;

      await passwordPage.goto(`${siteUrl}/signin`, { waitUntil: 'networkidle2' });
      await waitForAuthForm(passwordPage);
      await passwordPage.type('#email', persona('password'));
      await passwordPage.type('#password', PASSWORD);
      await clickElement(passwordPage, 'button[data-provider="email"]:not(.d-none)');
      await waitForLanding(passwordPage);

      const account = await readAccountPage(passwordPage, siteUrl);
      assert.equal(account.email, persona('password'), `the form should sign in the persona (got ${account.email})`);
      await passwordPage.close();
      activePage = authPage;
      return persona('password');
    });

    await step('the /signup FORM creates an account and lands it signed in', async () => {
      const signupPage = await newPage(browser, 'signup', consoleLog);
      activePage = signupPage;
      const email = `_test.flows-signup-${Date.now()}@${personaDomain}`;

      await signupPage.goto(`${siteUrl}/signup`, { waitUntil: 'networkidle2' });
      await waitForAuthForm(signupPage);
      await signupPage.type('#email', email);
      await signupPage.type('#password', 'flows-e2e-password-1');
      await clickElement(signupPage, '#consent-legal');
      await clickElement(signupPage, 'button[data-provider="email"]:not(.d-none)');
      await waitForLanding(signupPage);

      const account = await readAccountPage(signupPage, siteUrl);
      assert.equal(account.email, email, `the new account should be signed in (got ${account.email})`);
      await signupPage.close();
      activePage = authPage;
      return email;
    });

    await step('the /reset FORM sends a password-reset request', async () => {
      const resetPage = await newPage(browser, 'reset', consoleLog);
      activePage = resetPage;

      await resetPage.goto(`${siteUrl}/reset`, { waitUntil: 'networkidle2' });
      await waitForAuthForm(resetPage);
      await resetPage.type('#email', persona('password'));
      await clickElement(resetPage, '#auth-form button[data-provider="email"]:not(.d-none)');

      await resetPage.waitForFunction(
        () => /reset email (has been )?sent|check your inbox/i.test(document.body.innerText),
        { timeout: 60000 },
      );
      await resetPage.close();
      activePage = authPage;
      return persona('password');
    });

    await authPage.close();

    // ---- Area 2: checkout -------------------------------------------------

    console.log('\n  Checkout');

    const checkoutPage = await newPage(browser, 'checkout', consoleLog);
    activePage = checkoutPage;

    await step('a persona signs in and checkout binds its state', async () => {
      await checkoutPage.goto(`${siteUrl}/signin`, { waitUntil: 'networkidle2' });
      await waitForAuthForm(checkoutPage);
      await checkoutPage.type('#email', persona('checkout'));
      await checkoutPage.type('#password', PASSWORD);
      await clickElement(checkoutPage, 'button[data-provider="email"]:not(.d-none)');
      await waitForLanding(checkoutPage);

      // `_dev_cardProvider=test` routes the card button at @omega.js/backend's
      // TEST provider: a Stripe-shaped session that auto-fires its own
      // webhook and hands back the confirmation URL — no live provider, ever.
      await checkoutPage.goto(`${siteUrl}/payment/checkout?product=premium&frequency=monthly&_dev_cardProvider=test`, { waitUntil: 'networkidle2' });
      await checkoutPage.waitForSelector('#checkout-form[data-form-state="ready"]', { timeout: 60000 });

      const bound = await checkoutPage.evaluate(() => ({
        product: window._checkout?.state?.product?.id || null,
        frequency: window._checkout?.state?.frequency || null,
        productName: document.querySelector('[data-omega-bind="@text checkout.product.name"]')?.textContent.trim() || null,
        error: document.querySelector('[data-omega-bind="@show checkout.error.show"]:not([hidden])')?.textContent.replace(/\s+/g, ' ').trim() || null,
      }));

      assert.equal(bound.error, null, `checkout should load without a fatal error (got ${bound.error})`);
      assert.equal(bound.product, 'premium', `the URL's product should bind (got ${bound.product})`);
      assert.equal(bound.frequency, 'monthly', `the URL's frequency should bind (got ${bound.frequency})`);
      return `${bound.product}/${bound.frequency}`;
    });

    await step('the payment-method buttons arm', async () => {
      const armed = await checkoutPage.$$eval(
        '#checkout-form button[data-payment-method]:not([hidden])',
        (buttons) => buttons.map((button) => button.getAttribute('data-payment-method')),
      );
      assert.ok(armed.includes('card'), `the card button should be visible and armed (armed: ${armed.join(', ') || 'none'})`);
      return armed.join(', ');
    });

    await step('paying reaches the confirmation surface with the order on it', async () => {
      await clickElement(checkoutPage, '#checkout-form button[data-payment-method="card"]:not([hidden])');
      await checkoutPage.waitForFunction(
        () => window.location.pathname.startsWith('/payment/confirmation'),
        { timeout: 90000 },
      );

      const confirmation = new URL(checkoutPage.url());
      assert.ok(confirmation.searchParams.get('orderId'), 'the confirmation URL should carry the orderId');
      assert.equal(confirmation.searchParams.get('productId'), 'premium', 'the confirmation URL should carry the product');

      await checkoutPage.waitForFunction(
        () => /thank you/i.test(document.body.innerText),
        { timeout: 60000 },
      );
      return `${confirmation.pathname} (order ${confirmation.searchParams.get('orderId')})`;
    });

    await checkoutPage.close();

    // ---- Area 3: verts ----------------------------------------------------

    console.log('\n  Verts');

    // Signed OUT: a vert unit hides itself for subscribers (the standard auth
    // binding), so the ladder is only observable on a visitor's page.
    const vertPage = await newPage(browser, 'verts', consoleLog);
    activePage = vertPage;

    await step('an unfilled slot ladders down to the built-in promo', async () => {
      await vertPage.goto(`${siteUrl}/test/libraries/verts`, { waitUntil: 'networkidle2' });
      await vertPage.evaluate(() => {
        const $host = document.querySelector('[data-omega-vert="house"]');
        window.__flowsVertEvents = [];
        for (const name of ['no-fill', 'promo', 'fill', 'click']) {
          $host.addEventListener(`omega-vert:${name}`, (event) => window.__flowsVertEvents.push({ name, detail: event.detail }));
        }

        // The playground carries no google analytics id, so web core foot.html
        // emits its no-op gtag stub and no dataLayer with it. Stand the
        // configured branch's recorder up in its place (the same
        // `dataLayer.push(arguments)` foot.html writes), so the host-side
        // vert_click lands exactly where a configured brand would see it (#159).
        window.dataLayer = window.dataLayer || [];
        window.gtag = function () { window.dataLayer.push(arguments); };

        $host.scrollIntoView({ block: 'center' });
      });

      await vertPage.waitForFunction(
        () => window.__flowsVertEvents.some((entry) => entry.name === 'promo'),
        { timeout: 90000 },
      );

      const events = await vertPage.evaluate(() => window.__flowsVertEvents.map((entry) => entry.name));
      assert.ok(events.includes('no-fill'), `the ladder's no-fill leg must fire (got ${events.join(' → ')})`);
      assert.ok(events.indexOf('no-fill') < events.indexOf('promo'), `no-fill must fire before the promo (got ${events.join(' → ')})`);
      return events.join(' → ');
    });

    await step('the promo card renders content-sized inside its slot ceiling', async () => {
      // The host mounts the frame AT the ceiling and shrinks it when the inline
      // document reports its height, so the promo event precedes the shrink:
      // wait for the report, or a loaded machine measures the ceiling itself.
      await vertPage.waitForFunction(
        () => {
          const $frame = document.querySelector('[data-omega-vert="house"] iframe.omega-vert-promo');
          return $frame && $frame.getBoundingClientRect().height < 250;
        },
        { timeout: 30000 },
      ).catch(() => {});

      const box = await vertPage.evaluate(() => {
        const $host = document.querySelector('[data-omega-vert="house"]');
        const $frame = $host.querySelector('iframe.omega-vert-promo');
        return {
          frameHeight: $frame ? Math.round($frame.getBoundingClientRect().height) : null,
          hostHeight: Math.round($host.getBoundingClientRect().height),
          sandbox: $frame?.getAttribute('sandbox') || null,
          srcdoc: !!$frame?.getAttribute('srcdoc'),
        };
      });

      assert.ok(box.srcdoc, 'the promo frame carries its document inline (zero network)');
      assert.ok(!/allow-same-origin/.test(box.sandbox), 'a srcdoc promo frame must never carry allow-same-origin');
      assert.ok(box.frameHeight > 0, 'the promo frame should have height');
      // 'rectangle' is the slot preset on this unit: a ceiling, never a floor
      assert.ok(box.frameHeight < 250, `the card should be content-sized under the rectangle ceiling (got ${box.frameHeight}px)`);
      assert.equal(box.hostHeight, box.frameHeight, 'the host should shrink to the card (no chrome of its own)');
      return `${box.frameHeight}px in a 250px slot`;
    });

    await step('a promo click carries the UTM set and forwards out of the frame', async () => {
      const link = await vertPage.evaluate(() => {
        const srcdoc = document.querySelector('[data-omega-vert="house"] iframe').getAttribute('srcdoc');
        const href = srcdoc.match(/href="([^"]+)"/)?.[1] || '';
        // srcdoc is html — the query separators arrive escaped
        return href.replace(/&amp;/g, '&');
      });

      const url = new URL(link);
      assert.equal(url.searchParams.get('utm_source'), brandId, `utm_source should be the host brand id (got ${url.searchParams.get('utm_source')})`);
      assert.equal(url.searchParams.get('utm_medium'), 'omega-vert', 'utm_medium should be omega-vert');
      assert.equal(url.searchParams.get('utm_campaign'), 'omega-promo', 'utm_campaign should mark the promo lane');
      assert.equal(url.searchParams.get('utm_content'), 'rectangle', 'utm_content should be the slot preset');

      const frame = await (await vertPage.$('[data-omega-vert="house"] iframe')).contentFrame();
      await frame.evaluate(() => document.getElementById('omega-vert').click());

      await vertPage.waitForFunction(
        () => window.__flowsVertEvents.some((entry) => entry.name === 'click'),
        { timeout: 30000 },
      );
      const click = await vertPage.evaluate(() => window.__flowsVertEvents.find((entry) => entry.name === 'click'));
      assert.equal(click.detail.id, 'omega-promo', `the host should receive the promo click (got ${click.detail.id})`);
      return `${url.origin}${url.pathname} + 4 utm params`;
    });

    await step('the click fires vert_click through the page gtag', async () => {
      // Web's analytics transport is the page's own gtag (#159), so a fired
      // event is a dataLayer entry: ['event', 'vert_click', params].
      await vertPage.waitForFunction(
        () => (window.dataLayer || []).some((entry) => entry[0] === 'event' && entry[1] === 'vert_click'),
        { timeout: 30000 },
      );

      const params = await vertPage.evaluate(() => {
        const entry = Array.from(window.dataLayer)
          .map((item) => Array.from(item))
          .find((item) => item[0] === 'event' && item[1] === 'vert_click');
        return entry[2];
      });

      assert.equal(params.vert_id, 'omega-promo', `vert_click should carry the promo id (got ${params.vert_id})`);
      assert.equal(params.vert_lane, 'promo', `vert_click should carry the promo lane (got ${params.vert_lane})`);
      assert.equal(params.vert_slot, 'rectangle', `vert_click should carry the slot preset (got ${params.vert_slot})`);
      assert.ok(params.page_location, 'the event should carry the page data the analytics module merges in');
      return `vert_click ${params.vert_id} (${params.vert_lane}/${params.vert_slot})`;
    });

    await vertPage.close();

    // ---- Area 4: dashboard / account --------------------------------------

    console.log('\n  Dashboard');

    const accountPage = await newPage(browser, 'account', consoleLog);
    activePage = accountPage;

    await step('a signed-in policy page renders account state from the emulator', async () => {
      await accountPage.goto(`${siteUrl}/signin`, { waitUntil: 'networkidle2' });
      await waitForAuthForm(accountPage);
      await accountPage.type('#email', persona('account'));
      await accountPage.type('#password', PASSWORD);
      await clickElement(accountPage, 'button[data-provider="email"]:not(.d-none)');
      await waitForLanding(accountPage);

      // /dashboard is the app root: it forwards to the account page
      await accountPage.goto(`${siteUrl}/dashboard`, { waitUntil: 'networkidle2' });
      await accountPage.waitForFunction(
        () => window.location.pathname === '/dashboard/account',
        { timeout: 60000 },
      );

      const account = await readAccountPage(accountPage, siteUrl);
      assert.equal(account.email, persona('account'), `the account page should show the persona (got ${account.email})`);
      // The seeded persona holds an active paid subscription — the plan name
      // comes from the BRAND's product catalog, resolved through the user doc
      assert.equal(account.plan, paidProduct?.name, `the plan should resolve from the emulator's user doc (got ${account.plan})`);
      assert.match(account.status || '', /active/i, `the subscription status should render (got ${account.status})`);
      return `${account.email} · ${account.plan} · ${account.status}`;
    });

    await step('a session killed server-side signs the open tab out at the next moment of doubt', async () => {
      // #798: Firebase asks the Auth server about a persisted session at page
      // load and at the hourly refresh and at no other moment, so a revoked,
      // disabled or deleted account kept an open tab signed in until a reload.
      // Nothing here reloads: the tab stays exactly where the step above left
      // it, signed in on the account page.
      //
      // The admin SDK, pointed at THIS run's auth emulator (the same host-side
      // lane the billing journeys use for Firestore).
      process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${authPort}`;
      const admin = adminApp();

      // The session dies on the SERVER while the browser still holds a
      // valid-looking token: what a revocation, a disable and a delete all
      // look like to an open page, and what a restarted auth emulator does to
      // a dev session. DISABLING is the lever here because the Auth emulator's
      // refresh grant never reads `validSince`, so `revokeRefreshTokens` is a
      // no-op against it while production honours it; a disabled user's
      // refresh comes back USER_DISABLED, which reaches the client as
      // `auth/user-disabled`, the same "session is gone" class.
      await admin.auth().updateUser(personaSeed('premium-active').uid, { disabled: true });

      // The tab comes back into view. @omega.js/client forces a token refresh,
      // the Auth server refuses it, the client signs out, and the page's auth
      // policy takes an `authenticated` page's signed-out visitor to the auth
      // surface: /signin or /signup, whichever the policy picks (the kick-out
      // step above accepts the same pair).
      await accountPage.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });

      await accountPage.waitForFunction(
        () => /^\/(signin|signup)/.test(window.location.pathname),
        { timeout: 60000 },
      );

      return accountPage.url();
    });

    await accountPage.close();

    // ---- Area 5: billing journeys -----------------------------------------
    //
    // One paid-lifecycle JOURNEY per DEDICATED persona (#209): upgrade,
    // cancel, a declined renewal, a trial converting. Each runs on its own
    // seeded `journey-flows-*` account, so no journey can inherit another's
    // subscription state, and each verdict is read off the RENDERED account
    // page — the surface a customer judges their plan by.
    //
    // Two of the four end states have no UI that reaches them: a renewal is
    // declined, and a trial ends, on the PROVIDER's clock. Those legs post a
    // hand-built test webhook at the backend exactly as a provider would —
    // the same shape @omega.js/backend's own payment journeys send.

    console.log('\n  Billing journeys');

    let db = null;

    await step('the seeded personas\' purchase records stand beside their subscriptions', async () => {
      assert.ok(paidProduct, 'the brand catalog must carry the `premium` plan the journeys buy');

      // The admin SDK, pointed at the emulator. Setting the host here only
      // affects THIS process.
      process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${firestorePort}`;
      const admin = adminApp();
      const projectId = admin.app().options.projectId;

      db = admin.firestore();

      // The fixtures are @omega.js/backend's own (`seedOrderFixture`, beside the
      // persona shapes), so the lane and the dev reset route stand up the SAME
      // record from ONE definition — each persona's status mirrors its seeded
      // subscription's.
      //
      // Surface 1 — the test cancel provider reads the plan's provider
      // product id off the LIVE order. Without it the cancellation webhook
      // would name no plan and the pipeline would resolve the persona down to
      // Basic mid-cancel, which is not what cancelling does.
      await seedOrderFixture(admin, 'journey-flows-cancel', backendConfig);
      // Surface 2 — trial eligibility (and the intent route's own downgrade
      // guard) call ANY prior subscription order disqualifying, per owner.
      // These LAPSED records' only job is to exist: they are what keep the two
      // journeys that BUY the plan off the 14-day trial, so each one proves
      // what its name claims — a direct purchase, and a payer's renewal being
      // declined — instead of quietly re-running the trial journey.
      await seedOrderFixture(admin, 'journey-flows-upgrade', backendConfig);
      await seedOrderFixture(admin, 'journey-flows-failure', backendConfig);

      return `3 orders → ${paidProduct.id} (project ${projectId})`;
    });

    await step('JOURNEY upgrade: a free persona pays and lands on the paid plan', async () => {
      const upgradePage = await newPage(browser, 'journey-upgrade', consoleLog);
      activePage = upgradePage;

      await signInWithPassword(upgradePage, siteUrl, persona('journeyUpgrade'));

      const before = await readAccountPage(upgradePage, siteUrl);
      assert.equal(before.email, persona('journeyUpgrade'), `the journey should run on its own persona (got ${before.email})`);
      assert.match(before.status || '', /free/i, `the persona should start unpaid (got ${before.status})`);

      // No `_dev_trialEligible` knob: this persona's LAPSED purchase record
      // makes the server refuse it a trial on its own, so what this journey
      // drives is the direct paid path — the one the trial journey is not.
      await payWithTestCard(upgradePage, siteUrl, { product: paidProduct.id });

      const account = await waitForAccountState(
        upgradePage,
        siteUrl,
        (state) => state.plan === paidProduct.name && /active/i.test(state.status || ''),
        `${paidProduct.name} · Active`,
      );
      assert.equal(account.cancelling, false, 'a fresh purchase is not cancelling');
      assert.equal(account.trialing, false, 'a paid purchase is not a trial');

      await upgradePage.close();
      activePage = null;
      return `${before.status} → ${account.plan} · ${account.status}`;
    });

    await step('JOURNEY cancel: a paid persona cancels and keeps access until the term ends', async () => {
      const cancelPage = await newPage(browser, 'journey-cancel', consoleLog);
      activePage = cancelPage;

      await signInWithPassword(cancelPage, siteUrl, persona('journeyCancel'));

      const before = await readAccountPage(cancelPage, siteUrl);
      assert.equal(before.plan, paidProduct.name, `the persona should start on the paid plan (got ${before.plan})`);
      assert.equal(before.cancelling, false, 'nothing should be scheduled to cancel before the journey runs');

      // The REAL cancel surface: the account page's accordion form, its
      // required confirmation, and the POST /omega/payments/cancel behind it.
      await cancelPage.waitForSelector('#cancel-subscription-form[data-form-state="ready"]', { timeout: 60000 });
      await clickElement(cancelPage, '#cancel-confirm-checkbox');
      await clickElement(cancelPage, '#cancel-subscription-btn');
      // `submitted` is the form's ACCEPTED state (the form disallows resubmit);
      // a refused cancel drops back to `ready` with the error on it. The
      // success copy itself is a toast that dismisses, so the state is what
      // can be waited on.
      await cancelPage.waitForSelector('#cancel-subscription-form[data-form-state="submitted"]', { timeout: 60000 });

      // Cancelling is not losing the plan: web core renders a cancelling
      // subscription as plain "Active" and says so in the alert, so the ALERT
      // is the only thing that can tell the two apart.
      const account = await waitForAccountState(
        cancelPage,
        siteUrl,
        (state) => state.cancelling,
        'the cancellation-scheduled alert',
      );
      assert.equal(account.plan, paidProduct.name, `access continues on the paid plan until the term ends (got ${account.plan})`);
      assert.match(account.status || '', /active/i, `a cancelling subscription still reads active (got ${account.status})`);

      await cancelPage.close();
      activePage = null;
      return `${account.plan} · ${account.status} · cancellation scheduled`;
    });

    await step('JOURNEY payment failure: a declined renewal suspends the persona', async () => {
      const failurePage = await newPage(browser, 'journey-failure', consoleLog);
      activePage = failurePage;

      await signInWithPassword(failurePage, siteUrl, persona('journeyFailure'));
      // Like the upgrade persona, this one's LAPSED purchase record makes the
      // server refuse it a trial — a renewal can only be declined for someone
      // who is actually paying.
      const orderId = await payWithTestCard(failurePage, siteUrl, { product: paidProduct.id });

      const paid = await waitForAccountState(
        failurePage,
        siteUrl,
        (state) => state.plan === paidProduct.name && /active/i.test(state.status || ''),
        `${paidProduct.name} · Active`,
      );
      assert.equal(paid.trialing, false, 'the renewal being declined must belong to a payer, not a trial');

      // A month later the renewal charge is declined. Nothing a user can
      // drive produces that — the provider's invoice event is the only door.
      // Reading the subscription id only AFTER the page showed the purchase
      // matters: the seed carries a lapsed subscription id of its own, and
      // the purchase overwrites it in the same write that flipped the plan.
      const seed = personaSeed('journey-flows-failure');
      const userDoc = await db.doc(`users/${seed.uid}`).get();
      const resourceId = userDoc.data()?.subscription?.payment?.resourceId;
      assert.ok(resourceId, 'the purchase should have left a provider subscription id on the user doc');

      await postTestWebhook(apiUrl, {
        id: `_test-evt-flows-failure-${Date.now()}`,
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: `in_test_flows_failure_${Date.now()}`,
            object: 'invoice',
            billing_reason: 'subscription_cycle',
            amount_due: 999,
            amount_paid: 0,
            status: 'open',
            parent: {
              type: 'subscription_details',
              subscription_details: {
                subscription: resourceId,
                metadata: { uid: seed.uid, orderId: orderId },
              },
            },
          },
        },
      });

      const account = await waitForAccountState(
        failurePage,
        siteUrl,
        (state) => /suspended/i.test(state.status || ''),
        'Suspended',
      );
      assert.equal(account.plan, paidProduct.name, `a suspended subscription keeps its plan on the page (got ${account.plan})`);

      await failurePage.close();
      activePage = null;
      return `${paid.status} → ${account.status}`;
    });

    // The trial is TWO journeys' worth of state on one persona — claiming it,
    // then the provider converting it — so it keeps one page across both.
    const trialPage = await newPage(browser, 'journey-trial', consoleLog);
    let trialOrderId = null;
    let trialResourceId = null;

    await step('JOURNEY trial: a trial checkout lands the persona trialing', async () => {
      activePage = trialPage;

      await signInWithPassword(trialPage, siteUrl, persona('journeyTrial'));
      // `_dev_trialEligible=true` is checkout's own dev override — the server
      // still refuses a trial to anyone with subscription history, so this
      // persona's first purchase is the only reason it lands one.
      trialOrderId = await payWithTestCard(trialPage, siteUrl, { product: paidProduct.id, _dev_trialEligible: 'true' });

      const account = await waitForAccountState(
        trialPage,
        siteUrl,
        (state) => state.trialing,
        'the free-trial alert',
      );
      assert.equal(account.plan, paidProduct.name, `a trial runs on the paid plan (got ${account.plan})`);
      assert.match(account.status || '', /active/i, `a trialing subscription reads active (got ${account.status})`);
      assert.equal(account.cancelling, false, 'a fresh trial is not cancelling');

      const seed = personaSeed('journey-flows-trial');
      const subscription = (await db.doc(`users/${seed.uid}`).get()).data()?.subscription;
      assert.equal(subscription?.trial?.claimed, true, 'the trial should be claimed on the user doc');
      trialResourceId = subscription?.payment?.resourceId;

      return `${account.plan} · ${account.status} · trialing`;
    });

    await step('JOURNEY trial: the trial converts and the persona keeps the plan as a payer', async () => {
      activePage = trialPage;
      assert.ok(trialResourceId, 'the trial leg must have left a provider subscription id to convert');

      const seed = personaSeed('journey-flows-trial');
      const nowUNIX = Math.floor(Date.now() / 1000);
      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      // The trial ending is the provider's clock: it converts by updating
      // the subscription with its trial window now CLOSED. Same status, same
      // product — what changes is that the customer is paying.
      await postTestWebhook(apiUrl, {
        id: `_test-evt-flows-trial-converted-${Date.now()}`,
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: trialResourceId,
            object: 'subscription',
            status: 'active',
            metadata: { uid: seed.uid, orderId: trialOrderId },
            cancel_at_period_end: false,
            cancel_at: null,
            canceled_at: null,
            current_period_end: Math.floor(periodEnd.getTime() / 1000),
            current_period_start: nowUNIX,
            start_date: nowUNIX - (86400 * 14),
            trial_start: nowUNIX - (86400 * 14),
            trial_end: nowUNIX,
            plan: { product: planProductId, interval: 'month' },
          },
        },
      });

      const account = await waitForAccountState(
        trialPage,
        siteUrl,
        (state) => state.plan === paidProduct.name && !state.trialing,
        `${paidProduct.name} with the trial alert gone`,
      );
      assert.match(account.status || '', /active/i, `the converted subscription reads active (got ${account.status})`);
      assert.equal(account.cancelling, false, 'converting is not cancelling');

      await trialPage.close();
      activePage = null;
      return `trialing → ${account.plan} · ${account.status}`;
    });

    activePage = null;
  } catch (error) {
    failures.push({ name: 'harness', error });
    stepsLog.fail('harness', error);
    console.log(`  ✗ harness\n      ${error.message}`);
    await screenshot('harness');
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    await stopChild(dev?.child);
    await stopChild(emulator?.child);
    releasePorts(hold?.servers);

    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(path.join(LOG_DIR, 'page.log'), `${consoleLog.join('\n')}\n`);
  }

  if (failures.length > 0) {
    console.log(`\n✗ user-flows e2e FAILED (${failures.length} failing step${failures.length === 1 ? '' : 's'}) — logs: ${path.relative(ROOT, LOG_DIR)}/\n`);
    process.exit(1);
  }

  console.log('\n✓ user-flows e2e PASSED\n');
  // Explicit exit — a closed browser can leave its transport handle open
  process.exit(0);
}

main().catch((error) => {
  // A death outside step() — a preflight guard, a throw on the way up — has no
  // verdict yet; record one so steps.log still answers "why did nothing run?".
  stepsLog.abort(error);
  console.error(`\n✗ user-flows e2e errored: ${error.message}\n`);
  process.exit(1);
});
