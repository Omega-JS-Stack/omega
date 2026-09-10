// Is the box's console session locked? The Token Logon dialog the SafeNet
// driver raises renders on the interactive desktop, and the auto-unlock helper
// types the PIN into whatever holds keyboard focus there. Behind a lock screen
// the dialog still exists (the window poll enumerates it) but every keystroke
// lands on the lock screen, so signtool waits for a PIN that never arrives
// ([#864](https://github.com/Omega-JS-Stack/omega/issues/864): a Windows Update
// restart auto-signed the box in and locked it, and the sign job hung six hours).
//
// Windows shows the lock screen through LogonUI.exe, which exits on unlock, so
// its presence in the process list IS the locked state.

const { execute } = require('node-powertools');

const TASKLIST_CMD = 'tasklist /fi "IMAGENAME eq LogonUI.exe" /fo csv /nh';

// Pure: read tasklist's CSV for the lock-screen process.
function isConsoleLocked(tasklistOutput) {
  return /"LogonUI\.exe"/i.test(String(tasklistOutput || ''));
}

// Throw, naming the cause and the fix, when the console is locked. Off Windows
// there is no lock screen to check.
async function assertConsoleUnlocked(options) {
  options = options || {};
  const platform = options.platform || process.platform;
  const exec     = options.exec || ((cmd) => execute(cmd, { log: false }));
  if (platform !== 'win32') return;

  if (isConsoleLocked(await exec(TASKLIST_CMD))) {
    throw new Error('The console session is locked (LogonUI.exe is running), so the PIN cannot reach the Token Logon dialog. Unlock the box (a Windows Update restart leaves it locked) and re-run.');
  }
}

module.exports = { isConsoleLocked, assertConsoleUnlocked };
