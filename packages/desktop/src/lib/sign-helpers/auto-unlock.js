// Auto-unlocks SafeNet / eToken password dialogs that signtool triggers when
// using a SafeNet-managed EV cert (selected via /sha1 thumbprint).
//
// Strategy: in parallel with the signtool invocation, poll the Win32 window
// list (via automately.getWindows() — a single native call, ~1-5ms) looking
// for a "Token Logon" window. When detected, type the password + Enter via
// automately (a maintained nutjs fork), then watch the dialog for a few seconds:
// a dialog that stays open after typing means the keystrokes did not reach it
// (a locked console does exactly that, [#864](https://github.com/Omega-JS-Stack/omega/issues/864)),
// and that is said out loud instead of leaving signtool's silence unexplained.
//
// Falls back to a no-op if:
//   - automately isn't installed (optional dep, may have failed to compile)
//   - WIN_CSC_KEY_PASSWORD isn't set (signing in thumbprint mode without auto-unlock)
//   - not on Windows
//
// Returns { stop } so the caller can cancel polling once signtool finishes.

let automately;
try {
  automately = require('automately');
} catch (e) {
  automately = null;
}

const TIMINGS = {
  pollIntervalMs: 500,    // automately.getWindows() is fast — poll twice a second
  pollTimeoutMs:  60000,
  preTypeDelayMs: 2000,   // safety wait after detecting dialog before typing
  perCharDelayMs: 60,     // small delay between keystrokes — some dialogs drop chars on fast input
  confirmMs:      10000,  // how long a typed-into dialog gets to close before that is reported
};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// The two things the helper does to the desktop, behind one seam so the loop
// above them is provable without a desktop.
function automatelyDriver() {
  return {
    findTokenLogonWindow: async () => {
      const windows = await automately.getWindows();
      for (const w of windows) {
        let title = '';
        try { title = await w.title; } catch (e) { continue; }
        if (title && title.startsWith('Token Logon')) return title;
      }
      return null;
    },
    typeText:   (text) => automately.keyboard.type(text),
    pressEnter: () => automately.keyboard.type(automately.Key.Enter),
  };
}

function startAutoUnlock({ password, logger, driver, timings, platform }) {
  platform = platform || process.platform;
  if (platform !== 'win32') return { stop: () => {} };
  if (!password) return { stop: () => {} };
  if (!driver && !automately) {
    if (logger) logger.warn('automately not installed — SafeNet password prompt will need manual entry. Run `npm install` in the @omega.js/desktop repo to enable auto-unlock.');
    return { stop: () => {} };
  }
  driver  = driver || automatelyDriver();
  timings = { ...TIMINGS, ...(timings || {}) };

  let stopped = false;
  let typed   = false;
  const startedAt = Date.now();

  (async function poll() {
    let attempt = 0;
    while (!stopped && !typed && Date.now() - startedAt < timings.pollTimeoutMs) {
      attempt += 1;
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      const pollStart = Date.now();
      let title = null;
      try {
        title = await driver.findTokenLogonWindow();
      } catch (e) {
        if (logger) logger.log(`auto-unlock: poll ${attempt} (${elapsed}s) — getWindows error: ${e.message}`);
      }
      const pollMs = Date.now() - pollStart;

      if (title) {
        if (logger) logger.log(`auto-unlock: SafeNet Token Logon dialog detected (attempt ${attempt}, ${elapsed}s, poll took ${pollMs}ms) — title: "${title}" — waiting ${timings.preTypeDelayMs}ms before typing...`);
        await sleep(timings.preTypeDelayMs);

        if (logger) logger.log(`auto-unlock: typing password (${password.length} chars, ~${timings.perCharDelayMs}ms each)...`);
        for (const ch of password) {
          if (stopped) return;
          await driver.typeText(ch);
          await sleep(timings.perCharDelayMs);
        }
        await driver.pressEnter();
        typed = true;
        if (logger) logger.log('auto-unlock: password typed + Enter pressed.');
        await confirmDialogClosed();
        return;
      }

      if (logger) logger.log(`auto-unlock: poll ${attempt} (${elapsed}s, took ${pollMs}ms) — no Token Logon window`);
      await sleep(timings.pollIntervalMs);
    }
    if (!typed && !stopped && logger) logger.warn(`auto-unlock: timed out after ${Math.round(timings.pollTimeoutMs / 1000)}s without seeing the Token Logon dialog`);
  })().catch((e) => {
    if (logger) logger.warn(`auto-unlock: poll error: ${e.message}`);
  });

  // The dialog closing is the only proof the keystrokes landed in it.
  async function confirmDialogClosed() {
    const typedAt = Date.now();
    while (!stopped && Date.now() - typedAt < timings.confirmMs) {
      await sleep(timings.pollIntervalMs);
      let title = null;
      try {
        title = await driver.findTokenLogonWindow();
      } catch (e) {
        if (logger) logger.log(`auto-unlock: confirm poll — getWindows error: ${e.message}`);
        title = 'unknown';
      }
      if (!title) {
        if (logger) logger.log('auto-unlock: Token Logon dialog closed.');
        return;
      }
    }
    if (!stopped && logger) logger.warn(`auto-unlock: the Token Logon dialog is still open ${Math.round(timings.confirmMs / 1000)}s after typing — the keystrokes did not reach it. Is the console session locked?`);
  }

  return {
    stop: () => { stopped = true; },
  };
}

module.exports = { startAutoUnlock };
