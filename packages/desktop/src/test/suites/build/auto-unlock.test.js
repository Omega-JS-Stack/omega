// Build-layer tests for the SafeNet PIN watcher. The desktop it types into is
// behind a driver seam, so what is proven here is the loop: the dialog is found,
// the PIN and Enter go in, and the dialog closing (or not) is reported.

const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const { startAutoUnlock } = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'auto-unlock.js'));

// Milliseconds, so a case is over in well under a second.
const FAST = { pollIntervalMs: 5, pollTimeoutMs: 500, preTypeDelayMs: 1, perCharDelayMs: 0, confirmMs: 60 };

function fakeLogger() {
  const lines = [];
  return {
    lines,
    log:  (m) => lines.push(`log: ${m}`),
    warn: (m) => lines.push(`warn: ${m}`),
  };
}

async function waitFor(check, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`waitFor: condition not met within ${ms}ms`);
}

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'auto-unlock — the Token Logon watcher, typed and confirmed',
  tests: [
    {
      name: 'the PIN and Enter go into the dialog, and the dialog closing is reported',
      run: async (ctx) => {
        const logger = fakeLogger();
        const typed  = [];
        let open = true;
        const driver = {
          findTokenLogonWindow: async () => (open ? 'Token Logon' : null),
          typeText:   async (t) => typed.push(t),
          pressEnter: async () => { typed.push('<Enter>'); open = false; },
        };

        const unlock = startAutoUnlock({ password: 'ab1', logger, driver, timings: FAST, platform: 'win32' });
        await waitFor(() => logger.lines.some((l) => l.includes('dialog closed')), 2000);
        unlock.stop();

        ctx.expect(typed).toEqual(['a', 'b', '1', '<Enter>']);
        ctx.expect(logger.lines.some((l) => l.includes('password typed + Enter pressed'))).toBe(true);
        ctx.expect(logger.lines.some((l) => l.startsWith('warn:'))).toBe(false);
      },
    },
    {
      name: 'a dialog still open after typing is called out: the keystrokes did not reach it',
      run: async (ctx) => {
        // A locked console does exactly this ([#864](https://github.com/Omega-JS-Stack/omega/issues/864)):
        // the window is enumerable, the keys land on the lock screen.
        const logger = fakeLogger();
        const driver = {
          findTokenLogonWindow: async () => 'Token Logon',
          typeText:   async () => {},
          pressEnter: async () => {},
        };

        const unlock = startAutoUnlock({ password: 'ab1', logger, driver, timings: FAST, platform: 'win32' });
        await waitFor(() => logger.lines.some((l) => l.includes('still open')), 2000);
        unlock.stop();

        const warning = logger.lines.find((l) => l.includes('still open'));
        ctx.expect(warning.startsWith('warn:')).toBe(true);
        ctx.expect(warning).toMatch(/keystrokes did not reach it/);
        ctx.expect(warning).toMatch(/console session locked/);
      },
    },
    {
      name: 'no dialog within the poll window is a warning, and stop() ends the watch silently',
      run: async (ctx) => {
        const logger = fakeLogger();
        const driver = {
          findTokenLogonWindow: async () => null,
          typeText:   async () => { throw new Error('nothing should be typed'); },
          pressEnter: async () => { throw new Error('nothing should be typed'); },
        };

        startAutoUnlock({ password: 'ab1', logger, driver, timings: FAST, platform: 'win32' });
        await waitFor(() => logger.lines.some((l) => l.includes('timed out')), 2000);

        // Stopped watchers say nothing more: signtool finished on its own.
        const quiet = fakeLogger();
        const unlock = startAutoUnlock({ password: 'ab1', logger: quiet, driver, timings: FAST, platform: 'win32' });
        unlock.stop();
        await new Promise((r) => setTimeout(r, FAST.pollTimeoutMs + 50));
        ctx.expect(quiet.lines.some((l) => l.startsWith('warn:'))).toBe(false);

        // Off Windows, or with no PIN, the watcher is a no-op.
        ctx.expect(typeof startAutoUnlock({ password: 'x', driver, platform: 'darwin' }).stop).toBe('function');
        ctx.expect(typeof startAutoUnlock({ password: '', driver, platform: 'win32' }).stop).toBe('function');
      },
    },
  ],
});
