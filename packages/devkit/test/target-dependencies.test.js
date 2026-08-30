/**
 * Unit tests for src/target-dependencies.js — the shared peer-dependency and
 * framework-freshness checks every framework's ensure-target / deploy-precheck
 * rides ([#675](https://github.com/Omega-JS-Stack/omega/issues/675)).
 *
 * The installer is injected, so nothing here touches npm or the network.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readProject, ensurePeerDependencies, updateManager } = require('../src/target-dependencies');

function tmpTarget(manifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-target-deps-'));
  if (manifest) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
  return dir;
}

function installer() {
  const calls = [];
  return { calls, safeInstall: async (command) => { calls.push(command); } };
}

test('readProject: both dependency sections are always objects', () => {
  const dir = tmpTarget({ name: 'consumer' });
  const project = readProject(dir);

  assert.equal(project.name, 'consumer');
  assert.deepEqual(project.dependencies, {});
  assert.deepEqual(project.devDependencies, {});

  // A target with no manifest at all reads as an empty project, never a throw.
  assert.deepEqual(readProject(tmpTarget()), { dependencies: {}, devDependencies: {} });
});

test('ensurePeerDependencies: a satisfied target installs nothing', async () => {
  const dir = tmpTarget({ name: 'consumer', devDependencies: { gulp: '5.0.0' } });
  const { calls, safeInstall } = installer();
  const log = [];

  await ensurePeerDependencies({
    projectDir: dir,
    package: { peerDependencies: { gulp: '^5.0.0' } },
    log: (line) => log.push(line),
    dependencyMap: { gulp: 'dev' },
    safeInstall,
  });

  assert.deepEqual(calls, [], 'a satisfied peer dep is never reinstalled — this runs on every verb');
  assert.match(log.join('\n'), /gulp is up to date/);
});

test('ensurePeerDependencies: the map decides --save-dev vs --save', async () => {
  const dir = tmpTarget({ name: 'consumer' });
  const { calls, safeInstall } = installer();

  await ensurePeerDependencies({
    projectDir: dir,
    package: { peerDependencies: { gulp: '^5.0.0', 'some-runtime-dep': '^2.0.0' } },
    log: () => {},
    dependencyMap: { gulp: 'dev' },
    safeInstall,
  });

  assert.deepEqual(calls, [
    'npm install gulp@5.0.0 --save-dev',
    'npm install some-runtime-dep@2.0.0 --save',
  ]);
});

test('ensurePeerDependencies: a behind version reinstalls, either section counts', async () => {
  const dir = tmpTarget({ name: 'consumer', dependencies: { gulp: '4.0.0' } });
  const { calls, safeInstall } = installer();

  await ensurePeerDependencies({
    projectDir: dir,
    package: { peerDependencies: { gulp: '^5.0.0' } },
    log: () => {},
    dependencyMap: {},
    safeInstall,
  });

  assert.deepEqual(calls, ['npm install gulp@5.0.0 --save']);
});

test('updateManager: an uninstalled framework is a loud error, not a silent skip', async () => {
  const dir = tmpTarget({ name: 'consumer' });
  const { calls, safeInstall } = installer();

  await assert.rejects(
    () => updateManager({ projectDir: dir, package: { name: '@omega.js/desktop' }, log: () => {}, error: () => {}, safeInstall }),
    /No installed version of @omega\.js\/desktop found/,
  );
  assert.deepEqual(calls, [], 'nothing is installed on the way out');
});
