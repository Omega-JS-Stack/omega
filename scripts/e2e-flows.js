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
 *   2. The Paperloom backend's full emulator suite (auth, functions, firestore,
 *      database, hosting, pubsub) WITH persona seeding — the lane signs in as
 *      seeded personas only, never a hand-made account.
 *   3. The website's REAL `omega dev` — not a static server: the #156 auth
 *      proxy (the emulator's OAuth handler served under the SITE origin) only
 *      exists there, and the provider redirect leg is what it makes possible.
 *      The website port is allocated HERE and handed to BOTH children as
 *      OMEGA_WEBSITE_PORT, because the backend builds its checkout
 *      confirmation URLs from it and boots before the site does.
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
const { spawn } = require('child_process');
const assert = require('assert');

if (process.env.OMEGA_SKIP_E2E === '1') {
  console.log('⏭ OMEGA_SKIP_E2E=1 — skipping user-flows e2e');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const PLAYGROUND_BACKEND = path.join(ROOT, 'apps', 'omega-playground', 'apps', 'backend');
const PLAYGROUND_WEBSITE = path.join(ROOT, 'apps', 'omega-playground', 'apps', 'website');
const LOG_DIR = path.join(ROOT, '.temp', 'flows-e2e');
const SHOT_DIR = path.join(LOG_DIR, 'screenshots');

const { CLASSIC_PORTS, readPortsFile, resolvePorts, composeTargetConfig } = require('@omega.js/config');

const EMULATOR_READY_TIMEOUT = 300000;
const DEV_READY_TIMEOUT = 300000;
const EMULATOR_READY_MARKER = /Emulator ready\. Press Ctrl\+C/i;
const DEV_READY_MARKER = /Dev server: (https?:\/\/localhost:\d+)/;

// The classics the allocator starts from, plus the two internal ports the
// HTTPS proxies want (web's 4443, the backend's 5443) — holding those too
// keeps a bumped stack from landing back on a number a developer's stack uses.
const CLASSIC_HOLD_PORTS = [...new Set([...Object.values(CLASSIC_PORTS), 4443, 5443])];

// Seeded personas (@omega.js/backend's test-accounts.js — every persona shares
// the deterministic password, and the domain comes from the brand's contact
// email). One persona per area, so no area's writes can perturb another's.
const { TEST_ACCOUNT_PASSWORD: PASSWORD } = require('@omega.js/backend/src/test/test-accounts.js');
const PERSONA_IDS = {
  password: '_test.basic',
  checkout: '_test.premium-expired',
  account: '_test.premium-active',
  googleOne: '_test.google.one',
  googleTwo: '_test.google.two',
};

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
let activePage = null;

/**
 * Run a named step. A failure screenshots whatever page is active and keeps
 * going — one broken area must not hide the state of the other three.
 * @param {string} name - step label
 * @param {Function} fn - the step body
 * @returns {Promise<boolean>} true when the step passed
 */
async function step(name, fn) {
  try {
    const detail = await fn();
    console.log(`  ✓ ${name}${detail ? ` (${detail})` : ''}`);
    return true;
  } catch (error) {
    failures.push({ name, error });
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

// -- Port isolation ---------------------------------------------------------

/**
 * Hold one address of one port. Node sets SO_REUSEADDR, so a wildcard
 * listener does NOT stop a 127.0.0.1 bind (and vice versa) — and isPortFree
 * probes all three. Holding all three is what actually makes a port "taken"
 * to both the allocator and firebase-tools' own connect probe.
 * @param {number} port - port to hold
 * @param {string|null} host - bind address (null = wildcard)
 * @returns {Promise<net.Server|null>} the listener, or null when busy
 */
function holdAddress(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(null));
    server.listen(host ? { port, host } : { port }, () => resolve(server));
  });
}

/**
 * Hold every classic port for the run's duration.
 * @returns {Promise<{ servers: net.Server[], held: number[], busy: number[] }>}
 */
async function holdClassicPorts() {
  const servers = [];
  const held = [];
  const busy = [];

  for (const port of CLASSIC_HOLD_PORTS) {
    const bound = [];
    for (const host of ['127.0.0.1', '::1', null]) {
      const server = await holdAddress(port, host);
      if (server) {
        bound.push(server);
      }
    }
    // A port nobody else owns binds on all three; anything less means a live
    // listener is there — leave it alone, the allocator bumps around it.
    // "Alone" means CLOSING the partial binds too: SO_REUSEADDR lets a
    // more-specific socket win, so keeping a 127.0.0.1 bind next to someone
    // else's live listener would steal their localhost traffic for the run.
    if (bound.length === 3) {
      held.push(port);
      servers.push(...bound);
    } else {
      busy.push(port);
      releasePorts(bound);
    }
  }

  return { servers, held, busy };
}

function releasePorts(servers) {
  for (const server of servers || []) {
    try { server.close(); } catch (e) { /* already closed */ }
  }
}

// -- Child processes --------------------------------------------------------

/**
 * Spawn a long-running child, teeing its output to a log file, and resolve
 * when its ready marker appears.
 * @param {object} options
 * @param {string} options.bin - executable
 * @param {string[]} options.args - argv
 * @param {string} options.cwd - working directory
 * @param {object} options.env - environment
 * @param {string} options.logFile - log path
 * @param {RegExp} options.marker - ready marker (a capture group is returned)
 * @param {number} options.timeout - ms before giving up
 * @returns {{ child: object, ready: Promise<string|null> }}
 */
function startChild({ bin, args, cwd, env, logFile, marker, timeout }) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const logStream = fs.createWriteStream(logFile);

  // The hoisted local bin is spawned DIRECTLY (not via npx): outside an
  // npm-script PATH the npx shim routes through the Socket Firewall proxy,
  // whose proxy env breaks firebase-tools' internal emulator REST calls.
  const child = spawn(bin, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  const ready = new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      reject(new Error(`${path.basename(bin)} ${args[0]} not ready after ${timeout / 1000}s (log: ${path.relative(ROOT, logFile)})`));
    }, timeout);

    const watch = (chunk) => {
      const text = chunk.toString();
      buffer += text;
      logStream.write(text);
      const match = buffer.match(marker);
      if (match) {
        clearTimeout(timer);
        resolve(match[1] || null);
      }
    };

    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`${path.basename(bin)} ${args[0]} exited early (code ${code}, log: ${path.relative(ROOT, logFile)})`));
    });
  });

  return { child, ready };
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try { process.kill(-child.pid, 'SIGINT'); } catch (e) { return; }
  const result = await Promise.race([exited.then(() => 'clean'), sleep(20000)]);
  if (result !== 'clean') {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { /* already gone */ }
  }
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
 * @param {object} page - puppeteer page
 * @param {string} siteUrl - the dev site origin
 * @returns {Promise<object>} { url, email, plan, status }
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

  return page.evaluate(() => ({
    url: window.location.href,
    email: document.querySelector('[data-omega-bind="@text auth.user.email"]')?.textContent.trim() || null,
    plan: document.querySelector('[data-omega-bind="@text billing.plan.name"]')?.textContent.trim() || null,
    status: document.querySelector('[data-omega-bind="@text billing.status.label"]')?.textContent.trim() || null,
  }));
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('\nUser-flows e2e (real Chromium: auth, checkout, verts, account)\n');

  let puppeteer = null;
  try {
    puppeteer = require('puppeteer');
    const chrome = puppeteer.executablePath();
    if (!chrome || !fs.existsSync(chrome)) {
      throw new Error(`puppeteer's Chrome is not installed at ${chrome}`);
    }
  } catch (error) {
    console.log(`⏭ SKIPPED — ${error.message}`);
    console.log('   install it with `npx puppeteer browsers install chrome`\n');
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

    await step('the Paperloom emulator boots + personas seed', async () => {
      emulator = startChild({
        bin: path.join(ROOT, 'node_modules', '.bin', 'mgr'),
        args: ['emulator'],
        cwd: PLAYGROUND_BACKEND,
        env: childEnv,
        logFile: path.join(LOG_DIR, 'emulator.log'),
        marker: EMULATOR_READY_MARKER,
        timeout: EMULATOR_READY_TIMEOUT,
      });
      await emulator.ready;
      const ports = readPortsFile(PLAYGROUND_BACKEND);
      if (!ports?.auth || !ports?.hosting) {
        throw new Error(`resolved port map incomplete: ${JSON.stringify(ports)}`);
      }
      assert.notEqual(ports.auth, CLASSIC_PORTS.auth, 'the emulator must not take the classic auth port');
      return `auth :${ports.auth}, hosting :${ports.hosting}, functions :${ports.functions}`;
    });

    await step('the website serves through the REAL `omega dev` (auth proxy live)', async () => {
      dev = startChild({
        bin: path.join(ROOT, 'node_modules', '.bin', 'omega'),
        args: ['dev', `--port=${sitePort}`],
        cwd: PLAYGROUND_WEBSITE,
        env: childEnv,
        logFile: path.join(LOG_DIR, 'dev.log'),
        marker: DEV_READY_MARKER,
        timeout: DEV_READY_TIMEOUT,
      });
      siteUrl = await dev.ready;
      return siteUrl;
    });

    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--ignore-certificate-errors',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

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

      // `_dev_cardProcessor=test` routes the card button at @omega.js/backend's
      // TEST processor: a Stripe-shaped session that auto-fires its own
      // webhook and hands back the confirmation URL — no live processor, ever.
      await checkoutPage.goto(`${siteUrl}/payment/checkout?product=premium&frequency=monthly&_dev_cardProcessor=test`, { waitUntil: 'networkidle2' });
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
      const paidProduct = (backendConfig.payment?.products || []).find((product) => product.id === 'premium');
      assert.equal(account.plan, paidProduct?.name, `the plan should resolve from the emulator's user doc (got ${account.plan})`);
      assert.match(account.status || '', /active/i, `the subscription status should render (got ${account.status})`);
      return `${account.email} · ${account.plan} · ${account.status}`;
    });

    await accountPage.close();
    activePage = null;
  } catch (error) {
    failures.push({ name: 'harness', error });
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
  console.error(`\n✗ user-flows e2e errored: ${error.message}\n`);
  process.exit(1);
});
