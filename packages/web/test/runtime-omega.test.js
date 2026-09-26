/**
 * The web runtime is ONE instance (#945): `runtime/omega.js` subclasses the
 * @omega.js/client base class and exports the instance every layout, page and
 * section module receives as `{ omega, options }`, and `sw/omega.js` does the
 * same for the service worker.
 *
 * The client package exports a class and no instance, so a core file that
 * imported its default would hold the class, not the booted runtime. These
 * pins keep that one door shut, keep main.js wiring its modules through one
 * list, and prove both instances are what their modules claim.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const PKG = path.join(__dirname, '..');

/**
 * Every .js file under a directory, recursively.
 * @param {string} dir
 * @returns {string[]}
 */
function walkJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkJs(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

// A default import of the client's entry, alone or beside named imports
const CLIENT_DEFAULT_IMPORT = /import\s+[\w$]+\s*(,\s*\{[^}]*\})?\s+from\s+['"]@omega\.js\/client['"]/;

test('#945: no core, theme or default-page file imports the default of @omega.js/client', () => {
  const offenders = ['core', 'themes', 'defaults']
    .flatMap((dir) => walkJs(path.join(PKG, dir)))
    .filter((file) => CLIENT_DEFAULT_IMPORT.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(PKG, file));

  assert.deepStrictEqual(offenders, [], 'the instance is `import omega from \'@omega.js/web/runtime\'`');
});

// main.js hands every module in its list `{ omega, options }`, so a module whose
// entry takes that argument reads the instance from it and never imports one
test('#945: a core module whose entry receives { omega } imports no runtime', () => {
  for (const name of ['analytics-loader', 'auth', 'lazy-loading', 'query-strings', 'consent', 'social-sharing']) {
    const source = fs.readFileSync(path.join(PKG, 'core', 'js', 'core', `${name}.js`), 'utf8');

    assert.match(source, /^export default function \(\{ omega \}\) \{$/m, `${name}.js takes { omega }`);
    assert.doesNotMatch(source, /from\s+['"]@omega\.js\/(web\/runtime|client)['"]/, `${name}.js imports no instance`);
  }
});

test('#945: runtime/omega.js is the only runtime file that imports the client entry', () => {
  const importers = walkJs(path.join(PKG, 'runtime'))
    .filter((file) => /from\s+['"]@omega\.js\/client['"]/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(PKG, file));

  assert.deepStrictEqual(importers, [path.join('runtime', 'omega.js')]);
});

test('#945: the web runtime default export is an instance of its exported Omega, a client Omega', async () => {
  const runtime = await import(path.join(PKG, 'runtime', 'omega.js'));
  const client = await import('@omega.js/client');

  assert.strictEqual(runtime.default.constructor, runtime.Omega, 'the default export is an instance of the exported class');
  assert.ok(runtime.default instanceof client.Omega, 'the prototype chain reaches the client base class');
  assert.notStrictEqual(runtime.Omega, client.Omega, 'web subclasses the base class rather than re-exporting it');
  assert.strictEqual(runtime.default.exitPopup, null, 'the exit popup is null until main.js wires it');
});

test('#945: main.js wires its modules through ONE list and calls nothing outside it', () => {
  const source = fs.readFileSync(path.join(PKG, 'core', 'js', 'main.js'), 'utf8');

  const lists = source.match(/const MODULES = \[/g) || [];
  assert.strictEqual(lists.length, 1, 'exactly one wiring list');

  const start = source.indexOf('const MODULES = [');
  const end = source.indexOf('\n];\n', start);
  assert.ok(end > start, 'the wiring list closes');
  const outside = source.slice(0, start) + source.slice(end);

  // Every binding main.js imports is called from the list, never around it
  const imported = [...source.matchAll(/^import\s+(?:([\w$]+)|\{([^}]*)\})\s+from/gm)]
    .flatMap(([, name, names]) => (name ? [name] : names.split(',').map((part) => part.trim()).filter(Boolean)));
  assert.ok(imported.length > 0, 'main.js imports its modules statically');

  for (const name of imported) {
    assert.ok(!new RegExp(`\\b${name}\\(`).test(outside), `${name} is called outside the wiring list`);
  }
  assert.ok(!/\b\w+Module\(\{/.test(source), 'no bare `xModule({` call anywhere');
});

test('#945: sw/omega.js default export is an instance with initialize()', () => {
  const { outputFiles } = esbuild.buildSync({
    entryPoints: [path.join(PKG, 'sw', 'omega.js')],
    bundle: true,
    format: 'cjs',
    write: false,
    define: { __OMEGA_FIREBASE_VERSION__: '"0.0.0"' },
    logLevel: 'silent',
  });

  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    self: { location: new URL('https://example.com/service-worker.js'), addEventListener: () => {} },
    importScripts: () => {},
    URLSearchParams,
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };
  vm.runInNewContext(outputFiles[0].text, context, { filename: 'sw/omega.js' });

  const { default: omega, Omega } = module.exports;
  assert.ok(omega instanceof Omega, 'the default export is an instance of the exported class');
  assert.strictEqual(typeof omega.initialize, 'function');
});
