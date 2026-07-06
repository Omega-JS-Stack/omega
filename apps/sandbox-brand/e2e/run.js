/**
 * Cross-stack e2e harness for the sandbox brand — `npm test` at the brand root.
 *
 * Boots the REAL stack, nothing mocked:
 *   1. builds apps/website (esbuild bundle embedding web-manager)
 *   2. boots backend-manager's Firebase emulator suite for apps/backend
 *      (functions, firestore, auth, database, hosting, pubsub — `npx mgr emulator`)
 *   3. serves the built website statically
 *   4. drives a real Chromium (puppeteer) through the frontend↔backend contract:
 *      signup → BEM auth onCreate creates the user doc → signout → signin →
 *      session persistence across reload → subscription resolution
 *
 * This is the brand-monorepo `npm test` contract from the redesign plan; the
 * `omega e2e` CLI grows from this harness once there is a second consumer.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const BRAND_ROOT = path.join(__dirname, '..');
const WEBSITE_DIR = path.join(BRAND_ROOT, 'apps', 'website');
const WEBSITE_DIST = path.join(WEBSITE_DIR, 'dist');
const BACKEND_FUNCTIONS = path.join(BRAND_ROOT, 'apps', 'backend', 'functions');
const LOG_DIR = path.join(__dirname, '.logs');
const EMULATOR_LOG = path.join(LOG_DIR, 'emulator.log');
const PAGE_LOG = path.join(LOG_DIR, 'page.log');

const SITE_PORT = 4600;
// BEM only supports the default emulator ports (Manager.getApiUrl()/getFunctionsUrl()
// hardcode them) — so the harness requires them free rather than picking random ones.
const EMULATOR_PORTS = [9099, 5001, 8080, 5002];
const EMULATOR_READY_TIMEOUT = 180000;
const DOC_CREATE_TIMEOUT = 90000;

const EMAIL = `e2e-${Date.now()}@sandbox-brand.example.com`;
const PASSWORD = 'sandbox-password-123';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Resolves true if something is already listening on the port
function isPortBusy(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

// --- Emulator lifecycle ------------------------------------------------------

function startEmulator() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logStream = fs.createWriteStream(EMULATOR_LOG);

  // detached → own process group, so teardown can SIGINT npx + mgr + firebase-tools together
  const child = spawn('npx', ['mgr', 'emulator'], {
    cwd: BACKEND_FUNCTIONS,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`emulator not ready after ${EMULATOR_READY_TIMEOUT / 1000}s (log: ${EMULATOR_LOG})`));
    }, EMULATOR_READY_TIMEOUT);

    const watch = (chunk) => {
      const text = chunk.toString();
      logStream.write(text);
      if (/All emulators ready/i.test(text)) {
        clearTimeout(timer);
        resolve();
      }
    };

    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`emulator exited early (code ${code}, log: ${EMULATOR_LOG})`));
    });
  });

  return { child, ready };
}

async function stopEmulator(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  const exited = new Promise((resolve) => child.once('exit', resolve));

  try {
    process.kill(-child.pid, 'SIGINT');
  } catch (error) {
    return;
  }

  const result = await Promise.race([exited.then(() => 'clean'), sleep(20000)]);
  if (result !== 'clean') {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { /* already gone */ }
  }
}

// --- Static site server ------------------------------------------------------

function startSiteServer() {
  const server = http.createServer((request, response) => {
    const urlPath = new URL(request.url, `http://localhost:${SITE_PORT}`).pathname;
    const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const filePath = path.normalize(path.join(WEBSITE_DIST, relative));

    if (!filePath.startsWith(WEBSITE_DIST) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    response.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(response);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(SITE_PORT, () => resolve(server));
  });
}

// --- Flow --------------------------------------------------------------------

async function main() {
  console.log('\nSandbox brand cross-stack e2e');
  console.log(`  site: http://localhost:${SITE_PORT}  |  user: ${EMAIL}\n`);

  const failures = [];
  let emulator = null;
  let server = null;
  let browser = null;
  const pageConsole = [];

  const step = async (name, fn) => {
    try {
      const detail = await fn();
      console.log(`  ✓ ${name}${detail ? ` (${detail})` : ''}`);
    } catch (error) {
      failures.push({ name, error });
      console.log(`  ✗ ${name}\n      ${error.message}`);
      throw error;
    }
  };

  try {
    await step('website builds', async () => {
      await require(path.join(WEBSITE_DIR, 'build.js'))();
    });

    await step('emulator ports free (BEM requires default ports)', async () => {
      for (const port of EMULATOR_PORTS) {
        if (await isPortBusy(port)) {
          throw new Error(`port ${port} is already in use — is another emulator running?`);
        }
      }
      if (await isPortBusy(SITE_PORT)) {
        throw new Error(`site port ${SITE_PORT} is already in use`);
      }
    });

    await step('emulator boots (functions, firestore, auth, database, hosting, pubsub)', async () => {
      emulator = startEmulator();
      await emulator.ready;
      return `log: ${path.relative(BRAND_ROOT, EMULATOR_LOG)}`;
    });

    await step('website serves', async () => {
      server = await startSiteServer();
      const body = await new Promise((resolve, reject) => {
        http.get(`http://localhost:${SITE_PORT}/`, (response) => {
          let data = '';
          response.on('data', (chunk) => { data += chunk; });
          response.on('end', () => resolve(data));
        }).on('error', reject);
      });
      if (!body.includes('Sandbox Brand')) {
        throw new Error('served page does not look like the sandbox site');
      }
    });

    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({
      headless: true,
      args: process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
    });
    const page = await browser.newPage();
    page.on('console', (message) => pageConsole.push(`[${message.type()}] ${message.text()}`));
    page.on('pageerror', (error) => pageConsole.push(`[pageerror] ${error.message}`));

    await step('page boots web-manager against the emulators', async () => {
      await page.goto(`http://localhost:${SITE_PORT}/`, { waitUntil: 'load' });
      await page.waitForFunction('window.__omega && (window.__omega.isReady || window.__omega.initError)', { timeout: 30000 });
      const initError = await page.evaluate(() => window.__omega.initError);
      if (initError) {
        throw new Error(`web-manager initialize failed: ${initError}`);
      }
    });

    let uid = null;

    await step('signup creates the auth user', async () => {
      uid = await page.evaluate(
        (email, password) => window.__omega.signUp(email, password),
        EMAIL, PASSWORD,
      );
      if (!uid) {
        throw new Error('signup returned no uid');
      }
      return `uid: ${uid}`;
    });

    await step('BEM auth onCreate creates the Firestore user doc', async () => {
      // The frontend resolver (@omegajs/account with no generators) leaves
      // api.clientId null — it's only non-null when the account read hits the
      // REAL doc BEM's trigger wrote (the backend generates the $uuid).
      const deadline = Date.now() + DOC_CREATE_TIMEOUT;
      let last = null;
      while (Date.now() < deadline) {
        last = await page.evaluate(() => window.__omega.authState().then((state) => ({
          uid: state.account.auth.uid,
          clientId: state.account.api.clientId,
        })));
        if (last.clientId) {
          if (last.uid !== uid) {
            throw new Error(`user doc uid mismatch: ${last.uid} !== ${uid}`);
          }
          return `api.clientId: ${last.clientId}`;
        }
        await sleep(1500);
      }
      throw new Error(`user doc not created within ${DOC_CREATE_TIMEOUT / 1000}s (last state: ${JSON.stringify(last)})`);
    });

    await step('sign out', async () => {
      await page.evaluate(() => window.__omega.signOut());
      const user = await page.evaluate(() => window.__omega.currentUser());
      if (user) {
        throw new Error('currentUser still set after signOut');
      }
    });

    await step('sign in via web-manager', async () => {
      const signedInUid = await page.evaluate(
        (email, password) => window.__omega.signIn(email, password),
        EMAIL, PASSWORD,
      );
      if (signedInUid !== uid) {
        throw new Error(`signin uid mismatch: ${signedInUid} !== ${uid}`);
      }
    });

    await step('session persists across reload', async () => {
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction('window.__omega && (window.__omega.isReady || window.__omega.initError)', { timeout: 30000 });
      const state = await page.evaluate(() => window.__omega.authState().then((s) => ({
        uid: s.user && s.user.uid,
        clientId: s.account.api.clientId,
      })));
      if (state.uid !== uid) {
        throw new Error(`restored session uid mismatch: ${JSON.stringify(state)}`);
      }
      if (!state.clientId) {
        throw new Error('account doc not readable after reload');
      }
    });

    await step('subscription resolves for a fresh user', async () => {
      const resolved = await page.evaluate(() => window.__omega.authState().then((s) => ({
        email: s.account.auth.email,
        plan: s.resolved.plan,
        active: s.resolved.active,
        everPaid: s.resolved.everPaid,
      })));
      // everPaid must be exactly false (not undefined) — proves the shared
      // @omegajs/account resolveSubscription is the one running in the bundle
      if (resolved.email !== EMAIL || resolved.plan !== 'basic' || resolved.active !== false || resolved.everPaid !== false) {
        throw new Error(`unexpected resolved state: ${JSON.stringify(resolved)}`);
      }
      return `plan: ${resolved.plan}, active: ${resolved.active}`;
    });
  } catch (error) {
    // step() already reported it; fall through to teardown
  } finally {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(PAGE_LOG, pageConsole.join('\n') + '\n');

    if (browser) {
      await browser.close().catch(() => {});
    }
    if (server) {
      server.close();
    }
    if (emulator) {
      await stopEmulator(emulator.child);
    }
  }

  if (failures.length) {
    console.log(`\n  ${failures.length} step(s) failed — logs: ${path.relative(BRAND_ROOT, LOG_DIR)}/\n`);
    process.exit(1);
  }

  console.log('\n  Cross-stack e2e PASSED\n');
}

main().catch((error) => {
  console.error('Harness error:', error);
  process.exit(1);
});
