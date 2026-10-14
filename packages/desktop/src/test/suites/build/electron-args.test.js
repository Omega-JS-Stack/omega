// Build-layer tests for the Electron launch args. A Linux CI runner cannot start
// Electron's SUID sandbox, so the drivers launch with `--no-sandbox` there and
// unchanged everywhere else. The boot case drives the spawn seam with an injected child.

const path = require('path');
const os = require('os');
const fs = require('fs');
const { EventEmitter } = require('events');
const jetpack = require('fs-jetpack');
const defineCases = require('@omega.js/devkit/test/define-cases');

const runnersDir = path.join(__dirname, '..', '..', 'runners');
const { electronArgs } = require(path.join(runnersDir, 'app-child.js'));
const { runBootChild } = require(path.join(runnersDir, 'boot.js'));

// The spawn seam's child: the surface runBootChild touches, and `end(code)`
// emitting `exit` then `close` as a real child does.
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  child.end = (code) => { child.emit('exit', code, null); child.emit('close', code, null); };
  return child;
}

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'electron launch args: --no-sandbox on a Linux CI runner, unchanged elsewhere',
  tests: [
    {
      name: 'GITHUB_ACTIONS=true on linux launches with --no-sandbox',
      run: (ctx) => {
        ctx.expect(electronArgs('/x', { env: { GITHUB_ACTIONS: 'true' }, platform: 'linux' })).toEqual(['--no-sandbox', '/x']);
      },
    },
    {
      name: 'CI=true on linux launches with --no-sandbox',
      run: (ctx) => {
        ctx.expect(electronArgs('/x', { env: { CI: 'true' }, platform: 'linux' })).toEqual(['--no-sandbox', '/x']);
      },
    },
    {
      name: 'a CI env on darwin launches unchanged',
      run: (ctx) => {
        ctx.expect(electronArgs('/x', { env: { GITHUB_ACTIONS: 'true', CI: 'true' }, platform: 'darwin' })).toEqual(['/x']);
      },
    },
    {
      name: 'an empty env on linux launches unchanged',
      run: (ctx) => {
        ctx.expect(electronArgs('/x', { env: {}, platform: 'linux' })).toEqual(['/x']);
      },
    },
    {
      // The CI env and platform are handed in, never read off this host,
      // so the case proves the Linux CI launch from any machine.
      name: 'the boot runner spawns Electron with the args electronArgs builds',
      run: async (ctx) => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-electron-args-')));
        const specFile = path.join(root, 'spec.json');
        jetpack.write(specFile, '{}');
        const child = fakeChild();
        let spawnedArgs = null;

        const pending = runBootChild({
          electronBin:   '/not/spawned/electron',
          entry:         root,
          platform:      'linux',
          childEnv:      { GITHUB_ACTIONS: 'true' },
          effectiveRoot: root,
          specFile,
          cases:         [],
          report:        () => {},
          spawnFn:       (bin, args) => { spawnedArgs = args; return child; },
          timeoutMs:     5000,
          killGraceMs:   20,
        });
        child.end(0);
        await pending;

        ctx.expect(spawnedArgs).toEqual(['--no-sandbox', root]);
        jetpack.remove(root);
      },
    },
  ],
});
