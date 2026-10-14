/**
 * Root `npm run test:flows`: the crucial user flows in a REAL browser against
 * the FULL local stack: provider picker, the password forms, checkout, the vert
 * ladder, the signed-in policy pages, and the billing journeys (upgrade, cancel,
 * a declined renewal, a trial converting), each journey on its OWN seeded persona.
 * The lane HOLDS every classic port so both children bump onto fresh ones, boots
 * the playground backend's emulator with persona seeding, then the website's real
 * `omega dev` (the auth proxy lives only there), handing the site port to both as
 * OMEGA_WEBSITE_PORT. Only the /signin persona comes through the roster; every
 * other persona is a seeded fixture named by personaEmail. Every case runs
 * whatever the one before it did, and a failed case screenshots its page.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const path = require('path');
const fs = require('fs');
const { createRequire } = require('module');

const { CLASSIC_PORTS, resolvePorts, composeTargetConfig, loadEnv } = require('@omega.js/config');
const { startChild, stopChild } = require('@omega.js/devkit/test/boot-child');
const { holdClassicPorts, releasePorts, CLASSIC_HOLD_PORTS } = require('@omega.js/devkit/test/port-hold');
const { launchBrowser, resolvePuppeteer } = require('@omega.js/devkit/test/browser');
const { DEV_READY_MARKER } = require('@omega.js/devkit/test/e2e-harness');
const { startPlaygroundEmulator, stopPlaygroundEmulator, assertNoLivePlayground, playgroundProjectId, PLAYGROUND_BACKEND } = require('./_emulator');
const { waitForSignOutAtDoubt } = require('../../scripts/flows-session-doubt');
const { personaEmail, fetchRosterPersona } = require('../../scripts/roster-persona');

const ROOT = path.join(__dirname, '..', '..');
const PLAYGROUND_WEBSITE = path.join(ROOT, 'brands', 'playground-omega', 'targets', 'web');
// The hoisted local bin, spawned DIRECTLY (see @omega.js/devkit/test/boot-child)
const OMEGA_BIN = path.join(ROOT, 'node_modules', '.bin', 'omega');
const LOG_DIR = path.join(ROOT, '.temp', 'flows-e2e');
const SHOT_DIR = path.join(LOG_DIR, 'screenshots');

const EMULATOR_READY_TIMEOUT = 300000;
const DEV_READY_TIMEOUT = 300000;


// Seeded personas (@omega.js/backend's test-accounts.js): every persona shares
// the deterministic password and lives on the brand's host (personaEmail). One
// persona per area, so no area's writes can perturb another's.
const { TEST_ACCOUNT_PASSWORD: PASSWORD, TEST_ACCOUNTS, seedOrderFixture } = require('../../packages/backend/src/test/test-accounts.js');
// The password FORMS' own persona, which the lane asks the roster for
const FORMS_PERSONA_LOCALPART = '_test.flows-signin';
const PERSONA_IDS = {
  checkout: '_test.premium-expired',
  account: '_test.premium-active',
  googleOne: '_test.google.one',
  googleTwo: '_test.google.two',
  // One DEDICATED persona per billing journey, never shared with
  // another journey, so no journey inherits another's subscription state.
  journeyUpgrade: '_test.journey-flows-upgrade',
  journeyCancel: '_test.journey-flows-cancel',
  journeyFailure: '_test.journey-flows-failure',
  journeyTrial: '_test.journey-flows-trial',
};

/**
 * A journey persona's own seed definition. The lane reads uids and seeded
 * payment ids straight off test-accounts.js (the seeder's SSOT), so a
 * renamed persona breaks loudly here instead of silently missing its account.
 * @param {string} key - the test-accounts.js account key
 * @returns {object} the account definition ({ id, uid, email, properties })
 */
function personaSeed(key) {
  const account = TEST_ACCOUNTS[key];
  if (!account) {
    throw new Error(`no seeded persona named ${key}: test-accounts.js and this lane have drifted`);
  }
  return account;
}

// The only hosts a page may reach. Everything else (ad scripts, analytics,
// avatar services, CDNs) is refused, which is what keeps the vert ladder and
// the page timings the same on every machine.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
// The provider sign-in leg's irreducible externals: unpkg + Google Fonts build the
// Auth EMULATOR's picker (Material Web; without it the rows ignore clicks), and the
// Firebase Auth SDK's redirect resolver loads gapi from apis.google.com + gstatic
// even against the emulator, failing getRedirectResult() when it cannot.
const AUTH_FLOW_HOSTS = new Set([
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'apis.google.com',
  'www.gstatic.com',
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  // A failing request is the usual root cause behind a stalled flow: the
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
 * movement trips it: the modal then covers the form and every later click
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
 * The account page's rendered account state (bindings fed from the emulator's
 * user doc). The two alert flags are the only way to tell a cancelling or
 * trialing subscription apart: billing.js renders BOTH as plain "Active". A
 * `@show` binding toggles `hidden`, so visibility is read off the attribute.
 * @param {object} page - puppeteer page
 * @param {string} siteUrl - the dev site origin
 * @returns {Promise<object>} { url, email, plan, status, cancelling, trialing }
 */
async function readAccountPage(page, siteUrl) {
  await page.goto(`${siteUrl}/dashboard/account`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => {
      const element = document.querySelector('[data-omega-bind="@text auth.user.email"]');
      // The theme ships `email@example.com` as the binding's static text, so an
      // '@' alone is the placeholder, not the bound account
      return !!element && element.textContent.includes('@') && !element.textContent.includes('example.com');
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
 * journey's verdict is the first render that agrees, not the first render.
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
 * opens this way: a journey that reached its account through the SDK would
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
 * would. Two of the four journeys' end states (a declined renewal, a trial
 * converting) have NO user-facing surface that can produce them; a webhook
 * is the only way they ever arrive, in production or here.
 * @param {string} apiUrl - the emulator's hosting origin (rewrites /omega/**)
 * @param {string} key - the brand's OMEGA_WEBHOOK_KEY
 * @param {object} event - the Stripe-shaped event body
 */
async function postTestWebhook(apiUrl, key, event) {
  const response = await fetch(`${apiUrl}/omega/payments/webhook?provider=test&key=${key}`, {
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
    admin.initializeApp({ projectId: playgroundProjectId() });
  }

  return admin;
}

/**
 * Screenshot a page into the artifacts dir (best effort).
 * @param {object} [page] - puppeteer page; none means nothing to photograph
 * @param {string} label - case name the shot is named after
 */
async function screenshot(page, label) {
  if (!page) {
    return;
  }
  const file = path.join(SHOT_DIR, `${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: file, fullPage: false });
    console.log(`      shot: ${path.relative(ROOT, file)}`);
  } catch (e) {
    // A dead page cannot be photographed: the assertion message is the record
  }
}

/**
 * One case whose failure screenshots whatever page is active before it reports.
 * @param {string} name - case name
 * @param {Function} run - the case body
 * @param {number} [timeout] - the case's own ceiling, where a boot's must fire first
 * @returns {object} the case
 */
function flowCase(name, run, timeout) {
  return {
    name,
    timeout,
    run: async (ctx) => {
      try {
        return await run(ctx);
      } catch (error) {
        await screenshot(ctx.state.activePage, name);
        throw error;
      }
    },
  };
}

/** Close the current area's page, if one is open. */
async function closeArea(state) {
  if (state.areaPage) {
    await state.areaPage.close();
    state.areaPage = null;
  }
}

/**
 * Open the next area's own page (launching the browser on first use), closing
 * the area before it: every area signs in on its own profile.
 * @param {object} state - the suite state
 * @param {string} label - context label, used in the console log file
 * @returns {Promise<object>} the page
 */
async function openArea(state, label) {
  await closeArea(state);
  if (!state.browser) {
    state.browser = await launchBrowser({ puppeteer: state.puppeteer });
  }
  state.areaPage = await newPage(state.browser, label, state.consoleLog);
  state.activePage = state.areaPage;
  return state.areaPage;
}

module.exports = defineCases({
  type: 'suite',
  description: 'user-flows e2e (real Chromium: auth, checkout, verts, account, billing journeys)',
  timeout: 300000,
  stopOnFailure: false,

  async setup(ctx) {
    const { state } = ctx;
    if (process.env.OMEGA_SKIP_E2E === '1') ctx.skip('OMEGA_SKIP_E2E=1');

    // Resolved from the monorepo root, the same walk a brand's lane makes to its
    // own root. No browser is a SKIP, never a failure.
    try {
      state.puppeteer = resolvePuppeteer(ROOT);
    } catch (error) {
      ctx.skip(error.message);
    }

    const backendConfig = composeTargetConfig(PLAYGROUND_BACKEND, 'backend').config;
    state.backendConfig = backendConfig;
    state.persona = (id) => personaEmail(backendConfig, PERSONA_IDS[id]);
    state.brandId = backendConfig.brand?.id;
    // The billing journeys' paid tier: the same product the checkout area buys
    state.paidProduct = (backendConfig.payment?.products || []).find((product) => product.id === 'premium');
    // The id a provider puts on the plan. Brands with no real Stripe product carry
    // the `_test_<id>` sentinel the resolver maps back (the backend's test intent
    // provider): either way the pipeline resolves the same plan.
    state.planProductId = state.paidProduct?.stripe?.productId || `_test_${state.paidProduct?.id}`;
    state.consoleLog = [];

    await assertNoLivePlayground();

    // The children carry the environment as it is now; only then does this
    // process gain the brand's secrets the billing journeys need (loadEnv
    // mutates this process's env, and the children resolve their own cascade).
    state.childEnv = { ...process.env };
    loadEnv(PLAYGROUND_BACKEND);
    state.webhookKey = process.env.OMEGA_WEBHOOK_KEY;
    if (!state.webhookKey) {
      throw new Error('OMEGA_WEBHOOK_KEY is missing from the playground backend\'s .env cascade: the billing journeys cannot post their webhooks');
    }
  },

  async cleanup(ctx) {
    const { state } = ctx;
    // A skipped lane started nothing and collected nothing.
    if (!state.consoleLog) return;
    if (state.browser) {
      await state.browser.close().catch(() => {});
    }
    await stopChild(state.dev?.child);
    await stopPlaygroundEmulator(state.emulator);
    releasePorts(state.hold?.servers);

    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(path.join(LOG_DIR, 'page.log'), `${state.consoleLog.join('\n')}\n`);
  },

  tests: [
    flowCase('the classic ports are held so the stack boots beside a live dev', async (ctx) => {
      const { state } = ctx;
      state.hold = await holdClassicPorts();
      // The website port is allocated HERE (past the held classics) because the
      // emulator needs it at BOOT time: the backend builds the checkout
      // confirmation URL from OMEGA_WEBSITE_PORT, and it starts first.
      const { ports } = await resolvePorts({ wanted: { website: CLASSIC_PORTS.website } });
      state.sitePort = ports.website;
      state.childEnv.OMEGA_WEBSITE_PORT = String(state.sitePort);
      ctx.expect(state.sitePort, 'the lane must never take the classic website port').not.toBe(CLASSIC_PORTS.website);
      console.log(`    held ${state.hold.held.length}/${CLASSIC_HOLD_PORTS.length}${state.hold.busy.length ? ` (busy, left alone: ${state.hold.busy.join(', ')})` : ''}; website :${state.sitePort}`);
    }),

    flowCase('the playground emulator boots + personas seed', async (ctx) => {
      const { state } = ctx;
      const { child, ports } = await startPlaygroundEmulator({ logDir: LOG_DIR, env: state.childEnv, timeout: EMULATOR_READY_TIMEOUT });
      state.emulator = child;
      ctx.expect(ports.auth, 'the emulator must not take the classic auth port').not.toBe(CLASSIC_PORTS.auth);
      // Hosting rewrites /omega/** at the api function: the origin the billing
      // journeys post their provider webhooks to.
      state.apiUrl = `http://127.0.0.1:${ports.hosting}`;
      state.firestorePort = ports.firestore;
      state.authPort = ports.auth;
      console.log(`    auth :${ports.auth}, hosting :${ports.hosting}, functions :${ports.functions}`);
    }, EMULATOR_READY_TIMEOUT + 60000),

    flowCase('the website serves through the REAL `omega dev` (auth proxy live)', async (ctx) => {
      const { state } = ctx;
      state.dev = startChild({
        bin: OMEGA_BIN,
        args: ['dev', `--port=${state.sitePort}`],
        cwd: PLAYGROUND_WEBSITE,
        env: state.childEnv,
        logFile: path.join(LOG_DIR, 'dev.log'),
        marker: DEV_READY_MARKER,
        timeout: DEV_READY_TIMEOUT,
        relativeTo: ROOT,
      });
      state.siteUrl = await state.dev.ready;
      console.log(`    ${state.siteUrl}`);
    }, DEV_READY_TIMEOUT + 60000),

    // ---- Area 1: auth ---------------------------------------------------

    flowCase('a Google signup runs the REAL redirect leg: picker → account → landing', async (ctx) => {
      const { state } = ctx;
      const { siteUrl } = state;
      const authPage = await openArea(state, 'auth');
      await authPage.goto(`${siteUrl}/signup`, { waitUntil: 'networkidle2' });
      await waitForAuthForm(authPage);
      await clickElement(authPage, '#consent-legal');
      await clickElement(authPage, 'button[data-provider="google.com"]');

      const picked = await pickGoogleAccount(authPage, state.persona('googleOne'));
      const landing = await waitForLanding(authPage);

      const account = await readAccountPage(authPage, siteUrl);
      ctx.expect(account.email, `the signed-in account should be the picked persona (got ${account.email})`).toBe(state.persona('googleOne'));
      console.log(`    ${picked.split(' ').slice(-1)[0]} → ${landing}`);
    }),

    flowCase('signout (?authSignout=true) ends the session and the account page kicks out', async (ctx) => {
      const { siteUrl, areaPage: authPage } = ctx.state;
      await authPage.goto(`${siteUrl}/signin?authSignout=true`, { waitUntil: 'networkidle2' });
      await waitForAuthForm(authPage);

      await authPage.goto(`${siteUrl}/dashboard/account`, { waitUntil: 'networkidle2' });
      await authPage.waitForFunction(
        () => /\/(signin|signup)/.test(window.location.pathname),
        { timeout: 60000 },
      );
      console.log(`    ${authPage.url().replace(siteUrl, '')}`);
    }),

    flowCase('the authReturnUrl leg returns a Google sign-in to its destination', async (ctx) => {
      const { state } = ctx;
      const { siteUrl, areaPage: authPage } = state;
      const destination = `${siteUrl}/pricing`;
      await authPage.goto(`${siteUrl}/signin?authReturnUrl=${encodeURIComponent(destination)}`, { waitUntil: 'networkidle2' });
      await waitForAuthForm(authPage);
      await clickElement(authPage, 'button[data-provider="google.com"]');
      await pickGoogleAccount(authPage, state.persona('googleTwo'));

      await authPage.waitForFunction(
        (wanted) => window.location.pathname === new URL(wanted).pathname,
        { timeout: 60000 },
        destination,
      );
      console.log(`    ${authPage.url().replace(siteUrl, '')}`);
    }),

    flowCase('a RELATIVE authReturnUrl is honored the same as the absolute form (#160)', async (ctx) => {
      const { state } = ctx;
      const { siteUrl, areaPage: authPage } = state;
      const destination = '/pricing';
      await authPage.goto(`${siteUrl}/signin?authSignout=true`, { waitUntil: 'networkidle2' });
      await waitForAuthForm(authPage);

      await authPage.goto(`${siteUrl}/signin?authReturnUrl=${encodeURIComponent(destination)}`, { waitUntil: 'networkidle2' });
      await waitForAuthForm(authPage);
      await clickElement(authPage, 'button[data-provider="google.com"]');
      await pickGoogleAccount(authPage, state.persona('googleTwo'));

      await authPage.waitForFunction(
        (wanted) => window.location.pathname === wanted,
        { timeout: 60000 },
        destination,
      );
      console.log(`    ${authPage.url().replace(siteUrl, '')}`);
    }),

    flowCase('an empty OAuth return fails LOUDLY instead of showing a blank form', async (ctx) => {
      const { state } = ctx;
      const emptyReturnPage = await newPage(state.browser, 'empty-return', state.consoleLog);
      state.activePage = emptyReturnPage;
      // The one-shot marker `signInWithRedirect` writes before leaving: this
      // page load IS a return from a redirect, with no credential behind it.
      await emptyReturnPage.evaluateOnNewDocument(() => {
        try { sessionStorage.setItem('omega:authRedirectPending', String(Date.now())); } catch (e) { /* denied storage */ }
      });
      await emptyReturnPage.goto(`${state.siteUrl}/signin`, { waitUntil: 'networkidle2' });

      await emptyReturnPage.waitForFunction(
        () => /Sign-in did not complete/i.test(document.body.innerText),
        { timeout: 60000 },
      );
      await emptyReturnPage.close();
      state.activePage = state.areaPage;
      console.log('    Sign-in did not complete. Please try again.');
    }),

    flowCase('the /signin FORM signs the roster\'s persona in with email + password', async (ctx) => {
      const { state } = ctx;
      const { siteUrl } = state;
      state.formsPersona = await fetchRosterPersona({ apiBase: state.apiUrl, localpart: FORMS_PERSONA_LOCALPART });

      const passwordPage = await newPage(state.browser, 'password', state.consoleLog);
      state.activePage = passwordPage;

      await passwordPage.goto(`${siteUrl}/signin`, { waitUntil: 'networkidle2' });
      await waitForAuthForm(passwordPage);
      await passwordPage.type('#email', state.formsPersona.email);
      await passwordPage.type('#password', state.formsPersona.password);
      await clickElement(passwordPage, 'button[data-provider="email"]:not(.d-none)');
      await waitForLanding(passwordPage);

      const account = await readAccountPage(passwordPage, siteUrl);
      ctx.expect(account.email, `the form should sign in the persona (got ${account.email})`).toBe(state.formsPersona.email);
      await passwordPage.close();
      state.activePage = state.areaPage;
      console.log(`    ${state.formsPersona.email}`);
    }),

    flowCase('the /signup FORM creates an account and lands it signed in', async (ctx) => {
      const { state } = ctx;
      const { siteUrl } = state;
      const signupPage = await newPage(state.browser, 'signup', state.consoleLog);
      state.activePage = signupPage;
      const email = personaEmail(state.backendConfig, `_test.flows-signup-${Date.now()}`);

      await signupPage.goto(`${siteUrl}/signup`, { waitUntil: 'networkidle2' });
      await waitForAuthForm(signupPage);
      await signupPage.type('#email', email);
      await signupPage.type('#password', 'flows-e2e-password-1');
      await clickElement(signupPage, '#consent-legal');
      await clickElement(signupPage, 'button[data-provider="email"]:not(.d-none)');
      await waitForLanding(signupPage);

      const account = await readAccountPage(signupPage, siteUrl);
      ctx.expect(account.email, `the new account should be signed in (got ${account.email})`).toBe(email);
      await signupPage.close();
      state.activePage = state.areaPage;
      console.log(`    ${email}`);
    }),

    flowCase('the /reset FORM sends a password-reset request', async (ctx) => {
      const { state } = ctx;
      const resetPage = await newPage(state.browser, 'reset', state.consoleLog);
      state.activePage = resetPage;

      await resetPage.goto(`${state.siteUrl}/reset`, { waitUntil: 'networkidle2' });
      await waitForAuthForm(resetPage);
      await resetPage.type('#email', state.formsPersona.email);
      await clickElement(resetPage, '#auth-form button[data-provider="email"]:not(.d-none)');

      await resetPage.waitForFunction(
        () => /reset email (has been )?sent|check your inbox/i.test(document.body.innerText),
        { timeout: 60000 },
      );
      await resetPage.close();
      state.activePage = state.areaPage;
      console.log(`    ${state.formsPersona.email}`);
    }),

    // ---- Area 2: checkout -----------------------------------------------

    flowCase('a persona signs in and checkout binds its state', async (ctx) => {
      const { state, expect } = ctx;
      const { siteUrl } = state;
      const checkoutPage = await openArea(state, 'checkout');
      await checkoutPage.goto(`${siteUrl}/signin`, { waitUntil: 'networkidle2' });
      await waitForAuthForm(checkoutPage);
      await checkoutPage.type('#email', state.persona('checkout'));
      await checkoutPage.type('#password', PASSWORD);
      await clickElement(checkoutPage, 'button[data-provider="email"]:not(.d-none)');
      await waitForLanding(checkoutPage);

      // `_dev_cardProvider=test` routes the card button at @omega.js/backend's
      // TEST provider: a Stripe-shaped session that auto-fires its own webhook
      // and hands back the confirmation URL, no live provider, ever.
      await checkoutPage.goto(`${siteUrl}/payment/checkout?product=premium&frequency=monthly&_dev_cardProvider=test`, { waitUntil: 'networkidle2' });
      await checkoutPage.waitForSelector('#checkout-form[data-form-state="ready"]', { timeout: 60000 });

      const bound = await checkoutPage.evaluate(() => ({
        product: window._checkout?.state?.product?.id || null,
        frequency: window._checkout?.state?.frequency || null,
        productName: document.querySelector('[data-omega-bind="@text checkout.product.name"]')?.textContent.trim() || null,
        error: document.querySelector('[data-omega-bind="@show checkout.error.show"]:not([hidden])')?.textContent.replace(/\s+/g, ' ').trim() || null,
      }));

      expect(bound.error, `checkout should load without a fatal error (got ${bound.error})`).toBeNull();
      expect(bound.product, `the URL's product should bind (got ${bound.product})`).toBe('premium');
      expect(bound.frequency, `the URL's frequency should bind (got ${bound.frequency})`).toBe('monthly');
      console.log(`    ${bound.product}/${bound.frequency}`);
    }),

    flowCase('the payment-method buttons arm', async (ctx) => {
      const armed = await ctx.state.areaPage.$$eval(
        '#checkout-form button[data-payment-method]:not([hidden])',
        (buttons) => buttons.map((button) => button.getAttribute('data-payment-method')),
      );
      ctx.expect(armed.includes('card'), `the card button should be visible and armed (armed: ${armed.join(', ') || 'none'})`).toBeTruthy();
      console.log(`    ${armed.join(', ')}`);
    }),

    flowCase('paying reaches the confirmation surface with the order on it', async (ctx) => {
      const { expect } = ctx;
      const checkoutPage = ctx.state.areaPage;
      await clickElement(checkoutPage, '#checkout-form button[data-payment-method="card"]:not([hidden])');
      await checkoutPage.waitForFunction(
        () => window.location.pathname.startsWith('/payment/confirmation'),
        { timeout: 90000 },
      );

      const confirmation = new URL(checkoutPage.url());
      expect(confirmation.searchParams.get('orderId'), 'the confirmation URL should carry the orderId').toBeTruthy();
      expect(confirmation.searchParams.get('productId'), 'the confirmation URL should carry the product').toBe('premium');

      await checkoutPage.waitForFunction(
        () => /thank you/i.test(document.body.innerText),
        { timeout: 60000 },
      );
      console.log(`    ${confirmation.pathname} (order ${confirmation.searchParams.get('orderId')})`);
    }),

    // ---- Area 3: verts --------------------------------------------------

    flowCase('an unfilled slot ladders down to the built-in promo', async (ctx) => {
      // Signed OUT: a vert unit hides itself for subscribers (the standard auth
      // binding), so the ladder is only observable on a visitor's page.
      const vertPage = await openArea(ctx.state, 'verts');
      await vertPage.goto(`${ctx.state.siteUrl}/test/libraries/verts`, { waitUntil: 'networkidle2' });
      await vertPage.evaluate(() => {
        const $host = document.querySelector('[data-omega-vert="house"]');
        window.__flowsVertEvents = [];
        for (const name of ['no-fill', 'promo', 'fill', 'click']) {
          $host.addEventListener(`omega-vert:${name}`, (event) => window.__flowsVertEvents.push({ name, detail: event.detail }));
        }

        // The playground carries no google analytics id, so web core foot.html
        // emits its no-op gtag stub and no dataLayer. Stand the configured
        // branch's recorder up in its place, so the host-side vert_click lands
        // exactly where a configured brand would see it.
        window.dataLayer = window.dataLayer || [];
        window.gtag = function () { window.dataLayer.push(arguments); };

        $host.scrollIntoView({ block: 'center' });
      });

      await vertPage.waitForFunction(
        () => window.__flowsVertEvents.some((entry) => entry.name === 'promo'),
        { timeout: 90000 },
      );

      const events = await vertPage.evaluate(() => window.__flowsVertEvents.map((entry) => entry.name));
      ctx.expect(events.includes('no-fill'), `the ladder's no-fill leg must fire (got ${events.join(' → ')})`).toBeTruthy();
      ctx.expect(events.indexOf('no-fill') < events.indexOf('promo'), `no-fill must fire before the promo (got ${events.join(' → ')})`).toBeTruthy();
      console.log(`    ${events.join(' → ')}`);
    }),

    flowCase('the promo card renders content-sized inside its slot ceiling', async (ctx) => {
      const { expect } = ctx;
      const vertPage = ctx.state.areaPage;
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

      expect(box.srcdoc, 'the promo frame carries its document inline (zero network)').toBeTruthy();
      expect(!/allow-same-origin/.test(box.sandbox), 'a srcdoc promo frame must never carry allow-same-origin').toBeTruthy();
      expect(box.frameHeight > 0, 'the promo frame should have height').toBeTruthy();
      // 'rectangle' is the slot preset on this unit: a ceiling, never a floor
      expect(box.frameHeight < 250, `the card should be content-sized under the rectangle ceiling (got ${box.frameHeight}px)`).toBeTruthy();
      expect(box.hostHeight, 'the host should shrink to the card (no chrome of its own)').toBe(box.frameHeight);
      console.log(`    ${box.frameHeight}px in a 250px slot`);
    }),

    flowCase('a promo click carries the UTM set and forwards out of the frame', async (ctx) => {
      const { state, expect } = ctx;
      const vertPage = state.areaPage;
      const link = await vertPage.evaluate(() => {
        const srcdoc = document.querySelector('[data-omega-vert="house"] iframe').getAttribute('srcdoc');
        const href = srcdoc.match(/href="([^"]+)"/)?.[1] || '';
        // srcdoc is html: the query separators arrive escaped
        return href.replace(/&amp;/g, '&');
      });

      const url = new URL(link);
      expect(url.searchParams.get('utm_source'), `utm_source should be the host brand id (got ${url.searchParams.get('utm_source')})`).toBe(state.brandId);
      expect(url.searchParams.get('utm_medium'), 'utm_medium should be omega-vert').toBe('omega-vert');
      expect(url.searchParams.get('utm_campaign'), 'utm_campaign should mark the promo lane').toBe('omega-promo');
      expect(url.searchParams.get('utm_content'), 'utm_content should be the slot preset').toBe('rectangle');

      const frame = await (await vertPage.$('[data-omega-vert="house"] iframe')).contentFrame();
      await frame.evaluate(() => document.getElementById('omega-vert').click());

      await vertPage.waitForFunction(
        () => window.__flowsVertEvents.some((entry) => entry.name === 'click'),
        { timeout: 30000 },
      );
      const click = await vertPage.evaluate(() => window.__flowsVertEvents.find((entry) => entry.name === 'click'));
      expect(click.detail.id, `the host should receive the promo click (got ${click.detail.id})`).toBe('omega-promo');
      console.log(`    ${url.origin}${url.pathname} + 4 utm params`);
    }),

    flowCase('the click fires vert_click through the page gtag', async (ctx) => {
      const { expect } = ctx;
      const vertPage = ctx.state.areaPage;
      // Web's analytics transport is the page's own gtag, so a fired event is a
      // dataLayer entry: ['event', 'vert_click', params].
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

      expect(params.vert_id, `vert_click should carry the promo id (got ${params.vert_id})`).toBe('omega-promo');
      expect(params.vert_lane, `vert_click should carry the promo lane (got ${params.vert_lane})`).toBe('promo');
      expect(params.vert_slot, `vert_click should carry the slot preset (got ${params.vert_slot})`).toBe('rectangle');
      expect(params.page_location, 'the event should carry the page data the analytics module merges in').toBeTruthy();
      console.log(`    vert_click ${params.vert_id} (${params.vert_lane}/${params.vert_slot})`);
    }),

    // ---- Area 4: dashboard / account ------------------------------------

    flowCase('a signed-in policy page renders account state from the emulator', async (ctx) => {
      const { state, expect } = ctx;
      const { siteUrl, paidProduct } = state;
      const accountPage = await openArea(state, 'account');
      await accountPage.goto(`${siteUrl}/signin`, { waitUntil: 'networkidle2' });
      await waitForAuthForm(accountPage);
      await accountPage.type('#email', state.persona('account'));
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
      expect(account.email, `the account page should show the persona (got ${account.email})`).toBe(state.persona('account'));
      // The seeded persona holds an active paid subscription: the plan name comes
      // from the BRAND's product catalog, resolved through the user doc
      expect(account.plan, `the plan should resolve from the emulator's user doc (got ${account.plan})`).toBe(paidProduct?.name);
      expect(account.status || '', `the subscription status should render (got ${account.status})`).toMatch(/active/i);
      console.log(`    ${account.email} · ${account.plan} · ${account.status}`);
    }),

    flowCase('a session killed server-side signs the open tab out at the next moment of doubt', async (ctx) => {
      // Firebase asks the Auth server about a persisted session only at page load
      // and the hourly refresh. Nothing here reloads: the tab stays exactly where
      // the case above left it, signed in on the account page. The admin SDK points
      // at THIS run's auth emulator (the billing journeys' host-side lane).
      process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${ctx.state.authPort}`;
      const admin = adminApp();

      // The session dies on the SERVER while the browser holds a valid-looking
      // token. DISABLING is the lever: the Auth emulator's refresh grant never
      // reads `validSince`, so revoking is a no-op there, while a disabled user's
      // refresh comes back USER_DISABLED (`auth/user-disabled`) to the client.
      await admin.auth().updateUser(personaSeed('premium-active').uid, { disabled: true });

      // The tab comes back into view: @omega.js/client forces a token refresh, the
      // Auth server refuses it, the client signs out, and the page's auth policy
      // routes the visitor to /signin or /signup (the kick-out case accepts both).
      console.log(`    ${await waitForSignOutAtDoubt(ctx.state.areaPage)}`);
    }),

    // ---- Area 5: billing journeys ---------------------------------------

    // One paid-lifecycle JOURNEY per DEDICATED persona, each verdict read off the
    // RENDERED account page. A declined renewal and a trial ending happen on the
    // PROVIDER's clock, so those legs post a hand-built test webhook at the backend
    // exactly as a provider would (@omega.js/backend's own journeys' shape).

    flowCase('the seeded personas\' purchase records stand beside their subscriptions', async (ctx) => {
      const { state } = ctx;
      await closeArea(state);
      ctx.expect(state.paidProduct, 'the brand catalog must carry the `premium` plan the journeys buy').toBeTruthy();

      // The admin SDK, pointed at the emulator. Setting the host here only
      // affects THIS process.
      process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${state.firestorePort}`;
      const admin = adminApp();
      const projectId = admin.app().options.projectId;

      state.db = admin.firestore();

      // The fixtures are @omega.js/backend's own (`seedOrderFixture`), so the lane
      // and the dev reset route stand up the SAME record from ONE definition. The
      // cancel provider reads the plan's product id off the LIVE order; without it
      // the cancellation would resolve the persona down to Basic mid-cancel.
      await seedOrderFixture(admin, 'journey-flows-cancel', state.backendConfig);
      // Trial eligibility calls ANY prior subscription order disqualifying, so these
      // LAPSED records keep the two journeys that BUY the plan off the trial: each
      // proves what its name claims instead of quietly re-running the trial journey.
      await seedOrderFixture(admin, 'journey-flows-upgrade', state.backendConfig);
      await seedOrderFixture(admin, 'journey-flows-failure', state.backendConfig);

      console.log(`    3 orders → ${state.paidProduct.id} (project ${projectId})`);
    }),

    flowCase('JOURNEY upgrade: a free persona pays and lands on the paid plan', async (ctx) => {
      const { state, expect } = ctx;
      const { siteUrl, paidProduct } = state;
      const upgradePage = await newPage(state.browser, 'journey-upgrade', state.consoleLog);
      state.activePage = upgradePage;

      await signInWithPassword(upgradePage, siteUrl, state.persona('journeyUpgrade'));

      const before = await readAccountPage(upgradePage, siteUrl);
      expect(before.email, `the journey should run on its own persona (got ${before.email})`).toBe(state.persona('journeyUpgrade'));
      expect(before.status || '', `the persona should start unpaid (got ${before.status})`).toMatch(/free/i);

      // No `_dev_trialEligible` knob: this persona's LAPSED purchase record makes
      // the server refuse it a trial on its own, so this journey drives the direct
      // paid path, the one the trial journey is not.
      await payWithTestCard(upgradePage, siteUrl, { product: paidProduct.id });

      const account = await waitForAccountState(
        upgradePage,
        siteUrl,
        (accountState) => accountState.plan === paidProduct.name && /active/i.test(accountState.status || ''),
        `${paidProduct.name} · Active`,
      );
      expect(account.cancelling, 'a fresh purchase is not cancelling').toBe(false);
      expect(account.trialing, 'a paid purchase is not a trial').toBe(false);

      await upgradePage.close();
      state.activePage = null;
      console.log(`    ${before.status} → ${account.plan} · ${account.status}`);
    }),

    flowCase('JOURNEY cancel: a paid persona cancels and keeps access until the term ends', async (ctx) => {
      const { state, expect } = ctx;
      const { siteUrl, paidProduct } = state;
      const cancelPage = await newPage(state.browser, 'journey-cancel', state.consoleLog);
      state.activePage = cancelPage;

      await signInWithPassword(cancelPage, siteUrl, state.persona('journeyCancel'));

      const before = await readAccountPage(cancelPage, siteUrl);
      expect(before.plan, `the persona should start on the paid plan (got ${before.plan})`).toBe(paidProduct.name);
      expect(before.cancelling, 'nothing should be scheduled to cancel before the journey runs').toBe(false);

      // The REAL cancel surface: the account page's accordion form, its required
      // confirmation, and the POST /omega/payments/cancel behind it.
      await cancelPage.waitForSelector('#cancel-subscription-form[data-form-state="ready"]', { timeout: 60000 });
      await clickElement(cancelPage, '#cancel-confirm-checkbox');
      await clickElement(cancelPage, '#cancel-subscription-btn');
      // `submitted` is the form's ACCEPTED state; a refused cancel drops back to
      // `ready` with the error on it, and the success toast dismisses itself.
      await cancelPage.waitForSelector('#cancel-subscription-form[data-form-state="submitted"]', { timeout: 60000 });

      // Cancelling is not losing the plan: web core renders a cancelling
      // subscription as plain "Active", so the ALERT tells the two apart.
      const account = await waitForAccountState(
        cancelPage,
        siteUrl,
        (accountState) => accountState.cancelling,
        'the cancellation-scheduled alert',
      );
      expect(account.plan, `access continues on the paid plan until the term ends (got ${account.plan})`).toBe(paidProduct.name);
      expect(account.status || '', `a cancelling subscription still reads active (got ${account.status})`).toMatch(/active/i);

      await cancelPage.close();
      state.activePage = null;
      console.log(`    ${account.plan} · ${account.status} · cancellation scheduled`);
    }),

    flowCase('JOURNEY payment failure: a declined renewal suspends the persona', async (ctx) => {
      const { state, expect } = ctx;
      const { siteUrl, paidProduct } = state;
      const failurePage = await newPage(state.browser, 'journey-failure', state.consoleLog);
      state.activePage = failurePage;

      await signInWithPassword(failurePage, siteUrl, state.persona('journeyFailure'));
      // Like the upgrade persona, this one's LAPSED purchase record makes the
      // server refuse it a trial: only a payer's renewal can be declined.
      const orderId = await payWithTestCard(failurePage, siteUrl, { product: paidProduct.id });

      const paid = await waitForAccountState(
        failurePage,
        siteUrl,
        (accountState) => accountState.plan === paidProduct.name && /active/i.test(accountState.status || ''),
        `${paidProduct.name} · Active`,
      );
      expect(paid.trialing, 'the renewal being declined must belong to a payer, not a trial').toBe(false);

      // A month later the renewal charge is declined: the provider's invoice event
      // is the only door. The subscription id is read only AFTER the page showed
      // the purchase, which overwrites the seed's lapsed id in the same write.
      const seed = personaSeed('journey-flows-failure');
      const userDoc = await state.db.doc(`users/${seed.uid}`).get();
      const resourceId = userDoc.data()?.subscription?.payment?.resourceId;
      expect(resourceId, 'the purchase should have left a provider subscription id on the user doc').toBeTruthy();

      await postTestWebhook(state.apiUrl, state.webhookKey, {
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
        (accountState) => /suspended/i.test(accountState.status || ''),
        'Suspended',
      );
      expect(account.plan, `a suspended subscription keeps its plan on the page (got ${account.plan})`).toBe(paidProduct.name);

      await failurePage.close();
      state.activePage = null;
      console.log(`    ${paid.status} → ${account.status}`);
    }),

    // The trial is TWO journeys' worth of state on one persona (claiming it, then
    // the provider converting it), so its two cases share one page.
    flowCase('JOURNEY trial: a trial checkout lands the persona trialing', async (ctx) => {
      const { state, expect } = ctx;
      const { siteUrl, paidProduct } = state;
      state.trialPage = await newPage(state.browser, 'journey-trial', state.consoleLog);
      const { trialPage } = state;
      state.activePage = trialPage;

      await signInWithPassword(trialPage, siteUrl, state.persona('journeyTrial'));
      // `_dev_trialEligible=true` is checkout's own dev override: the server still
      // refuses a trial to anyone with subscription history, so this persona's
      // first purchase is the only reason it lands one.
      state.trialOrderId = await payWithTestCard(trialPage, siteUrl, { product: paidProduct.id, _dev_trialEligible: 'true' });

      const account = await waitForAccountState(
        trialPage,
        siteUrl,
        (accountState) => accountState.trialing,
        'the free-trial alert',
      );
      expect(account.plan, `a trial runs on the paid plan (got ${account.plan})`).toBe(paidProduct.name);
      expect(account.status || '', `a trialing subscription reads active (got ${account.status})`).toMatch(/active/i);
      expect(account.cancelling, 'a fresh trial is not cancelling').toBe(false);

      const seed = personaSeed('journey-flows-trial');
      const subscription = (await state.db.doc(`users/${seed.uid}`).get()).data()?.subscription;
      expect(subscription?.trial?.claimed, 'the trial should be claimed on the user doc').toBe(true);
      state.trialResourceId = subscription?.payment?.resourceId;

      console.log(`    ${account.plan} · ${account.status} · trialing`);
    }),

    flowCase('JOURNEY trial: the trial converts and the persona keeps the plan as a payer', async (ctx) => {
      const { state, expect } = ctx;
      const { siteUrl, paidProduct, trialPage } = state;
      state.activePage = trialPage;
      expect(state.trialResourceId, 'the trial leg must have left a provider subscription id to convert').toBeTruthy();

      const seed = personaSeed('journey-flows-trial');
      const nowUNIX = Math.floor(Date.now() / 1000);
      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      // The trial ending is the provider's clock: it converts by updating the
      // subscription with its trial window now CLOSED. Same status, same product:
      // what changes is that the customer is paying.
      await postTestWebhook(state.apiUrl, state.webhookKey, {
        id: `_test-evt-flows-trial-converted-${Date.now()}`,
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: state.trialResourceId,
            object: 'subscription',
            status: 'active',
            metadata: { uid: seed.uid, orderId: state.trialOrderId },
            cancel_at_period_end: false,
            cancel_at: null,
            canceled_at: null,
            current_period_end: Math.floor(periodEnd.getTime() / 1000),
            current_period_start: nowUNIX,
            start_date: nowUNIX - (86400 * 14),
            trial_start: nowUNIX - (86400 * 14),
            trial_end: nowUNIX,
            plan: { product: state.planProductId, interval: 'month' },
          },
        },
      });

      const account = await waitForAccountState(
        trialPage,
        siteUrl,
        (accountState) => accountState.plan === paidProduct.name && !accountState.trialing,
        `${paidProduct.name} with the trial alert gone`,
      );
      expect(account.status || '', `the converted subscription reads active (got ${account.status})`).toMatch(/active/i);
      expect(account.cancelling, 'converting is not cancelling').toBe(false);

      await trialPage.close();
      state.activePage = null;
      console.log(`    trialing → ${account.plan} · ${account.status}`);
    }),
  ],
});
