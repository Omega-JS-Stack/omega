/**
 * Root `npm run test:e2e-desktop`: the desktop sign-in in a REAL Electron app.
 * The emulator seeds its personas; this lane's own (scripts/roster-persona.js)
 * is minted a custom token; a consumer app staged from @omega.js/desktop's
 * fixture builds and boots; a SECOND instance carries
 * `<brand.id>://auth/token?authToken=` so the OS single-instance lock forwards
 * it through the real deep-link pipeline. Main's session and the renderer's own
 * Firebase must both land on the persona, and a sign-out in main must end both
 * (the renderer through the real broadcast). Offline: emulator only.
 * OMEGA_SKIP_E2E=1 skips; no electron, or no desktop dist, is a SKIP.
 */
const defineCases = require('@omega.js/devkit/test/define-cases');
const path = require('path');
const fs = require('fs');
const { normalizeSpec } = require('@omega.js/devkit/test/run-case');

const { startPlaygroundEmulator, stopPlaygroundEmulator, playgroundProjectId } = require('./_emulator');
const { mintPersonaToken } = require('../../scripts/roster-persona');

const ROOT = path.join(__dirname, '..', '..');
const DESKTOP = path.join(ROOT, 'packages', 'desktop');
const DESKTOP_DIST = path.join(DESKTOP, 'dist');
const FIXTURE = path.join(DESKTOP, 'src', 'test', 'fixtures', 'consumer-app');
// The staged app lives INSIDE packages/desktop on purpose: the fixture resolves
// gulp/esbuild/firebase through the upward node_modules walk, which only reaches
// the desktop package (and the workspace root) from in here.
const STAGE_DIR = path.join(DESKTOP, '.temp', 'desktop-auth-e2e');
const APP_DIR = path.join(STAGE_DIR, 'app');
const LOG_DIR = path.join(ROOT, '.temp', 'desktop-auth-e2e');

const BRAND_ID = 'desktop-auth-e2e';

// The boot case's backstop sits above the gulp build plus every in-app case's own
// timeout, so the in-app ceilings fire first, naming the case that hung.
const BUILD_BUDGET = 300000;
const MARGIN = 60000;

// This lane's own seeded persona, never shared with another suite
const PERSONA_LOCALPART = '_test.desktop-auth-e2e';
const API_KEY = 'fake-api-key';

// -- The staged consumer app ------------------------------------------------

// Copy the bundled fixture and apply the two test-time overrides. Everything
// else (main.js, preload, views, styles) is the fixture verbatim, so what
// boots here is the same consumer shape the desktop boot suite proves.
function stageApp({ projectId, apiKey, ports }) {
  fs.rmSync(APP_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(APP_DIR), { recursive: true });
  fs.cpSync(FIXTURE, APP_DIR, {
    recursive: true,
    filter: (src) => !/[\\/](node_modules|dist|logs)$/.test(src),
  });

  fs.writeFileSync(path.join(APP_DIR, 'package.json'), `${JSON.stringify({
    name: 'desktop-auth-e2e-consumer',
    version: '1.0.0',
    private: true,
    description: 'Staged @omega.js/desktop consumer for test/e2e/desktop-auth.test.js: generated, never committed.',
    main: 'dist/main.bundle.js',
    // A real consumer always declares its framework: ensureTarget's locality
    // check refuses a target without it. `file:` is the linked-brand
    // shape; from APP_DIR that path is packages/desktop itself.
    devDependencies: { '@omega.js/desktop': 'file:../../..' },
  }, null, 2)}\n`);

  // JSON is valid JSON5: the config loader reads this the same way it reads a
  // hand-written one.
  const config = {
    brand: {
      id: BRAND_ID,
      name: 'Desktop Auth E2E',
      // The .deb target needs a homepage and a maintainer: build-config
      // refuses the config without them, so the staged brand spells both.
      url: 'https://desktop-auth-e2e.test',
      contact: { email: 'support@desktop-auth-e2e.test' },
      images: { icon: '' },
    },
    // The baked word. The RUNNING environment beats it: the boot lane
    // names `testing`, main and the renderer both answer it, and the renderer's
    // @omega.js/client connects to the auth/firestore emulators in any
    // non-production environment, reading the ports from `dev.ports`.
    environment: 'development',
    dev: { ports },
    cloud: {
      provider: 'firebase',
      // The renderer's @omega.js/client boots Messaging, which refuses a config
      // without appId and messagingSenderId, so the staged brand carries both
      config: { apiKey, projectId, appId: '1:000000000000:web:desktopauthe2e', messagingSenderId: '000000000000' },
    },
    monitoring: { providers: { sentry: { dsn: '' } } },
    analytics: { providers: { google: { id: '' } } },
    targets: {
      desktop: {
        type: 'desktop',
        startup: { mode: 'normal' },
        releases: { enabled: false },
      },
    },
  };
  fs.writeFileSync(path.join(APP_DIR, 'config', 'omega.json5'), `${JSON.stringify(config, null, 2)}\n`);

  // Renderer entry override: park the instance on window so the lane can read
  // the RENDERER's own auth state (the fixture's entry keeps no reference).
  const rendererEntry = path.join(APP_DIR, 'src', 'assets', 'js', 'components', 'main', 'index.js');
  fs.writeFileSync(rendererEntry, [
    '// Staged for test/e2e/desktop-auth.test.js: the fixture entry plus a window',
    '// handle, so the lane can read this renderer\'s own @omega.js/client auth state.',
    "import omega from '@omega.js/desktop/renderer';",
    '',
    'window.__omegaAuthE2E = omega;',
    'omega.initialize();',
    '',
  ].join('\n'));
}

// The boot-layer tests, run INSIDE the spawned Electron app. Their run bodies
// are serialized to the child: no closures over this file, and the one parameter
// is `ctx`. `require`, `process`, and `Buffer` are injected; everything else
// arrives on process.env (set by the last case, inherited by the spawn).

const bootSpec = {
  type: 'group',
  layer: 'boot',
  description: 'desktop auth e2e',
  tests: [
    {
      name: 'main-process auth is live on the emulator, not yet the persona',
      timeout: 30000,
      run: async (ctx) => {
        const { omega, expect } = ctx;
        expect(omega._initialized).toBe(true);
        // Firebase actually loaded (an empty cloud.config leaves auth in no-op
        // mode, which would make every assertion below vacuous).
        expect(Boolean(omega.auth._firebaseAuth)).toBe(true);
        expect(omega.isTesting()).toBe(true);
        const current = omega.auth._firebaseAuth.currentUser;
        expect(current?.uid === process.env.OMEGA_E2E_UID).toBe(false);
      },
    },

    {
      name: 'a REAL second instance delivers the deep link; main signs in as the persona',
      timeout: 150000,
      run: async (ctx) => {
        const { omega, expect, appRoot } = ctx;
        const { spawn } = require('child_process');

        const url = `${process.env.OMEGA_E2E_SCHEME}://auth/token?authToken=${process.env.OMEGA_E2E_TOKEN}`;

        // Observe the dispatch without claiming it: a consumer handler runs BEFORE
        // the built-in and, leaving ctx.handled false, lets the built-in do the
        // real work. This is how we know the token arrived through the pipeline.
        global.__omega_e2e_dispatch = null;
        omega.deepLink.on('auth/token', (ctx) => {
          global.__omega_e2e_dispatch = { source: ctx.source, url: ctx.url, hasToken: Boolean(ctx.query?.authToken) };
        });

        // The OS single-instance lock forwards this argv to US (second-instance).
        // The duplicate quits itself the moment it loses the lock.
        const env = Object.assign({}, process.env);
        delete env.OMEGA_TEST_BOOT;
        delete env.OMEGA_TEST_BOOT_HARNESS;
        delete env.OMEGA_TEST_BOOT_SPEC;
        // Same scrub runners/boot.js does at its own spawn: with this set, the
        // duplicate boots as plain node, `electron.app` is undefined, and it dies
        // before it can hand us its argv.
        delete env.ELECTRON_RUN_AS_NODE;
        // A testing run wipes its userData at boot, and Electron's
        // single-instance lock LIVES there. Without this the duplicate deletes our
        // lock, wins one of its own, and no argv is ever forwarded.
        env.OMEGA_TEST_KEEP_USERDATA = '1';
        const log = require('fs').openSync(process.env.OMEGA_E2E_SECOND_INSTANCE_LOG, 'w');
        // The duplicate must boot the SAME app the primary booted: the staged
        // test root, not the project root, whose dist/ is gone by then.
        const child = spawn(process.env.OMEGA_E2E_ELECTRON_BIN, [appRoot, url], {
          cwd: appRoot,
          env,
          stdio: ['ignore', log, log],
        });
        const exited = new Promise((resolve) => child.on('exit', resolve));

        let user = null;
        for (let i = 0; i < 120; i++) {
          // Main's own Firebase session: `omega.auth.user` builds from the account a
          // renderer pushes, which needs the Firestore read this lane does not stage
          user = omega.auth._firebaseAuth.currentUser;
          if (user?.uid === process.env.OMEGA_E2E_UID) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 15000))]);
        // If forwarding is broken the duplicate never loses the lock and never
        // quits on its own: reap it so a failing run leaves no orphan Electron.
        if (child.exitCode === null) child.kill('SIGKILL');

        const dispatch = global.__omega_e2e_dispatch;
        expect(Boolean(dispatch)).toBe(true);
        expect(dispatch.source).toBe('warm-start');
        expect(dispatch.hasToken).toBe(true);
        expect(user?.uid).toBe(process.env.OMEGA_E2E_UID);
        expect(user?.email).toBe(process.env.OMEGA_E2E_EMAIL);
      },
    },

    {
      name: 'the renderer reflects the same persona (own Firebase + main over IPC)',
      timeout: 90000,
      run: async (ctx) => {
        const { omega, expect } = ctx;
        const { BrowserWindow } = require('electron');

        const win = omega.windows.get('main') || BrowserWindow.getAllWindows()[0];
        expect(Boolean(win && !win.isDestroyed())).toBe(true);

        // The renderer learned about the sign-in ONLY through the real
        // desktop:auth:sign-in-with-token broadcast; nothing pushes it here.
        const read = () => win.webContents.executeJavaScript(`(async () => {
          const instance = window.__omegaAuthE2E;
          const rendererUid = instance?.firebaseAuth?.currentUser?.uid || null;
          const mainUser = await window.desktop.ipc.invoke('desktop:auth:get-user').catch(() => null);
          return { rendererUid, mainUid: mainUser?.uid || null };
        })()`).catch(() => null);

        let state = null;
        for (let i = 0; i < 120; i++) {
          state = await read();
          if (state?.rendererUid === process.env.OMEGA_E2E_UID) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        expect(state?.rendererUid).toBe(process.env.OMEGA_E2E_UID);
        expect(state?.mainUid).toBe(process.env.OMEGA_E2E_UID);
      },
    },

    {
      name: 'a sign-out ends main\'s session and the renderer follows the broadcast',
      timeout: 60000,
      run: async (ctx) => {
        const { omega, expect } = ctx;
        const { BrowserWindow } = require('electron');

        const win = omega.windows.get('main') || BrowserWindow.getAllWindows()[0];
        const readRendererUid = () => win.webContents.executeJavaScript(
          '(window.__omegaAuthE2E?.firebaseAuth?.currentUser?.uid || null)',
        ).catch(() => 'unreadable');

        // Both sides start on the persona, so the sign-out below cannot pass vacuously
        expect(omega.auth._firebaseAuth.currentUser?.uid).toBe(process.env.OMEGA_E2E_UID);
        expect(await readRendererUid()).toBe(process.env.OMEGA_E2E_UID);

        const result = await omega.auth.signOut();
        expect(result.success).toBe(true);
        expect(omega.auth._firebaseAuth.currentUser).toBeNull();
        expect(omega.auth.user.authenticated).toBe(false);

        // The renderer signs out ONLY on the desktop:auth:sign-out broadcast
        let rendererUid = await readRendererUid();
        for (let i = 0; i < 60 && rendererUid !== null; i++) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          rendererUid = await readRendererUid();
        }
        expect(rendererUid).toBeNull();
      },
    },
  ],
};

module.exports = defineCases({
  type: 'suite',
  description: 'desktop auth e2e (real Electron app, real deep link, main + renderer)',
  timeout: 300000,

  setup(ctx) {
    if (process.env.OMEGA_SKIP_E2E === '1') ctx.skip('OMEGA_SKIP_E2E=1');

    let electronBin = null;
    try {
      electronBin = require(require.resolve('electron', { paths: [DESKTOP] }));
      if (!electronBin || !fs.existsSync(electronBin)) {
        throw new Error(`the electron binary is not installed at ${electronBin}`);
      }
    } catch (error) {
      ctx.skip(`${error.message} (install it with \`npm install\` at the monorepo root)`);
    }

    const bootRunnerPath = path.join(DESKTOP_DIST, 'test', 'runners', 'boot.js');
    if (!fs.existsSync(bootRunnerPath)) {
      ctx.skip(`@omega.js/desktop has no dist at ${path.relative(ROOT, DESKTOP_DIST)} (build it with \`npm run prepare -w @omega.js/desktop\`)`);
    }

    ctx.state.electronBin = electronBin;
    ctx.state.bootDriver = require(bootRunnerPath).bootDriver;
    ctx.state.suite = normalizeSpec(bootSpec, { file: __filename });
  },

  async cleanup(ctx) {
    await stopPlaygroundEmulator(ctx.state.emulator);
  },

  tests: [
    {
      name: 'playground emulator boots (auth, functions, hosting) and seeds its personas',
      run: async (ctx) => {
        // --no-https: the app resolves its API base from the OMEGA_*_PORT env channel
        // and speaks plain http to the hosting emulator; an mkcert-fronted stack would
        // move plain hosting off the port the child was told about.
        const { child, ports } = await startPlaygroundEmulator({ logDir: LOG_DIR, args: ['--no-https'] });
        ctx.state.emulator = child;
        ctx.state.ports = ports;
        console.log(`    hosting :${ports.hosting}, auth :${ports.auth}`);
      },
    },

    {
      name: 'the roster\'s persona signs in with the test password and the backend mints its custom token',
      run: async (ctx) => {
        const { ports } = ctx.state;
        ctx.state.projectId = playgroundProjectId();

        const signIn = await mintPersonaToken({
          apiBase: `http://127.0.0.1:${ports.hosting}`,
          authPort: ports.auth,
          firebaseConfig: { apiKey: API_KEY, projectId: ctx.state.projectId },
          localpart: PERSONA_LOCALPART,
        });
        ctx.state.signIn = signIn;
        console.log(`    ${signIn.email}, uid ${signIn.uid}`);
      },
    },

    {
      name: 'a consumer app is staged from the bundled fixture',
      run: (ctx) => {
        stageApp({ projectId: ctx.state.projectId, apiKey: API_KEY, ports: ctx.state.ports });
        console.log(`    ${path.relative(ROOT, APP_DIR)}`);
      },
    },

    {
      name: 'the app builds + boots in a REAL Electron process, the deep link signs it in, and a sign-out reaches the renderer',
      timeout: BUILD_BUDGET + bootSpec.tests.reduce((sum, caseDef) => sum + caseDef.timeout, 0) + MARGIN,
      run: async (ctx) => {
        const { ports, signIn, electronBin, bootDriver, suite } = ctx.state;
        // Everything the spawned Electron app needs: the boot runner passes
        // process.env straight through to the child.
        Object.assign(process.env, {
          OMEGA_TEST_BOOT_PROJECT:  APP_DIR,
          OMEGA_HOSTING_PORT:       String(ports.hosting),
          OMEGA_AUTH_PORT:          String(ports.auth),
          OMEGA_FUNCTIONS_PORT:     String(ports.functions),
          OMEGA_E2E_SCHEME:         BRAND_ID,
          OMEGA_E2E_TOKEN:          signIn.token,
          OMEGA_E2E_UID:            signIn.uid,
          OMEGA_E2E_EMAIL:          signIn.email,
          OMEGA_E2E_ELECTRON_BIN:   electronBin,
          OMEGA_E2E_SECOND_INSTANCE_LOG: path.join(LOG_DIR, 'second-instance.log'),
        });
        delete process.env.OMEGA_HTTPS_PORT;

        const events = [];
        // Stopped once the case settles, a timeout included, so the app never outlives it.
        let handle = null;
        ctx.after(() => handle && handle.stop());
        handle = await bootDriver.start({ projectRoot: APP_DIR, suites: [suite], report: (event) => events.push(event) });
        await handle.finished;
        const failed = suite.cases
          .map((caseDef) => ({ caseDef, event: events.find((event) => event.id === caseDef.id) }))
          .filter(({ event }) => !event || event.status !== 'pass')
          .map(({ caseDef, event }) => `"${caseDef.name}": ${!event ? 'never reported' : (event.error?.message || event.reason || event.status)}`);
        if (failed.length > 0) {
          throw new Error(`boot layer: ${failed.length} of ${suite.cases.length} failed: ${failed.join('; ')} (logs: ${path.relative(ROOT, LOG_DIR)}/, staged app: ${path.relative(ROOT, APP_DIR)})`);
        }
        console.log(`    ${suite.cases.length} boot assertions`);
      },
    },
  ],
});
