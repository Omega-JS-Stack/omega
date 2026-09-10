// Build-layer tests for the runner command. Most behavior is platform-gated to Windows;
// what we can verify on Mac is: module shape, error paths for non-Windows, error messages
// for missing GH_TOKEN, subcommand dispatch.
//
// ⚠ THE SUITE MAY NEVER ACT ON A REAL BOX.
// 2026-09-04, on the signing box: two cases called `runner install` with no home
// of their own. RUNNER_HOME is resolved when runner.js is REQUIRED, so it was
// the box's own `%LOCALAPPDATA%\omega-runner`; the config walk read the saved
// GH_TOKEN back out of that home's `.env` after the case deleted it from the
// environment, a blank OMEGA_RUNNER_ORGS off a TTY means every admin org, and
// the lane tore the box's runner down and registered 34 orgs for real.
//
// So the redirect happens HERE, at the top of the file, before any require of
// runner.js can freeze the wrong home — and `OMEGA_TEST_RUNNER` arms the
// production refusal in utils/runner-env.js, which catches the same mistake in
// any suite that forgets this. The guard case below pins both.

const path = require('path');
const fs   = require('fs');
const defineCases = require('@omega.js/devkit/test/define-cases');

// <packages/desktop>/.temp/runner-home-<pid> — fresh per run, never a real home.
const SCRATCH_HOME = path.join(__dirname, '..', '..', '..', '..', '.temp', `runner-home-${process.pid}`);
fs.rmSync(SCRATCH_HOME, { recursive: true, force: true });
fs.mkdirSync(SCRATCH_HOME, { recursive: true });
process.env.OMEGA_RUNNER_HOME = SCRATCH_HOME;
// The Startup folder is the second machine-wide surface, and no home scopes it:
// `uninstall` sweeps every `omega-runner-*.cmd` in it. Same redirect, same
// reason, and the guard refuses every mutating verb on the box without it.
const SCRATCH_STARTUP_DIR = path.join(__dirname, '..', '..', '..', '..', '.temp', `runner-startup-${process.pid}`);
fs.rmSync(SCRATCH_STARTUP_DIR, { recursive: true, force: true });
fs.mkdirSync(SCRATCH_STARTUP_DIR, { recursive: true });
process.env.OMEGA_RUNNER_STARTUP_DIR = SCRATCH_STARTUP_DIR;
process.env.OMEGA_TEST_RUNNER = '1';

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'runner command — Windows EV-token signing runner',
  tests: [
    {
      name: 'the suite can never touch a real box: RUNNER_HOME is a scratch under .temp',
      run: (ctx) => {
        // If this fails, STOP: every mutating case below would act on the home
        // it names. Nothing here asserts a value the module computed for itself
        // — the point is that the redirect above won the race with the require.
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        ctx.expect(runner.RUNNER_HOME).toBe(SCRATCH_HOME);
        ctx.expect(runner.RUNNER_HOME.split(path.sep)).toContain('.temp');

        // The Startup folder froze at require time the same way, and it is the
        // surface no home scopes — an unpinned one is the box's own.
        ctx.expect(runner.STARTUP_DIR).toBe(SCRATCH_STARTUP_DIR);
        ctx.expect(runner.STARTUP_DIR.split(path.sep)).toContain('.temp');

        // …and it is not the box's own home, by any of the names that home has.
        ctx.expect(runner.RUNNER_HOME).not.toBe(runner.defaultRunnerHome('win32', { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }));
        ctx.expect(runner.RUNNER_HOME).not.toBe(runner.defaultRunnerHome('darwin', {}));
        for (const real of [process.env.LOCALAPPDATA, process.env.APPDATA].filter(Boolean)) {
          ctx.expect(runner.RUNNER_HOME.startsWith(real)).toBe(false);
        }
      },
    },
    {
      name: 'a test process is REFUSED against a home that is not a scratch — every mutating verb, whichever home is real',
      run: async (ctx) => {
        // The backstop for the suite that forgets the redirect above: with a
        // test marker set, the mutating verbs will not touch a real home at all.
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));
        const runnerEnv = require(path.join(__dirname, '..', '..', '..', 'utils', 'runner-env.js'));

        const realish = path.join(os.homedir(), 'omega-runner-NOT-A-SCRATCH');
        const origForce = process.env.OMEGA_RUNNER_FORCE;
        process.env.OMEGA_RUNNER_FORCE = '1';                       // the platform gate must not be what saves us
        jetpack.remove(realish);                                    // a RED run of this case is what would create it
        try {
          // Every verb that CHANGES the machine — stop kills real listeners under
          // the home, self-update runs a global npm install.
          for (const sub of ['install', 'config', 'register-org', 'start', 'restart', 'stop', 'uninstall', 'self-update']) {
            let threw;
            try {
              // `_env: {}` is a fixture for the config walk. It is NOT an answer
              // to "am I a test process" — that comes from process.env, always,
              // or a case could hand the guard an empty object and disarm it.
              await runner({ _: ['runner', sub, 'some-org'], _home: realish, _env: {}, _interactive: false });
            } catch (e) { threw = e; }
            ctx.expect(threw).toBeDefined();
            ctx.expect(threw.message).toContain('OMEGA_TEST_RUNNER');   // names the variable
            ctx.expect(threw.message).toContain(realish);
          }
          ctx.expect(jetpack.exists(realish)).toBe(false);            // nothing was created

          // Read-only verbs are not the danger and stay usable.
          ctx.expect(runner.isScratchRunnerHome(SCRATCH_HOME)).toBe(true);
          ctx.expect(runner.isScratchRunnerHome(realish)).toBe(false);
          ctx.expect(runner.isScratchRunnerHome(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-')))).toBe(true);

          // BOTH homes are checked, and the refusal names the one that is real:
          // the module-level RUNNER_HOME is the home whose `.env` was already
          // read into this process at require time.
          let threw;
          try {
            runnerEnv.assertTestSafeRunnerHome('install', SCRATCH_HOME, realish);
          } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toContain(realish);
          ctx.expect(threw.message).not.toContain(SCRATCH_HOME);
          runnerEnv.assertTestSafeRunnerHome('install', SCRATCH_HOME, SCRATCH_HOME);   // both scratch: allowed
        } finally {
          if (origForce === undefined) delete process.env.OMEGA_RUNNER_FORCE; else process.env.OMEGA_RUNNER_FORCE = origForce;
          jetpack.remove(realish);
        }
      },
    },
    {
      name: 'a real module-level RUNNER_HOME refuses even when the call passes a scratch _home',
      run: (ctx) => {
        // RUNNER_HOME is frozen when the module is required, so this one needs
        // its own process: the box's shape exactly — a real home in the
        // environment, a test marker, and a caller that thinks `_home` saves it.
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const { spawnSync } = require('child_process');

        const fakeProfile = path.join(os.homedir(), `omega-runner-fake-profile-${process.pid}`);
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const commandPath = path.join(__dirname, '..', '..', '..', 'commands', 'runner.js');
        try {
          const script = [
            `const runner = require(${JSON.stringify(commandPath)});`,
            `runner({ _: ['runner', 'install'], _home: ${JSON.stringify(scratch)}, _interactive: false })`,
            `  .then(() => process.stdout.write('RAN'))`,
            `  .catch((e) => process.stdout.write(e.message));`,
          ].join('\n');
          const out = spawnSync(process.execPath, ['-e', script], {
            encoding: 'utf8',
            env: {
              ...process.env,
              OMEGA_RUNNER_HOME:  fakeProfile,     // what the box has: a real home
              OMEGA_TEST_RUNNER:  '1',
              OMEGA_RUNNER_FORCE: '1',             // the platform gate must not be what saves us
            },
          });

          ctx.expect(out.stdout).toContain('OMEGA_TEST_RUNNER');
          ctx.expect(out.stdout).toContain(fakeProfile);
          ctx.expect(out.stdout.includes('RAN')).toBe(false);
          ctx.expect(jetpack.exists(fakeProfile)).toBe(false);
          ctx.expect(jetpack.list(scratch) || []).toEqual([]);      // and the scratch was not installed into either
        } finally {
          jetpack.remove(fakeProfile);
          jetpack.remove(scratch);
        }
      },
    },
    {
      name: '`status` reports the home the call passed, never the module-level RUNNER_HOME',
      run: (ctx) => {
        // `_home` is the whole redirect: a suite that points it at a scratch must
        // get a scratch, whatever home the module froze at require time. Two homes,
        // both real on disk, and only B's contents may show up in the output.
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const { spawnSync } = require('child_process');

        const homeA = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-a-'));
        const homeB = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-b-'));
        const commandPath = path.join(__dirname, '..', '..', '..', 'commands', 'runner.js');
        try {
          jetpack.write(path.join(homeA, 'config.json'), { registeredOrgs: ['org-in-a'] });
          jetpack.write(path.join(homeB, 'config.json'), { registeredOrgs: ['org-in-b'] });

          const script = [
            `const runner = require(${JSON.stringify(commandPath)});`,
            `runner({ _: ['runner', 'status'], _home: ${JSON.stringify(homeB)}, _interactive: false })`,
            `  .then(() => process.stdout.write('\\nRAN'))`,
            `  .catch((e) => process.stdout.write('\\nTHREW ' + e.message));`,
          ].join('\n');
          const out = spawnSync(process.execPath, ['-e', script], {
            encoding: 'utf8',
            env: {
              ...process.env,
              OMEGA_RUNNER_HOME:  homeA,           // the home the module freezes
              OMEGA_TEST_RUNNER:  '1',
              OMEGA_RUNNER_FORCE: '1',             // status is Windows-only otherwise
            },
          });

          ctx.expect(out.stdout).toContain('RAN');
          ctx.expect(out.stdout).toContain(`omega-runner home: ${homeB}`);
          ctx.expect(out.stdout).toContain(`Log: ${path.join(homeB, 'logs', 'runner.log')}`);
          ctx.expect(out.stdout).toContain('org-in-b');            // B's install record
          ctx.expect(out.stdout.includes(homeA)).toBe(false);      // and not one word about A
          ctx.expect(out.stdout.includes('org-in-a')).toBe(false);
        } finally {
          jetpack.remove(homeA);
          jetpack.remove(homeB);
        }
      },
    },
    {
      name: '`uninstall` tears down the home the call passed, leaving the module-level one whole',
      run: (ctx) => {
        // The destructive half of the same contract. Neither org dir carries a
        // config.cmd, so the deregistration roster is empty and nothing reaches
        // GitHub — what is left to prove is which home lost its tree.
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const { spawnSync } = require('child_process');

        const homeA = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-a-'));
        const homeB = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-b-'));
        // The Startup folder is machine-wide — NEITHER home scopes it. Round 4
        // ran this case on the box without a seam here and `uninstall` deleted
        // the box's three real shortcuts. It gets a scratch of its own now, and
        // the sweep may only ever reach into that.
        const startupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-startup-'));
        const host = os.hostname().toLowerCase();
        const commandPath = path.join(__dirname, '..', '..', '..', 'commands', 'runner.js');
        try {
          jetpack.write(path.join(homeA, 'config.json'), { registeredOrgs: ['org-in-a'] });
          jetpack.dir(path.join(homeA, 'actions-runner-org-in-a'));
          jetpack.write(path.join(homeB, 'config.json'), { registeredOrgs: ['org-in-b'] });
          jetpack.dir(path.join(homeB, 'actions-runner-org-in-b'));
          // Both, whichever home they read as: the sweep takes every
          // `omega-runner-*` in the folder it is given, which is the contract.
          jetpack.write(path.join(startupDir, `omega-runner-${host}-org-in-b.cmd`), '@echo off\r\n');
          jetpack.write(path.join(startupDir, `omega-runner-${host}-org-in-a.cmd`), '@echo off\r\n');

          const script = [
            `const runner = require(${JSON.stringify(commandPath)});`,
            `runner({ _: ['runner', 'uninstall'], _home: ${JSON.stringify(homeB)}, _interactive: false })`,
            `  .then(() => process.stdout.write('\\nRAN'))`,
            `  .catch((e) => process.stdout.write('\\nTHREW ' + e.message));`,
          ].join('\n');
          const out = spawnSync(process.execPath, ['-e', script], {
            encoding: 'utf8',
            env: {
              ...process.env,
              OMEGA_RUNNER_HOME:         homeA,
              OMEGA_RUNNER_STARTUP_DIR:  startupDir,
              OMEGA_TEST_RUNNER:         '1',
              OMEGA_RUNNER_FORCE:        '1',
            },
          });

          ctx.expect(out.stdout).toContain('RAN');
          // B lost its install; only the logs dir the run's own tee wrote survives.
          ctx.expect(jetpack.list(homeB)).toEqual(['logs']);
          // A was never touched.
          ctx.expect(jetpack.list(homeA).sort()).toEqual(['actions-runner-org-in-a', 'config.json']);
          // The sweep reached the scratch and nothing else. `removeRunnerStartupShortcut`
          // keeps its win32 early return, so off Windows the shortcuts survive —
          // what the seam proves on every platform is WHICH folder was listed.
          const sweptStartup = process.platform === 'win32'
            ? []
            : [`omega-runner-${host}-org-in-a.cmd`, `omega-runner-${host}-org-in-b.cmd`];
          ctx.expect((jetpack.list(startupDir) || []).sort()).toEqual(sweptStartup);
          // The surfaces no home and no seam can scope are not touched at all.
          ctx.expect(out.stdout).toContain('Test run: skipping the machine-wide sweeps (services, logon tasks, legacy homes).');
        } finally {
          jetpack.remove(homeA);
          jetpack.remove(homeB);
          jetpack.remove(startupDir);
        }
      },
    },
    {
      name: 'a test run refuses every mutating subcommand while the Startup dir is the real one',
      run: (ctx) => {
        // The round-4 hole, pinned: both homes scratch, and the run still swept
        // the box's real Startup folder because no home scopes it. Now the folder
        // is checked like a home — a non-scratch one refuses before anything runs.
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const { spawnSync } = require('child_process');

        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const realStartup = path.join(os.homedir(), 'omega-runner-startup-never-created');
        const commandPath = path.join(__dirname, '..', '..', '..', 'commands', 'runner.js');
        try {
          jetpack.write(path.join(scratch, 'config.json'), { registeredOrgs: ['org-in-scratch'] });
          jetpack.dir(path.join(scratch, 'actions-runner-org-in-scratch'));

          const script = [
            `const runner = require(${JSON.stringify(commandPath)});`,
            `runner({ _: ['runner', 'uninstall'], _home: ${JSON.stringify(scratch)}, _interactive: false })`,
            `  .then(() => process.stdout.write('\\nRAN'))`,
            `  .catch((e) => process.stdout.write('\\nTHREW ' + e.message));`,
          ].join('\n');
          const out = spawnSync(process.execPath, ['-e', script], {
            encoding: 'utf8',
            env: {
              ...process.env,
              OMEGA_RUNNER_HOME:         scratch,       // both homes scratch…
              OMEGA_RUNNER_STARTUP_DIR:  realStartup,   // …and the third surface real
              OMEGA_TEST_RUNNER:         '1',
              OMEGA_RUNNER_FORCE:        '1',
            },
          });

          ctx.expect(out.stdout).toContain('THREW');
          ctx.expect(out.stdout.includes('RAN')).toBe(false);
          ctx.expect(out.stdout).toContain(realStartup);                  // names the offender
          ctx.expect(out.stdout).toContain('OMEGA_RUNNER_STARTUP_DIR');   // and the seam that fixes it
          // The refusal wrote nothing: the scratch home is whole and the real
          // Startup path was never so much as created.
          ctx.expect(jetpack.list(scratch).sort()).toEqual(['actions-runner-org-in-scratch', 'config.json']);
          ctx.expect(jetpack.exists(realStartup)).toBe(false);
        } finally {
          jetpack.remove(scratch);
        }
      },
    },
    {
      name: '`monitor` lists the orgs of the home the call passed, not the module-level one',
      timeout: 30000,
      run: (ctx) => {
        // monitor tails forever by design, so the child is killed once it has
        // printed its roster — the block it prints on start is the whole
        // assertion, and it comes from that home's config.json.
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const { spawnSync } = require('child_process');

        const homeA = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-a-'));
        const homeB = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-b-'));
        const commandPath = path.join(__dirname, '..', '..', '..', 'commands', 'runner.js');
        try {
          jetpack.write(path.join(homeA, 'config.json'), { registeredOrgs: ['org-in-a'] });
          jetpack.write(path.join(homeB, 'config.json'), { registeredOrgs: ['org-in-b'] });

          const script = [
            `const runner = require(${JSON.stringify(commandPath)});`,
            // `file` so the roster is the only thing the log path can affect.
            `runner({ _: ['runner', 'monitor'], file: ${JSON.stringify(path.join(homeB, 'omega-signing.log'))}, _home: ${JSON.stringify(homeB)} });`,
          ].join('\n');
          const out = spawnSync(process.execPath, ['-e', script], {
            encoding: 'utf8',
            timeout:  8000,                        // it never exits on its own (the Windows process scan is slow)
            env: {
              ...process.env,
              OMEGA_RUNNER_HOME: homeA,
              OMEGA_TEST_RUNNER: '1',
            },
          });

          ctx.expect(out.stdout).toContain('Monitoring signing requests across 1 org(s)');
          ctx.expect(out.stdout).toContain('org-in-b');
          ctx.expect(out.stdout.includes('org-in-a')).toBe(false);
          ctx.expect(out.stdout.includes(homeA)).toBe(false);
        } finally {
          jetpack.remove(homeA);
          jetpack.remove(homeB);
        }
      },
    },
    {
      name: 'runner command exports a function',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));
        ctx.expect(typeof mod).toBe('function');
        ctx.expect(Array.isArray(mod.RUNNER_LABELS)).toBe(true);
        ctx.expect(mod.RUNNER_LABELS).toContain('self-hosted');
        ctx.expect(mod.RUNNER_LABELS).toContain('windows');
        ctx.expect(mod.RUNNER_LABELS).toContain('ev-token');
      },
    },
    {
      name: 'runner pinned actions/runner version is set',
      run: (ctx) => {
        const mod = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));
        ctx.expect(typeof mod.ACTIONS_RUNNER_VERSION).toBe('string');
        ctx.expect(mod.ACTIONS_RUNNER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
      },
    },
    {
      name: 'runner unknown subcommand throws',
      run: async (ctx) => {
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));
        let threw;
        try {
          await runner({ _: ['runner', 'banana'] });
        } catch (e) { threw = e; }
        ctx.expect(threw).toBeDefined();
        ctx.expect(threw.message).toMatch(/Unknown runner subcommand/);
      },
    },
    {
      name: 'runner install on non-Windows refuses without override — against the scratch home, with no token anywhere',
      run: async (ctx) => {
        // This case used to delete GH_TOKEN and trust "the token check fires".
        // On the box it did not: the walk read the saved token back out of the
        // REAL home's .env and installed for real (2026-09-04). Now the home is
        // the suite's scratch, its .env carries no token, and the environment
        // handed to the walk carries none either — there is no path left where a
        // real token can reach this case.
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const origForce = process.env.OMEGA_RUNNER_FORCE;
        const origToken = process.env.GH_TOKEN;
        delete process.env.OMEGA_RUNNER_FORCE;
        delete process.env.GH_TOKEN;
        jetpack.write(path.join(SCRATCH_HOME, '.env'), 'GH_TOKEN=""\n');

        let threw;
        try {
          await runner({ _: ['runner', 'install'], _home: SCRATCH_HOME, _env: {}, _interactive: false });
        } catch (e) { threw = e; }

        if (origForce !== undefined) process.env.OMEGA_RUNNER_FORCE = origForce;
        if (origToken !== undefined) process.env.GH_TOKEN = origToken;

        ctx.expect(threw).toBeDefined();
        // Off Windows the platform check wins; on the box the missing-token
        // refusal does. Either way nothing was installed.
        ctx.expect(threw.message).toMatch(process.platform === 'win32' ? /GH_TOKEN/ : /only runs on Windows/);
        ctx.expect(jetpack.exists(path.join(SCRATCH_HOME, '_template'))).toBe(false);
        ctx.expect(jetpack.exists(path.join(SCRATCH_HOME, 'config.json'))).toBe(false);
      },
    },
    {
      name: 'runner register-org without org throws clear error',
      run: async (ctx) => {
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));
        const origForce = process.env.OMEGA_RUNNER_FORCE;
        const origToken = process.env.GH_TOKEN;
        process.env.OMEGA_RUNNER_FORCE = '1';
        process.env.GH_TOKEN = 'ghp_test_dummy';

        let threw;
        try {
          await runner({ _: ['runner', 'register-org'] });   // no org
        } catch (e) { threw = e; }

        if (origForce !== undefined) process.env.OMEGA_RUNNER_FORCE = origForce;
        else delete process.env.OMEGA_RUNNER_FORCE;
        if (origToken !== undefined) process.env.GH_TOKEN = origToken;
        else delete process.env.GH_TOKEN;

        ctx.expect(threw).toBeDefined();
        ctx.expect(threw.message).toMatch(/Usage:.*register-org/);
      },
    },
    {
      name: 'runner install without GH_TOKEN throws — off a TTY, naming the key, nothing registered',
      run: async (ctx) => {
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const origForce = process.env.OMEGA_RUNNER_FORCE;
        const origToken = process.env.GH_TOKEN;
        process.env.OMEGA_RUNNER_FORCE = '1';          // the platform gate passes: the TOKEN check is what must fire
        delete process.env.GH_TOKEN;
        jetpack.write(path.join(SCRATCH_HOME, '.env'), 'GH_TOKEN=""\n');   // and the home has none saved either

        let threw;
        try {
          await runner({ _: ['runner', 'install'], _home: SCRATCH_HOME, _env: {}, _interactive: false });
        } catch (e) { threw = e; }

        if (origForce !== undefined) process.env.OMEGA_RUNNER_FORCE = origForce;
        else delete process.env.OMEGA_RUNNER_FORCE;
        if (origToken !== undefined) process.env.GH_TOKEN = origToken;

        ctx.expect(threw).toBeDefined();
        ctx.expect(threw.message).toContain('GH_TOKEN');
        ctx.expect(threw.message).toContain('no terminal to ask in');
        // Off a TTY it refuses BEFORE it acts: no download, no registration.
        ctx.expect(jetpack.exists(path.join(SCRATCH_HOME, '_template'))).toBe(false);
        ctx.expect(jetpack.exists(path.join(SCRATCH_HOME, 'config.json'))).toBe(false);
      },
    },
    {
      name: 'GH_TOKEN error message recommends admin:org (not manage_runners:org)',
      run: (ctx) => {
        // Guards against the regression where docs/code suggested manage_runners:org —
        // GitHub's runner-registration endpoint requires admin:org for classic PATs.
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        ctx.expect(src).toContain('admin:org');
        ctx.expect(src).not.toMatch(/lacks manage_runners:org/);
      },
    },
    {
      name: 'downloadActionsRunner uses Expand-Archive on Windows + tar fallback elsewhere',
      run: (ctx) => {
        // 1.2.36+ uses PowerShell Expand-Archive on Windows because Git-for-Windows'
        // GNU tar misinterprets `C:\...` paths as `host:path`. tar still used on
        // mac/linux for the framework-dev path.
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        ctx.expect(src).toContain('Expand-Archive');                   // Windows path present
        ctx.expect(src).toContain("spawnSync('tar', ['-xf'");          // unix fallback present
        ctx.expect(src).toContain("process.platform === 'win32'");     // platform fork present
      },
    },
    {
      name: 'tar can extract a real Windows actions/runner zip (smoke)',
      run: async (ctx) => {
        // Validates the tar approach works against an actual zip with the layout
        // actions/runner ships. We don't pull from GH on every test (slow + flaky);
        // instead build a tiny fixture zip on disk via Node, then extract via tar.
        //
        // tar is the NON-Windows extraction path (the framework-dev one, with
        // OMEGA_RUNNER_FORCE); macOS ships bsdtar, which reads zip, so it is a
        // valid local check there. GNU tar on Linux does NOT read zip. Windows
        // extracts with Expand-Archive and never calls tar — and the `tar` on a
        // Windows box's PATH is often Git for Windows' GNU tar, which reads a
        // `C:\...` path as `host:path` and exits 128 (the exact reason the
        // production code switched). So the case runs on macOS only.
        if (process.platform === 'linux') {
          ctx.skip('GNU tar on Linux does not support zip — the tar path is the non-Windows framework-dev one');
        }
        if (process.platform === 'win32') {
          ctx.skip('Windows extracts with Expand-Archive, never tar — a Git-for-Windows GNU tar on PATH cannot take a C:\\ path');
        }

        const fs = require('fs');
        const os = require('os');
        const { spawnSync } = require('child_process');

        // Skip if tar isn't on PATH for any reason.
        const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['tar']);
        if (which.status !== 0) {
          ctx.skip('tar not found on PATH');
        }

        // Build a minimal zip via Node — uses the same standard zip container that
        // actions/runner ships. We're testing that tar's zip support works at all.
        // Smallest valid zip = 22-byte EOCD with no entries.
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-tar-test-'));
        const zipPath = path.join(tmp, 'empty.zip');
        // EOCD signature (PK\x05\x06) + 18 zero bytes = empty valid zip
        const eocd = Buffer.from([0x50, 0x4B, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        fs.writeFileSync(zipPath, eocd);

        const r = spawnSync('tar', ['-xf', zipPath, '-C', tmp]);
        // Cleanup before assertion so we don't leak tmp dirs on failure.
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }

        ctx.expect(r.status).toBe(0);
      },
    },
    {
      name: 'install surfaces zero-success failure with non-zero exit code',
      run: (ctx) => {
        // Source-text guard: confirm install reports + sets exitCode when 0/N orgs registered.
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        ctx.expect(src).toContain('Install summary');
        ctx.expect(src).toContain('process.exitCode = 1');
        ctx.expect(src).toContain('failedByReason');
      },
    },
    {
      name: 'install is idempotent — calls uninstall first if the runner home exists',
      run: (ctx) => {
        // Source-text guard: re-running install should never leave you in a worse state.
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        ctx.expect(src).toContain('Existing runner installation detected');
        ctx.expect(src).toContain('uninstalling first for a clean re-install');
        // ...and the electron-manager era's install counts as an existing one.
        ctx.expect(src).toMatch(/jetpack\.exists\(home\)\s*\|\|\s*listLegacyRunnerHomes\(\{ home \}\)\.length > 0/);
      },
    },
    {
      name: 'downloadActionsRunner uses curl + size validation (not wonderful-fetch buffer)',
      run: (ctx) => {
        // Guards against the regression where wonderful-fetch returned an unexpected
        // ~224MB buffer that tar couldn't extract.
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        ctx.expect(src).toContain("spawnSync('curl'");
        ctx.expect(src).toContain('1024 * 1024');                  // size sanity check
        ctx.expect(src).not.toContain("require('wonderful-fetch')");
      },
    },
    {
      name: 'per-org state reads the runner dir + Startup shortcut out of a fake runner home',
      run: (ctx) => {
        // What `monitor` and `status` both report: is this org registered on disk,
        // does it auto-start at logon, is a listener alive. No Scheduled Tasks.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home       = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const startupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-startup-'));

        try {
          const before = runner.orgRunnerState('Omega-JS-Stack', { home, startupDir });
          ctx.expect(before.dir).toBe(path.join(home, 'actions-runner-omega-js-stack'));
          ctx.expect(before.installed).toBe(false);
          ctx.expect(before.autoStart).toBe(false);
          ctx.expect(before.state).toBe('NOT_INSTALLED');

          // Register: the per-org runner dir lands, then its Startup shortcut.
          jetpack.dir(before.dir);
          ctx.expect(runner.orgRunnerState('Omega-JS-Stack', { home, startupDir }).state).toBe('STOPPED');

          jetpack.write(path.join(startupDir, `${before.name}.cmd`), '@echo off\r\n');
          const after = runner.orgRunnerState('Omega-JS-Stack', { home, startupDir });
          ctx.expect(after.installed).toBe(true);
          ctx.expect(after.autoStart).toBe(true);
          // No Runner.Listener.exe under a temp dir on any platform.
          ctx.expect(after.listeners).toEqual([]);
          ctx.expect(after.state).toBe('STOPPED');
        } finally {
          jetpack.remove(home);
          jetpack.remove(startupDir);
        }
      },
    },
    {
      name: 'monitor lists every registered org with its state (no Scheduled Tasks)',
      run: (ctx) => {
        // The regression this replaces: monitor called listEmRunnerTasks() /
        // taskState(), neither of which exists, so it threw a ReferenceError on
        // any box with at least one registered org.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home       = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const startupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-startup-'));

        try {
          jetpack.write(path.join(home, 'config.json'), { registeredOrgs: ['Omega-JS-Stack', 'ITW-Creative-Works'] });
          jetpack.dir(path.join(home, 'actions-runner-omega-js-stack'));

          const states = runner.monitorOrgStates({ home, startupDir, env: {} });
          ctx.expect(states.length).toBe(2);
          ctx.expect(states.map((s) => s.org)).toEqual(['Omega-JS-Stack', 'ITW-Creative-Works']);
          ctx.expect(states[0].state).toBe('STOPPED');
          ctx.expect(states[1].state).toBe('NOT_INSTALLED');

          // OMEGA_RUNNER_ORGS narrows the roster the same way install does.
          const filtered = runner.monitorOrgStates({ home, startupDir, env: { OMEGA_RUNNER_ORGS: 'omega-js-stack' } });
          ctx.expect(filtered.map((s) => s.org)).toEqual(['Omega-JS-Stack']);
        } finally {
          jetpack.remove(home);
          jetpack.remove(startupDir);
        }
      },
    },
    {
      name: 'uninstall sweeps up leftover actions.runner.* services + retries removal',
      run: (ctx) => {
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        ctx.expect(src).toContain('uninstallActionsRunnerServices');
        ctx.expect(src).toContain('removeRunnerHomeWithRetry');
        ctx.expect(src).toContain('SERVICE_NAME:\\s*(actions\\.runner');   // pattern for service discovery
      },
    },
    {
      name: 'uninstall builds its deregistration roster from the runner dirs on disk',
      run: (ctx) => {
        // Off config.json deliberately: a half-finished install leaves per-org
        // directories config.json never recorded, and those are exactly the ones
        // that strand an orphaned runner in the org.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        try {
          jetpack.write(path.join(home, 'actions-runner-foo', 'config.cmd'), 'rem foo');
          jetpack.dir(path.join(home, 'actions-runner-bar'));                       // no config.cmd — nothing to remove with
          jetpack.write(path.join(home, '_template', 'config.cmd'), 'rem template'); // never registered against an org
          jetpack.write(path.join(home, 'config.json'), { registeredOrgs: ['gone'] });

          const roster = runner.listOrgRunnerDirs(home);
          ctx.expect(roster.map((r) => r.org)).toEqual(['foo']);
          ctx.expect(roster[0].dir).toBe(path.join(home, 'actions-runner-foo'));
          ctx.expect(roster[0].configCmd).toBe(path.join(home, 'actions-runner-foo', 'config.cmd'));
        } finally {
          jetpack.remove(home);
        }

        ctx.expect(runner.listOrgRunnerDirs(path.join(home, 'does-not-exist'))).toEqual([]);
      },
    },
    {
      name: 'uninstall runs config.cmd remove per org dir, with that dir as cwd',
      run: async (ctx) => {
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const origToken = process.env.GH_TOKEN;
        process.env.GH_TOKEN = 'ghp_test_dummy';

        try {
          jetpack.write(path.join(home, 'actions-runner-foo', 'config.cmd'), 'rem foo');
          jetpack.write(path.join(home, 'actions-runner-baz', 'config.cmd'), 'rem baz');

          const calls = [];
          const result = await runner.deregisterOrgRunners({
            home,
            getRemoveToken: async (org) => `tok-${org}`,
            exec: (cmd, args, cwd) => { calls.push({ cmd, args, cwd }); return { status: 0 }; },
          });

          ctx.expect(result.deregistered).toEqual(['baz', 'foo']);
          ctx.expect(result.failed).toEqual([]);
          ctx.expect(calls.length).toBe(2);
          // cmd.exe /c — a .cmd file cannot be spawned directly by CreateProcess.
          ctx.expect(calls[1].cmd).toBe('cmd.exe');
          ctx.expect(calls[1].args).toEqual([
            '/c', path.join(home, 'actions-runner-foo', 'config.cmd'), 'remove', '--token', 'tok-foo',
          ]);
          ctx.expect(calls[1].cwd).toBe(path.join(home, 'actions-runner-foo'));
        } finally {
          if (origToken === undefined) delete process.env.GH_TOKEN;
          else process.env.GH_TOKEN = origToken;
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'a failed config.cmd remove keeps that org for a later uninstall to retry',
      run: async (ctx) => {
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const origToken = process.env.GH_TOKEN;
        process.env.GH_TOKEN = 'ghp_test_dummy';

        try {
          jetpack.write(path.join(home, 'actions-runner-foo', 'config.cmd'), 'rem foo');
          jetpack.write(path.join(home, 'actions-runner-baz', 'config.cmd'), 'rem baz');

          const result = await runner.deregisterOrgRunners({
            home,
            getRemoveToken: async (org) => `tok-${org}`,
            // baz removes cleanly; foo exits 1 — it is STILL registered on GitHub.
            exec: (cmd, args, cwd) => ({ status: cwd.endsWith('actions-runner-foo') ? 1 : 0 }),
          });

          ctx.expect(result.deregistered).toEqual(['baz']);
          ctx.expect(result.failed.map((f) => f.org)).toEqual(['foo']);
          // The directory holding the registration has to survive, or the retry
          // has no config.cmd to remove with.
          ctx.expect(result.failed[0].dir).toBe(path.join(home, 'actions-runner-foo'));
        } finally {
          if (origToken === undefined) delete process.env.GH_TOKEN;
          else process.env.GH_TOKEN = origToken;
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'without GH_TOKEN, deregistration is skipped loudly rather than half-run',
      run: async (ctx) => {
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const origToken = process.env.GH_TOKEN;
        delete process.env.GH_TOKEN;

        try {
          jetpack.write(path.join(home, 'actions-runner-foo', 'config.cmd'), 'rem foo');

          let called = false;
          const result = await runner.deregisterOrgRunners({
            home,
            exec: () => { called = true; return { status: 0 }; },
          });

          ctx.expect(result.deregistered).toEqual([]);
          ctx.expect(called).toBe(false);
          // Not deregistered means the directory stays, so a later run can retry.
          ctx.expect(result.failed.map((f) => f.org)).toEqual(['foo']);
        } finally {
          if (origToken !== undefined) process.env.GH_TOKEN = origToken;
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'a test run never kills a process whose path it cannot read',
      run: (ctx) => {
        // A Runner.Listener/Worker whose ExecutablePath the query cannot read
        // belongs to ANOTHER account, and `$ep -eq ''` matches it against
        // WHATEVER home is passed — so `uninstall` from a test would `taskkill /F`
        // the box's real runners with two scratch homes and a scratch Startup dir.
        // PowerShell cannot run here, so the filter text is the assertion.
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const real = runner.listenerFilterScript('c:\\users\\me\\appdata\\local\\omega-runner', { includeUnreadable: true });
        const test = runner.listenerFilterScript('c:\\users\\me\\appdata\\local\\omega-runner', { includeUnreadable: false });

        ctx.expect(real).toContain("$ep -eq ''");                   // a real box clears every handle in the home
        ctx.expect(test.includes("$ep -eq ''")).toBe(false);        // a test owns no stranger's process
        // Both still scope to the home, and both still catch the cmd.exe wrappers.
        ctx.expect(test).toContain('$ep.StartsWith($home_lc)');
        ctx.expect(test).toContain('run.cmd');
        ctx.expect(real).toContain('$ep.StartsWith($home_lc)');

        // …and the two paths that kill are wired to it. Source-level, because
        // neither can be observed off Windows: both return before spawning.
        const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        ctx.expect(source).toContain('listenerFilterScript(homeLower, { includeUnreadable: !isTestRun() })');
        ctx.expect(source).toContain('if (isTestRun()) continue;');   // the same rule, enumerating for `stop`
      },
    },
    {
      name: 'a test run refuses to deregister without an injected seam',
      run: async (ctx) => {
        // The default path mints a REAL removal token with GH_TOKEN and runs each
        // org dir's own config.cmd — the box's registrations, gone. Neither is
        // scoped by a home, so the seam is the only thing between a test and
        // GitHub, and its absence has to be a refusal rather than a request.
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const marker = path.join(home, 'config-cmd-ran.txt');
        const origToken = process.env.GH_TOKEN;
        process.env.GH_TOKEN = 'ghp_test_dummy';                      // the box's shape: a token IS set

        try {
          // A config.cmd that leaves proof if anything ever executes it.
          jetpack.write(path.join(home, 'actions-runner-foo', 'config.cmd'), `@echo off\r\necho ran > "${marker}"\r\n`);

          let threw;
          try {
            await runner.deregisterOrgRunners({ home });             // no exec, no getRemoveToken
          } catch (e) { threw = e; }

          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toContain('exec');
          ctx.expect(threw.message).toContain('getRemoveToken');
          ctx.expect(threw.message).toContain('test run');
          ctx.expect(jetpack.exists(marker)).toBe(false);            // config.cmd never ran

          // `exec` alone does not disarm it while a token is set: the default
          // `getRemoveToken` would still mint a real removal token.
          let threwExecOnly;
          try {
            await runner.deregisterOrgRunners({ home, exec: () => ({ status: 0 }) });
          } catch (e) { threwExecOnly = e; }
          ctx.expect(threwExecOnly).toBeDefined();
          ctx.expect(threwExecOnly.message).toContain('getRemoveToken');
          ctx.expect(jetpack.exists(marker)).toBe(false);

          // An empty roster is not a refusal — there is nothing to deregister.
          const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
          ctx.expect(await runner.deregisterOrgRunners({ home: empty })).toEqual({ deregistered: [], failed: [] });
          jetpack.remove(empty);
        } finally {
          if (origToken === undefined) delete process.env.GH_TOKEN;
          else process.env.GH_TOKEN = origToken;
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'a listener in session 0 is a warning state, not a healthy RUNNING',
      run: (ctx) => {
        // Session 0 has no desktop and its own (empty) certificate store, so a
        // runner there picks up jobs and then fails every one of them.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home       = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const startupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-startup-'));

        try {
          jetpack.dir(path.join(home, 'actions-runner-foo'));

          const healthy = runner.orgRunnerState('foo', {
            home, startupDir,
            listListeners: () => [{ pid: 11, sessionId: 1, execPath: 'C:\\x\\Runner.Listener.exe' }],
          });
          ctx.expect(healthy.state).toBe('RUNNING');
          ctx.expect(healthy.sessionZero).toBe(false);

          const blind = runner.orgRunnerState('foo', {
            home, startupDir,
            listListeners: () => [{ pid: 12, sessionId: 0, execPath: null }],
          });
          ctx.expect(blind.state).toBe('SESSION_0');
          ctx.expect(blind.sessionZero).toBe(true);

          const lines = runner.orgRunnerStateLines(blind);
          ctx.expect(lines[0]).toContain('SESSION_0');
          ctx.expect(lines[0]).toContain('⚠');
          ctx.expect(lines[1]).toContain('PID=12');
          ctx.expect(lines[1]).toContain('session=0');
          ctx.expect(lines[1]).toContain('cannot see CurrentUser\\My cert store');
        } finally {
          jetpack.remove(home);
          jetpack.remove(startupDir);
        }
      },
    },
    {
      name: 'status and monitor render the per-org block from ONE derivation',
      run: (ctx) => {
        // The drift this closes: status scanned processes itself while monitor
        // asked a pair of Scheduled-Task helpers that did not exist.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home       = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const startupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-startup-'));

        try {
          jetpack.write(path.join(home, 'config.json'), { registeredOrgs: ['foo', 'bar'] });
          jetpack.dir(path.join(home, 'actions-runner-foo'));
          jetpack.write(path.join(startupDir, `${runner.orgRunnerState('foo', { home, startupDir }).name}.cmd`), '@echo off\r\n');

          const report = runner.orgRunnerReport({
            home, startupDir, env: {},
            listListeners: (dir) => (dir.endsWith('actions-runner-foo')
              ? [{ pid: 99, sessionId: 1, execPath: 'C:\\x\\Runner.Listener.exe' }]
              : []),
          });

          ctx.expect(report.map((r) => r.state.org)).toEqual(['foo', 'bar']);
          ctx.expect(report[0].state.state).toBe('RUNNING');
          ctx.expect(report[0].lines[0]).toContain('auto-starts at logon');
          ctx.expect(report[0].lines[1]).toContain('PID=99');
          // bar is registered in config.json but nothing was ever laid down for it.
          ctx.expect(report[1].state.state).toBe('NOT_INSTALLED');
          ctx.expect(report[1].lines.length).toBe(1);
          ctx.expect(report[1].lines[0]).toContain('no Startup shortcut');
        } finally {
          jetpack.remove(home);
          jetpack.remove(startupDir);
        }
      },
    },
    {
      name: 'RUNNER_HOME resolves per platform (%LOCALAPPDATA% on Windows, <cwd>/.gh-runners elsewhere)',
      run: (ctx) => {
        const os = require('os');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        // Windows: per-user, under %LOCALAPPDATA% — the whole reason install
        // needs no admin. Falls back to the profile path when the var is unset.
        ctx.expect(runner.defaultRunnerHome('win32', { LOCALAPPDATA: path.join('C:', 'Users', 'ian', 'AppData', 'Local') }))
          .toBe(path.join('C:', 'Users', 'ian', 'AppData', 'Local', 'omega-runner'));
        ctx.expect(runner.defaultRunnerHome('win32', {}))
          .toBe(path.join(os.homedir(), 'AppData', 'Local', 'omega-runner'));

        // Everywhere else (framework dev only — the runner itself is Windows-only).
        ctx.expect(runner.defaultRunnerHome('darwin', {})).toBe(path.join(process.cwd(), '.gh-runners'));
        ctx.expect(runner.defaultRunnerHome('linux', {})).toBe(path.join(process.cwd(), '.gh-runners'));
      },
    },
    {
      name: 'install honors OMEGA_RUNNER_ORGS filter from env',
      run: (ctx) => {
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        ctx.expect(src).toContain('OMEGA_RUNNER_ORGS');
        ctx.expect(src).toContain('filter');
      },
    },
    {
      name: 'each org gets its own actions-runner-<org>/ directory (multi-org architecture)',
      run: (ctx) => {
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        ctx.expect(src).toContain('actions-runner-${org.toLowerCase()}');
        ctx.expect(src).toContain('templateDir');
      },
    },
    {
      name: 'config.cmd spawn uses inherited stdio (so --runasservice actually creates the service)',
      run: (ctx) => {
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        // Inherit, NOT pipe — actions/runner's --runasservice silently skips service
        // install when stdout/stderr are piped (it can't see a console).
        ctx.expect(src).toContain("stdio:    'inherit'");
        ctx.expect(src).toContain('null (killed)');                       // surfaces kill status meaningfully
      },
    },
    {
      name: 'config.cmd invoked via cmd.exe /c (not shell:true) to avoid Node DEP0190',
      run: (ctx) => {
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        ctx.expect(src).toContain("spawnSync('cmd.exe', ['/c', configCmd");
        // shell:true is gone from registerOrg's spawnSync (other places may still use it)
        ctx.expect(src).not.toMatch(/spawnSync\(configCmd[^)]*shell:\s*true/s);
      },
    },
    {
      name: 'the electron-manager era homes are found from the environment, never the current home',
      run: (ctx) => {
        // An upgraded box still runs `em runner`'s install out of
        // %LOCALAPPDATA%\em-runner (C:\actions-runners before that). Those are
        // what uninstall tears down and status names — unless one of them IS
        // the current home, which is the omega install and not a leftover.
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));
        const sep    = path.win32.sep;
        const env    = { LOCALAPPDATA: ['C:', 'Users', 'ian', 'AppData', 'Local'].join(sep), SystemDrive: 'C:' };
        const emHome = [env.LOCALAPPDATA, 'em-runner'].join(sep);
        const cHome  = ['C:', 'actions-runners'].join(sep);
        const home   = [env.LOCALAPPDATA, 'omega-runner'].join(sep);

        ctx.expect(runner.LEGACY_RUNNER_PREFIX).toBe('em-runner-');

        // Both on disk: both are named, in that order.
        ctx.expect(runner.listLegacyRunnerHomes({ platform: 'win32', env, home, exists: () => true })).toEqual([emHome, cHome]);

        // Only what is actually on disk.
        const onDisk = new Set([cHome.toLowerCase()]);
        ctx.expect(runner.listLegacyRunnerHomes({ platform: 'win32', env, home, exists: (p) => onDisk.has(p.toLowerCase()) })).toEqual([cHome]);
        ctx.expect(runner.listLegacyRunnerHomes({ platform: 'win32', env, home, exists: () => false })).toEqual([]);

        // OMEGA_RUNNER_HOME pointed AT the legacy path: that is the install, not a leftover.
        ctx.expect(runner.listLegacyRunnerHomes({ platform: 'win32', env, home: emHome.toUpperCase(), exists: () => true })).toEqual([cHome]);

        // Nothing to find off Windows.
        ctx.expect(runner.listLegacyRunnerHomes({ platform: 'darwin', env, home, exists: () => true })).toEqual([]);
      },
    },
    {
      name: 'em-runner-* Startup shortcuts are listed apart from omega-runner-* ones',
      run: (ctx) => {
        // `start` launches omega shortcuts only; `status` names the legacy ones
        // and `uninstall` removes them. The two rosters never mix.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const startupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-startup-'));
        try {
          jetpack.write(path.join(startupDir, 'omega-runner-host-acme.cmd'), '@echo off');
          jetpack.write(path.join(startupDir, 'omega-runner-host-zed.cmd'),  '@echo off');
          jetpack.write(path.join(startupDir, 'em-runner-host-acme.cmd'),    '@echo off');
          jetpack.write(path.join(startupDir, 'EM-RUNNER-host-old.CMD'),     '@echo off');
          jetpack.write(path.join(startupDir, 'em-runner-.cmd'),             '@echo off');   // prefix alone names no runner
          jetpack.write(path.join(startupDir, 'em-runner-notes.txt'),        'not a shortcut');
          jetpack.write(path.join(startupDir, 'Something Else.lnk'),         '');

          ctx.expect(runner.listRunnerStartupShortcuts(startupDir)).toEqual(['omega-runner-host-acme', 'omega-runner-host-zed']);
          ctx.expect(runner.listLegacyRunnerStartupShortcuts(startupDir)).toEqual(['EM-RUNNER-host-old', 'em-runner-host-acme']);

          ctx.expect(runner.listRunnerStartupShortcuts(path.join(startupDir, 'missing'))).toEqual([]);
          ctx.expect(runner.listLegacyRunnerStartupShortcuts(null)).toEqual([]);
        } finally {
          jetpack.remove(startupDir);
        }
      },
    },
    {
      name: 'the box owns its signing config: <runner home>/.env fills what the shell and CI did not set',
      run: (ctx) => {
        // The PIN, the cert, signtool, the token and the orgs belong to the
        // MACHINE, never to a brand's .env — and a value the shell or a CI job
        // already carries wins over the file. An empty delivered value counts
        // as absent (sanitize-signing-env's rule), and an empty line in the
        // file sets nothing.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runnerEnv = require(path.join(__dirname, '..', '..', '..', 'utils', 'runner-env.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        try {
          // No file yet: nothing happens, and the caller is told.
          const missing = runnerEnv.loadRunnerEnv({ home, env: {} });
          ctx.expect(missing.present).toBe(false);
          ctx.expect(missing.file).toBe(path.join(home, '.env'));

          // install lays the template down ONCE.
          ctx.expect(runnerEnv.ensureRunnerEnvFile(home)).toBe(true);
          ctx.expect(runnerEnv.ensureRunnerEnvFile(home)).toBe(false);
          const template = jetpack.read(path.join(home, '.env'));
          for (const key of runnerEnv.RUNNER_ENV_KEYS) ctx.expect(template).toContain(`${key}=""`);

          // The template's empty values set nothing.
          const blank = {};
          ctx.expect(runnerEnv.loadRunnerEnv({ home, env: blank }).applied).toEqual([]);
          ctx.expect(Object.keys(blank)).toEqual([]);

          jetpack.write(path.join(home, '.env'), [
            'GH_TOKEN=ghp_from_the_box',
            `WIN_EV_TOKEN_PATH=${'a'.repeat(40)}`,
            'WIN_CSC_KEY_PASSWORD="pin with spaces"',
            'SIGNTOOL_PATH=',
            '# WIN_TIMESTAMP_URL=http://elsewhere',
          ].join('\n'));

          const env = { WIN_EV_TOKEN_PATH: 'b'.repeat(40), GH_TOKEN: '   ' };
          const result = runnerEnv.loadRunnerEnv({ home, env });
          ctx.expect(result.present).toBe(true);
          ctx.expect(result.applied).toEqual(['GH_TOKEN', 'WIN_CSC_KEY_PASSWORD']);   // blank shell value = absent
          ctx.expect(result.skipped).toEqual(['WIN_EV_TOKEN_PATH']);                  // shell wins
          ctx.expect(env.GH_TOKEN).toBe('ghp_from_the_box');
          ctx.expect(env.WIN_EV_TOKEN_PATH).toBe('b'.repeat(40));
          ctx.expect(env.WIN_CSC_KEY_PASSWORD).toBe('pin with spaces');
          ctx.expect('SIGNTOOL_PATH' in env).toBe(false);
          ctx.expect('WIN_TIMESTAMP_URL' in env).toBe(false);

          // The report names keys, never values.
          const report = runnerEnv.runnerEnvReport(env);
          ctx.expect(report.find((r) => r.key === 'GH_TOKEN').set).toBe(true);
          ctx.expect(report.find((r) => r.key === 'SIGNTOOL_PATH').set).toBe(false);
          ctx.expect(JSON.stringify(report)).not.toContain('ghp_from_the_box');
        } finally {
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'uninstall removes the runner home but keeps the box .env and its logs',
      run: async (ctx) => {
        // Configuration is not install state: a re-install never asks for the
        // PIN or the token again. Neither is the box's own trail — runner.log
        // is what the uninstall itself is writing while it runs, so removing it
        // would delete the record of the run that is happening. With neither on
        // disk the home goes whole.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));
        const runnerEnv = require(path.join(__dirname, '..', '..', '..', 'utils', 'runner-env.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        try {
          jetpack.write(path.join(home, '.env'), 'WIN_CSC_KEY_PASSWORD=keep-me');
          jetpack.write(runnerEnv.runnerLogFile(home), '# omega log\n');
          jetpack.write(path.join(home, 'config.json'), { registeredOrgs: ['foo'] });
          jetpack.write(path.join(home, 'actions-runner-foo', 'config.cmd'), 'rem foo');
          jetpack.write(path.join(home, '_template', 'config.cmd'), 'rem template');

          await runner.removeRunnerHomeWithRetry(new Set(), home);

          ctx.expect(jetpack.list(home).sort()).toEqual(['.env', 'logs']);
          ctx.expect(jetpack.read(path.join(home, '.env'))).toBe('WIN_CSC_KEY_PASSWORD=keep-me');
          ctx.expect(jetpack.read(runnerEnv.runnerLogFile(home))).toBe('# omega log\n');

          // A kept org dir (its deregistration failed) survives beside them.
          jetpack.write(path.join(home, 'actions-runner-bar', 'config.cmd'), 'rem bar');
          jetpack.write(path.join(home, 'actions-runner-baz', 'config.cmd'), 'rem baz');
          await runner.removeRunnerHomeWithRetry(new Set([path.join(home, 'actions-runner-bar')]), home);
          ctx.expect(jetpack.list(home).sort()).toEqual(['.env', 'actions-runner-bar', 'logs']);

          // Neither the .env nor the logs: the whole home goes.
          jetpack.remove(path.join(home, '.env'));
          jetpack.remove(path.join(home, 'logs'));
          await runner.removeRunnerHomeWithRetry(new Set(), home);
          ctx.expect(jetpack.exists(home)).toBe(false);

          // Logs alone are enough to keep the home standing.
          jetpack.write(runnerEnv.runnerLogFile(home), '# omega log\n');
          jetpack.write(path.join(home, 'config.json'), { registeredOrgs: ['foo'] });
          await runner.removeRunnerHomeWithRetry(new Set(), home);
          ctx.expect(jetpack.list(home)).toEqual(['logs']);
          jetpack.remove(home);

          // And a home that is not there is not an error.
          await runner.removeRunnerHomeWithRetry(new Set(), home);
        } finally {
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'a missing required key is asked for in a terminal, saved to the box .env, and refused without one',
      run: async (ctx) => {
        // The runner never boots half configured: interactive, the missing
        // required keys are prompted (secrets masked) and written back; off a
        // TTY, or when an answer is empty, the command refuses naming the file
        // and the keys. Optional keys are never asked for.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runnerEnv = require(path.join(__dirname, '..', '..', '..', 'utils', 'runner-env.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        try {
          // Off a TTY: refuse, and say which keys and which file.
          let threw;
          try {
            await runnerEnv.ensureRunnerConfig({ home, env: {}, interactive: false, prompt: {} });
          } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toContain('GH_TOKEN, WIN_EV_TOKEN_PATH, WIN_CSC_KEY_PASSWORD, SIGNTOOL_PATH');
          ctx.expect(threw.message).toContain(path.join(home, '.env'));
          ctx.expect(threw.message).toContain('no terminal');
          ctx.expect(jetpack.exists(path.join(home, '.env'))).toBe('file');   // the template was laid down anyway

          // Only the signing scope: GH_TOKEN is not that caller's business.
          threw = undefined;
          try {
            await runnerEnv.ensureRunnerConfig({ home, env: { WIN_EV_TOKEN_PATH: 'f'.repeat(40) }, scopes: ['signing'], interactive: false, prompt: {} });
          } catch (e) { threw = e; }
          ctx.expect(threw.message).toContain('WIN_CSC_KEY_PASSWORD, SIGNTOOL_PATH are not set');
          ctx.expect(threw.message).not.toContain('GH_TOKEN');

          // Interactive: each missing required key is asked once, secrets through
          // the masked prompt, and the answers land in the file AND the env.
          const asked = [];
          const fakePrompt = {
            input:    async ({ message, default: suggestion }) => { asked.push(['input', message, suggestion]); return message.startsWith('SIGNTOOL_PATH') ? (suggestion || 'C:/sdk/signtool.exe') : 'a'.repeat(40); },
            password: async ({ message }) => { asked.push(['password', message]); return message.startsWith('GH_TOKEN') ? 'ghp_answered' : '1234'; },
          };
          const env = { OMEGA_RUNNER_ORGS: 'acme' };
          const result = await runnerEnv.ensureRunnerConfig({ home, env, interactive: true, prompt: fakePrompt });
          ctx.expect(result.asked).toEqual(['GH_TOKEN', 'WIN_EV_TOKEN_PATH', 'WIN_CSC_KEY_PASSWORD', 'SIGNTOOL_PATH']);
          ctx.expect(asked.map((a) => a[0])).toEqual(['password', 'input', 'password', 'input']);
          ctx.expect(asked.some((a) => a[1].startsWith('OMEGA_RUNNER_ORGS') || a[1].startsWith('WIN_TIMESTAMP_URL'))).toBe(false);
          ctx.expect(env.GH_TOKEN).toBe('ghp_answered');
          ctx.expect(env.WIN_CSC_KEY_PASSWORD).toBe('1234');

          const written = jetpack.read(path.join(home, '.env'));
          ctx.expect(written).toContain('GH_TOKEN="ghp_answered"');               // every value double-quoted
          ctx.expect(written).toContain('WIN_CSC_KEY_PASSWORD="1234"');
          ctx.expect(written).toContain(`WIN_EV_TOKEN_PATH="${'a'.repeat(40)}"`);
          ctx.expect(written).toContain('# The token PIN');                       // comments survive
          ctx.expect(written).toContain('# WIN_TIMESTAMP_URL=');                  // optional stays commented
          ctx.expect((written.match(/^GH_TOKEN=/gm) || []).length).toBe(1);       // replaced in place, not appended

          // Satisfied now: nothing is asked again, from a fresh env read off the file.
          const again = await runnerEnv.ensureRunnerConfig({ home, env: {}, interactive: false, prompt: {} });
          ctx.expect(again.asked).toEqual([]);

          // An empty answer to a required key is still a refusal.
          jetpack.write(path.join(home, '.env'), 'GH_TOKEN=x\nWIN_EV_TOKEN_PATH=\nWIN_CSC_KEY_PASSWORD=\nSIGNTOOL_PATH=s\n');
          threw = undefined;
          try {
            await runnerEnv.ensureRunnerConfig({ home, env: {}, interactive: true, prompt: { input: async () => '  ', password: async () => '' } });
          } catch (e) { threw = e; }
          ctx.expect(threw.message).toContain('WIN_EV_TOKEN_PATH, WIN_CSC_KEY_PASSWORD are not set');
          ctx.expect(threw.message).not.toContain('no terminal');

          // Every value is written double-quoted, so a PIN with spaces or a `#`
          // reads back whole and the file obeys the one .env quoting rule.
          runnerEnv.writeRunnerEnvValues(home, { WIN_CSC_KEY_PASSWORD: 'p in spaces #1', NEW_KEY: 'appended' });
          const quoted = jetpack.read(path.join(home, '.env'));
          ctx.expect(quoted).toContain('WIN_CSC_KEY_PASSWORD="p in spaces #1"');
          ctx.expect(quoted).toContain('NEW_KEY="appended"');
          const back = {};
          runnerEnv.loadRunnerEnv({ home, env: back });
          ctx.expect(back.WIN_CSC_KEY_PASSWORD).toBe('p in spaces #1');
          ctx.expect(back.NEW_KEY).toBe('appended');

          // A value carrying a double quote cannot be written at all — dotenv
          // has no escape for it — so it is refused naming the key and the char.
          let refused;
          try {
            runnerEnv.writeRunnerEnvValues(home, { WIN_CSC_KEY_PASSWORD: 'p in "quotes"' });
          } catch (e) { refused = e; }
          ctx.expect(refused).toBeDefined();
          ctx.expect(refused.message).toContain('WIN_CSC_KEY_PASSWORD');
          ctx.expect(refused.message).toContain('"');
          ctx.expect(jetpack.read(path.join(home, '.env'))).toContain('WIN_CSC_KEY_PASSWORD="p in spaces #1"');
        } finally {
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'install and config are ONE walk: every key is asked with the current value as its default',
      run: async (ctx) => {
        // Ian's box, 2026-09-04: a shell that carried an exported
        // OMEGA_RUNNER_ORGS made install skip the orgs question silently, and a
        // brand's GH_TOKEN could configure the box. So EVERY key is asked, every
        // time, and the default is the file's value — not the shell's.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runnerEnv = require(path.join(__dirname, '..', '..', '..', 'utils', 'runner-env.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        try {
          jetpack.write(path.join(home, '.env'), [
            'GH_TOKEN="ghp_saved"',
            'OMEGA_RUNNER_ORGS="acme"',
            `WIN_EV_TOKEN_PATH="${'a'.repeat(40)}"`,
            'WIN_CSC_KEY_PASSWORD="old-pin"',
            'SIGNTOOL_PATH="C:/sdk/signtool.exe"',
            'WIN_TIMESTAMP_URL=""',
          ].join('\n'));

          const asked = [];
          const prompt = {
            input:    async ({ message, default: current }) => { asked.push([message.split(' ')[0], current, message]); return ''; },
            password: async ({ message }) => { asked.push([message.split(' ')[0], undefined, message]); return ''; },
            checkbox: async (opts) => { asked.push(['OMEGA_RUNNER_ORGS', null, opts.message]); return ['acme']; },
          };
          // The shell of Ian's window: an exported org list and a brand's token.
          const env = { OMEGA_RUNNER_ORGS: 'org1,org2,org3', GH_TOKEN: 'ghp_from_the_brand' };
          const result = await runnerEnv.reconfigureRunnerEnv({
            home, env, interactive: true, prompt,
            discoverOrgs: async () => ['acme', 'zed'],
          });

          // Every schema key of both scopes, in schema order, required or not.
          ctx.expect(asked.map((a) => a[0])).toEqual([
            'GH_TOKEN', 'WIN_EV_TOKEN_PATH', 'WIN_CSC_KEY_PASSWORD', 'SIGNTOOL_PATH', 'WIN_TIMESTAMP_URL', 'OMEGA_RUNNER_ORGS',
          ]);
          // The file's value is the default; a secret never echoes, it says so instead.
          ctx.expect(asked.find((a) => a[0] === 'WIN_EV_TOKEN_PATH')[1]).toBe('a'.repeat(40));
          ctx.expect(asked.find((a) => a[0] === 'SIGNTOOL_PATH')[1]).toBe('C:/sdk/signtool.exe');
          ctx.expect(asked.find((a) => a[0] === 'GH_TOKEN')[2]).toContain('Enter keeps the current value');
          ctx.expect(asked.find((a) => a[0] === 'GH_TOKEN')[2]).not.toContain('ghp_saved');

          // Enter everywhere: every key is still ANSWERED (and so rewritten
          // quoted), and the walk's answers — the box's own values — are what
          // the rest of the command sees.
          ctx.expect(result.answers.sort()).toEqual(['GH_TOKEN', 'SIGNTOOL_PATH', 'WIN_CSC_KEY_PASSWORD', 'WIN_EV_TOKEN_PATH']);
          ctx.expect(env.GH_TOKEN).toBe('ghp_saved');
          ctx.expect(env.OMEGA_RUNNER_ORGS).toBe('acme');
          ctx.expect(jetpack.read(path.join(home, '.env'))).toContain('GH_TOKEN="ghp_saved"');

          // install runs that same walk, so it is asked the same way (source-text
          // guard lives in the install-wiring case below).
          ctx.expect(typeof runnerEnv.reconfigureRunnerEnv).toBe('function');
        } finally {
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'a value only the shell carries is the current value, and Enter saves it — secret or not',
      run: async (ctx) => {
        // "Current" means current: a key the file does not have yet but the
        // shell delivered is offered as the default, and accepting it writes it
        // to the box's file. The non-secret keys already did this (the prompt
        // hands the default back); a secret must not be the exception, and the
        // message says "current", not "saved", because it may be neither.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runnerEnv = require(path.join(__dirname, '..', '..', '..', 'utils', 'runner-env.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        try {
          jetpack.write(path.join(home, '.env'), [
            'GH_TOKEN=""',
            `WIN_EV_TOKEN_PATH=""`,
            'WIN_CSC_KEY_PASSWORD="1234"',
            'SIGNTOOL_PATH="C:/sdk/signtool.exe"',
          ].join('\n'));

          const asked = [];
          const env = { GH_TOKEN: 'ghp_from_the_shell', WIN_EV_TOKEN_PATH: 'e'.repeat(40) };
          const result = await runnerEnv.reconfigureRunnerEnv({
            home, env, interactive: true,
            prompt: {
              input:    async ({ message, default: current }) => { asked.push([message, current]); return ''; },   // Enter
              password: async ({ message }) => { asked.push([message, undefined]); return ''; },                   // Enter
              checkbox: async () => ['acme'],
            },
            discoverOrgs: async () => ['acme'],
          });

          // Offered as the default (secret: said, never echoed), and saved.
          ctx.expect(asked.find((a) => a[0].startsWith('WIN_EV_TOKEN_PATH'))[1]).toBe('e'.repeat(40));
          ctx.expect(asked.find((a) => a[0].startsWith('GH_TOKEN'))[0]).toContain('Enter keeps the current value');
          ctx.expect(asked.find((a) => a[0].startsWith('GH_TOKEN'))[0]).not.toContain('ghp_from_the_shell');

          ctx.expect(result.answers.sort()).toEqual(['GH_TOKEN', 'OMEGA_RUNNER_ORGS', 'SIGNTOOL_PATH', 'WIN_CSC_KEY_PASSWORD', 'WIN_EV_TOKEN_PATH']);
          const written = jetpack.read(path.join(home, '.env'));
          ctx.expect(written).toContain('GH_TOKEN="ghp_from_the_shell"');
          ctx.expect(written).toContain(`WIN_EV_TOKEN_PATH="${'e'.repeat(40)}"`);
          ctx.expect(written).toContain('WIN_CSC_KEY_PASSWORD="1234"');       // kept: rewritten with the same value, quoted
          ctx.expect((written.match(/^GH_TOKEN=/gm) || []).length).toBe(1);
        } finally {
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'the walk rewrites every answered key, so a pre-quoting file comes back fully quoted',
      run: async (ctx) => {
        // A box configured before the quoting rule kept its bare `KEY=value`
        // lines forever: only a CHANGED value was written, so Enter (keep) never
        // rewrote the line. Every value the walk ends with is written now — the
        // kept ones too — and the writer serializes `KEY="value"`, so one walk
        // brings an old file up to the rule without changing a single value.
        const fs = require('fs');
        const jetpack = require('fs-jetpack');
        const runnerEnv = require(path.join(__dirname, '..', '..', '..', 'utils', 'runner-env.js'));

        const home = fs.mkdtempSync(path.join(SCRATCH_HOME, 'quoted-'));
        try {
          jetpack.write(path.join(home, '.env'), [
            'GH_TOKEN=abc',                                  // written by the pre-quoting code
            'OMEGA_RUNNER_ORGS="acme"',
            `WIN_EV_TOKEN_PATH=${'a'.repeat(40)}`,
            'WIN_CSC_KEY_PASSWORD="old pin"',                // already quoted, spaces and all
            'SIGNTOOL_PATH=C:/sdk/signtool.exe',
            'WIN_TIMESTAMP_URL=http://timestamp.sectigo.com',
          ].join('\n'));

          // Enter on everything, the same fake prompts the walk cases above use.
          await runnerEnv.reconfigureRunnerEnv({
            home, env: {}, interactive: true,
            prompt: {
              input:    async ({ default: current }) => current || '',
              password: async () => '',
              checkbox: async () => ['acme'],
            },
            discoverOrgs: async () => ['acme'],
          });

          // Every KEY= line in the file is now KEY="…", commented ones included.
          const written = jetpack.read(path.join(home, '.env'));
          const bare = written.split('\n').filter((line) => /^\s*[A-Z][A-Z0-9_]*\s*=/.test(line) && !/^[A-Z][A-Z0-9_]*="[^"]*"$/.test(line));
          ctx.expect(bare).toEqual([]);

          // …and not one value moved.
          const back = {};
          runnerEnv.loadRunnerEnv({ home, env: back });
          ctx.expect(back.GH_TOKEN).toBe('abc');
          ctx.expect(back.OMEGA_RUNNER_ORGS).toBe('acme');
          ctx.expect(back.WIN_EV_TOKEN_PATH).toBe('a'.repeat(40));
          ctx.expect(back.WIN_CSC_KEY_PASSWORD).toBe('old pin');
          ctx.expect(back.SIGNTOOL_PATH).toBe('C:/sdk/signtool.exe');
          ctx.expect(back.WIN_TIMESTAMP_URL).toBe('http://timestamp.sectigo.com');
          ctx.expect((written.match(/^GH_TOKEN=/gm) || []).length).toBe(1);
        } finally {
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'the orgs checkbox lists orgs alphabetically and ticks the saved list, else this install\u2019s registered orgs, else nothing',
      run: async (ctx) => {
        // A token that administers 35 orgs must never register 35 runners on one
        // Enter, so nothing is ticked by default. What IS ticked: what the box
        // already answered, else what it already registered. The list is
        // alphabetical, case-insensitively, never GitHub's membership order.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runnerEnv = require(path.join(__dirname, '..', '..', '..', 'utils', 'runner-env.js'));

        const filled = (orgs) => [
          'GH_TOKEN="ghp_from_the_box"',
          `WIN_EV_TOKEN_PATH="${'a'.repeat(40)}"`,
          'WIN_CSC_KEY_PASSWORD="1234"',
          'SIGNTOOL_PATH="C:/sdk/signtool.exe"',
          `OMEGA_RUNNER_ORGS="${orgs}"`,
        ].join('\n');

        const walk = async (home, registeredOrgs) => {
          let choices;
          await runnerEnv.reconfigureRunnerEnv({
            home, env: {}, interactive: true, registeredOrgs,
            prompt: {
              input:    async ({ default: current }) => current || '',
              password: async () => '',
              checkbox: async (opts) => { choices = opts.choices; return ['Acme']; },
            },
            discoverOrgs: async () => ['Acme', 'zed', 'solo'],
          });
          return choices.map((c) => `${c.value}:${c.checked ? 'on' : 'off'}`);
        };

        const saved = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const installed = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        try {
          // 1. The saved list wins, case-insensitively.
          jetpack.write(path.join(saved, '.env'), filled('acme, zed'));
          ctx.expect(await walk(saved, ['solo'])).toEqual(['Acme:on', 'solo:off', 'zed:on']);

          // 2. No saved list: what this install registered.
          jetpack.write(path.join(installed, '.env'), filled(''));
          ctx.expect(await walk(installed, ['zed'])).toEqual(['Acme:off', 'solo:off', 'zed:on']);

          // 3. Neither: nothing ticked. One Enter registers nothing, by design.
          jetpack.write(path.join(fresh, '.env'), filled(''));
          ctx.expect(await walk(fresh, [])).toEqual(['Acme:off', 'solo:off', 'zed:off']);
          ctx.expect(jetpack.read(path.join(fresh, '.env'))).toContain('OMEGA_RUNNER_ORGS="Acme"');
        } finally {
          for (const home of [saved, installed, fresh]) jetpack.remove(home);
        }
      },
    },
    {
      name: 'a runner with no org is not a runner: zero ticked refuses, and a token with no admin org skips the question',
      run: async (ctx) => {
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runnerEnv = require(path.join(__dirname, '..', '..', '..', 'utils', 'runner-env.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        try {
          jetpack.write(path.join(home, '.env'), [
            'GH_TOKEN="ghp_from_the_box"',
            `WIN_EV_TOKEN_PATH="${'a'.repeat(40)}"`,
            'WIN_CSC_KEY_PASSWORD="1234"',
            'SIGNTOOL_PATH="C:/sdk/signtool.exe"',
          ].join('\n'));

          const keep = { input: async ({ default: current }) => current || '', password: async () => '' };

          // Everything unticked: refuse, naming the key. Nothing is written.
          let threw;
          try {
            await runnerEnv.reconfigureRunnerEnv({
              home, env: {}, interactive: true,
              prompt: { ...keep, checkbox: async () => [] },
              discoverOrgs: async () => ['Acme', 'zed'],
            });
          } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toContain('OMEGA_RUNNER_ORGS');
          const back = {};
          runnerEnv.loadRunnerEnv({ home, env: back });
          ctx.expect(back.OMEGA_RUNNER_ORGS).toBeUndefined();

          // A token that administers nothing: one warn line, no question, no refusal.
          const logged = [];
          const logger = { log: (m) => logged.push(['log', String(m)]), warn: (m) => logged.push(['warn', String(m)]) };
          const env = {};
          const result = await runnerEnv.reconfigureRunnerEnv({
            home, env, interactive: true, logger,
            prompt: { ...keep, checkbox: async () => { throw new Error('nothing to tick'); } },
            discoverOrgs: async () => [],
          });
          ctx.expect(result.orgs).toBeNull();
          ctx.expect(result.adminOrgs).toEqual([]);                       // asked GitHub, got nothing — install need not ask again
          ctx.expect(env.OMEGA_RUNNER_ORGS).toBeUndefined();
          ctx.expect(logged.filter((l) => l[0] === 'warn').map((l) => l[1]).join('\n')).toContain('admin');
        } finally {
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'off a TTY the walk asks nothing — install refuses only for a missing required key, config refuses outright',
      run: async (ctx) => {
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runnerEnv = require(path.join(__dirname, '..', '..', '..', 'utils', 'runner-env.js'));
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        try {
          jetpack.write(path.join(home, '.env'), [
            'GH_TOKEN="ghp_from_the_box"',
            `WIN_EV_TOKEN_PATH="${'a'.repeat(40)}"`,
            'WIN_CSC_KEY_PASSWORD="1234"',
            'SIGNTOOL_PATH="C:/sdk/signtool.exe"',
          ].join('\n'));

          // CI has no keyboard: nothing is asked, nothing is discovered, and a
          // blank OMEGA_RUNNER_ORGS still means every org the token administers.
          let discovered = false;
          const env = {};
          const result = await runnerEnv.reconfigureRunnerEnv({
            home, env, interactive: false, prompt: {},
            discoverOrgs: async () => { discovered = true; return ['Acme']; },
          });
          ctx.expect(result.answers).toEqual([]);
          ctx.expect(discovered).toBe(false);                    // no terminal, no question, no API call
          ctx.expect(result.adminOrgs).toBeNull();               // nothing discovered, so install discovers for itself
          ctx.expect(env.OMEGA_RUNNER_ORGS).toBeUndefined();

          const all = runner.selectRunnerOrgs(['Acme', 'zed'], env.OMEGA_RUNNER_ORGS);
          ctx.expect(all.orgs).toEqual(['Acme', 'zed']);
          ctx.expect(all.filtered).toBe(false);

          // An org in the list the token does not administer is named, not registered.
          const partial = runner.selectRunnerOrgs(['Acme'], 'acme, ghost');
          ctx.expect(partial.orgs).toEqual(['Acme']);
          ctx.expect(partial.unmatched).toEqual(['ghost']);

          // A required key missing off a TTY still refuses, naming the file and the keys.
          jetpack.write(path.join(home, '.env'), 'GH_TOKEN="ghp_from_the_box"\n');
          let threw;
          try {
            await runnerEnv.reconfigureRunnerEnv({ home, env: {}, interactive: false, prompt: {} });
          } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toContain('WIN_EV_TOKEN_PATH, WIN_CSC_KEY_PASSWORD, SIGNTOOL_PATH');
          ctx.expect(threw.message).toContain(path.join(home, '.env'));
          ctx.expect(threw.message).toContain('no terminal');

          // `config` has nothing to ask WITH, so it refuses even fully configured.
          threw = undefined;
          try {
            await runnerEnv.reconfigureRunnerEnv({ home, env: {}, interactive: false, prompt: {}, requireTerminal: true });
          } catch (e) { threw = e; }
          ctx.expect(threw.message).toContain(path.join(home, '.env'));
          ctx.expect(threw.message).toContain('interactive terminal');
        } finally {
          jetpack.remove(home);
        }
      },
    },
    {
      name: '`runner config` re-asks every key with the saved value as its default, and Enter keeps a saved secret',
      run: async (ctx) => {
        // install and start ask only for what is MISSING; `config` is how a
        // value that is already there gets CHANGED. Both scopes, every key,
        // then the orgs checkbox with the current list ticked.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const origForce = process.env.OMEGA_RUNNER_FORCE;
        process.env.OMEGA_RUNNER_FORCE = '1';
        try {
          jetpack.write(path.join(home, '.env'), [
            'GH_TOKEN=ghp_old',
            'OMEGA_RUNNER_ORGS=acme',
            `WIN_EV_TOKEN_PATH=${'a'.repeat(40)}`,
            'WIN_CSC_KEY_PASSWORD=old-pin',
            'SIGNTOOL_PATH=C:/sdk/signtool.exe',
            'WIN_TIMESTAMP_URL=',
          ].join('\n'));
          jetpack.write(path.join(home, 'config.json'), { registeredOrgs: ['acme'] });

          const asked  = [];
          const logged = [];
          const logger = { log: (m) => logged.push(['log', String(m)]), warn: (m) => logged.push(['warn', String(m)]), error: (m) => logged.push(['error', String(m)]) };
          let choices;
          const prompt = {
            input:    async ({ message, default: current }) => { asked.push(['input', message, current]); return message.startsWith('WIN_TIMESTAMP_URL') ? 'http://ts.example' : (current || ''); },
            password: async ({ message }) => { asked.push(['password', message]); return message.startsWith('GH_TOKEN') ? 'ghp_new' : ''; },
            checkbox: async (opts) => { asked.push(['checkbox', opts.message]); choices = opts.choices; return ['acme', 'zed']; },
          };

          await runner({
            _: ['runner', 'config'],
            _home: home, _env: {}, _logger: logger, _prompt: prompt, _interactive: true,
            _discoverOrgs: async () => ['acme', 'zed'],
          });

          // Every key of both scopes, in file order — the orgs checkbox IS the orgs question.
          ctx.expect(asked.map((a) => a[1].split(' ')[0])).toEqual([
            'GH_TOKEN', 'WIN_EV_TOKEN_PATH', 'WIN_CSC_KEY_PASSWORD', 'SIGNTOOL_PATH', 'WIN_TIMESTAMP_URL', 'OMEGA_RUNNER_ORGS',
          ]);
          ctx.expect(asked.find((a) => a[1].startsWith('WIN_EV_TOKEN_PATH'))[2]).toBe('a'.repeat(40));   // current value is the default
          ctx.expect(asked.find((a) => a[1].startsWith('WIN_CSC_KEY_PASSWORD'))[1]).toContain('Enter keeps the current value');

          const written = jetpack.read(path.join(home, '.env'));
          ctx.expect(written).toContain('GH_TOKEN="ghp_new"');                 // changed
          ctx.expect(written).toContain('WIN_CSC_KEY_PASSWORD="old-pin"');     // empty answer keeps the secret, rewritten in place quoted
          ctx.expect(written).toContain('WIN_TIMESTAMP_URL="http://ts.example"');
          ctx.expect(written).toContain('OMEGA_RUNNER_ORGS="acme,zed"');
          ctx.expect((written.match(/^GH_TOKEN=/gm) || []).length).toBe(1);

          // The current list is ticked; the rest are not.
          ctx.expect(choices.map((c) => `${c.value}:${c.checked ? 'on' : 'off'}`)).toEqual(['acme:on', 'zed:off']);

          // The new list is not the registered one, so say what applies it.
          ctx.expect(logged.map((l) => l[1]).join('\n')).toContain('npx omega runner install');

          // Off a TTY there is nothing to ask with: refuse, naming the file.
          let threw;
          try {
            await runner({ _: ['runner', 'config'], _home: home, _env: {}, _logger: logger, _prompt: {}, _interactive: false });
          } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toContain(path.join(home, '.env'));
        } finally {
          if (origForce === undefined) delete process.env.OMEGA_RUNNER_FORCE; else process.env.OMEGA_RUNNER_FORCE = origForce;
          jetpack.remove(home);
        }
      },
    },
    {
      name: '`start` settles the box config first: a missing required key is asked in a terminal, refused without one',
      run: async (ctx) => {
        // A box missing a required key is refused by start exactly as it is by
        // install — a listener that cannot sign is worse than no listener.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const origForce = process.env.OMEGA_RUNNER_FORCE;
        process.env.OMEGA_RUNNER_FORCE = '1';
        const logged = [];
        const logger = { log: (m) => logged.push(['log', String(m)]), warn: (m) => logged.push(['warn', String(m)]), error: (m) => logged.push(['error', String(m)]) };
        try {
          let threw;
          try {
            await runner({ _: ['runner', 'start'], _home: home, _env: {}, _logger: logger, _prompt: {}, _interactive: false });
          } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toContain('GH_TOKEN');
          ctx.expect(threw.message).toContain(path.join(home, '.env'));
          ctx.expect(threw.message).toContain('no terminal');

          // Interactive, the questions land and the answers are saved. Driven
          // through the preflight, since `start` itself would spawn a listener.
          let checkboxes = 0;
          const env = {};
          await runner.startPreflight({
            home, env, logger, interactive: true,
            prompt: {
              input:    async ({ message, default: suggestion }) => (message.startsWith('SIGNTOOL_PATH') ? (suggestion || 'C:/sdk/signtool.exe') : 'a'.repeat(40)),
              password: async ({ message }) => (message.startsWith('GH_TOKEN') ? 'ghp_answered' : '1234'),
              checkbox: async () => { checkboxes++; return []; },
            },
          });
          ctx.expect(env.GH_TOKEN).toBe('ghp_answered');
          ctx.expect(jetpack.read(path.join(home, '.env'))).toContain('GH_TOKEN="ghp_answered"');
          ctx.expect(checkboxes).toBe(0);        // the orgs question belongs to install and config
        } finally {
          if (origForce === undefined) delete process.env.OMEGA_RUNNER_FORCE; else process.env.OMEGA_RUNNER_FORCE = origForce;
          jetpack.remove(home);
        }
      },
    },
    {
      name: '`start` warns when OMEGA_RUNNER_ORGS names orgs this install never registered',
      run: async (ctx) => {
        // start registers nothing — it says which command would.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const logged = [];
        const logger = { log: (m) => logged.push(['log', String(m)]), warn: (m) => logged.push(['warn', String(m)]), error: (m) => logged.push(['error', String(m)]) };
        const filled = {
          GH_TOKEN: 'ghp_from_the_box',
          WIN_EV_TOKEN_PATH: 'a'.repeat(40),
          WIN_CSC_KEY_PASSWORD: '1234',
          SIGNTOOL_PATH: 'C:/sdk/signtool.exe',
        };
        try {
          jetpack.write(path.join(home, 'config.json'), { registeredOrgs: ['acme'] });

          await runner.startPreflight({ home, env: { ...filled, OMEGA_RUNNER_ORGS: 'Acme, zed' }, logger, interactive: false, prompt: {} });
          const warns = logged.filter((l) => l[0] === 'warn').map((l) => l[1]).join('\n');
          ctx.expect(warns).toContain('OMEGA_RUNNER_ORGS names Acme, zed');
          ctx.expect(warns).toContain('registered acme');
          ctx.expect(warns).toContain('npx omega runner install');

          // The same set spelled differently is the same set: nothing to say.
          logged.length = 0;
          await runner.startPreflight({ home, env: { ...filled, OMEGA_RUNNER_ORGS: 'ACME' }, logger, interactive: false, prompt: {} });
          ctx.expect(logged.filter((l) => l[0] === 'warn')).toEqual([]);

          // Blank means every admin org, which no registered list contradicts.
          await runner.startPreflight({ home, env: { ...filled }, logger, interactive: false, prompt: {} });
          ctx.expect(logged.filter((l) => l[0] === 'warn')).toEqual([]);
        } finally {
          jetpack.remove(home);
        }
      },
    },
    {
      name: '`start` brings EVERY registered org online, detached, in Startup-shortcut order',
      run: async (ctx) => {
        // The hole this closes: `start` brought up the FIRST shortcut only, in
        // the calling terminal, and every other registered org stayed offline
        // until the next logon. It now walks them all, through the injected
        // spawn so a case never runs cmd.exe.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const origForce = process.env.OMEGA_RUNNER_FORCE;
        const origExit  = process.exitCode;
        process.env.OMEGA_RUNNER_FORCE = '1';
        const hostPrefix = `omega-runner-${os.hostname().toLowerCase()}-`;
        const orgs      = ['acme', 'zeta'];
        const shortcuts = orgs.map((org) => path.join(SCRATCH_STARTUP_DIR, `${hostPrefix}${org}.cmd`));
        const logged  = [];
        const logger  = { log: (m) => logged.push(['log', String(m)]), warn: (m) => logged.push(['warn', String(m)]), error: (m) => logged.push(['error', String(m)]) };
        const spawned = [];
        const filled  = { GH_TOKEN: 'ghp_from_the_box', WIN_EV_TOKEN_PATH: 'a'.repeat(40), WIN_CSC_KEY_PASSWORD: '1234', SIGNTOOL_PATH: 'C:/sdk/signtool.exe' };
        try {
          for (const org of orgs) jetpack.dir(path.join(home, `actions-runner-${org}`));
          for (const file of shortcuts) jetpack.write(file, '@echo off\r\n');

          await runner({
            _: ['runner', 'start'], _home: home, _env: filled, _logger: logger, _interactive: false, _prompt: {},
            _listeners: () => [],
            _spawn: (dir) => { spawned.push(dir); return { ok: true, pid: 1000 + spawned.length }; },
          });

          // One spawn per shortcut, in the order the shortcuts are listed.
          ctx.expect(spawned).toEqual(orgs.map((org) => path.join(home, `actions-runner-${org}`)));
          const lines = logged.map((l) => l[1]).join('\n');
          for (const org of orgs) ctx.expect(lines).toContain(`${hostPrefix}${org}`);
          ctx.expect(lines).toContain('PID=1001');
          ctx.expect(lines).toContain('PID=1002');
          // Every org online: the run is a success.
          ctx.expect(process.exitCode).toBe(origExit);
        } finally {
          if (origForce === undefined) delete process.env.OMEGA_RUNNER_FORCE; else process.env.OMEGA_RUNNER_FORCE = origForce;
          process.exitCode = origExit;
          for (const file of shortcuts) jetpack.remove(file);
          jetpack.remove(home);
        }
      },
    },
    {
      name: '`start` skips the org whose listener is already alive, naming its PID, and starts the rest',
      run: async (ctx) => {
        // Idempotent: running it twice is running it once. A second listener on
        // one registration is the session-takeover storm, so an alive org is
        // named and left alone rather than refused or duplicated.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const origForce = process.env.OMEGA_RUNNER_FORCE;
        const origExit  = process.exitCode;
        process.env.OMEGA_RUNNER_FORCE = '1';
        const hostPrefix = `omega-runner-${os.hostname().toLowerCase()}-`;
        const orgs      = ['acme', 'zeta'];
        const shortcuts = orgs.map((org) => path.join(SCRATCH_STARTUP_DIR, `${hostPrefix}${org}.cmd`));
        const logged  = [];
        const logger  = { log: (m) => logged.push(['log', String(m)]), warn: (m) => logged.push(['warn', String(m)]), error: (m) => logged.push(['error', String(m)]) };
        const spawned = [];
        const filled  = { GH_TOKEN: 'ghp_from_the_box', WIN_EV_TOKEN_PATH: 'a'.repeat(40), WIN_CSC_KEY_PASSWORD: '1234', SIGNTOOL_PATH: 'C:/sdk/signtool.exe' };
        const aliveDir = path.join(home, 'actions-runner-acme');
        try {
          for (const org of orgs) jetpack.dir(path.join(home, `actions-runner-${org}`));
          for (const file of shortcuts) jetpack.write(file, '@echo off\r\n');

          await runner({
            _: ['runner', 'start'], _home: home, _env: filled, _logger: logger, _interactive: false, _prompt: {},
            _listeners: (dir) => (dir === aliveDir ? [{ pid: 4242, sessionId: 1, execPath: path.join(aliveDir, 'bin', 'Runner.Listener.exe') }] : []),
            _spawn: (dir) => { spawned.push(dir); return { ok: true, pid: 7777 }; },
          });

          ctx.expect(spawned).toEqual([path.join(home, 'actions-runner-zeta')]);
          const lines = logged.map((l) => l[1]).join('\n');
          ctx.expect(lines).toContain('acme');
          ctx.expect(lines).toContain('PID=4242');           // the skip names the live listener
          ctx.expect(lines).toContain('PID=7777');           // and the one it did start
          ctx.expect(process.exitCode).toBe(origExit);       // a skip is not a failure
        } finally {
          if (origForce === undefined) delete process.env.OMEGA_RUNNER_FORCE; else process.env.OMEGA_RUNNER_FORCE = origForce;
          process.exitCode = origExit;
          for (const file of shortcuts) jetpack.remove(file);
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'a spawn that failed leaves that org offline and the run exits non-zero',
      run: async (ctx) => {
        // A partial start is a failure: the exit code is what a script or a
        // logon task reads.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const origForce = process.env.OMEGA_RUNNER_FORCE;
        const origExit  = process.exitCode;
        process.env.OMEGA_RUNNER_FORCE = '1';
        const hostPrefix = `omega-runner-${os.hostname().toLowerCase()}-`;
        const orgs      = ['acme', 'zeta'];
        const shortcuts = orgs.map((org) => path.join(SCRATCH_STARTUP_DIR, `${hostPrefix}${org}.cmd`));
        const logged  = [];
        const logger  = { log: (m) => logged.push(['log', String(m)]), warn: (m) => logged.push(['warn', String(m)]), error: (m) => logged.push(['error', String(m)]) };
        const filled  = { GH_TOKEN: 'ghp_from_the_box', WIN_EV_TOKEN_PATH: 'a'.repeat(40), WIN_CSC_KEY_PASSWORD: '1234', SIGNTOOL_PATH: 'C:/sdk/signtool.exe' };
        try {
          for (const org of orgs) jetpack.dir(path.join(home, `actions-runner-${org}`));
          for (const file of shortcuts) jetpack.write(file, '@echo off\r\n');

          await runner({
            _: ['runner', 'start'], _home: home, _env: filled, _logger: logger, _interactive: false, _prompt: {},
            _listeners: () => [],
            _spawn: (dir) => (dir.endsWith('actions-runner-zeta') ? { ok: false, message: 'run.cmd not found', pid: null } : { ok: true, pid: 1001 }),
          });

          ctx.expect(process.exitCode).toBe(1);
          const lines = logged.map((l) => l[1]).join('\n');
          ctx.expect(lines).toContain('run.cmd not found');
          ctx.expect(lines).toContain('PID=1001');           // the org that did come up is still reported
        } finally {
          if (origForce === undefined) delete process.env.OMEGA_RUNNER_FORCE; else process.env.OMEGA_RUNNER_FORCE = origForce;
          process.exitCode = origExit;
          for (const file of shortcuts) jetpack.remove(file);
          jetpack.remove(home);
        }
      },
    },
    {
      name: '`restart` stops first, then starts every org',
      run: async (ctx) => {
        // One command for the loop an operator ran by hand. The order is the
        // whole point: a start before the stop is the takeover storm.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const origForce = process.env.OMEGA_RUNNER_FORCE;
        const origExit  = process.exitCode;
        process.env.OMEGA_RUNNER_FORCE = '1';
        const hostPrefix = `omega-runner-${os.hostname().toLowerCase()}-`;
        const shortcut = path.join(SCRATCH_STARTUP_DIR, `${hostPrefix}acme.cmd`);
        const logged  = [];
        const logger  = { log: (m) => logged.push(['log', String(m)]), warn: (m) => logged.push(['warn', String(m)]), error: (m) => logged.push(['error', String(m)]) };
        const spawned = [];
        const filled  = { GH_TOKEN: 'ghp_from_the_box', WIN_EV_TOKEN_PATH: 'a'.repeat(40), WIN_CSC_KEY_PASSWORD: '1234', SIGNTOOL_PATH: 'C:/sdk/signtool.exe' };
        try {
          jetpack.dir(path.join(home, 'actions-runner-acme'));
          jetpack.write(shortcut, '@echo off\r\n');

          await runner({
            _: ['runner', 'restart'], _home: home, _env: filled, _logger: logger, _interactive: false, _prompt: {},
            _listeners: () => [],
            _spawn: (dir) => { spawned.push(dir); return { ok: true, pid: 2222 }; },
          });

          const lines   = logged.map((l) => l[1]);
          const stopped = lines.findIndex((l) => l.includes('already stopped'));
          const started = lines.findIndex((l) => l.includes('PID=2222'));
          ctx.expect(stopped >= 0).toBe(true);
          ctx.expect(started >= 0).toBe(true);
          ctx.expect(stopped < started).toBe(true);
          ctx.expect(spawned).toEqual([path.join(home, 'actions-runner-acme')]);
        } finally {
          if (origForce === undefined) delete process.env.OMEGA_RUNNER_FORCE; else process.env.OMEGA_RUNNER_FORCE = origForce;
          process.exitCode = origExit;
          jetpack.remove(shortcut);
          jetpack.remove(home);
        }
      },
    },
    {
      name: '`restart` settles the box config BEFORE it kills anything',
      run: async (ctx) => {
        // Preflight lived inside `start`, so a box missing a required key was
        // stopped, then refused: every listener dead and nothing to bring them
        // back. It now runs first, and the refusal costs nothing.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const origForce = process.env.OMEGA_RUNNER_FORCE;
        const origExit  = process.exitCode;
        process.env.OMEGA_RUNNER_FORCE = '1';
        const hostPrefix = `omega-runner-${os.hostname().toLowerCase()}-`;
        const shortcut = path.join(SCRATCH_STARTUP_DIR, `${hostPrefix}acme.cmd`);
        const logged  = [];
        const logger  = { log: (m) => logged.push(['log', String(m)]), warn: (m) => logged.push(['warn', String(m)]), error: (m) => logged.push(['error', String(m)]) };
        const spawned = [];
        const killed  = [];
        try {
          jetpack.dir(path.join(home, 'actions-runner-acme'));
          jetpack.write(shortcut, '@echo off\r\n');

          let threw;
          try {
            await runner({
              _: ['runner', 'restart'], _home: home, _env: {}, _logger: logger, _interactive: false, _prompt: {},
              _listeners: (dir) => { killed.push(dir); return []; },
              _spawn: (dir) => { spawned.push(dir); return { ok: true, pid: 3333 }; },
            });
          } catch (e) { threw = e; }

          ctx.expect(threw).toBeDefined();
          ctx.expect(threw.message).toContain('GH_TOKEN');
          // Nothing was stopped and nothing was started: the box is as it was.
          ctx.expect(logged.map((l) => l[1]).join('\n').includes('already stopped')).toBe(false);
          ctx.expect(spawned).toEqual([]);
        } finally {
          if (origForce === undefined) delete process.env.OMEGA_RUNNER_FORCE; else process.env.OMEGA_RUNNER_FORCE = origForce;
          process.exitCode = origExit;
          jetpack.remove(shortcut);
          jetpack.remove(home);
        }
      },
    },
    {
      name: '`restart` waits for the killed listener to actually go, then starts',
      run: async (ctx) => {
        // taskkill returns before the process leaves the table. A start that
        // raced it read the dying listener as "already running" and called the
        // box online while it was on its way down.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const origForce = process.env.OMEGA_RUNNER_FORCE;
        const origExit  = process.exitCode;
        process.env.OMEGA_RUNNER_FORCE = '1';
        const hostPrefix = `omega-runner-${os.hostname().toLowerCase()}-`;
        const shortcut = path.join(SCRATCH_STARTUP_DIR, `${hostPrefix}acme.cmd`);
        const logged  = [];
        const logger  = { log: (m) => logged.push(['log', String(m)]), warn: (m) => logged.push(['warn', String(m)]), error: (m) => logged.push(['error', String(m)]) };
        const spawned = [];
        const waits   = [];
        const filled  = { GH_TOKEN: 'ghp_from_the_box', WIN_EV_TOKEN_PATH: 'a'.repeat(40), WIN_CSC_KEY_PASSWORD: '1234', SIGNTOOL_PATH: 'C:/sdk/signtool.exe' };
        try {
          jetpack.dir(path.join(home, 'actions-runner-acme'));
          jetpack.write(shortcut, '@echo off\r\n');

          // Alive for the first two polls, gone on the third.
          let looks = 0;
          await runner({
            _: ['runner', 'restart'], _home: home, _env: filled, _logger: logger, _interactive: false, _prompt: {},
            _delay: async (ms) => { waits.push(ms); },
            _listeners: () => (++looks <= 2 ? [{ pid: 909, sessionId: 1, execPath: 'C:/x/Runner.Listener.exe' }] : []),
            _spawn: (dir) => { spawned.push(dir); return { ok: true, pid: 4444 }; },
          });

          ctx.expect(waits.length).toBe(2);                  // it polled rather than trusting taskkill
          ctx.expect(waits[0]).toBe(250);
          ctx.expect(spawned).toEqual([path.join(home, 'actions-runner-acme')]);
          const lines = logged.map((l) => l[1]).join('\n');
          ctx.expect(lines).toContain('PID=4444');           // the fresh listener, not the dying one
          ctx.expect(lines.includes('already running')).toBe(false);
          ctx.expect(process.exitCode).toBe(origExit);
        } finally {
          if (origForce === undefined) delete process.env.OMEGA_RUNNER_FORCE; else process.env.OMEGA_RUNNER_FORCE = origForce;
          process.exitCode = origExit;
          jetpack.remove(shortcut);
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'a listener that outlives the stop fails the `restart` loudly',
      run: async (ctx) => {
        // The poll is bounded: a listener still standing after it is reported,
        // never started over the top of, and the run exits non-zero.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const origForce = process.env.OMEGA_RUNNER_FORCE;
        const origExit  = process.exitCode;
        process.env.OMEGA_RUNNER_FORCE = '1';
        const hostPrefix = `omega-runner-${os.hostname().toLowerCase()}-`;
        const shortcut = path.join(SCRATCH_STARTUP_DIR, `${hostPrefix}acme.cmd`);
        const logged  = [];
        const logger  = { log: (m) => logged.push(['log', String(m)]), warn: (m) => logged.push(['warn', String(m)]), error: (m) => logged.push(['error', String(m)]) };
        const spawned = [];
        const waits   = [];
        const filled  = { GH_TOKEN: 'ghp_from_the_box', WIN_EV_TOKEN_PATH: 'a'.repeat(40), WIN_CSC_KEY_PASSWORD: '1234', SIGNTOOL_PATH: 'C:/sdk/signtool.exe' };
        try {
          jetpack.dir(path.join(home, 'actions-runner-acme'));
          jetpack.write(shortcut, '@echo off\r\n');

          await runner({
            _: ['runner', 'restart'], _home: home, _env: filled, _logger: logger, _interactive: false, _prompt: {},
            _delay: async (ms) => { waits.push(ms); },
            _listeners: () => [{ pid: 909, sessionId: 1, execPath: 'C:/x/Runner.Listener.exe' }],
            _spawn: (dir) => { spawned.push(dir); return { ok: true, pid: 4444 }; },
          });

          ctx.expect(waits.length).toBe(20);                 // bounded, not forever
          ctx.expect(process.exitCode).toBe(1);
          const warns = logged.filter((l) => l[0] === 'warn').map((l) => l[1]).join('\n');
          ctx.expect(warns).toContain('still has a listener after stop');
          ctx.expect(warns).toContain('PID=909');
          ctx.expect(spawned).toEqual([]);                   // never a second one on that registration
        } finally {
          if (origForce === undefined) delete process.env.OMEGA_RUNNER_FORCE; else process.env.OMEGA_RUNNER_FORCE = origForce;
          process.exitCode = origExit;
          jetpack.remove(shortcut);
          jetpack.remove(home);
        }
      },
    },
    {
      name: '`start` never takes the terminal over: no inherited stdio in it',
      run: (ctx) => {
        // Source-text guard on the branch that was deleted. A reintroduced
        // foreground start would hang the box's install and every script.
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        const from = src.indexOf('async function startServices');
        const to   = src.indexOf('async function restartServices');
        ctx.expect(from > 0 && to > from).toBe(true);
        const startSrc = src.slice(from, to);
        ctx.expect(startSrc.includes("stdio: 'inherit'")).toBe(false);
        ctx.expect(startSrc.includes('spawnSync')).toBe(false);
        // ...and install hands off to it rather than foregrounding one org.
        ctx.expect(src).toContain('await startServices({ ...options, _home: home })');

        // The spawn's own options, pinned the same way: the listener is handed
        // the runner's private HOME ([#807](https://github.com/Omega-JS-Stack/omega/issues/807))
        // so its jobs never read the box's symlinked `~/.gitconfig`, and the
        // detached child does not depend on the `.env` read alone. Only a real
        // spawn on Windows proves it, which no case may do, so the wiring is
        // read off the source.
        const spawnSrc = src.slice(src.indexOf('function spawnRunnerDetached'), src.indexOf('function listRunnerListenerProcessesUnder'));
        ctx.expect(spawnSrc.length).toBeGreaterThan(0);
        ctx.expect(spawnSrc).toContain('HOME: runnerPrivateHome(');
      },
    },
    {
      name: 'a live listener belongs to the org dir it is INSIDE, never the one its name starts with',
      run: async (ctx) => {
        // `acme` and `acme-2` on one box: a bare prefix match read acme-2's
        // listener as acme's, so acme was skipped as "already running" and
        // never came up.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const origForce = process.env.OMEGA_RUNNER_FORCE;
        const origExit  = process.exitCode;
        process.env.OMEGA_RUNNER_FORCE = '1';
        const hostPrefix = `omega-runner-${os.hostname().toLowerCase()}-`;
        const orgs      = ['acme', 'acme-2'];
        const shortcuts = orgs.map((org) => path.join(SCRATCH_STARTUP_DIR, `${hostPrefix}${org}.cmd`));
        const logged  = [];
        const logger  = { log: (m) => logged.push(['log', String(m)]), warn: (m) => logged.push(['warn', String(m)]), error: (m) => logged.push(['error', String(m)]) };
        const spawned = [];
        const filled  = { GH_TOKEN: 'ghp_from_the_box', WIN_EV_TOKEN_PATH: 'a'.repeat(40), WIN_CSC_KEY_PASSWORD: '1234', SIGNTOOL_PATH: 'C:/sdk/signtool.exe' };
        try {
          for (const org of orgs) jetpack.dir(path.join(home, `actions-runner-${org}`));
          for (const file of shortcuts) jetpack.write(file, '@echo off\r\n');

          // The rule itself, on the two names.
          const longDir  = path.join(home, 'actions-runner-acme-2');
          const shortDir = path.join(home, 'actions-runner-acme');
          const live     = { pid: 55, sessionId: 1, execPath: path.join(longDir, 'bin', 'Runner.Listener.exe') };
          ctx.expect(runner.isListenerUnder(live.execPath, longDir)).toBe(true);
          ctx.expect(runner.isListenerUnder(live.execPath, shortDir)).toBe(false);
          // Windows spells its paths the other way, whichever OS is asking.
          ctx.expect(runner.isListenerUnder('C:\\r\\actions-runner-acme-2\\bin\\Runner.Listener.exe', 'C:\\r\\actions-runner-acme')).toBe(false);
          ctx.expect(runner.isListenerUnder('C:\\r\\actions-runner-acme\\bin\\Runner.Listener.exe', 'C:\\r\\actions-runner-acme')).toBe(true);

          // …and `start` reading through that rule brings the short org up.
          await runner({
            _: ['runner', 'start'], _home: home, _env: filled, _logger: logger, _interactive: false, _prompt: {},
            _listeners: (dir) => [live].filter((p) => runner.isListenerUnder(p.execPath, dir)),
            _spawn: (dir) => { spawned.push(dir); return { ok: true, pid: 6060 }; },
          });

          ctx.expect(spawned).toEqual([shortDir]);
          ctx.expect(process.exitCode).toBe(origExit);
        } finally {
          if (origForce === undefined) delete process.env.OMEGA_RUNNER_FORCE; else process.env.OMEGA_RUNNER_FORCE = origForce;
          process.exitCode = origExit;
          for (const file of shortcuts) jetpack.remove(file);
          jetpack.remove(home);
        }
      },
    },
    {
      name: '`start` warns about a session-0 listener, skips it, and still exits 0',
      run: async (ctx) => {
        // A session-0 listener is alive but cannot see the cert store, so it
        // fails every job. `start` says so and names `restart`; killing is
        // `stop`'s job, never a start's.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const origForce = process.env.OMEGA_RUNNER_FORCE;
        const origExit  = process.exitCode;
        process.env.OMEGA_RUNNER_FORCE = '1';
        const hostPrefix = `omega-runner-${os.hostname().toLowerCase()}-`;
        const shortcut = path.join(SCRATCH_STARTUP_DIR, `${hostPrefix}acme.cmd`);
        const logged  = [];
        const logger  = { log: (m) => logged.push(['log', String(m)]), warn: (m) => logged.push(['warn', String(m)]), error: (m) => logged.push(['error', String(m)]) };
        const spawned = [];
        const filled  = { GH_TOKEN: 'ghp_from_the_box', WIN_EV_TOKEN_PATH: 'a'.repeat(40), WIN_CSC_KEY_PASSWORD: '1234', SIGNTOOL_PATH: 'C:/sdk/signtool.exe' };
        try {
          jetpack.dir(path.join(home, 'actions-runner-acme'));
          jetpack.write(shortcut, '@echo off\r\n');

          await runner({
            _: ['runner', 'start'], _home: home, _env: filled, _logger: logger, _interactive: false, _prompt: {},
            _listeners: () => [{ pid: 12, sessionId: 0, execPath: 'C:/r/actions-runner-acme/bin/Runner.Listener.exe' }],
            _spawn: (dir) => { spawned.push(dir); return { ok: true, pid: 7070 }; },
          });

          const warns = logged.filter((l) => l[0] === 'warn').map((l) => l[1]).join('\n');
          ctx.expect(warns).toContain('SESSION 0');
          ctx.expect(warns).toContain('PID=12');
          ctx.expect(warns).toContain('runner restart');
          ctx.expect(spawned).toEqual([]);                   // skipped, never killed and never doubled
          ctx.expect(process.exitCode).toBe(origExit);       // still a clean run
        } finally {
          if (origForce === undefined) delete process.env.OMEGA_RUNNER_FORCE; else process.env.OMEGA_RUNNER_FORCE = origForce;
          process.exitCode = origExit;
          jetpack.remove(shortcut);
          jetpack.remove(home);
        }
      },
    },
    {
      name: '`runner config` saves the retyped keys BEFORE the orgs question, and names an org the token no longer administers',
      run: async (ctx) => {
        // The orgs step can refuse (nothing ticked, a token that cannot list,
        // a Ctrl-C). None of that may cost the operator the keys they just
        // retyped — those are written the moment they are answered.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const origForce = process.env.OMEGA_RUNNER_FORCE;
        process.env.OMEGA_RUNNER_FORCE = '1';
        try {
          jetpack.write(path.join(home, '.env'), [
            'GH_TOKEN=ghp_old',
            'OMEGA_RUNNER_ORGS=acme,ghost',
            `WIN_EV_TOKEN_PATH=${'a'.repeat(40)}`,
            'WIN_CSC_KEY_PASSWORD=old-pin',
            'SIGNTOOL_PATH=C:/sdk/signtool.exe',
            'WIN_TIMESTAMP_URL=',
          ].join('\n'));

          const logged = [];
          const logger = { log: (m) => logged.push(['log', String(m)]), warn: (m) => logged.push(['warn', String(m)]), error: (m) => logged.push(['error', String(m)]) };
          const prompt = {
            input:    async ({ message, default: current }) => (message.startsWith('WIN_EV_TOKEN_PATH') ? 'b'.repeat(40) : (current || '')),
            password: async ({ message }) => (message.startsWith('GH_TOKEN') ? 'ghp_new' : ''),
            checkbox: async () => { throw new Error('the operator hit Ctrl-C'); },
          };

          let threw;
          try {
            await runner({
              _: ['runner', 'config'],
              _home: home, _env: {}, _logger: logger, _prompt: prompt, _interactive: true,
              _discoverOrgs: async () => ['acme', 'zed'],
            });
          } catch (e) { threw = e; }
          ctx.expect(threw).toBeDefined();

          // Everything answered before the refusal survived it.
          const written = jetpack.read(path.join(home, '.env'));
          ctx.expect(written).toContain('GH_TOKEN="ghp_new"');
          ctx.expect(written).toContain(`WIN_EV_TOKEN_PATH="${'b'.repeat(40)}"`);
          ctx.expect(written).toContain('WIN_CSC_KEY_PASSWORD="old-pin"');   // Enter kept it, rewritten in place quoted
          ctx.expect(written).toContain('OMEGA_RUNNER_ORGS=acme,ghost');     // the question never finished

          // The saved list named an org the token cannot admin any more: said once, before the checkbox.
          const warns = logged.filter((l) => l[0] === 'warn').map((l) => l[1]).join('\n');
          ctx.expect(warns).toContain('ghost');
          ctx.expect(warns).toContain('no longer administers');
        } finally {
          if (origForce === undefined) delete process.env.OMEGA_RUNNER_FORCE; else process.env.OMEGA_RUNNER_FORCE = origForce;
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'every runner subcommand tees its output to <runner home>/logs/runner.log, appending',
      run: async (ctx) => {
        // The box keeps its own record of what the runner commands did, beside
        // the install. It APPENDS: a `runner start` parent holds the file while
        // every `sign-windows` its listener spawns writes to the same one, and a
        // truncating open would throw the parent's trail away.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));
        const runnerEnv = require(path.join(__dirname, '..', '..', '..', 'utils', 'runner-env.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const origForce = process.env.OMEGA_RUNNER_FORCE;
        process.env.OMEGA_RUNNER_FORCE = '1';
        try {
          const logFile = runnerEnv.runnerLogFile(home);
          ctx.expect(logFile).toBe(path.join(home, 'logs', 'runner.log'));

          jetpack.write(path.join(home, '.env'), [
            'GH_TOKEN="ghp_from_the_box"',
            'OMEGA_RUNNER_ORGS="acme"',
            `WIN_EV_TOKEN_PATH="${'a'.repeat(40)}"`,
            'WIN_CSC_KEY_PASSWORD="1234"',
            'SIGNTOOL_PATH="C:/sdk/signtool.exe"',
          ].join('\n'));

          // Two runs of a real subcommand, on a runner (CI is exactly when the
          // box's record is wanted — the log lives in the runner home, never in
          // a workspace).
          const walk = () => runner({
            _: ['runner', 'config'],
            _home: home, _env: { GITHUB_ACTIONS: 'true' }, _interactive: true,
            _prompt: {
              input:    async ({ default: current }) => current || '',
              password: async () => '',
              checkbox: async () => ['acme'],
            },
            _discoverOrgs: async () => ['acme'],
          });
          await walk();
          await walk();

          const written = jetpack.read(logFile);
          ctx.expect(written).toContain("This box's signing configuration");
          ctx.expect(written).toContain('Saved to');
          ctx.expect((written.match(/# omega log/g) || []).length).toBe(2);   // both runs kept
        } finally {
          if (origForce === undefined) delete process.env.OMEGA_RUNNER_FORCE; else process.env.OMEGA_RUNNER_FORCE = origForce;
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'off Windows a subcommand refuses BEFORE it writes: no runner home left in the cwd',
      run: async (ctx) => {
        // `npx omega runner status` on a Mac used to drop a `.gh-runners/` next
        // to whatever you were standing in, because the log attached before the
        // platform gate ran. The refusal now writes nothing at all.
        if (process.platform === 'win32') return ctx.skip('the platform gate passes on the box — there is no refusal to prove');

        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));
        const runnerEnv = require(path.join(__dirname, '..', '..', '..', 'utils', 'runner-env.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const origForce = process.env.OMEGA_RUNNER_FORCE;
        delete process.env.OMEGA_RUNNER_FORCE;
        try {
          for (const sub of ['status', 'install', 'config', 'start']) {
            let threw;
            try {
              await runner({ _: ['runner', sub], _home: home, _interactive: false });
            } catch (e) { threw = e; }
            ctx.expect(threw).toBeDefined();
            ctx.expect(threw.message).toMatch(/only runs on Windows/);
          }
          ctx.expect(jetpack.exists(runnerEnv.runnerLogFile(home))).toBe(false);
          ctx.expect(jetpack.exists(path.join(home, 'logs'))).toBe(false);

          // An unknown subcommand still says so — the platform gate never speaks
          // for a name no subcommand answers to.
          let threw;
          try {
            await runner({ _: ['runner', 'banana'], _home: home });
          } catch (e) { threw = e; }
          ctx.expect(threw.message).toMatch(/Unknown runner subcommand/);
          ctx.expect(jetpack.exists(path.join(home, 'logs'))).toBe(false);
        } finally {
          if (origForce !== undefined) process.env.OMEGA_RUNNER_FORCE = origForce;
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'install runs the same full walk config does, and pays for the org walk once',
      run: (ctx) => {
        const fs = require('fs');
        const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'), 'utf8');
        const install = src.slice(src.indexOf('async function install('), src.indexOf('// ─── config ─'));
        ctx.expect(install).toContain('reconfigureRunnerEnv(');
        ctx.expect(install).toMatch(/discoverOrgs:\s+discoverAdminOrgs/);
        // The question already listed the admin orgs; install reuses that list
        // and only walks GitHub itself when the question never ran.
        ctx.expect(install).toContain('adminOrgs || await discoverAdminOrgs()');
        // One walk, one path: the missing-keys-only step is not install's any more.
        ctx.expect(install).not.toContain('ensureRunnerConfig');
        ctx.expect(src).not.toContain('askOrgs');
      },
    },
    {
      name: 'the runner gets a private HOME: `<runner home>/home` with a real .gitconfig, delivered by the runner dir\'s .env',
      run: (ctx) => {
        // Why it exists ([#807](https://github.com/Omega-JS-Stack/omega/issues/807)):
        // actions/checkout copies `$HOME/.gitconfig` into a temporary HOME with
        // @actions/io, which recreates a SYMLINK source as a Windows junction,
        // and a junction to a FILE is invalid. The box's `~/.gitconfig` is a
        // dotfiles symlink and must stay one, so the runner is pointed at a
        // HOME of its own instead, holding a real file.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runnerEnv = require(path.join(__dirname, '..', '..', '..', 'utils', 'runner-env.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const runnerDir = path.join(home, 'actions-runner-acme');
        try {
          jetpack.dir(runnerDir);
          ctx.expect(runnerEnv.runnerPrivateHome(home)).toBe(path.join(home, 'home'));

          const result = runnerEnv.ensureRunnerPrivateHome(home);
          ctx.expect(result.home).toBe(path.join(home, 'home'));
          ctx.expect(result.written).toBe(true);
          // The exact bytes, hard-coded: the ONE setting the workflows rely on.
          ctx.expect(fs.readFileSync(path.join(home, 'home', '.gitconfig'), 'utf8')).toBe('[core]\n\tautocrlf = false\n');

          // The listener reads `<runner dir>/.env` at startup and hands it to
          // every job, so one line delivers it to the detached spawn and the
          // Startup shortcut alike. Bare, never quoted: the runner takes the
          // rest of the line as the value, quotes included.
          const file = runnerEnv.ensureRunnerDirEnv(runnerDir, { HOME: result.home });
          ctx.expect(file).toBe(path.join(runnerDir, '.env'));
          ctx.expect(fs.readFileSync(file, 'utf8')).toBe(`HOME=${path.join(home, 'home')}\n`);
        } finally {
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'a second ensure changes nothing: the home, the .gitconfig and the .env come back byte-equal',
      run: (ctx) => {
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runnerEnv = require(path.join(__dirname, '..', '..', '..', 'utils', 'runner-env.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const runnerDir = path.join(home, 'actions-runner-acme');
        try {
          jetpack.dir(runnerDir);
          const first = runnerEnv.ensureRunnerPrivateHome(home);
          runnerEnv.ensureRunnerDirEnv(runnerDir, { HOME: first.home });
          const gitconfig = fs.readFileSync(path.join(first.home, '.gitconfig'), 'utf8');
          const env = fs.readFileSync(path.join(runnerDir, '.env'), 'utf8');

          const second = runnerEnv.ensureRunnerPrivateHome(home);
          runnerEnv.ensureRunnerDirEnv(runnerDir, { HOME: second.home });

          ctx.expect(second.written).toBe(false);
          ctx.expect(fs.readFileSync(path.join(first.home, '.gitconfig'), 'utf8')).toBe(gitconfig);
          ctx.expect(fs.readFileSync(path.join(runnerDir, '.env'), 'utf8')).toBe(env);
        } finally {
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'an existing runner .env keeps its other lines and gains exactly ONE HOME line, in the endings it already uses',
      run: (ctx) => {
        // The file GitHub documents for proxy settings. A box that carries one
        // must keep it: this write adds a line, it does not own the file.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runnerEnv = require(path.join(__dirname, '..', '..', '..', 'utils', 'runner-env.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const runnerDir = path.join(home, 'actions-runner-acme');
        try {
          jetpack.dir(runnerDir);
          fs.writeFileSync(path.join(runnerDir, '.env'), 'https_proxy=http://proxy:8080\r\nHOME=C:\\stale\r\nno_proxy=localhost\r\n');

          const privateHome = runnerEnv.runnerPrivateHome(home);
          runnerEnv.ensureRunnerDirEnv(runnerDir, { HOME: privateHome });
          const contents = fs.readFileSync(path.join(runnerDir, '.env'), 'utf8');

          ctx.expect(contents).toBe(`https_proxy=http://proxy:8080\r\nHOME=${privateHome}\r\nno_proxy=localhost\r\n`);
          ctx.expect(contents.split(/\r?\n/).filter((line) => line.startsWith('HOME=')).length).toBe(1);
        } finally {
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'a runner .env with no HOME line gains one on the line after the last, never after a blank one',
      run: (ctx) => {
        // The file ends with a newline, as a written file does. Splitting that
        // leaves a trailing empty element, and appending after it puts the key
        // below a blank line: legal to read back, but not a file anyone wants
        // to look at, and it grows a second blank line per rewrite.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runnerEnv = require(path.join(__dirname, '..', '..', '..', 'utils', 'runner-env.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const runnerDir = path.join(home, 'actions-runner-acme');
        try {
          jetpack.dir(runnerDir);
          fs.writeFileSync(path.join(runnerDir, '.env'), 'https_proxy=http://proxy:8080\r\nno_proxy=localhost\r\n');

          const privateHome = runnerEnv.runnerPrivateHome(home);
          runnerEnv.ensureRunnerDirEnv(runnerDir, { HOME: privateHome });
          const first = fs.readFileSync(path.join(runnerDir, '.env'), 'utf8');
          ctx.expect(first).toBe(`https_proxy=http://proxy:8080\r\nno_proxy=localhost\r\nHOME=${privateHome}\r\n`);

          // And a second call is the same bytes: nothing appended, no line grown.
          runnerEnv.ensureRunnerDirEnv(runnerDir, { HOME: privateHome });
          ctx.expect(fs.readFileSync(path.join(runnerDir, '.env'), 'utf8')).toBe(first);
        } finally {
          jetpack.remove(home);
        }
      },
    },
    {
      name: 'a .gitconfig that is not the one this command writes is LEFT alone, and said so',
      run: (ctx) => {
        // A human may have edited it on the box. Overwriting someone's file to
        // deliver one setting is never the trade.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runnerEnv = require(path.join(__dirname, '..', '..', '..', 'utils', 'runner-env.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const mine = '[core]\n\tautocrlf = false\n[user]\n\tname = The Box\n';
        const logged = [];
        try {
          jetpack.dir(runnerEnv.runnerPrivateHome(home));
          fs.writeFileSync(path.join(runnerEnv.runnerPrivateHome(home), '.gitconfig'), mine);

          const result = runnerEnv.ensureRunnerPrivateHome(home, { logger: { log: (m) => logged.push(String(m)), warn: (m) => logged.push(String(m)) } });

          ctx.expect(result.written).toBe(false);
          ctx.expect(fs.readFileSync(path.join(result.home, '.gitconfig'), 'utf8')).toBe(mine);
          ctx.expect(logged.join('\n')).toContain(path.join(result.home, '.gitconfig'));
        } finally {
          jetpack.remove(home);
        }
      },
    },
    {
      name: '`start` heals a private HOME the install never had, for every registered org, before a listener comes up',
      run: async (ctx) => {
        // A box installed before #807 has no private home and no HOME line, and
        // the first job it picks up dies in `actions/checkout`. The preflight
        // writes both, so bringing the box online is the whole fix.
        const fs = require('fs');
        const os = require('os');
        const jetpack = require('fs-jetpack');
        const runner = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));

        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-runner-home-'));
        const origForce = process.env.OMEGA_RUNNER_FORCE;
        process.env.OMEGA_RUNNER_FORCE = '1';
        const hostPrefix = `omega-runner-${os.hostname().toLowerCase()}-`;
        const orgs = ['acme', 'zeta'];
        const shortcuts = orgs.map((org) => path.join(SCRATCH_STARTUP_DIR, `${hostPrefix}${org}.cmd`));
        const logged = [];
        const logger = { log: (m) => logged.push(String(m)), warn: (m) => logged.push(String(m)), error: (m) => logged.push(String(m)) };
        const filled = { GH_TOKEN: 'ghp_from_the_box', WIN_EV_TOKEN_PATH: 'a'.repeat(40), WIN_CSC_KEY_PASSWORD: '1234', SIGNTOOL_PATH: 'C:/sdk/signtool.exe' };
        try {
          for (const org of orgs) jetpack.write(path.join(home, `actions-runner-${org}`, 'config.cmd'), '@echo off\r\n');
          for (const file of shortcuts) jetpack.write(file, '@echo off\r\n');
          ctx.expect(jetpack.exists(path.join(home, 'home'))).toBe(false);

          await runner({
            _: ['runner', 'start'], _home: home, _env: filled, _logger: logger, _interactive: false, _prompt: {},
            _listeners: () => [],
            _spawn: () => ({ ok: true, pid: 1000 }),
          });

          ctx.expect(fs.readFileSync(path.join(home, 'home', '.gitconfig'), 'utf8')).toBe('[core]\n\tautocrlf = false\n');
          for (const org of orgs) {
            ctx.expect(fs.readFileSync(path.join(home, `actions-runner-${org}`, '.env'), 'utf8')).toBe(`HOME=${path.join(home, 'home')}\n`);
            ctx.expect(logged.join('\n')).toContain(`HOME for ${org}: ${path.join(home, 'home')}`);
          }
        } finally {
          if (origForce === undefined) delete process.env.OMEGA_RUNNER_FORCE; else process.env.OMEGA_RUNNER_FORCE = origForce;
          for (const file of shortcuts) jetpack.remove(file);
          jetpack.remove(home);
        }
      },
    },
  ],
});
