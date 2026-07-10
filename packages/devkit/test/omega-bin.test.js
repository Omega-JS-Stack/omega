/**
 * omega-bin dispatcher — target-framework detection + dispatch.
 * Real execution, no mocks: committed fixtures for detection, an os.tmpdir()
 * scratch with a fake installed framework for cross-dispatch.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { findTargetFramework, FRAMEWORKS, run } = require('../src/omega-bin.js');

const FIXTURES = path.join(__dirname, 'fixtures', 'local');
const BRAND = path.join(FIXTURES, 'brand');

test('FRAMEWORKS covers exactly the four app frameworks', () => {
  assert.deepEqual(FRAMEWORKS, [
    '@omega.js/web',
    '@omega.js/backend',
    '@omega.js/desktop',
    '@omega.js/extension',
  ]);
});

test('findTargetFramework: web app via devDependency', () => {
  const hit = findTargetFramework(path.join(BRAND, 'apps', 'site'));
  assert.deepEqual(hit, { name: '@omega.js/web', dir: path.join(BRAND, 'apps', 'site') });
});

test('findTargetFramework: backend app via the functions/ peek from the app dir', () => {
  const hit = findTargetFramework(path.join(BRAND, 'apps', 'backend-app'));
  assert.deepEqual(hit, {
    name: '@omega.js/backend',
    dir: path.join(BRAND, 'apps', 'backend-app', 'functions'),
  });
});

test('findTargetFramework: inside functions/ finds backend directly', () => {
  const hit = findTargetFramework(path.join(BRAND, 'apps', 'backend-app', 'functions'));
  assert.equal(hit.name, '@omega.js/backend');
});

test('findTargetFramework: a deep (even nonexistent) dir inside an app walks up to the app', () => {
  const hit = findTargetFramework(path.join(BRAND, 'apps', 'site', 'src', 'pages', 'deep'));
  assert.equal(hit.name, '@omega.js/web');
});

test('findTargetFramework: standalone app (desktop devDep)', () => {
  const hit = findTargetFramework(path.join(FIXTURES, 'standalone-app'));
  assert.equal(hit.name, '@omega.js/desktop');
});

test('findTargetFramework: no framework anywhere up the chain → null', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-null-'));
  assert.equal(findTargetFramework(scratch), null);
});

test('run(): no app context falls back to the HOST CLI (bootstrap case, e.g. `omega setup` in a fresh dir)', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-boot-'));
  const cwd0 = process.cwd();
  let ran = 0;
  process.chdir(scratch);
  try {
    await run({ hostName: '@omega.js/web', hostRun: () => { ran += 1; } });
  } finally {
    process.chdir(cwd0);
  }
  assert.equal(ran, 1);
});

test('run(): host match executes hostRun (no dispatch)', async () => {
  const cwd0 = process.cwd();
  let ran = 0;
  process.chdir(path.join(BRAND, 'apps', 'site'));
  try {
    await run({ hostName: '@omega.js/web', hostRun: () => { ran += 1; } });
  } finally {
    process.chdir(cwd0);
  }
  assert.equal(ran, 1);
});

test('run(): cross-framework dispatch resolves the target\'s ./cli and calls run()', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-x-'));
  const appDir = path.join(scratch, 'apps', 'site');
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(
    path.join(appDir, 'package.json'),
    JSON.stringify({ name: 'site', dependencies: { '@omega.js/web': '*' } })
  );

  // Fake installed framework, hoisted to the scratch root (resolution walks up).
  const fwDir = path.join(scratch, 'node_modules', '@omega.js', 'web');
  fs.mkdirSync(fwDir, { recursive: true });
  fs.writeFileSync(
    path.join(fwDir, 'package.json'),
    JSON.stringify({ name: '@omega.js/web', exports: { './cli': './cli.js' } })
  );
  const marker = path.join(scratch, 'marker.txt');
  fs.writeFileSync(
    path.join(fwDir, 'cli.js'),
    `module.exports = { run() { require('fs').writeFileSync(${JSON.stringify(marker)}, 'dispatched'); } };`
  );

  const cwd0 = process.cwd();
  process.chdir(appDir);
  try {
    await run({
      hostName: '@omega.js/desktop',
      hostRun: () => { throw new Error('hostRun must not fire on cross-dispatch'); },
    });
  } finally {
    process.chdir(cwd0);
  }
  assert.equal(fs.readFileSync(marker, 'utf8'), 'dispatched');
});
