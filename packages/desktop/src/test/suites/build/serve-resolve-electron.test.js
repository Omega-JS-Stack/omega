// Build-layer tests for gulp/serve's electron resolution.
//
// The launch used to require `<projectRoot>/node_modules/electron` by path, which never
// exists in an npm-workspaces brand (electron hoists to the brand root). We stage that exact
// shape in a temp dir — a hoisted electron, a target dir with none — and resolve from the app.

const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const jetpack = require('fs-jetpack');
const defineCases = require('@omega.js/devkit/test/define-cases');

const servePath = path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'serve.js');

const SENTINEL = '/staged/electron/binary';

// Brand root with a hoisted electron; the target underneath carries none of its own.
function stageHoistedBrand() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-serve-'));
  const pkg = path.join(tmp, 'node_modules', 'electron');

  jetpack.write(path.join(pkg, 'package.json'), JSON.stringify({ name: 'electron', version: '0.0.0', main: 'index.js' }));
  jetpack.write(path.join(pkg, 'index.js'), `module.exports = ${JSON.stringify(SENTINEL)};\n`);
  jetpack.dir(path.join(tmp, 'targets', 'desktop'));

  return { tmp, targetDir: path.join(tmp, 'targets', 'desktop') };
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'gulp/serve — electron resolution',
  tests: [
    {
      name: 'resolveElectron finds the brand-hoisted electron from a target with none',
      run: (ctx) => {
        const { targetDir } = stageHoistedBrand();
        const { resolveElectron } = require(servePath);

        ctx.expect(resolveElectron(targetDir)).toBe(SENTINEL);
      },
    },
    {
      name: 'the old app-local path join cannot see the hoisted copy',
      run: (ctx) => {
        const { targetDir } = stageHoistedBrand();

        let error = null;
        try {
          require(path.join(targetDir, 'node_modules', 'electron'));
        } catch (e) {
          error = e;
        }
        ctx.expect(error && error.code).toBe('MODULE_NOT_FOUND');
      },
    },
  ],
});
