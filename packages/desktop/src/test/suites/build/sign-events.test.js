// Build-layer tests for the signing event log. Two things matter and neither
// needs a Windows box: WHERE the file lands, and that a first write into a
// directory nobody created yet actually lands instead of being dropped.

const fs = require('fs');
const os = require('os');
const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const eventsPath = path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'sign-events.js');
const runner     = require(path.join(__dirname, '..', '..', '..', 'commands', 'runner.js'));
const signEvents = require(eventsPath);

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'sign-events — log path resolution + first write',
  tests: [
    {
      name: 'OMEGA_SIGN_LOG wins over everything',
      run: (ctx) => {
        ctx.expect(signEvents.resolveLogPath({
          OMEGA_SIGN_LOG:    '/tmp/explicit.log',
          OMEGA_RUNNER_HOME: '/tmp/home',
        }, 'win32')).toBe('/tmp/explicit.log');
      },
    },
    {
      name: 'OMEGA_RUNNER_HOME is next — the log sits beside the runner it belongs to',
      run: (ctx) => {
        ctx.expect(signEvents.resolveLogPath({ OMEGA_RUNNER_HOME: '/tmp/home' }, 'win32'))
          .toBe(path.join('/tmp/home', 'omega-signing.log'));
      },
    },
    {
      name: 'the Windows default follows defaultRunnerHome(), not a hardcoded C:\\actions-runners',
      run: (ctx) => {
        // The regression: this used to return C:\actions-runners\omega-signing.log,
        // a path the per-user install stopped creating in any version, so every
        // event was dropped on a box that had not set OMEGA_RUNNER_HOME.
        const env = { LOCALAPPDATA: path.join('C:', 'Users', 'ian', 'AppData', 'Local') };
        ctx.expect(signEvents.resolveLogPath(env, 'win32'))
          .toBe(path.join(runner.defaultRunnerHome('win32', env), 'omega-signing.log'));
        ctx.expect(signEvents.resolveLogPath(env, 'win32')).not.toMatch(/actions-runners/);
      },
    },
    {
      name: 'off Windows: the CI root, then logs/signing.log',
      run: (ctx) => {
        ctx.expect(signEvents.resolveLogPath({ RUNNER_WORKSPACE: '/ci/work' }, 'darwin'))
          .toBe(path.join('/ci/work', 'omega-signing.log'));
        ctx.expect(signEvents.resolveLogPath({}, 'darwin'))
          .toBe(path.join(process.cwd(), 'logs', 'signing.log'));
      },
    },
    {
      name: 'the first emit creates the parent directory instead of dropping the event',
      run: (ctx) => {
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-sign-events-'));
        const target  = path.join(scratch, 'never-created', 'omega-signing.log');
        const origLog = process.env.OMEGA_SIGN_LOG;

        // Re-require the module so it resolves against our scratch path — this
        // exercises the real emit(), not a test-only seam.
        const resolved = require.resolve(eventsPath);
        delete require.cache[resolved];
        process.env.OMEGA_SIGN_LOG = target;

        try {
          const fresh = require(resolved);
          ctx.expect(fresh.getLogPath()).toBe(target);
          fresh.emit('sign-start', { file: 'App.exe', mode: 'thumbprint' });

          ctx.expect(fs.existsSync(target)).toBe(true);
          const written = JSON.parse(fs.readFileSync(target, 'utf8').trim());
          ctx.expect(written.event).toBe('sign-start');
          ctx.expect(written.file).toBe('App.exe');
          ctx.expect(written.mode).toBe('thumbprint');
          ctx.expect(typeof written.ts).toBe('string');
        } finally {
          delete require.cache[resolved];
          if (origLog === undefined) delete process.env.OMEGA_SIGN_LOG;
          else process.env.OMEGA_SIGN_LOG = origLog;
          require(resolved);   // restore the process-wide instance
          fs.rmSync(scratch, { recursive: true, force: true });
        }
      },
    },
  ],
});
