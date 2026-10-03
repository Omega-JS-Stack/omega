// Unit tests for src/test/e2e-harness.js — the brand e2e harness.
//
// Real-execution only (no mocks of our own code): target discovery, bin
// resolution and the dev-target refusal run against temp-dir fixtures, and
// step() accounting runs real (throwing/passing) functions. The BOOT itself is
// left to the lanes: it holds every classic port and starts an emulator, which
// a unit test must never do. The pieces it stands on are proven in
// boot-child.test.js, port-hold.test.js and browser.test.js.

const defineCases = require('@omega.js/devkit/test/define-cases');
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

module.exports = defineCases({
  type: 'group',
  description: 'e2e-harness',
  tests: [
    // ---- discoverTargets

    {
      name: 'discoverTargets finds the backend and web target dirs',
      run: (ctx) => {
        const root = makeTempBrand(['targets/backend/package.json', 'targets/web/package.json']);
        const targets = discoverTargets(root);
        ctx.expect(targets.backend).toBe(path.join(root, 'targets', 'backend'));
        ctx.expect(targets.web).toBe(path.join(root, 'targets', 'web'));
      },
    },

    {
      name: 'discoverTargets finds the web leg by TYPE, whatever the brand named it (#886)',
      run: (ctx) => {
        const root = makeTempBrand(['targets/storefront/package.json', 'targets/api/package.json']);
        write(path.join(root, 'config', 'omega.json5'), "{ targets: { storefront: { type: 'web' }, api: { type: 'backend' } } }\n");

        const targets = discoverTargets(root);
        ctx.expect(targets.web).toBe(path.join(root, 'targets', 'storefront'));
        ctx.expect(targets.backend).toBe(path.join(root, 'targets', 'api'));
      },
    },

    {
      name: 'discoverTargets returns nulls for missing targets and a missing targets dir',
      run: (ctx) => {
        const partial = makeTempBrand(['targets/web/package.json']);
        ctx.expect(discoverTargets(partial).backend).toBe(null);
        ctx.expect(discoverTargets(partial).web).toBe(path.join(partial, 'targets', 'web'));

        const bare = makeTempBrand([]);
        ctx.expect(discoverTargets(bare)).toEqual({ backend: null, web: null });
      },
    },

    {
      name: 'discoverTargets ignores dot-dirs and plain files in targets/',
      run: (ctx) => {
        const root = makeTempBrand(['targets/.DS_Store', 'targets/notes.md', 'targets/backend/package.json']);
        const targets = discoverTargets(root);
        ctx.expect(targets.backend).toBe(path.join(root, 'targets', 'backend'));
        ctx.expect(targets.web).toBe(null);
      },
    },

    // ---- the ready markers (the contract with @omega.js/backend and @omega.js/web)

    {
      name: 'the emulator marker is the POST-SEED line, not firebase-tools\' own',
      run: (ctx) => {
        ctx.expect('\n  Emulator ready. Press Ctrl+C to shut down...\n').toMatch(EMULATOR_READY_MARKER);
        ctx.expect(EMULATOR_READY_MARKER.test('All emulators ready! It is now safe to connect'), 'seeding runs AFTER that line and starts with a full wipe — waiting on it races the wipe').toBe(false);
      },
    },

    {
      name: 'the dev marker captures the ORIGIN, protocol included (omega dev serves mkcert HTTPS)',
      run: (ctx) => {
        ctx.expect('Dev server: https://localhost:4001'.match(DEV_READY_MARKER)[1]).toBe('https://localhost:4001');
        ctx.expect('Dev server: http://localhost:4002'.match(DEV_READY_MARKER)[1]).toBe('http://localhost:4002');
      },
    },

    // ---- resolveLocalBin

    {
      name: 'resolveLocalBin climbs to the nearest install carrying the bin',
      run: (ctx) => {
        const root = makeTempBrand([]);
        write(path.join(root, 'node_modules', '.bin', 'mgr'), '#!/bin/sh\n');
        const targetDir = path.join(root, 'targets', 'backend');
        fs.mkdirSync(targetDir, { recursive: true });

        ctx.expect(resolveLocalBin('mgr', targetDir)).toBe(path.join(root, 'node_modules', '.bin', 'mgr'));
      },
    },

    {
      name: 'resolveLocalBin prefers the NEAREST install over an outer one',
      run: (ctx) => {
        const root = makeTempBrand([]);
        write(path.join(root, 'node_modules', '.bin', 'omega'), '#!/bin/sh\n');
        const targetDir = path.join(root, 'targets', 'web');
        write(path.join(targetDir, 'node_modules', '.bin', 'omega'), '#!/bin/sh\n');

        ctx.expect(resolveLocalBin('omega', targetDir)).toBe(path.join(targetDir, 'node_modules', '.bin', 'omega'));
      },
    },

    {
      name: 'a missing bin fails loudly, naming the install to run',
      run: (ctx) => {
        const root = makeTempBrand(['targets/backend/package.json']);
        ctx.expect(() => resolveLocalBin('mgr', path.join(root, 'targets', 'backend'))).toThrow(/no node_modules\/\.bin\/mgr above .* — run npm install in the brand/);
      },
    },

    // ---- resolveDevTarget: the web leg's precondition

    {
      name: 'a web target declaring @omega.js/web resolves to that framework',
      run: (ctx) => {
        const root = makeTempBrand([]);
        const webDir = path.join(root, 'targets', 'web');
        write(path.join(webDir, 'package.json'), JSON.stringify({
          name: 'web', devDependencies: { '@omega.js/web': '*' },
        }));

        const target = resolveDevTarget(webDir, root);
        ctx.expect(target.kind).toBe('framework');
        ctx.expect(target.name).toBe('@omega.js/web');
      },
    },

    {
      name: 'a web target declaring NO framework refuses by name (never a stray dispatch)',
      run: (ctx) => {
        const root = makeTempBrand([]);
        write(path.join(root, 'config', 'omega.json5'), "{ targets: { web: { type: 'web' } } }\n");
        const webDir = path.join(root, 'targets', 'web');
        write(path.join(webDir, 'package.json'), JSON.stringify({ name: 'web' }));

        ctx.expect(() => resolveDevTarget(webDir, root)).toThrow(/^targets\/web declares no web framework dependency, so there is no `omega dev` to boot/);
      },
    },

    // ---- step() accounting

    {
      name: 'step records failures and rethrows; passes do not accumulate',
      run: async (ctx) => {
        const root = makeTempBrand([]);
        const harness = new E2eHarness(root);

        await harness.step('passing step', async () => 'detail');
        ctx.expect(harness.failures.length).toBe(0);

        await ctx.expect((() => harness.step('failing step', async () => { throw new Error('boom'); }))()).rejects.toThrow(/boom/);
        ctx.expect(harness.failures.length).toBe(1);
        ctx.expect(harness.failures[0].name).toBe('failing step');
      },
    },

    {
      name: 'the log dir is the lane folder, and every step writes its verdict as it lands',
      run: async (ctx) => {
        const root = makeTempBrand([]);
        const harness = new E2eHarness(root);
        const stepsLog = path.join(root, 'test', 'e2e', '.logs', 'steps.log');

        await harness.step('page boots @omega.js/client against the emulators', async () => 'auth :9099');
        await ctx.expect((() => harness.step('signup creates the auth user', async () => {
            throw new Error('user doc not created within 90s\n      (last state: null)');
          }))()).rejects.toThrow(/user doc not created/);

        const contents = fs.readFileSync(stepsLog, 'utf8');
        ctx.expect(contents).toMatch(/^PASS {2}page boots @omega\.js\/client against the emulators \(auth :9099\)$/m);
        // One line per step: the multi-line failure detail collapses
        ctx.expect(contents).toMatch(/^FAIL {2}signup creates the auth user — user doc not created within 90s \(last state: null\)$/m);
      },
    },

    {
      name: 'a failure recorded outside step() lands as a preflight verdict on exit',
      run: (ctx) => {
        const root = makeTempBrand([]);
        const harness = new E2eHarness(root);
        const stepsLog = path.join(root, 'test', 'e2e', '.logs', 'steps.log');

        // What a runner does when launchBrowser()/preparePage() dies before any step
        // ran — without this the file would hold a header and nothing else.
        harness.failures.push({ name: 'harness setup', error: new Error('puppeteer.launch failed') });

        ctx.expect(callExit(harness)).toBe(1);
        ctx.expect(fs.readFileSync(stepsLog, 'utf8')).toMatch(/^FAIL {2}preflight — puppeteer\.launch failed$/m);
      },
    },

    {
      name: 'exit() adds no preflight line when a step already recorded the failure',
      run: async (ctx) => {
        const root = makeTempBrand([]);
        const harness = new E2eHarness(root);
        const stepsLog = path.join(root, 'test', 'e2e', '.logs', 'steps.log');

        await ctx.expect((() => harness.step('sign out', async () => { throw new Error('currentUser still set'); }))()).rejects.toThrow();

        callExit(harness);

        const contents = fs.readFileSync(stepsLog, 'utf8');
        const verdicts = contents.split('\n').filter((line) => /^(PASS|FAIL) /.test(line));
        ctx.expect(verdicts.length).toBe(1);
        ctx.expect(/preflight/.test(contents)).toBe(false);
      },
    },

    // ---- childEnv: the port both children need

    {
      name: 'childEnv carries the resolved website port to both children',
      run: (ctx) => {
        const root = makeTempBrand([]);
        const harness = new E2eHarness(root);
        ctx.expect(harness.childEnv.OMEGA_WEBSITE_PORT, 'nothing is claimed before allocation').toBe(undefined);

        harness.sitePort = 4001;
        ctx.expect(harness.childEnv.OMEGA_WEBSITE_PORT).toBe('4001');
        ctx.expect(harness.childEnv.PATH, 'the rest of the environment rides along').toBe(process.env.PATH);
      },
    },

    // ---- preparePage

    {
      name: 'preparePage wires console capture and injects the resolved emulator map as a FALLBACK (#300)',
      run: async (ctx) => {
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

        ctx.expect(events.sort(), 'console capture wired').toEqual(['console', 'pageerror']);
        ctx.expect(injections.length).toBe(1);
        ctx.expect(injections[0].ports).toEqual({ auth: 9199, firestore: 8180, hosting: 5099 });
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
        ctx.expect(win.__OMEGA_DEV_PORTS__).toEqual({ auth: 9199, firestore: 8180, hosting: 5099 });
      },
    },

    // ---- teardown

    {
      name: 'teardown writes page.log (even empty) and releases everything boot() started',
      run: async (ctx) => {
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
        ctx.expect(fs.existsSync(pageLog), 'page.log must exist even with no console output').toBe(true);
        ctx.expect(closed).toEqual(['browser', 'port']);
        ctx.expect(harness.browser).toBe(null);
        ctx.expect(harness.dev).toBe(null);
        ctx.expect(harness.emulator).toBe(null);
        ctx.expect(harness.hold).toBe(null);
      },
    },

    {
      name: 'teardown is safe on a harness that never booted',
      run: async (ctx) => {
        const root = makeTempBrand([]);
        const harness = new E2eHarness(root);
        await harness.teardown();
        ctx.expect(fs.existsSync(path.join(root, 'test', 'e2e', '.logs', 'page.log'))).toBe(true);
      },
    },

    // ---- siteUrl

    {
      name: 'siteUrl is the origin the dev server REPORTED, not one composed from a port',
      run: (ctx) => {
        const root = makeTempBrand([]);
        const harness = new E2eHarness(root);
        ctx.expect(harness.siteUrl, 'nothing is claimed before the dev server says so').toBe(null);

        harness._siteUrl = 'https://localhost:4001';
        ctx.expect(harness.siteUrl).toBe('https://localhost:4001');
      },
    },
  ],
});
