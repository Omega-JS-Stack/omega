// Build-layer tests for the locked-console refusal. The process list is
// injected, so both verdicts are provable without a Windows box.

const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const lock = require(path.join(__dirname, '..', '..', '..', 'lib', 'sign-helpers', 'console-lock.js'));

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'console-lock — LogonUI.exe in the process list is a locked console',
  tests: [
    {
      name: "tasklist's CSV with the lock-screen process reads as locked, without it as not",
      run: (ctx) => {
        ctx.expect(lock.isConsoleLocked('"LogonUI.exe","2012","Console","1","71,284 K"\r\n')).toBe(true);
        ctx.expect(lock.isConsoleLocked('INFO: No tasks are running which match the specified criteria.')).toBe(false);
        ctx.expect(lock.isConsoleLocked('')).toBe(false);
      },
    },
    {
      name: 'a locked console is refused, naming LogonUI.exe and the fix',
      run: async (ctx) => {
        const ran = [];
        const exec = (out) => async (cmd) => { ran.push(cmd); return out; };

        let threw;
        try {
          await lock.assertConsoleUnlocked({ platform: 'win32', exec: exec('"LogonUI.exe","2012","Console","1","71,284 K"') });
        } catch (e) { threw = e; }
        ctx.expect(threw).toBeDefined();
        ctx.expect(threw.message).toMatch(/console session is locked/);
        ctx.expect(threw.message).toMatch(/LogonUI\.exe/);
        ctx.expect(threw.message).toMatch(/Unlock the box/);
        // The filter and the headerless CSV are what isConsoleLocked reads.
        ctx.expect(ran).toEqual(['tasklist /fi "IMAGENAME eq LogonUI.exe" /fo csv /nh']);

        await lock.assertConsoleUnlocked({ platform: 'win32', exec: exec('INFO: No tasks are running which match the specified criteria.') });
      },
    },
    {
      name: 'off Windows there is no lock screen and nothing is run',
      run: async (ctx) => {
        const ran = [];
        await lock.assertConsoleUnlocked({ platform: 'darwin', exec: async (cmd) => { ran.push(cmd); return '"LogonUI.exe"'; } });
        ctx.expect(ran).toEqual([]);
      },
    },
  ],
});
