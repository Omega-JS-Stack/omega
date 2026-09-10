// Build-layer tests for the Windows signer. signtool only exists on Windows, so
// what we prove here is everything AROUND it: the exact command line each cert
// mode produces, which env keys are read, and the retry policy on the sign call.

const path = require('path');
const fs = require('fs');
const defineCases = require('@omega.js/devkit/test/define-cases');

const signWindows = require(path.join(__dirname, '..', '..', '..', 'commands', 'sign-windows.js'));

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'sign-windows — signtool command construction + retry policy',
  tests: [
    {
      name: 'this suite can never sign for real: every signWithRetry call injects its exec',
      run: (ctx) => {
        // The box runs this lane too. `signWithRetry` shells out to signtool by
        // DEFAULT, so a case that forgets `exec:` would drive the real EV token
        // (and its PIN retries) on the signing box — the deliberate signing
        // lives in sign-windows-e2e.test.js, gated. This pins the invariant.
        const fs = require('fs');
        const source = fs.readFileSync(__filename, 'utf8');
        // The needle is assembled so this case's own text is not one of its hits.
        const calls = source.split(`signWithRetry${'('}`).slice(1);
        ctx.expect(calls.length).toBeGreaterThan(0);
        for (const call of calls) {
          const body = call.slice(0, call.indexOf('});'));
          if (!body.includes('exec:')) {
            throw new Error(`a signWithRetry call in this suite does not inject exec — it would run the real signtool:\n${body.slice(0, 200)}`);
          }
        }
      },
    },
    {
      name: 'the box log is never written from a test run unless its home is a scratch',
      run: async (ctx) => {
        // `sign-windows` tees to `<runner home>/logs/runner.log`. On the box that
        // IS the file to write; from a test process pointed at a real home it is
        // the box's own record, and a test may not touch it — so the tee target
        // resolves to null and nothing attaches.
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const signer = require(path.join(__dirname, '..', '..', '..', 'commands', 'sign-windows.js'));

        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-sign-home-'));
        const realish = path.join(os.homedir(), `omega-runner-fake-${process.pid}`);
        const origHome   = process.env.OMEGA_RUNNER_HOME;
        const origMarker = process.env.OMEGA_TEST_RUNNER;
        try {
          // Pure half: the decision, with the home coming from the passed env and
          // the "is this a test" answer coming from process.env, always.
          process.env.OMEGA_TEST_RUNNER = '1';
          ctx.expect(signer.boxLogTarget({ OMEGA_RUNNER_HOME: scratch }, 'darwin')).toBe(path.join(scratch, 'logs', 'runner.log'));
          ctx.expect(signer.boxLogTarget({ OMEGA_RUNNER_HOME: realish }, 'darwin')).toBeNull();
          ctx.expect(signer.boxLogTarget({}, 'darwin')).toBeNull();                    // no box home off Windows
          delete process.env.OMEGA_TEST_RUNNER;
          ctx.expect(signer.boxLogTarget({ OMEGA_RUNNER_HOME: realish }, 'darwin')).toBe(path.join(realish, 'logs', 'runner.log'));
          process.env.OMEGA_TEST_MODE = 'true';                                        // the devkit/boot marker counts too
          ctx.expect(signer.boxLogTarget({ OMEGA_RUNNER_HOME: realish }, 'darwin')).toBeNull();
          delete process.env.OMEGA_TEST_MODE;

          // And the command itself: pointed at a real home from a test run, it
          // leaves no runner.log behind (it refuses --smoke off Windows).
          process.env.OMEGA_TEST_RUNNER = '1';
          process.env.OMEGA_RUNNER_HOME = realish;
          let threw;
          try {
            await signer({ smoke: true });
          } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();
          ctx.expect(jetpack.exists(path.join(realish, 'logs', 'runner.log'))).toBe(false);
        } finally {
          if (origHome === undefined) delete process.env.OMEGA_RUNNER_HOME; else process.env.OMEGA_RUNNER_HOME = origHome;
          if (origMarker === undefined) delete process.env.OMEGA_TEST_RUNNER; else process.env.OMEGA_TEST_RUNNER = origMarker;
          jetpack.remove(scratch);
          jetpack.remove(realish);
        }
      },
    },
    {
      name: 'a 40-hex value is a thumbprint, a path is not',
      run: (ctx) => {
        ctx.expect(signWindows.isThumbprint('a'.repeat(40))).toBe(true);
        ctx.expect(signWindows.isThumbprint(`AB CD ${'e'.repeat(36)}`)).toBe(true);   // signtool copy/paste spacing
        ctx.expect(signWindows.isThumbprint('C:\\certs\\ev.pfx')).toBe(false);
        ctx.expect(signWindows.isThumbprint('')).toBe(false);
        ctx.expect(signWindows.isThumbprint(undefined)).toBe(false);
      },
    },
    {
      name: 'thumbprint mode signs with /sha1 and never puts the PIN on the command line',
      run: (ctx) => {
        const cmd = signWindows.buildSignCommand({
          signtool:     'C:\\sdk\\signtool.exe',
          tokenRef:     `AA BB ${'c'.repeat(36)}`,
          password:     'hunter2',
          timestampUrl: 'http://timestamp.sectigo.com',
          outPath:      'C:\\out\\App Setup.exe',
        });

        ctx.expect(cmd).toBe(`"C:\\sdk\\signtool.exe" sign /sha1 AABB${'c'.repeat(36)}`
          + ' /tr "http://timestamp.sectigo.com" /td sha256 /fd sha256 "C:\\out\\App Setup.exe" 2>&1');
        // SafeNet holds the PIN in thumbprint mode — it must never reach argv.
        ctx.expect(cmd).not.toContain('hunter2');
      },
    },
    {
      name: 'pfx mode signs with /f + /p',
      run: (ctx) => {
        const cmd = signWindows.buildSignCommand({
          signtool:     'signtool',
          tokenRef:     'C:\\certs\\ev.pfx',
          password:     'hunter2',
          timestampUrl: 'http://timestamp.digicert.com',
          outPath:      'C:\\out\\App.exe',
        });

        ctx.expect(cmd).toBe('"signtool" sign /f "C:\\certs\\ev.pfx" /p "hunter2"'
          + ' /tr "http://timestamp.digicert.com" /td sha256 /fd sha256 "C:\\out\\App.exe" 2>&1');
      },
    },
    {
      name: 'the sign command redirects stderr into stdout so the classifier sees signtool text',
      run: (ctx) => {
        // signtool writes its diagnosis to stderr; execute() surfaces whichever
        // stream it captured. Without 2>&1 a wrong PIN can arrive as a bare exit
        // code, which the classifier reads as transient and retries.
        const cmd = signWindows.buildSignCommand({
          signtool: 'signtool', tokenRef: 'f'.repeat(40), timestampUrl: 'http://ts', outPath: 'C:\\out\\App.exe',
        });
        ctx.expect(cmd.endsWith(' 2>&1')).toBe(true);
        // verify parses its own output and stays untouched.
        ctx.expect(signWindows.buildVerifyCommand({ signtool: 'signtool', outPath: 'C:\\out\\App.exe' }))
          .not.toContain('2>&1');
      },
    },
    {
      name: 'verify is one shape, /pa, single-shot',
      run: (ctx) => {
        ctx.expect(signWindows.buildVerifyCommand({ signtool: 'signtool', outPath: 'C:\\out\\App.exe' }))
          .toBe('"signtool" verify /pa "C:\\out\\App.exe"');
      },
    },
    {
      name: 'WIN_EV_TOKEN_PATH is the ONE cert-reference key — WIN_CSC_LINK is not read',
      run: (ctx) => {
        let threw;
        try {
          signWindows.resolveSigntoolEnv({ WIN_CSC_LINK: 'C:\\certs\\ev.pfx', WIN_CSC_KEY_PASSWORD: 'hunter2' });
        } catch (e) { threw = e; }

        ctx.expect(threw).toBeDefined();
        ctx.expect(threw.message).toMatch(/WIN_EV_TOKEN_PATH/);
        ctx.expect(threw.message).not.toMatch(/WIN_CSC_LINK/);
      },
    },
    {
      name: 'signtool path + timestamp url come from env with documented defaults',
      run: (ctx) => {
        const bare = signWindows.resolveSigntoolEnv({ WIN_EV_TOKEN_PATH: 'f'.repeat(40) });
        ctx.expect(bare.signtool).toBe('signtool');
        ctx.expect(bare.timestampUrl).toBe('http://timestamp.sectigo.com');
        ctx.expect(bare.useThumbprint).toBe(true);

        const set = signWindows.resolveSigntoolEnv({
          WIN_EV_TOKEN_PATH: 'f'.repeat(40),
          SIGNTOOL_PATH:     'C:\\sdk\\signtool.exe',
          WIN_TIMESTAMP_URL: 'http://timestamp.digicert.com',
        });
        ctx.expect(set.signtool).toBe('C:\\sdk\\signtool.exe');
        ctx.expect(set.timestampUrl).toBe('http://timestamp.digicert.com');
      },
    },
    {
      name: 'a .pfx without WIN_CSC_KEY_PASSWORD refuses; a thumbprint without one is fine',
      run: (ctx) => {
        let threw;
        try {
          signWindows.resolveSigntoolEnv({ WIN_EV_TOKEN_PATH: 'C:\\certs\\ev.pfx' });
        } catch (e) { threw = e; }
        ctx.expect(threw).toBeDefined();
        ctx.expect(threw.message).toMatch(/WIN_CSC_KEY_PASSWORD/);

        // Thumbprint mode: SafeNet owns the PIN, so no password is required here.
        ctx.expect(signWindows.resolveSigntoolEnv({ WIN_EV_TOKEN_PATH: 'f'.repeat(40) }).password).toBe(undefined);
      },
    },
    {
      name: 'a timestamp-server failure is retried three times, then throws',
      run: async (ctx) => {
        const events = [];
        const slept  = [];
        let calls = 0;

        let threw;
        try {
          await signWindows.signWithRetry('signtool sign ...', {
            file:  'App.exe',
            exec:  () => { calls += 1; throw new Error('SignTool Error: The timestamp signature could not be verified'); },
            sleep: (ms) => { slept.push(ms); return Promise.resolve(); },
            emit:  (event, data) => events.push({ event, ...data }),
          });
        } catch (e) { threw = e; }

        ctx.expect(calls).toBe(3);
        ctx.expect(threw.message).toMatch(/timestamp signature/);
        // Two backoffs between three attempts, and every attempt on the event log.
        ctx.expect(slept.length).toBe(2);
        ctx.expect(slept.every((ms) => ms > 0)).toBe(true);
        ctx.expect(events.filter((e) => e.event === 'sign-attempt').map((e) => e.attempt)).toEqual([1, 2, 3]);
        ctx.expect(events.filter((e) => e.event === 'sign-retry').length).toBe(2);
      },
    },
    {
      name: 'the first attempt succeeding is the only attempt',
      run: async (ctx) => {
        const events = [];
        let calls = 0;

        await signWindows.signWithRetry('signtool sign ...', {
          file:  'App.exe',
          exec:  () => { calls += 1; return Promise.resolve('Successfully signed'); },
          sleep: () => { throw new Error('should not back off on success'); },
          emit:  (event, data) => events.push({ event, ...data }),
        });

        ctx.expect(calls).toBe(1);
        ctx.expect(events.map((e) => e.event)).toEqual(['sign-attempt']);
      },
    },
    {
      name: 'a wrong PIN or a missing cert stops after ONE attempt (never walk the token to a lockout)',
      run: async (ctx) => {
        for (const message of [
          'SignTool Error: The specified network password is not correct.',
          'SignTool Error: No certificates were found that met all the given criteria.',
        ]) {
          const events = [];
          let calls = 0;
          let threw;
          try {
            await signWindows.signWithRetry('signtool sign ...', {
              file:  'App.exe',
              exec:  () => { calls += 1; throw new Error(message); },
              sleep: () => { throw new Error('should not back off on a non-transient failure'); },
              emit:  (event, data) => events.push({ event, ...data }),
            });
          } catch (e) { threw = e; }

          ctx.expect(calls).toBe(1);
          ctx.expect(threw.message).toBe(message);
          ctx.expect(events.filter((e) => e.event === 'sign-retry').length).toBe(0);
        }
      },
    },
    {
      name: 'every signtool attempt gets its OWN SafeNet PIN watcher, stopped after it',
      run: async (ctx) => {
        // The SafeNet Token Logon dialog reappears on EVERY signtool call, and
        // the watcher returns once it has typed. One watcher around the whole
        // retry loop leaves attempts 2 and 3 facing the dialog unattended.
        const watchers = [];

        let threw;
        try {
          await signWindows.signWithRetry('signtool sign ...', {
            file:  'App.exe',
            exec:  () => { throw new Error('SignTool Error: The timestamp signature could not be verified'); },
            sleep: () => Promise.resolve(),
            emit:  () => {},
            startUnlock: () => {
              const watcher = { stopped: false };
              watchers.push(watcher);
              return { stop: () => { watcher.stopped = true; } };
            },
          });
        } catch (e) { threw = e; }

        ctx.expect(threw).toBeDefined();
        ctx.expect(watchers.length).toBe(3);
        ctx.expect(watchers.every((w) => w.stopped)).toBe(true);
      },
    },
    {
      name: 'the PIN watcher is stopped before the backoff, not held across it',
      run: async (ctx) => {
        const events = [];
        let live = 0;

        await signWindows.signWithRetry('signtool sign ...', {
          file:  'App.exe',
          exec:  () => { events.push(`exec(live=${live})`); return Promise.resolve('ok'); },
          sleep: () => Promise.resolve(),
          emit:  () => {},
          startUnlock: () => { live += 1; return { stop: () => { live -= 1; } }; },
        });

        ctx.expect(events).toEqual(['exec(live=1)']);
        ctx.expect(live).toBe(0);
      },
    },
    {
      name: 'a failure signtool does not name is treated as transient',
      run: (ctx) => {
        ctx.expect(signWindows.isTransientSignFailure(new Error('exit status 1'))).toBe(true);
        ctx.expect(signWindows.isTransientSignFailure(new Error('SignTool Error: No certificates were found'))).toBe(false);
        ctx.expect(signWindows.isTransientSignFailure(new Error('The specified network password is not correct'))).toBe(false);
      },
    },
    {
      name: 'a terminated attempt reads as transient, so the next one gets a fresh PIN watcher',
      run: async (ctx) => {
        // The wording is execWithLimit's (exec-with-limit.test.js proves the
        // mechanism); here it only matters that nothing classifies it as final.
        const limitError = new Error('signtool produced no verdict within 180s and was terminated');
        ctx.expect(signWindows.isTransientSignFailure(limitError)).toBe(true);
        ctx.expect(signWindows.SIGN_TIME_LIMIT_MS).toBe(3 * 60 * 1000);

        let watchers = 0;
        let calls = 0;
        let threw;
        try {
          await signWindows.signWithRetry('signtool sign ...', {
            file:  'App.exe',
            exec:  () => { calls += 1; throw limitError; },
            sleep: () => Promise.resolve(),
            emit:  () => {},
            startUnlock: () => { watchers += 1; return { stop: () => {} }; },
          });
        } catch (e) { threw = e; }

        ctx.expect(calls).toBe(3);
        ctx.expect(watchers).toBe(3);
        ctx.expect(threw.message).toMatch(/no verdict within 180s/);
      },
    },
  ],
});
