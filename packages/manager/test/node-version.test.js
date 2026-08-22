// Tests for src/lib/node-version.js + runCommand's per-target Node spawning
// (friction #15: the manager drives each app's commands under that app's
// own .nvmrc Node). A fake $NVM_DIR with a shim "node" makes the tests
// machine-independent — no real nvm installs are touched.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const jetpack = require('fs-jetpack');
const { parseNvmrcMajor, findInstalledNode, resolveTargetNode, nodeEnvFor } = require('../src/lib/node-version.js');
const { runCommand } = require('../src/lib/run-command.js');

/** Build a fake $NVM_DIR holding an executable shim for the given version. */
function makeFakeNvm(base, version, shimScript) {
  const binDir = path.join(base, 'versions', 'node', version, 'bin');
  const shim = path.join(binDir, 'node');
  jetpack.write(shim, shimScript);
  jetpack.file(shim, { mode: '755' });
  return binDir;
}

function withEnv(overrides, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  const result = fn();
  if (result && typeof result.finally === 'function') return result.finally(restore);
  restore();
  return result;
}

test('node-version: parseNvmrcMajor accepts every spec form', () => {
  assert.equal(parseNvmrcMajor('v24/*'), 24);
  assert.equal(parseNvmrcMajor('v22'), 22);
  assert.equal(parseNvmrcMajor('20'), 20);
  assert.equal(parseNvmrcMajor('24.1.0'), 24);
  assert.equal(parseNvmrcMajor('lts/iron'), null);
  assert.equal(parseNvmrcMajor(''), null);
});

test('node-version: findInstalledNode picks the highest patch of the major', () => {
  const base = path.join(os.tmpdir(), `omega-nvm-${process.pid}-a`);
  jetpack.remove(base);
  makeFakeNvm(base, 'v99.1.0', '#!/bin/sh\nexit 0\n');
  makeFakeNvm(base, 'v99.4.2', '#!/bin/sh\nexit 0\n');
  makeFakeNvm(base, 'v98.9.9', '#!/bin/sh\nexit 0\n');

  withEnv({ NVM_DIR: base }, () => {
    const found = findInstalledNode(99);
    assert.equal(found.version, 'v99.4.2');
    assert.ok(found.binDir.endsWith(path.join('v99.4.2', 'bin')));
    assert.equal(findInstalledNode(97), null);
  });
  jetpack.remove(base);
});

test('node-version: resolveTargetNode — no .nvmrc, current-major match, pinned major, missing install', () => {
  const base = path.join(os.tmpdir(), `omega-nvm-${process.pid}-b`);
  const targetDir = path.join(os.tmpdir(), `omega-app-${process.pid}-b`);
  jetpack.remove(base);
  jetpack.remove(targetDir);
  jetpack.dir(targetDir);
  makeFakeNvm(base, 'v99.0.1', '#!/bin/sh\nexit 0\n');

  withEnv({ NVM_DIR: base }, () => {
    // no .nvmrc → inherited PATH
    assert.equal(resolveTargetNode(targetDir), null);

    // current major → resolved but binDir null (no PATH override needed)
    const currentMajor = process.versions.node.split('.')[0];
    jetpack.write(path.join(targetDir, '.nvmrc'), `v${currentMajor}/*`);
    const same = resolveTargetNode(targetDir);
    assert.equal(same.binDir, null);
    assert.equal(same.major, Number(currentMajor));
    assert.deepEqual(nodeEnvFor(same), {});

    // pinned different major → resolved from the nvm install (the target root
    // is the ONE .nvmrc home — src/dist pillar; dist/.nvmrc is a staged copy)
    jetpack.write(path.join(targetDir, '.nvmrc'), 'v99/*');
    const pinned = resolveTargetNode(targetDir);
    assert.equal(pinned.major, 99);
    assert.ok(pinned.binDir.includes('v99.0.1'));
    assert.ok(nodeEnvFor(pinned).PATH.startsWith(pinned.binDir));

    // pinned major with no install → hard error naming nvm install
    jetpack.write(path.join(targetDir, '.nvmrc'), 'v97/*');
    const missing = resolveTargetNode(targetDir);
    assert.match(missing.error, /nvm install 97/);
  });
  jetpack.remove(base);
  jetpack.remove(targetDir);
});

test('runCommand: spawns under the target\'s pinned Node (shim proves the PATH override)', async () => {
  const base = path.join(os.tmpdir(), `omega-nvm-${process.pid}-c`);
  const targetDir = path.join(os.tmpdir(), `omega-app-${process.pid}-c`);
  jetpack.remove(base);
  jetpack.remove(targetDir);
  const marker = path.join(targetDir, 'shim-ran.txt');
  // The shim writes a marker file so the test can prove IT ran (stdio is inherited).
  makeFakeNvm(base, 'v99.0.0', `#!/bin/sh\necho "shim" > "${marker}"\nexit 0\n`);
  jetpack.write(path.join(targetDir, '.nvmrc'), 'v99/*');

  await withEnv({ NVM_DIR: base }, async () => {
    const result = await runCommand('node', ['-v'], targetDir);
    assert.equal(result.success, true);
    assert.equal((jetpack.read(marker) || '').trim(), 'shim');
  });

  jetpack.remove(base);
  jetpack.remove(targetDir);
});

test('runCommand: pinned-but-missing major fails fast with the nvm install hint', async () => {
  const base = path.join(os.tmpdir(), `omega-nvm-${process.pid}-d`);
  const targetDir = path.join(os.tmpdir(), `omega-app-${process.pid}-d`);
  jetpack.remove(base);
  jetpack.remove(targetDir);
  jetpack.dir(path.join(base, 'versions', 'node'));
  jetpack.write(path.join(targetDir, '.nvmrc'), 'v97/*');

  await withEnv({ NVM_DIR: base }, async () => {
    const result = await runCommand('node', ['-v'], targetDir);
    assert.equal(result.success, false);
    assert.match(result.error, /nvm install 97/);
  });

  jetpack.remove(base);
  jetpack.remove(targetDir);
});

test('runCommand: a command that rewrites .nvmrc and fails is retried once under the new Node', async () => {
  const base = path.join(os.tmpdir(), `omega-nvm-${process.pid}-e`);
  const targetDir = path.join(os.tmpdir(), `omega-app-${process.pid}-e`);
  jetpack.remove(base);
  jetpack.remove(targetDir);
  const marker = path.join(targetDir, 'attempts.txt');
  const nvmrc = path.join(targetDir, '.nvmrc');
  // v99's shim simulates EM setup: rewrites the pin to v98 and FAILS.
  makeFakeNvm(base, 'v99.0.0', `#!/bin/sh\necho "v99" >> "${marker}"\necho "v98/*" > "${nvmrc}"\nexit 1\n`);
  // v98's shim succeeds — the retry must land here.
  makeFakeNvm(base, 'v98.0.0', `#!/bin/sh\necho "v98" >> "${marker}"\nexit 0\n`);
  jetpack.write(nvmrc, 'v99/*');

  await withEnv({ NVM_DIR: base }, async () => {
    const result = await runCommand('node', ['setup'], targetDir);
    assert.equal(result.success, true);
    assert.deepEqual((jetpack.read(marker) || '').trim().split('\n'), ['v99', 'v98']);
  });

  jetpack.remove(base);
  jetpack.remove(targetDir);
});
