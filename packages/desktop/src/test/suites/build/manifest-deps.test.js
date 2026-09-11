// Build-layer test: a library the runtime source requires by BARE specifier is
// DECLARED by this package ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
//
// The class of bug: on a laptop the monorepo root hoists every workspace's deps
// into one node_modules, so `require('sharp')` resolves from packages/desktop even
// though the desktop manifest never named it. The packed tarball a runner installs
// carries only what the manifest declares, and the first mac CI publish died on
// `Cannot find module 'sharp'` inside resolve-icons.js. Nothing about that failure
// was visible locally, so the manifest is checked HERE instead.
//
// Scope: src/lib and src/gulp, the two trees that run unbundled from the installed
// package (main-process libs and the gulp build lane). Internal `@omega.js/*`
// packages are excluded: the prepare lane vendors them into dist/vendor and rewires
// the requires, so they are never resolved by name from an install.

const path = require('path');
const fs = require('fs');
const { builtinModules } = require('module');
const defineCases = require('@omega.js/devkit/test/define-cases');

const PACKAGE_ROOT = path.join(__dirname, '..', '..', '..', '..');
const SOURCE_DIRS = ['lib', 'gulp'];

// The two specifiers that are ALLOWED to be undeclared, each one required inside a
// try/catch whose catch is the documented behaviour, not a crash:
//   firebase        @omega.js/client's own dependency; the client bridge falls back
//                   to no-op mode when it is not there (lib/client-bridge.js)
//   app-builder-bin electron-builder's own dependency; blockmap generation is
//                   best-effort and warns-and-skips (lib/sign-helpers/update-info.js)
const GUARDED = new Set(['firebase', 'app-builder-bin']);

// Every bare specifier `require`d under a dir, as package names.
function requiredPackages(dir) {
  const names = new Map();

  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);

      if (entry.isDirectory()) {
        walk(file);
        continue;
      }
      if (!entry.name.endsWith('.js')) {
        continue;
      }

      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const specifier = match[1];
        if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
          continue;
        }

        const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
        if (builtinModules.includes(name)) {
          continue;
        }

        if (!names.has(name)) {
          names.set(name, path.relative(PACKAGE_ROOT, file));
        }
      }
    }
  };

  walk(dir);

  return names;
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'manifest deps: what the runtime source requires, the package declares (#872)',
  tests: [
    {
      name: 'every bare require under src/lib and src/gulp is declared by the manifest',
      run: (ctx) => {
        const pkg = require(path.join(PACKAGE_ROOT, 'package.json'));
        // dependencies ship inside the tarball; peers and optionals are installed
        // beside it (ensureTarget installs the peers on every verb).
        const declared = new Set([
          ...Object.keys(pkg.dependencies || {}),
          ...Object.keys(pkg.peerDependencies || {}),
          ...Object.keys(pkg.optionalDependencies || {}),
        ]);

        const undeclared = [];
        for (const dir of SOURCE_DIRS) {
          for (const [name, file] of requiredPackages(path.join(PACKAGE_ROOT, 'src', dir))) {
            // The package requiring ITSELF is node's self-reference through the
            // exports map, and the internal packages are vendored at prepare time.
            if (name === pkg.name || name.startsWith('@omega.js/') || GUARDED.has(name)) {
              continue;
            }
            if (!declared.has(name)) {
              undeclared.push(`${name} (${file})`);
            }
          }
        }

        ctx.expect(undeclared).toEqual([]);
      },
    },
    {
      name: 'sharp, the icon pipeline it was missing, is a dependency and not a hoisted accident',
      run: (ctx) => {
        const pkg = require(path.join(PACKAGE_ROOT, 'package.json'));

        ctx.expect(Boolean(pkg.dependencies.sharp)).toBe(true);
        ctx.expect(fs.readFileSync(path.join(PACKAGE_ROOT, 'src', 'lib', 'sign-helpers', 'resolve-icons.js'), 'utf8')).toContain("require('sharp')");
      },
    },
  ],
});
