// Unit tests for src/test/e2e-harness.js — the brand e2e harness.
//
// Real-execution only (no mocks of our own code): target discovery, bin
// resolution and the dev-target refusal run against temp-dir fixtures, and
// step() accounting runs real (throwing/passing) functions. The BOOT itself is
// left to the lanes: it holds every classic port and starts an emulator, which
// a unit test must never do. The pieces it stands on are proven in
// boot-child.test.js, port-hold.test.js and browser.test.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  E2eHarness,
  discoverTargets,
  resolveLocalBin,
  resolveDevTarget,
  EMULATOR_READY_MARKER,
  DEV_READY_MARKER,
} = require('../src/test/e2e-harness');

function makeTempBrand(structure) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-harness-test-')));
  for (const relative of structure) {
    const target = path.join(root, relative);
    if (relative.endsWith('/')) {
      fs.mkdirSync(target, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, relative.endsWith('.json') ? '{}' : '');
    }
  }
  return root;
}

function write(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

// ---- discoverTargets

test('discoverTargets finds the backend and website target dirs', () => {
  const root = makeTempBrand(['targets/backend/package.json', 'targets/website/package.json']);
  const targets = discoverTargets(root);
  assert.equal(targets.backend, path.join(root, 'targets', 'backend'));
  assert.equal(targets.website, path.join(root, 'targets', 'website'));
});

test('discoverTargets returns nulls for missing targets and a missing targets dir', () => {
  const partial = makeTempBrand(['targets/website/package.json']);
  assert.equal(discoverTargets(partial).backend, null);
  assert.equal(discoverTargets(partial).website, path.join(partial, 'targets', 'website'));

  const bare = makeTempBrand([]);
  assert.deepEqual(discoverTargets(bare), { backend: null, website: null });
});

test('discoverTargets ignores dot-dirs and plain files in targets/', () => {
  const root = makeTempBrand(['targets/.DS_Store', 'targets/notes.md', 'targets/backend/package.json']);
  const targets = discoverTargets(root);
  assert.equal(targets.backend, path.join(root, 'targets', 'backend'));
  assert.equal(targets.website, null);
});

// ---- the ready markers (the contract with @omega.js/backend and @omega.js/web)

test('the emulator marker is the POST-SEED line, not firebase-tools\' own', () => {
  assert.match('\n  Emulator ready. Press Ctrl+C to shut down...\n', EMULATOR_READY_MARKER);
  assert.equal(EMULATOR_READY_MARKER.test('All emulators ready! It is now safe to connect'), false,
    'seeding runs AFTER that line and starts with a full wipe — waiting on it races the wipe');
});

test('the dev marker captures the ORIGIN, protocol included (omega dev serves mkcert HTTPS)', () => {
  assert.equal('Dev server: https://localhost:4001'.match(DEV_READY_MARKER)[1], 'https://localhost:4001');
  assert.equal('Dev server: http://localhost:4002'.match(DEV_READY_MARKER)[1], 'http://localhost:4002');
});

// ---- resolveLocalBin

test('resolveLocalBin climbs to the nearest install carrying the bin', () => {
  const root = makeTempBrand([]);
  write(path.join(root, 'node_modules', '.bin', 'mgr'), '#!/bin/sh\n');
  const targetDir = path.join(root, 'targets', 'backend');
  fs.mkdirSync(targetDir, { recursive: true });

  assert.equal(resolveLocalBin('mgr', targetDir), path.join(root, 'node_modules', '.bin', 'mgr'));
});

test('resolveLocalBin prefers the NEAREST install over an outer one', () => {
  const root = makeTempBrand([]);
  write(path.join(root, 'node_modules', '.bin', 'omega'), '#!/bin/sh\n');
  const targetDir = path.join(root, 'targets', 'website');
  write(path.join(targetDir, 'node_modules', '.bin', 'omega'), '#!/bin/sh\n');

  assert.equal(resolveLocalBin('omega', targetDir), path.join(targetDir, 'node_modules', '.bin', 'omega'));
});

test('a missing bin fails loudly, naming the install to run', () => {
  const root = makeTempBrand(['targets/backend/package.json']);
  assert.throws(
    () => resolveLocalBin('mgr', path.join(root, 'targets', 'backend')),
    /no node_modules\/\.bin\/mgr above .* — run npm install in the brand/,
  );
});

// ---- resolveDevTarget: the website leg's precondition

test('a website target declaring @omega.js/web resolves to that framework', () => {
  const root = makeTempBrand([]);
  const websiteDir = path.join(root, 'targets', 'website');
  write(path.join(websiteDir, 'package.json'), JSON.stringify({
    name: 'website', devDependencies: { '@omega.js/web': '*' },
  }));

  const target = resolveDevTarget(websiteDir, root);
  assert.equal(target.kind, 'framework');
  assert.equal(target.name, '@omega.js/web');
});

test('a website target declaring NO framework refuses by name (never a stray dispatch)', () => {
  const root = makeTempBrand([]);
  write(path.join(root, 'config', 'omega.json5'), '{ targets: { web: {} } }\n');
  const websiteDir = path.join(root, 'targets', 'website');
  write(path.join(websiteDir, 'package.json'), JSON.stringify({ name: 'website' }));

  assert.throws(
    () => resolveDevTarget(websiteDir, root),
    /^Error: targets\/website declares no web framework dependency, so there is no `omega dev` to boot/,
  );
});

// ---- step() accounting

test('step records failures and rethrows; passes do not accumulate', async () => {
  const root = makeTempBrand([]);
  const harness = new E2eHarness(root);

  await harness.step('passing step', async () => 'detail');
  assert.equal(harness.failures.length, 0);

  await assert.rejects(
    () => harness.step('failing step', async () => { throw new Error('boom'); }),
    /boom/,
  );
  assert.equal(harness.failures.length, 1);
  assert.equal(harness.failures[0].name, 'failing step');
});

// ---- steps.log: the harness's verdicts on disk (#197)

// exit() ends the process on failure — the ONE thing a unit test must stub (a
// real exit would take the runner with it). The stub throws so the call site
// behaves like the real one: it never returns.
const EXITED = new Error('process.exit');
function callExit(harness) {
  const realExit = process.exit;
  let code = null;
  process.exit = (value) => { code = value; throw EXITED; };
  try {
    harness.exit();
  } catch (error) {
    if (error !== EXITED) { throw error; }
  } finally {
    process.exit = realExit;
  }
  return code;
}

test('the log dir is the lane folder, and every step writes its verdict as it lands', async () => {
  const root = makeTempBrand([]);
  const harness = new E2eHarness(root);
  const stepsLog = path.join(root, 'test', 'e2e', '.logs', 'steps.log');

  await harness.step('page boots @omega.js/client against the emulators', async () => 'auth :9099');
  await assert.rejects(
    () => harness.step('signup creates the auth user', async () => {
      throw new Error('user doc not created within 90s\n      (last state: null)');
    }),
    /user doc not created/,
  );

  const contents = fs.readFileSync(stepsLog, 'utf8');
  assert.match(contents, /^PASS {2}page boots @omega\.js\/client against the emulators \(auth :9099\)$/m);
  // One line per step: the multi-line failure detail collapses
  assert.match(contents, /^FAIL {2}signup creates the auth user — user doc not created within 90s \(last state: null\)$/m);
});

test('a failure recorded outside step() lands as a preflight verdict on exit', () => {
  const root = makeTempBrand([]);
  const harness = new E2eHarness(root);
  const stepsLog = path.join(root, 'test', 'e2e', '.logs', 'steps.log');

  // What a runner does when launchBrowser()/preparePage() dies before any step
  // ran — without this the file would hold a header and nothing else.
  harness.failures.push({ name: 'harness setup', error: new Error('puppeteer.launch failed') });

  assert.equal(callExit(harness), 1);
  assert.match(fs.readFileSync(stepsLog, 'utf8'), /^FAIL {2}preflight — puppeteer\.launch failed$/m);
});

test('exit() adds no preflight line when a step already recorded the failure', async () => {
  const root = makeTempBrand([]);
  const harness = new E2eHarness(root);
  const stepsLog = path.join(root, 'test', 'e2e', '.logs', 'steps.log');

  await assert.rejects(() => harness.step('sign out', async () => { throw new Error('currentUser still set'); }));

  callExit(harness);

  const contents = fs.readFileSync(stepsLog, 'utf8');
  const verdicts = contents.split('\n').filter((line) => /^(PASS|FAIL) /.test(line));
  assert.equal(verdicts.length, 1);
  assert.equal(/preflight/.test(contents), false);
});

// ---- childEnv: the port both children need

test('childEnv carries the resolved website port to both children', () => {
  const root = makeTempBrand([]);
  const harness = new E2eHarness(root);
  assert.equal(harness.childEnv.OMEGA_WEBSITE_PORT, undefined, 'nothing is claimed before allocation');

  harness.sitePort = 4001;
  assert.equal(harness.childEnv.OMEGA_WEBSITE_PORT, '4001');
  assert.equal(harness.childEnv.PATH, process.env.PATH, 'the rest of the environment rides along');
});

// ---- preparePage

test('preparePage wires console capture and injects the resolved emulator map as a FALLBACK (#300)', async () => {
  const root = makeTempBrand([]);
  const harness = new E2eHarness(root);
  harness.emulatorPorts = { auth: 9199, firestore: 8180, hosting: 5099 };

  const events = [];
  const injections = [];
  const fakePage = {
    on(event) { events.push(event); },
    async evaluateOnNewDocument(fn, ports) { injections.push({ fn, ports }); },
  };

  await harness.preparePage(fakePage);

  assert.deepEqual(events.sort(), ['console', 'pageerror'], 'console capture wired');
  assert.equal(injections.length, 1);
  assert.deepEqual(injections[0].ports, { auth: 9199, firestore: 8180, hosting: 5099 });
  // The injected function must set the runtime channel the client reads for
  // the keys a page's own chrome does NOT carry
  const win = {};
  const originalWindow = global.window;
  global.window = win;
  try {
    injections[0].fn(injections[0].ports);
  } finally {
    global.window = originalWindow;
  }
  assert.deepEqual(win.__OMEGA_DEV_PORTS__, { auth: 9199, firestore: 8180, hosting: 5099 });
});

// ---- teardown

test('teardown writes page.log (even empty) and releases everything boot() started', async () => {
  const root = makeTempBrand([]);
  const harness = new E2eHarness(root);

  const closed = [];
  harness.browser = { close: async () => { closed.push('browser'); } };
  // Children that have already exited: stopChild signals nothing, which is
  // what a unit test may do — the real group stop is boot-child.test.js's.
  harness.dev = { child: { exitCode: 0, pid: -1 } };
  harness.emulator = { child: { exitCode: 0, pid: -1 } };
  harness.hold = { servers: [{ close: () => closed.push('port') }] };

  await harness.teardown();

  const pageLog = path.join(root, 'test', 'e2e', '.logs', 'page.log');
  assert.equal(fs.existsSync(pageLog), true, 'page.log must exist even with no console output');
  assert.deepEqual(closed, ['browser', 'port']);
  assert.equal(harness.browser, null);
  assert.equal(harness.dev, null);
  assert.equal(harness.emulator, null);
  assert.equal(harness.hold, null);
});

test('teardown is safe on a harness that never booted', async () => {
  const root = makeTempBrand([]);
  const harness = new E2eHarness(root);
  await harness.teardown();
  assert.equal(fs.existsSync(path.join(root, 'test', 'e2e', '.logs', 'page.log')), true);
});

// ---- siteUrl

test('siteUrl is the origin the dev server REPORTED, not one composed from a port', () => {
  const root = makeTempBrand([]);
  const harness = new E2eHarness(root);
  assert.equal(harness.siteUrl, null, 'nothing is claimed before the dev server says so');

  harness._siteUrl = 'https://localhost:4001';
  assert.equal(harness.siteUrl, 'https://localhost:4001');
});
