// Build-layer tests for gulp/serve's electron resolution.
//
// The launch used to require `<projectRoot>/node_modules/electron` by path, which never
// exists in an npm-workspaces brand (electron hoists to the brand root). We stage that exact
// shape in a temp dir — a hoisted electron, an app dir with none — and resolve from the app.

const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const jetpack = require('fs-jetpack');

const servePath = path.join(__dirname, '..', '..', '..', 'gulp', 'tasks', 'serve.js');

const SENTINEL = '/staged/electron/binary';

// Brand root with a hoisted electron; the app underneath carries none of its own.
function stageHoistedBrand() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-serve-'));
  const pkg = path.join(tmp, 'node_modules', 'electron');

  jetpack.write(path.join(pkg, 'package.json'), JSON.stringify({ name: 'electron', version: '0.0.0', main: 'index.js' }));
  jetpack.write(path.join(pkg, 'index.js'), `module.exports = ${JSON.stringify(SENTINEL)};\n`);
  jetpack.dir(path.join(tmp, 'apps', 'desktop'));

  return { tmp, appDir: path.join(tmp, 'apps', 'desktop') };
}

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'gulp/serve — electron resolution',
  tests: [
    {
      name: 'resolveElectron finds the brand-hoisted electron from an app with none',
      run: (ctx) => {
        const { appDir } = stageHoistedBrand();
        const { resolveElectron } = require(servePath);

        ctx.expect(resolveElectron(appDir)).toBe(SENTINEL);
      },
    },
    {
      name: 'the old app-local path join cannot see the hoisted copy',
      run: (ctx) => {
        const { appDir } = stageHoistedBrand();

        let error = null;
        try {
          require(path.join(appDir, 'node_modules', 'electron'));
        } catch (e) {
          error = e;
        }
        ctx.expect(error && error.code).toBe('MODULE_NOT_FOUND');
      },
    },
  ],
};
