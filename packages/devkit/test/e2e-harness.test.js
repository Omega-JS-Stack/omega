// Unit tests for src/test/e2e-harness.js — the brand e2e harness.
//
// Real-execution only (no mocks of our own code): target discovery, bin
// resolution and the dev-target refusal run against temp-dir fixtures. The
// BOOT itself is left to the lanes: it holds every classic port and starts an
// emulator, which a unit test must never do. The pieces it stands on are proven
// in boot-child.test.js, port-hold.test.js and browser.test.js.

const defineCases = require('@omega.js/devkit/test/define-cases');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  E2eHarness,
  bootLeg,
  discoverTargets,
  resolveLocalBin,
  resolveDevTarget,
  EMULATOR_READY_MARKER,
  DEV_READY_MARKER,
} = require('../src/test/e2e-harness');
const { startChild, stopChild } = require('../src/test/boot-child');

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

module.exports = defineCases({
  type: 'group',
  description: 'e2e-harness',
  tests: [
    // ---- bootLeg

    {
      name: 'a boot leg that throws rejects naming the leg, with the cause',
      run: async (ctx) => {
        const cause = new Error('port 9099 busy');
        const error = await bootLeg('the emulator', async () => { throw cause; }).then(() => null, (e) => e);
        ctx.expect(error.message).toBe('boot failed at "the emulator": port 9099 busy');
        ctx.expect(error.cause).toBe(cause);
        ctx.expect(await bootLeg('the hold', async () => '5 ports')).toBeUndefined();
      },
    },

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

    // ---- the shape: a suite's setup boots, its cleanup tears down

    {
      name: 'the step, exit and steps-log plumbing is gone: a lane is a defineCases suite',
      run: (ctx) => {
        for (const key of ['step', 'exit', 'stepsLog']) {
          ctx.expect(key in E2eHarness.prototype, `E2eHarness.prototype.${key}`).toBe(false);
        }
        const harness = new E2eHarness(makeTempBrand([]));
        ctx.expect('failures' in harness, 'an instance keeps no failures list').toBe(false);
      },
    },

    {
      name: 'boot, launchBrowser, capturePageConsole, preparePage and teardown stay',
      run: (ctx) => {
        for (const key of ['boot', 'launchBrowser', 'capturePageConsole', 'preparePage', 'teardown']) {
          ctx.expect(E2eHarness.prototype[key], `E2eHarness.prototype.${key}`).toBeTypeOf('function');
        }
      },
    },

    {
      name: 'the harness imports no steps-log',
      run: (ctx) => {
        const source = fs.readFileSync(require.resolve('../src/test/e2e-harness'), 'utf8');
        ctx.expect(/steps-log/.test(source)).toBe(false);
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
      name: 'teardown stops every child it started, the emulator and the dev server alike',
      timeout: 60000,
      run: async (ctx) => {
        const root = makeTempBrand([]);
        const harness = new E2eHarness(root);
        const start = (leg) => startChild({
          bin: process.execPath,
          args: ['-e', `console.log('${leg} ready'); setInterval(() => {}, 1000);`],
          cwd: root,
          logFile: path.join(root, 'logs', `${leg}.log`),
          marker: new RegExp(`(${leg}) ready`),
          timeout: 20000,
          relativeTo: root,
        });
        const emulator = start('emulator');
        const dev = start('dev');
        const children = [emulator.child, dev.child];
        const running = (child) => child.exitCode === null && child.signalCode === null;
        ctx.after(async () => {
          for (const child of children.filter(running)) { await stopChild(child); }
        });
        await Promise.all([emulator.ready, dev.ready]);
        harness.emulator = { child: emulator.child };
        harness.dev = { child: dev.child };

        await harness.teardown();

        ctx.expect(children.filter(running).length, 'every child boot() started has exited').toBe(0);
        ctx.expect(harness.emulator).toBe(null);
        ctx.expect(harness.dev).toBe(null);
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
