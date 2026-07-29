// Framework-provided dependencies (#87), webpack half: a CONSUMER module requires any
// library @omega.js/desktop declares by BARE specifier and it resolves from the
// FRAMEWORK's own installation — the framework's copy wins even when the consumer
// installed its own. The mechanism is the ORDER of the shared `resolve.modules` in
// gulp/tasks/webpack.js (framework's node_modules before the consumer's), so these
// tests compile a real consumer entry with that exact resolve config and read the
// resolved module paths back out of `stats.toJson({ modules: true })`.
//
// Both consumer layers live in a temp dir OUTSIDE this monorepo and carry their own
// node_modules — the same layouts npm produces for a real brand: shared/hoisted copies
// in the consumer's node_modules, and a framework-private nested copy exactly when the
// consumer declares a conflicting version.

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const webpack = require(require.resolve('webpack', { paths: [FRAMEWORK_ROOT] }));
const { makeSharedResolve } = require(path.join(FRAMEWORK_ROOT, 'src', 'gulp', 'tasks', 'webpack.js'));

// Framework-declared deps sampled by the first test: two bare CJS packages plus a
// subpath import, all of them real `dependencies` of @omega.js/desktop.
const SAMPLE = ['fs-jetpack', 'js-yaml', 'lodash/merge'];

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function writePackage(dir, name, version, extra) {
  write(path.join(dir, 'package.json'), JSON.stringify({ name, version, main: 'index.js', ...extra }));
}

function packageName(spec) {
  return spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
}

// The installed COPY a specifier resolves to from `fromRoot` — the package directory,
// not the entry file: which FILE inside it a bundle lands on is chosen by the target's
// export conditions (a web build takes the browser entry where node's require takes the
// CJS one), while the contract here is about which copy.
function packageDirFor(spec, fromRoot) {
  const name   = packageName(spec);
  const marker = `${path.sep}node_modules${path.sep}${name}${path.sep}`;
  const entry  = require.resolve(spec, { paths: [fromRoot] });
  return entry.slice(0, entry.indexOf(marker) + marker.length - 1);
}

// Compile `entry` with the shared resolve config the desktop webpack task builds for
// this (projectRoot, frameworkRoot) pair, and return the module list.
function compile({ projectRoot, frameworkRoot }) {
  return new Promise((resolve, reject) => {
    webpack({
      mode:    'development',
      devtool: false,
      target:  'electron-main',
      entry:   path.join(projectRoot, 'src', 'entry.js'),
      output:  { path: path.join(projectRoot, 'dist'), filename: 'entry.bundle.js' },
      resolve: makeSharedResolve(projectRoot, frameworkRoot),
    }, (err, stats) => {
      if (err) return reject(err);
      const json = stats.toJson({ modules: true, errors: true });
      if (json.errors?.length) return reject(new Error(json.errors.map((e) => e.message || e).join('\n')));
      resolve(json.modules);
    });
  });
}

// The module webpack resolved for a given bare specifier.
function resolvedFor(modules, spec) {
  const mod = modules.find((m) => (m.reasons || []).some((r) => r.userRequest === spec));
  return mod && mod.nameForCondition;
}

// A real consumer install: the framework's deps hoisted into the consumer's own
// node_modules (symlinked to the real installed copies), no nested copies anywhere.
function stageHoistedConsumer(specs) {
  // realpath: macOS' /var is a symlink to /private/var, and the resolved module
  // paths webpack reports are real paths.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-desktop-framework-deps-')));
  writePackage(root, 'consumer-app', '1.0.0');

  specs.forEach((spec) => {
    const link = path.join(root, 'node_modules', packageName(spec));
    fs.mkdirSync(path.dirname(link), { recursive: true });
    if (!fs.existsSync(link)) fs.symlinkSync(packageDirFor(spec, FRAMEWORK_ROOT), link, 'dir');
  });

  write(path.join(root, 'src', 'entry.js'), specs.map((s) => `require(${JSON.stringify(s)});`).join('\n'));
  return root;
}

// A real consumer install with a CONFLICT: the consumer declares its own version of
// `dupe-pkg`, so npm keeps that copy hoisted and nests the framework's version under
// the framework package. `shared-pkg` has no conflict — one hoisted copy for both.
function stageConflictInstall() {
  const root      = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-desktop-framework-deps-dupe-')));
  const consumerNm = path.join(root, 'node_modules');
  const frameworkRoot = path.join(consumerNm, '@omega.js', 'desktop');

  writePackage(root, 'consumer-app', '1.0.0', { dependencies: { 'dupe-pkg': '^1.0.0' } });

  writePackage(path.join(consumerNm, 'dupe-pkg'), 'dupe-pkg', '1.0.0');
  write(path.join(consumerNm, 'dupe-pkg', 'index.js'), 'module.exports = "CONSUMER_COPY";');
  write(path.join(consumerNm, 'dupe-pkg', 'sub.js'), 'module.exports = "CONSUMER_SUBPATH";');

  writePackage(path.join(consumerNm, 'shared-pkg'), 'shared-pkg', '1.0.0');
  write(path.join(consumerNm, 'shared-pkg', 'index.js'), 'module.exports = "SHARED_COPY";');

  writePackage(frameworkRoot, '@omega.js/desktop', '1.0.0', {
    dependencies: { 'dupe-pkg': '^2.0.0', 'shared-pkg': '^1.0.0' },
  });
  const nested = path.join(frameworkRoot, 'node_modules', 'dupe-pkg');
  writePackage(nested, 'dupe-pkg', '2.0.0');
  write(path.join(nested, 'index.js'), 'module.exports = "FRAMEWORK_COPY";');
  write(path.join(nested, 'sub.js'), 'module.exports = "FRAMEWORK_SUBPATH";');

  write(path.join(root, 'src', 'entry.js'), [
    "require('dupe-pkg');",
    "require('dupe-pkg/sub');",
    "require('shared-pkg');",
  ].join('\n'));

  return { root, frameworkRoot };
}

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'framework-deps — a consumer bundle resolves framework-declared deps from the framework',
  timeout: 60000,
  tests: [
    {
      name: 'bare specifiers (and subpaths) of framework-declared deps resolve from the framework installation',
      run: async (ctx) => {
        const projectRoot = stageHoistedConsumer(SAMPLE);
        try {
          const modules = await compile({ projectRoot, frameworkRoot: FRAMEWORK_ROOT });
          SAMPLE.forEach((spec) => {
            const dir = packageDirFor(spec, FRAMEWORK_ROOT);
            ctx.expect(resolvedFor(modules, spec).startsWith(dir + path.sep)).toBe(true);
          });
        } finally {
          fs.rmSync(projectRoot, { recursive: true, force: true });
        }
      },
    },

    {
      name: "the framework's copy wins over a consumer-declared duplicate, subpaths included",
      run: async (ctx) => {
        const { root, frameworkRoot } = stageConflictInstall();
        try {
          const modules = await compile({ projectRoot: root, frameworkRoot });

          // Both the bare specifier and the subpath land on the framework's nested copy…
          ['dupe-pkg', 'dupe-pkg/sub'].forEach((spec) => {
            ctx.expect(resolvedFor(modules, spec)).toBe(require.resolve(spec, { paths: [frameworkRoot] }));
          });
          ctx.expect(resolvedFor(modules, 'dupe-pkg')).toContain(path.join('desktop', 'node_modules', 'dupe-pkg'));

          // …while a dep with no conflict keeps resolving to the single hoisted copy,
          // shared by the framework and the consumer alike.
          ctx.expect(resolvedFor(modules, 'shared-pkg')).toBe(require.resolve('shared-pkg', { paths: [frameworkRoot] }));
          ctx.expect(resolvedFor(modules, 'shared-pkg')).toBe(path.join(root, 'node_modules', 'shared-pkg', 'index.js'));
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
    },
  ],
};
