/**
 * omega-bin dispatcher — context detection (app framework / brand root) +
 * dispatch. Real execution, no mocks: committed fixtures for detection, an
 * os.tmpdir() scratch with a fake installed package for each dispatch case.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { findTarget, isBrandRoot, FRAMEWORKS, MANAGER, run } = require('../src/omega-bin.js');

const FIXTURES = path.join(__dirname, 'fixtures', 'local');
const BRAND = path.join(FIXTURES, 'brand');
const DISPATCH = path.join(__dirname, 'fixtures', 'dispatch');

test('FRAMEWORKS covers exactly the four app frameworks', () => {
  assert.deepEqual(FRAMEWORKS, [
    '@omega.js/web',
    '@omega.js/backend',
    '@omega.js/desktop',
    '@omega.js/extension',
  ]);
  assert.equal(MANAGER, '@omega.js/manager');
});

test('findTarget: web app via devDependency', () => {
  const hit = findTarget(path.join(BRAND, 'apps', 'site'));
  assert.deepEqual(hit, { kind: 'framework', name: '@omega.js/web', dir: path.join(BRAND, 'apps', 'site') });
});

test('findTarget: backend app via app-root manifest (src/dist pillar — no functions/ peek)', () => {
  const hit = findTarget(path.join(BRAND, 'apps', 'backend-app'));
  assert.deepEqual(hit, {
    kind: 'framework',
    name: '@omega.js/backend',
    dir: path.join(BRAND, 'apps', 'backend-app'),
  });
});

test('findTarget: inside functions/ walks up to the app root', () => {
  const hit = findTarget(path.join(BRAND, 'apps', 'backend-app', 'functions'));
  assert.equal(hit.name, '@omega.js/backend');
  assert.equal(hit.dir, path.join(BRAND, 'apps', 'backend-app'));
});

test('findTarget: a deep (even nonexistent) dir inside an app walks up to the app', () => {
  const hit = findTarget(path.join(BRAND, 'apps', 'site', 'src', 'pages', 'deep'));
  assert.equal(hit.name, '@omega.js/web');
});

test('findTarget: standalone app (desktop devDep)', () => {
  const hit = findTarget(path.join(FIXTURES, 'standalone-app'));
  assert.equal(hit.name, '@omega.js/desktop');
});

test('findTarget: no framework anywhere up the chain → null', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-null-'));
  assert.equal(findTarget(scratch), null);
});

// ─── Brand-root detection (cp94b) ────────────────────────────────────────────

test('findTarget: a brand root (config/omega.json5, no framework dep) → brand kind', () => {
  const hit = findTarget(path.join(DISPATCH, 'brand'));
  assert.deepEqual(hit, { kind: 'brand', dir: path.join(DISPATCH, 'brand') });
});

test('findTarget: deep non-app dir inside a brand walks up to the brand root', () => {
  const hit = findTarget(path.join(DISPATCH, 'brand', 'config'));
  assert.deepEqual(hit, { kind: 'brand', dir: path.join(DISPATCH, 'brand') });
});

test('findTarget: an app inside a brand still dispatches as the app (nearest context wins)', () => {
  const hit = findTarget(path.join(DISPATCH, 'brand', 'apps', 'site'));
  assert.deepEqual(hit, {
    kind: 'framework',
    name: '@omega.js/web',
    dir: path.join(DISPATCH, 'brand', 'apps', 'site'),
  });
});

test('findTarget: an app-of-brand config with no framework dep is skipped, resolving the brand above', () => {
  const hit = findTarget(path.join(DISPATCH, 'brand', 'apps', 'rogue'));
  assert.deepEqual(hit, { kind: 'brand', dir: path.join(DISPATCH, 'brand') });
});

test('findTarget: standalone consumer with BOTH framework dep and config → framework wins', () => {
  const hit = findTarget(path.join(DISPATCH, 'standalone-consumer'));
  assert.equal(hit.kind, 'framework');
  assert.equal(hit.name, '@omega.js/desktop');
});

test('isBrandRoot: true at a brand root, false for an app-of-brand config dir', () => {
  assert.equal(isBrandRoot(path.join(DISPATCH, 'brand')), true);
  assert.equal(isBrandRoot(path.join(DISPATCH, 'brand', 'apps', 'rogue')), false);
  assert.equal(isBrandRoot(path.join(DISPATCH, 'brand', 'apps', 'site')), false);
});

// ─── Repo boundary (#73) ─────────────────────────────────────────────────────

test('findTarget: the walk stops at the nearest .git — a context outside the repo is never adopted', () => {
  // Outer dir = a framework app; inner repo = an unconfigured project. An
  // unbounded walk would climb out of the repo and dispatch the outer app.
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-gitbound-'));
  fs.writeFileSync(
    path.join(outer, 'package.json'),
    JSON.stringify({ name: 'outer', dependencies: { '@omega.js/web': '*' } })
  );
  const repo = path.join(outer, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src', 'deep'), { recursive: true });

  assert.equal(findTarget(path.join(repo, 'src', 'deep')), null);
  assert.equal(findTarget(repo), null);

  // The git root itself is still CHECKED before the walk stops
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'inner', devDependencies: { '@omega.js/desktop': '*' } })
  );
  assert.deepEqual(findTarget(path.join(repo, 'src', 'deep')), {
    kind: 'framework',
    name: '@omega.js/desktop',
    dir: repo,
  });

  fs.rmSync(outer, { recursive: true, force: true });
});

// ─── run() dispatch ──────────────────────────────────────────────────────────

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

test('run(): brand root dispatches to @omega.js/manager\'s ./cli', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-brand-'));
  const brandRoot = path.join(scratch, 'my-brand');
  fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(brandRoot, 'package.json'),
    JSON.stringify({ name: 'my-brand', private: true, workspaces: ['apps/*'] })
  );
  fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), '{ brand: { id: "my-brand" } }\n');

  // Fake installed manager at the brand root (resolution walks up from there).
  const mgrDir = path.join(brandRoot, 'node_modules', '@omega.js', 'manager');
  fs.mkdirSync(mgrDir, { recursive: true });
  fs.writeFileSync(
    path.join(mgrDir, 'package.json'),
    JSON.stringify({ name: '@omega.js/manager', exports: { './cli': './cli.js' } })
  );
  const marker = path.join(scratch, 'marker.txt');
  fs.writeFileSync(
    path.join(mgrDir, 'cli.js'),
    `module.exports = { run() { require('fs').writeFileSync(${JSON.stringify(marker)}, 'brand-dispatched'); } };`
  );

  const cwd0 = process.cwd();
  process.chdir(brandRoot);
  try {
    await run({
      hostName: '@omega.js/web',
      hostRun: () => { throw new Error('hostRun must not fire at a brand root'); },
    });
  } finally {
    process.chdir(cwd0);
  }
  assert.equal(fs.readFileSync(marker, 'utf8'), 'brand-dispatched');
});
