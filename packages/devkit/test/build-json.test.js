// Unit tests for src/build-json.js: the one OMEGA_BUILD_JSON composer and the
// one build.js writer every browser surface goes through (#743).
//
// The file text is proven the way a browser proves it: run it in a scope whose
// only global is `self`, which is what a service worker importScripts() gives
// it and what a window's script tag gives it too.

const { test } = require('node:test');
const assert = require('node:assert/strict');
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

test('the wrapper is the same five keys, with the browser subset inside `config`', () => {
  const buildJson = composeBuildJson({ config: CONFIG, pkg: PKG, mode: MODE, license: LICENSE, facts: FACTS });

  assert.deepEqual(Object.keys(buildJson).sort(), ['builtAt', 'config', 'license', 'mode', 'package']);
  assert.deepEqual(buildJson.package, PKG);
  assert.deepEqual(buildJson.mode, MODE);
  assert.deepEqual(buildJson.license, LICENSE);
  assert.match(buildJson.builtAt, /^\d{4}-\d{2}-\d{2}T/);

  // The facts ride ON the config, the way every surface reads them.
  assert.equal(buildJson.config.runtime, 'electron');
  assert.equal(buildJson.config.target, 'desktop');
  assert.equal(buildJson.config.brand.name, 'Acme');
});

test('a non-client section never reaches the wrapper', () => {
  const buildJson = composeBuildJson({ config: CONFIG, pkg: PKG, mode: MODE, license: LICENSE, facts: FACTS });

  // cloud ships its public half only: the Firebase web config, never the
  // service account beside it.
  assert.deepEqual(buildJson.config.cloud, { config: { projectId: 'acme-prod' } });
});

test('a mode missing one of its three keys throws, naming what is missing', () => {
  for (const key of MODE_KEYS) {
    const mode = { ...MODE };
    delete mode[key];
    assert.throws(
      () => composeBuildJson({ config: CONFIG, pkg: PKG, mode, license: LICENSE, facts: FACTS }),
      new RegExp(`missing: ${key}`),
    );
  }

  assert.throws(() => composeBuildJson({ config: CONFIG, pkg: PKG, license: LICENSE, facts: FACTS }), /missing: environment, build, publish/);
});

test('the file text parses back in a worker-like scope, dev on its own statement', () => {
  const dev = { ports: { website: 4000 }, origin: 'http://localhost:4000' };
  const buildJson = composeBuildJson({
    config: CONFIG, pkg: PKG, mode: { ...MODE, environment: 'development', build: false }, license: LICENSE, facts: { ...FACTS, dev },
  });
  const source = buildJsSource(buildJson);

  // Two statements, the dev map on the second one: that is the line `omega
  // dev` rewrites per request (#346).
  assert.equal(source.split('\n').filter(Boolean).length, 2);
  assert.ok(source.startsWith('self.OMEGA_BUILD_JSON = {'), 'one plain assignment, no IIFE');
  assert.match(source, /\nself\.OMEGA_BUILD_JSON\.config\.dev = \{"ports"/);

  // Read back through JSON: the vm scope is another realm, so the objects in
  // it are compared as the bytes a browser would have parsed.
  const loaded = JSON.parse(JSON.stringify(runInWorkerScope(source)));
  assert.deepEqual(loaded.config.dev, dev);
  assert.equal(loaded.config.brand.id, 'acme');
  assert.deepEqual(loaded.mode, { environment: 'development', build: false, publish: false });
});

test('a build with no local stack writes dev as null, the same two statements', () => {
  const source = buildJsSource(composeBuildJson({ config: CONFIG, pkg: PKG, mode: MODE, license: LICENSE, facts: FACTS }));

  assert.match(source, /\nself\.OMEGA_BUILD_JSON\.config\.dev = null;/);

  assert.equal(runInWorkerScope(source).config.dev, null);
});

test('writeBuildJs writes <webRoot>/build.js and is idempotent', () => {
  const dir = jetpack.dir(path.join(os.tmpdir(), `omega-build-json-${process.pid}`), { empty: true }).cwd();
  const buildJson = composeBuildJson({ config: CONFIG, pkg: PKG, mode: MODE, license: LICENSE, facts: FACTS });

  const file = writeBuildJs(dir, buildJson);
  assert.equal(file, path.join(dir, 'build.js'));

  const first = jetpack.read(file);
  writeBuildJs(dir, buildJson);
  assert.equal(jetpack.read(file), first, 'the same snapshot writes the same bytes');

  jetpack.remove(dir);
});
