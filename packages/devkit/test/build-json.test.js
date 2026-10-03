// Unit tests for src/build-json.js: the one OMEGA_BUILD_JSON composer and the
// one build.js writer every browser surface goes through (#743).
//
// The file text is proven the way a browser proves it: run it in a scope whose
// only global is `self`, which is what a service worker importScripts() gives
// it and what a window's script tag gives it too.

const defineCases = require('@omega.js/devkit/test/define-cases');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const jetpack = require('fs-jetpack');

const { composeBuildJson, buildJsSource, writeBuildJs, MODE_KEYS } = require('../src/build-json.js');

/**
 * Run a build.js the way a worker does: a scope whose only global is `self`.
 * @param {string} source - the file text
 * @returns {object} what the file assigned
 */
function runInWorkerScope(source) {
  const scope = { self: {} };
  vm.runInNewContext(source, scope);
  return scope.self.OMEGA_BUILD_JSON;
}

// A resolved config carrying one client section (brand) and one section the
// schema never ships to a browser (cloud's provisioning half rides under
// `cloud.config` alone, and `secrets` is no section at all).
const CONFIG = {
  brand: { id: 'acme', name: 'Acme' },
  cloud: { config: { projectId: 'acme-prod' }, serviceAccount: { clientEmail: 'build@acme' } },
};

const MODE = { environment: 'production', build: true, publish: false };
const LICENSE = { licensed: true, payments: 'live', attribution: 'removed', reason: 'test' };
const PKG = { name: 'acme-desktop', version: '1.2.3' };
const FACTS = { runtime: 'electron', environment: 'production', version: '1.2.3', buildTime: 1757000000000, target: 'desktop' };

module.exports = defineCases({
  type: 'group',
  description: 'build-json',
  tests: [
    {
      name: 'the wrapper is the same five keys, with the browser subset inside `config`',
      run: (ctx) => {
        const buildJson = composeBuildJson({ config: CONFIG, pkg: PKG, mode: MODE, license: LICENSE, facts: FACTS });

        ctx.expect(Object.keys(buildJson).sort()).toEqual(['builtAt', 'config', 'license', 'mode', 'package']);
        ctx.expect(buildJson.package).toEqual(PKG);
        ctx.expect(buildJson.mode).toEqual(MODE);
        ctx.expect(buildJson.license).toEqual(LICENSE);
        ctx.expect(buildJson.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

        // The facts ride ON the config, the way every surface reads them.
        ctx.expect(buildJson.config.runtime).toBe('electron');
        ctx.expect(buildJson.config.target).toBe('desktop');
        ctx.expect(buildJson.config.brand.name).toBe('Acme');
      },
    },

    {
      name: 'a non-client section never reaches the wrapper',
      run: (ctx) => {
        const buildJson = composeBuildJson({ config: CONFIG, pkg: PKG, mode: MODE, license: LICENSE, facts: FACTS });

        // cloud ships its public half only: the Firebase web config, never the
        // service account beside it.
        ctx.expect(buildJson.config.cloud).toEqual({ config: { projectId: 'acme-prod' } });
      },
    },

    {
      name: 'a mode missing one of its three keys throws, naming what is missing',
      run: (ctx) => {
        for (const key of MODE_KEYS) {
          const mode = { ...MODE };
          delete mode[key];
          ctx.expect(() => composeBuildJson({ config: CONFIG, pkg: PKG, mode, license: LICENSE, facts: FACTS })).toThrow(new RegExp(`missing: ${key}`));
        }

        ctx.expect(() => composeBuildJson({ config: CONFIG, pkg: PKG, license: LICENSE, facts: FACTS })).toThrow(/missing: environment, build, publish/);
      },
    },

    {
      name: 'the file text parses back in a worker-like scope, dev on its own statement',
      run: (ctx) => {
        const dev = { ports: { website: 4000 }, origin: 'http://localhost:4000' };
        const buildJson = composeBuildJson({
          config: CONFIG, pkg: PKG, mode: { ...MODE, environment: 'development', build: false }, license: LICENSE, facts: { ...FACTS, dev },
        });
        const source = buildJsSource(buildJson);

        // Two statements, the dev map on the second one: that is the line `omega
        // dev` rewrites per request (#346).
        ctx.expect(source.split('\n').filter(Boolean).length).toBe(2);
        ctx.expect(source.startsWith('self.OMEGA_BUILD_JSON = {'), 'one plain assignment, no IIFE').toBeTruthy();
        ctx.expect(source).toMatch(/\nself\.OMEGA_BUILD_JSON\.config\.dev = \{"ports"/);

        // Read back through JSON: the vm scope is another realm, so the objects in
        // it are compared as the bytes a browser would have parsed.
        const loaded = JSON.parse(JSON.stringify(runInWorkerScope(source)));
        ctx.expect(loaded.config.dev).toEqual(dev);
        ctx.expect(loaded.config.brand.id).toBe('acme');
        ctx.expect(loaded.mode).toEqual({ environment: 'development', build: false, publish: false });
      },
    },

    {
      name: 'a build with no local stack writes dev as null, the same two statements',
      run: (ctx) => {
        const source = buildJsSource(composeBuildJson({ config: CONFIG, pkg: PKG, mode: MODE, license: LICENSE, facts: FACTS }));

        ctx.expect(source).toMatch(/\nself\.OMEGA_BUILD_JSON\.config\.dev = null;/);

        ctx.expect(runInWorkerScope(source).config.dev).toBe(null);
      },
    },

    {
      name: 'writeBuildJs writes <webRoot>/build.js and is idempotent',
      run: (ctx) => {
        const dir = jetpack.dir(path.join(os.tmpdir(), `omega-build-json-${process.pid}`), { empty: true }).cwd();
        const buildJson = composeBuildJson({ config: CONFIG, pkg: PKG, mode: MODE, license: LICENSE, facts: FACTS });

        const file = writeBuildJs(dir, buildJson);
        ctx.expect(file).toBe(path.join(dir, 'build.js'));

        const first = jetpack.read(file);
        writeBuildJs(dir, buildJson);
        ctx.expect(jetpack.read(file), 'the same snapshot writes the same bytes').toBe(first);

        jetpack.remove(dir);
      },
    },
  ],
});
