// Verifies all package.json `exports` resolve to valid module files.

const path = require('path');
const fs = require('fs');

const build = require('../../../build.js');
const defineCases = require('@omega.js/devkit/test/define-cases');
const pkg = build.getPackage('main');
const root = build.getRootPath('main');

module.exports = defineCases({
  type: 'group',
  layer: 'build',
  description: 'Package exports',
  tests: [
    {
      name: 'all exported subpaths resolve to existing files',
      run: (ctx) => {
        const entries = Object.entries(pkg.exports);
        ctx.expect(entries.length).toBeGreaterThan(0);

        for (const [subpath, target] of entries) {
          const filePath = path.join(root, target);
          if (!fs.existsSync(filePath)) {
            throw new Error(`Export "${subpath}" → ${target} does not exist on disk.`);
          }
        }
      },
    },
    {
      // main and preload load anywhere and export their instance; the renderer
      // needs its preload's window.desktop, so omega.test.js loads it with one
      name: 'main / preload / build all loadable',
      run: (ctx) => {
        const fromDist = (subpath) => path.join(root, 'dist', subpath);
        ctx.expect(typeof require(fromDist('main.js'))).toBe('object');
        ctx.expect(typeof require(fromDist('preload.js'))).toBe('object');
        ctx.expect(typeof require(fromDist('build.js'))).toBe('object');
      },
    },
    {
      name: 'every lib module exports a singleton or constructor',
      run: (ctx) => {
        const libDir = path.join(root, 'dist', 'lib');
        // Skip leading-underscore files — they're internal utilities (mixins, helpers)
        // shared between libs, not Electron-feature singletons.
        const files = fs.readdirSync(libDir).filter((f) => f.endsWith('.js') && !f.startsWith('_'));
        ctx.expect(files.length).toBeGreaterThan(0);

        for (const file of files) {
          const mod = require(path.join(libDir, file));
          if (mod === null || mod === undefined) {
            throw new Error(`lib/${file} exports null/undefined`);
          }
          // Loggers are constructors; everything else is a singleton object with initialize()
          const isLogger = file.startsWith('logger');
          if (!isLogger && typeof mod.initialize !== 'function') {
            throw new Error(`lib/${file} singleton missing initialize() method`);
          }
        }
      },
    },
  ],
});
