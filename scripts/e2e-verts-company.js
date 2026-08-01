/**
 * Root `npm run test:verts` — verts (verts) step 6: the COMPANY-MODE PROOF
 * (docs/web/ads-system.md, sequencing 6: "Paperloom serves, a second in-repo
 * brand consumes"). Runs in root `npm test` between the sandbox e2e and the
 * wizard journey. Fully offline: local emulators only, nothing cloud.
 *
 * Serving side — the playground backend ("Paperloom") boots its real
 * emulator stack (`npx mgr emulator --no-seed`, mirroring the devkit e2e
 * harness) and its Firestore `verts` collection is seeded with a small varied
 * inventory (tags, weights, one whitelist-scoped vert).
 *
 * Route-level proof (raw fetch against the hosting emulator):
 *   - eligible vert → the self-contained HTML unit (postMessage vocabulary,
 *     redirect link, port-preserving target origin, no external assets)
 *   - contextual scoring beats raw weight (tag-matched vert always wins)
 *   - 204 no-fill when nothing is eligible
 *   - redirect 302s ONLY to the stored link (+ UTM), 404s unknown ids,
 *     never follows a caller-supplied url
 *   - whitelist scoping: an vert whitelisted to one sub-brand host serves
 *     there and NEVER anywhere else (fail-closed via the `parent` param)
 *
 * Company hop — the consumer side is REAL code, not URL math: The Daily
 * Build's web config is composed by @omega.js/config from its committed
 * omega.json5 (advertising.providers.inhouse.source 'company' +
 * company.url), fed to the REAL @omega.js/client singleton (node globals per
 * the client test setup), and the verts module's resolveSource() +
 * VertUnit.buildServeUrl() produce the URL that is then ACTUALLY fetched
 * against the Paperloom emulator — the consumer-resolved request lands on
 * the parent's inventory. In development the api derivation resolves through
 * the provided dev port map (window.__OMEGA_DEV_PORTS__ — the same channel
 * the devkit e2e harness injects); the production derivation
 * (company.url → api.<company host>) is asserted as URL math alongside.
 *
 * Knobs: OMEGA_SKIP_E2E=1 skips (matches the sandbox e2e lane).
 */
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');
const assert = require('assert');

if (process.env.OMEGA_SKIP_E2E === '1') {
  console.log('⏭ OMEGA_SKIP_E2E=1 — skipping verts company-mode e2e');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const PLAYGROUND_BACKEND = path.join(ROOT, 'apps', 'omega-playground', 'apps', 'backend');
const NEWSFLASH_WEBSITE = path.join(ROOT, 'apps', 'newsflash-brand', 'apps', 'website');
const CLIENT_SRC = path.join(ROOT, 'packages', 'client', 'src');
const LOG_DIR = path.join(ROOT, '.temp', 'verts-e2e');

const { readPortsFile, composeTargetConfig } = require('@omega.js/config');

const EMULATOR_READY_TIMEOUT = 240000;
const READY_MARKER = /Emulator ready\. Press Ctrl\+C/i;

// The consumer's dev host — The Daily Build's pinned side-by-side port
const CONSUMER_HOST = 'localhost:4100';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Seeded inventory: varied tags + weights, one whitelist-scoped vert. Verts that
// should be reachable everywhere blacklist nofill.example so the no-fill
// assertion has a deterministic parent (backend serve-suite convention).
const VERTS = [
  {
    id: 'paperloom-desk',
    enabled: true,
    title: 'The Paperloom Desk Kit',
    description: 'Everything a quiet writing desk needs.',
    button: 'Browse the kit',
    link: 'https://desk.paperloom-partners.example/kit',
    image: '',
    footer: 'Sponsored by Paperloom Partners',
    weight: 5,
    targeting: { sites: [], categories: ['writing'], keywords: ['notes'] },
    whitelist: [],
    blacklist: ['nofill.example'],
  },
  {
    id: 'devnews-digest',
    enabled: true,
    title: 'The Build Radar Digest',
    description: 'Release radar and ship logs, weekly.',
    button: 'Subscribe',
    link: 'https://digest.buildtools.example/subscribe',
    image: '',
    footer: 'Sponsored by Build Tools Co',
    weight: 1,
    targeting: { sites: [], categories: ['dev-news'], keywords: ['ci'] },
    whitelist: [],
    blacklist: ['nofill.example'],
  },
  {
    id: 'dailybuild-exclusive',
    enabled: true,
    title: 'Daily Build Reader Offer',
    description: 'An offer only The Daily Build readers see.',
    button: 'Claim it',
    link: 'https://exclusive.pressroom.example/offer',
    image: '',
    footer: 'Sponsored by the Pressroom',
    weight: 1,
    targeting: { sites: [], categories: [], keywords: [] },
    whitelist: ['dailybuild.omegajs.dev'],
    blacklist: [],
  },
];

const failures = [];

async function step(name, fn) {
  try {
    const detail = await fn();
    console.log(`  ✓ ${name}${detail ? ` (${detail})` : ''}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  ✗ ${name}\n      ${error.message}`);
    throw error;
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

// -- Emulator lifecycle (mirrors @omega.js/devkit/test/e2e-harness) ---------

function startEmulator() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const emulatorLog = path.join(LOG_DIR, 'emulator.log');
  const logStream = fs.createWriteStream(emulatorLog);

  // --no-seed: personas are irrelevant to the verts proof (and skipping the
  // ~55-account seed keeps the lane fast). The hoisted local bin is spawned
  // DIRECTLY (not via npx): outside an npm-script PATH the shell's npx shim
  // routes through the Socket Firewall proxy, whose proxy env breaks
  // firebase-tools' internal emulator REST calls (HTML instead of JSON at
  // firestore-trigger registration).
  const mgrBin = path.join(ROOT, 'node_modules', '.bin', 'mgr');
  const child = spawn(mgrBin, ['emulator', '--no-seed'], {
    cwd: PLAYGROUND_BACKEND,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`emulator not ready after ${EMULATOR_READY_TIMEOUT / 1000}s (log: ${emulatorLog})`));
    }, EMULATOR_READY_TIMEOUT);

    const watch = (chunk) => {
      const text = chunk.toString();
      logStream.write(text);
      if (READY_MARKER.test(text)) {
        clearTimeout(timer);
        resolve();
      }
    };

    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`emulator exited early (code ${code}, log: ${emulatorLog})`));
    });
  });

  return { child, ready };
}

async function stopEmulator(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try { process.kill(-child.pid, 'SIGINT'); } catch (e) { return; }
  const result = await Promise.race([exited.then(() => 'clean'), sleep(20000)]);
  if (result !== 'clean') {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { /* already gone */ }
  }
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('\nAds company-mode e2e (Paperloom serves, The Daily Build consumes)\n');

  let emulator = null;
  let ports = null;

  try {
    // Never clobber a live playground stack (its ports file + a listening
    // hosting port = someone's dev session; booting here would overwrite the
    // published port map and wipe their seeded state on teardown).
    const incumbent = readPortsFile(PLAYGROUND_BACKEND);
    if (incumbent?.hosting && await isPortListening(incumbent.hosting)) {
      throw new Error(`a playground emulator stack is already running (hosting :${incumbent.hosting}) — stop it and re-run`);
    }

    await step('Paperloom emulator boots (functions, firestore, hosting)', async () => {
      emulator = startEmulator();
      await emulator.ready;
      ports = readPortsFile(PLAYGROUND_BACKEND);
      if (!ports?.hosting || !ports?.firestore) {
        throw new Error(`resolved port map incomplete: ${JSON.stringify(ports)}`);
      }
      return `hosting :${ports.hosting}, firestore :${ports.firestore}`;
    });

    const base = `http://127.0.0.1:${ports.hosting}`;

    await step('verts inventory seeds into the emulator Firestore', async () => {
      // firebase-admin from the backend app's own resolution, pointed at the
      // emulator (host env) — no credentials, nothing cloud.
      process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${ports.firestore}`;
      const backendRequire = createRequire(path.join(PLAYGROUND_BACKEND, 'package.json'));
      const firebaserc = JSON.parse(fs.readFileSync(path.join(PLAYGROUND_BACKEND, '.firebaserc'), 'utf8'));
      const projectId = firebaserc.projects.default;

      const admin = backendRequire('firebase-admin');
      if (admin.apps.length === 0) {
        admin.initializeApp({ projectId });
      }
      const db = admin.firestore();

      // Idempotent: wipe whatever a previous run left, then seed
      const existing = await db.collection('verts').get();
      for (const doc of existing.docs) {
        await doc.ref.delete();
      }
      for (const vert of VERTS) {
        await db.doc(`verts/${vert.id}`).set(vert);
      }

      return `${VERTS.length} verts (project ${projectId})`;
    });

    // -- 1. Paperloom serves (route level) --------------------------------

    await step('eligible vert serves as the self-contained HTML unit', async () => {
      const response = await fetch(`${base}/omega/verts/serve?parent=${CONSUMER_HOST}&tags=writing,notes`);
      const body = await response.text();

      assert.equal(response.status, 200, `serve should 200 (got ${response.status})`);
      assert.match(response.headers.get('content-type') || '', /text\/html/, 'response should be HTML');
      assert.ok(body.includes('The Paperloom Desk Kit'), 'tag-matched vert title should render');
      assert.ok(body.includes('omega-vert:set-dimensions'), 'unit should report dimensions via postMessage');
      assert.ok(body.includes('omega-vert:click'), 'unit should forward clicks via postMessage');
      assert.ok(body.includes('/omega/verts/redirect?id=paperloom-desk'), 'click link should ride the redirect route');
      assert.ok(body.includes('"http://localhost:4100"'), 'postMessage target origin should preserve the dev port');
      assert.ok(!body.includes('<script src') && !body.includes('<link'), 'unit must be self-contained');
      assert.ok(!body.includes('setInterval') && !body.includes('setTimeout'), 'unit must have no self-refresh timers');
    });

    await step('contextual scoring beats raw weight (5 of 5 rounds)', async () => {
      // devnews-digest (weight 1) scores 2 on these tags; paperloom-desk
      // (weight 5) scores 0 — the top scorer must win every time
      for (let i = 0; i < 5; i++) {
        const response = await fetch(`${base}/omega/verts/serve?parent=${CONSUMER_HOST}&tags=dev-news,ci`);
        const body = await response.text();
        assert.equal(response.status, 200, `serve should 200 (got ${response.status})`);
        assert.ok(body.includes('id=devnews-digest'), `round ${i + 1}: tag-matched vert should beat the heavier untargeted vert`);
      }
    });

    await step('no eligible inventory → 204 no-fill', async () => {
      // nofill.example: verts 1-2 blacklist it; the whitelisted vert fails closed
      const response = await fetch(`${base}/omega/verts/serve?parent=nofill.example`);
      assert.equal(response.status, 204, `no-fill should 204 (got ${response.status})`);
    });

    await step('redirect 302s only to the stored link (+ UTM), fail-closed', async () => {
      const response = await fetch(
        `${base}/omega/verts/redirect?id=devnews-digest&parent=dailybuild.omegajs.dev&url=https://evil.example/hijack`,
        { redirect: 'manual' },
      );
      assert.equal(response.status, 302, `redirect should 302 (got ${response.status})`);

      const location = new URL(response.headers.get('location'));
      assert.equal(location.origin + location.pathname, 'https://digest.buildtools.example/subscribe', 'redirect must land on the STORED link (never a caller-supplied url)');
      assert.equal(location.searchParams.get('utm_source'), 'dailybuild.omegajs.dev', 'utm_source should be the parent host');
      assert.equal(location.searchParams.get('utm_medium'), 'omega-vert', 'utm_medium should be omega-vert');
      assert.equal(location.searchParams.get('utm_campaign'), 'devnews-digest', 'utm_campaign should be the vert id');

      const unknown = await fetch(`${base}/omega/verts/redirect?id=no-such-vert`, { redirect: 'manual' });
      assert.equal(unknown.status, 404, `unknown id should 404 (got ${unknown.status})`);
    });

    // -- 3. Whitelist scoping (parent scopes inventory per sub-brand) -----

    await step('whitelisted vert serves ONLY on its listed sub-brand host', async () => {
      const listed = await fetch(`${base}/omega/verts/serve?parent=dailybuild.omegajs.dev&vertId=dailybuild-exclusive`);
      const listedBody = await listed.text();
      assert.equal(listed.status, 200, `listed host should 200 (got ${listed.status})`);
      assert.ok(listedBody.includes('id=dailybuild-exclusive'), 'listed host should receive the whitelisted vert');

      // Another sub-brand pinning the same vert: the pin is ineligible — either
      // another vert serves or nothing does, but NEVER the whitelisted one
      const other = await fetch(`${base}/omega/verts/serve?parent=site.example&vertId=dailybuild-exclusive`);
      const otherBody = other.status === 200 ? await other.text() : '';
      assert.ok(!otherBody.includes('id=dailybuild-exclusive'), 'a non-listed host must never receive the whitelisted vert');

      // And with everything else ineligible the whitelist fails CLOSED
      const closed = await fetch(`${base}/omega/verts/serve?parent=nofill.example&vertId=dailybuild-exclusive`);
      assert.equal(closed.status, 204, `whitelist must fail closed for unknown hosts (got ${closed.status})`);
    });

    // -- 2. The Daily Build consumes as COMPANY ---------------------------

    let Manager = null;
    let composed = null;

    await step('The Daily Build composes company-mode verts config (real @omega.js/config)', async () => {
      composed = composeTargetConfig(NEWSFLASH_WEBSITE, 'web').config;
      assert.equal(composed.advertising?.providers?.inhouse?.source, 'company', 'inhouse source should be company');
      assert.equal(composed.advertising?.fallback, 'inhouse', 'fallback should be inhouse');
      assert.equal(composed.company?.url, 'https://playground.omegajs.dev', 'company.url should point at the parent');
      assert.deepEqual(composed.advertising?.tags, ['dev-news', 'ci'], 'brand tags should compose');
    });

    await step('real @omega.js/client resolves the company source to the parent stack', async () => {
      // Browser globals exactly as the client test suite provides them, then
      // the consumer's own dev identity: The Daily Build's pinned site port
      // and the resolved parent port map (the devkit harness channel).
      require(path.join(ROOT, 'packages', 'client', 'test', 'setup.js'));
      global.window.location = {
        href: `http://${CONSUMER_HOST}/`,
        search: '',
        origin: `http://${CONSUMER_HOST}`,
        host: CONSUMER_HOST,
      };
      global.window.__OMEGA_DEV_PORTS__ = { hosting: ports.hosting };

      const mod = await import(pathToFileURL(path.join(CLIENT_SRC, 'index.js')).href);
      Manager = mod.default;

      await Manager.initialize({
        runtime: 'web',
        environment: 'development',
        brand: composed.brand,
        advertising: composed.advertising,
        company: composed.company,
        firebase: { app: { enabled: false } },
        sentry: { enabled: false },
      });

      const source = Manager.verts().resolveSource();
      assert.equal(source, `http://127.0.0.1:${ports.hosting}`, `company source should resolve to the parent emulator (got ${source})`);

      // The production derivation of the SAME company.url — the api URL a
      // deployed sub-brand would hit
      const production = Manager.getApiUrl('production', composed.company.url);
      assert.equal(production, 'https://api.playground.omegajs.dev', `production derivation should prepend api. (got ${production})`);

      return source;
    });

    await step('consumer-built serve request lands on the parent inventory (the REAL hop)', async () => {
      const { VertUnit } = await import(pathToFileURL(path.join(CLIENT_SRC, 'modules', 'verts.js')).href);

      const source = Manager.verts().resolveSource();
      const unit = new VertUnit(Manager, {}, {
        source,
        tags: Manager.config.advertising.tags,
      });
      const serveUrl = unit.buildServeUrl();

      // The URL the consumer module built, requested for real
      assert.ok(serveUrl.startsWith(`http://127.0.0.1:${ports.hosting}/omega/verts/serve?`), `consumer URL should target the parent serve route (got ${serveUrl})`);
      assert.ok(serveUrl.includes(`parent=${encodeURIComponent(CONSUMER_HOST)}`), 'consumer URL should carry its own host as parent');
      assert.ok(serveUrl.includes('tags=dev-news%2Cci'), 'consumer URL should carry the brand tags');

      const response = await fetch(serveUrl);
      const body = await response.text();
      assert.equal(response.status, 200, `parent should fill the consumer request (got ${response.status})`);
      assert.ok(body.includes('The Build Radar Digest'), "the consumer's tags should select the parent's tag-matched vert");
      assert.ok(body.includes('id=devnews-digest'), 'served unit should be parent inventory');
      assert.ok(body.includes('"http://localhost:4100"'), "postMessage target origin should be the CONSUMER's dev origin (port preserved)");

      return `${serveUrl.split('?')[0]} → 200`;
    });
  } catch (error) {
    // step() already reported it; fall through to teardown
  } finally {
    if (emulator) {
      await stopEmulator(emulator.child);
    }
  }

  if (failures.length) {
    console.log(`\n  ${failures.length} step(s) failed — log: ${path.relative(ROOT, path.join(LOG_DIR, 'emulator.log'))}\n`);
    process.exit(1);
  }
  console.log('\n  Verts company-mode e2e PASSED\n');
  // Explicit exit — the firebase-admin gRPC channel and the client singleton
  // hold the event loop open otherwise
  process.exit(0);
}

main().catch((error) => {
  console.error('Harness error:', error);
  process.exit(1);
});
