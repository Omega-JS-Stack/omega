// The dev lane treats the whole `.env` chain as a watch input
// ([#681](https://github.com/Omega-JS-Stack/omega/issues/681)).
//
// The backend's stage watch already did — an edit to the brand root's .env
// re-stages and the running emulator sees it — while desktop's gulp read the
// cascade once at boot and never noticed an edit. This pins the PATH
// RESOLUTION the `serve` task wires up (the same level the backend's
// stage-watch test pins): every layer of the chain, and each layer's
// `.env.<environment>` overlay (#586).
//
// Offline by construction: temp dirs and path resolution only, and the watcher
// is closed before the case returns.

const path = require('path');
const fs = require('fs');
const os = require('os');
const jetpack = require('fs-jetpack');

const SRC = path.join(__dirname, '..', '..', '..');
const serveTask = require(path.join(SRC, 'gulp', 'tasks', 'serve.js'));
const defineCases = require('@omega.js/devkit/test/define-cases');

// A desktop target inside a brand monorepo, with a company root above it:
// <root>/company/.env, <root>/brand/.env, <root>/brand/targets/desktop/.
function seedBrand() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-env-watch-')));
  const companyRoot = path.join(root, 'company');
  const brandRoot = path.join(root, 'brand');
  const targetDir = path.join(brandRoot, 'targets', 'desktop');

  jetpack.write(path.join(companyRoot, '.env'), '');
  jetpack.write(path.join(brandRoot, '.omega', 'company.json'), JSON.stringify({ root: companyRoot }));
  jetpack.write(path.join(brandRoot, 'config', 'omega.json5'), '{ brand: { id: "fixture" }, targets: { desktop: {} } }');
  jetpack.dir(targetDir);

  return { root, companyRoot, brandRoot, targetDir };
}

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'env-watch (#681) — the dev lane watches every layer of the .env chain',
  tests: [
    {
      name: 'the serve watcher lists company, brand and target — overlays included',
      run: (ctx) => {
        const { root, companyRoot, brandRoot, targetDir } = seedBrand();
        const watcher = serveTask.watchEnvSources(targetDir, { environment: 'development' });

        try {
          ctx.expect(watcher.inputs.map((input) => input.path)).toEqual([
            path.join(companyRoot, '.env'),
            path.join(companyRoot, '.env.development'),
            path.join(brandRoot, '.env'),
            path.join(brandRoot, '.env.development'),
            path.join(targetDir, '.env'),
            path.join(targetDir, '.env.development'),
          ]);
          ctx.expect(watcher.inputs.map((input) => input.layer)).toEqual([
            'company', 'company', 'brand', 'brand', 'target', 'target',
          ]);
        } finally {
          watcher.close();
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'a standalone target watches only its own .env layer',
      run: (ctx) => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-env-watch-solo-')));
        const watcher = serveTask.watchEnvSources(root, { environment: 'development' });

        try {
          ctx.expect(watcher.inputs.map((input) => input.path)).toEqual([
            path.join(root, '.env'),
            path.join(root, '.env.development'),
          ]);
        } finally {
          watcher.close();
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
  ],
});
