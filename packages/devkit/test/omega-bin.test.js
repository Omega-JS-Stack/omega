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

const { findTarget, isBrandRoot, APP_SUBDIRS, FRAMEWORKS, MANAGER, run } = require('../src/omega-bin.js');

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

// ─── APP_SUBDIRS: functions/ and dist/ are app VIEWS, never roots (#307) ─────

/**
 * A backend app staged by `omega build`: the app root declares the framework,
 * and dist/ carries the GENERATED tree — a derived manifest (runtime
 * dependencies only, so a devDependency-declared framework is absent from it)
 * beside the composed config/omega.json5.
 * @returns {{ brandRoot: string, appDir: string, distDir: string }}
 */
function makeStagedBackend() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-staged-'));
  const brandRoot = path.join(scratch, 'acme');
  const appDir = path.join(brandRoot, 'apps', 'backend-app');
  const distDir = path.join(appDir, 'dist');

  fs.mkdirSync(path.join(brandRoot, '.git'), { recursive: true }); // bound the walk
  fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
  fs.mkdirSync(path.join(distDir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), '{ brand: { id: "acme" } }\n');
  fs.writeFileSync(
    path.join(appDir, 'package.json'),
    JSON.stringify({ name: 'acme-backend', devDependencies: { '@omega.js/backend': '*' } })
  );
  fs.writeFileSync(
    path.join(distDir, 'package.json'),
    JSON.stringify({ name: 'acme-backend-functions', dependencies: { 'firebase-admin': '^13.0.0' } })
  );
  fs.writeFileSync(
    path.join(distDir, 'config', 'omega.json5'),
    '// Staged by `omega build`\n{ "brand": { "id": "acme" } }\n'
  );

  return { brandRoot, appDir, distDir };
}

test('findTarget: inside a staged backend\'s dist/ walks up to the app root (#307)', () => {
  const { appDir, distDir } = makeStagedBackend();

  assert.deepEqual(findTarget(distDir), {
    kind: 'framework',
    name: '@omega.js/backend',
    dir: appDir,
  });
});

test('isBrandRoot: an APP_SUBDIR view (functions/, dist/) is never a brand root, config or not (#307)', () => {
  const { distDir } = makeStagedBackend();
  assert.equal(isBrandRoot(distDir), false, 'a staged dist/ carries a composed config but is output, not a root');

  // functions/ — the pre-pillar runtime cwd, same rule (both live in APP_SUBDIRS)
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-functions-'));
  fs.mkdirSync(path.join(scratch, 'functions', 'config'), { recursive: true });
  fs.writeFileSync(path.join(scratch, 'functions', 'config', 'omega.json5'), '{ brand: { id: "legacy" } }\n');
  assert.equal(isBrandRoot(path.join(scratch, 'functions')), false);
});

test('APP_SUBDIRS: the stdlib twin mirrors @omega.js/config\'s canonical list (#307)', () => {
  // The dispatcher cannot REQUIRE @omega.js/config (it is vendored into every
  // framework dist), so the list is copied — this pins the copy to the
  // canonical one so the twin can never drift again.
  assert.deepEqual(APP_SUBDIRS, require('@omega.js/config/load').APP_SUBDIRS);
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

test('run(): a brand-SHAPED dir with no manager installed falls back to the HOST CLI with a note (#194)', async () => {
  // `omega setup` scaffolds config/omega.json5 into a STANDALONE app before the
  // framework dep lands in its package.json — brand-shaped, but no manager to
  // dispatch to. The dispatcher must not dead-end there.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-nomgr-'));
  const appDir = path.join(scratch, 'fresh-app');
  fs.mkdirSync(path.join(appDir, 'config'), { recursive: true });
  fs.mkdirSync(path.join(appDir, '.git'), { recursive: true }); // bound the walk inside the scratch
  fs.writeFileSync(
    path.join(appDir, 'package.json'),
    JSON.stringify({ name: 'fresh-app', dependencies: {} })
  );
  fs.writeFileSync(path.join(appDir, 'config', 'omega.json5'), '{ brand: { id: "fresh-app" } }\n');

  const cwd0 = process.cwd();
  const error0 = console.error;
  const notes = [];
  let ran = 0;
  console.error = (...args) => { notes.push(args.join(' ')); };
  process.chdir(appDir);
  try {
    await run({ hostName: '@omega.js/web', hostRun: () => { ran += 1; } });
  } finally {
    process.chdir(cwd0);
    console.error = error0;
  }

  assert.equal(ran, 1);
  const note = notes.join('\n');
  assert.match(note, /@omega\.js\/manager is not installed/);
  assert.match(note, /running @omega\.js\/web/);
  assert.ok(note.includes(appDir), `note names the brand-shaped dir: ${note}`);
});

test('run(): an unresolvable CROSS-FRAMEWORK app still hard-fails (never falls back to the wrong CLI)', () => {
  // The brand fallback (#194) must not soften this branch: the app names a
  // DIFFERENT framework, so running the host's CLI would run the wrong tool.
  // Real execution in a child process — this path calls process.exit(1).
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-xfail-'));
  const appDir = path.join(scratch, 'site');
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(
    path.join(appDir, 'package.json'),
    JSON.stringify({ name: 'site', dependencies: { '@omega.js/web': '*' } })
  );
  const runner = path.join(scratch, 'runner.js');
  fs.writeFileSync(
    runner,
    `require(${JSON.stringify(path.join(__dirname, '..', 'src', 'omega-bin.js'))})`
      + `.run({ hostName: '@omega.js/desktop', hostRun: () => console.log('HOST-RAN') });`
  );

  const out = require('child_process').spawnSync(process.execPath, [runner], { cwd: appDir, encoding: 'utf8' });
  assert.equal(out.status, 1);
  assert.equal(out.stdout.includes('HOST-RAN'), false);
  assert.match(out.stderr, /could not resolve '@omega\.js\/web\/cli'/);
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
