// The renderer bundle's output key
// ([#806](https://github.com/Omega-JS-Stack/omega/issues/806)).
//
// esbuild writes one `[name].bundle.js` per entry KEY, and the key comes from
// the path glob hands back for `src/assets/js/components/<name>/index.js`. On
// Windows glob returns `settings\index.js`, so a derivation that strips a
// forward-slash `/index.js` leaves EVERY key spelled `index.js`: about, main
// and settings then all claim `index.js.bundle.js` and the package run dies on
// "Two output files share the same path but have different contents". The
// derivation therefore accepts either separator, and the same entry, spelled
// either way, names the same bundle.

const path = require('path');
const defineCases = require('@omega.js/devkit/test/define-cases');

const FRAMEWORK_ROOT = path.join(__dirname, '..', '..', '..', '..');
const { rendererEntryKey } = require(path.join(FRAMEWORK_ROOT, 'src', 'gulp', 'tasks', 'bundle.js'));

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'renderer entry keys (#806): one bundle name per component, on every platform',
  tests: [
    {
      name: 'a posix relative path names the component directory',
      run: (ctx) => {
        ctx.expect(rendererEntryKey('settings/index.js')).toBe('settings');
      },
    },
    {
      name: 'the Windows spelling of the same entry names the same bundle',
      run: (ctx) => {
        ctx.expect(rendererEntryKey('settings\\index.js')).toBe('settings');
      },
    },
  ],
});
