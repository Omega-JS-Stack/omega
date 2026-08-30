/**
 * omega-bin dispatcher — context detection (target framework / brand root) +
 * dispatch. Real execution, no mocks: committed fixtures for detection, an
 * os.tmpdir() scratch with a fake installed package for each dispatch case.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { findTarget, isBrandRoot, TARGET_SUBDIRS, FRAMEWORKS, MANAGER, run } = require('../src/omega-bin.js');

const FIXTURES = path.join(__dirname, 'fixtures', 'local');
const BRAND = path.join(FIXTURES, 'brand');
const DISPATCH = path.join(__dirname, 'fixtures', 'dispatch');

test('FRAMEWORKS covers exactly the four target frameworks', () => {
  assert.deepEqual(FRAMEWORKS, [
    '@omega.js/web',
    '@omega.js/backend',
    '@omega.js/desktop',
    '@omega.js/extension',
  ]);
  assert.equal(MANAGER, '@omega.js/manager');
});

test('findTarget: web target via devDependency', () => {
  const hit = findTarget(path.join(BRAND, 'targets', 'site'));
  assert.deepEqual(hit, { kind: 'framework', name: '@omega.js/web', dir: path.join(BRAND, 'targets', 'site') });
});

test('findTarget: backend target via target-root manifest (src/dist pillar — no functions/ peek)', () => {
  const hit = findTarget(path.join(BRAND, 'targets', 'backend-api'));
  assert.deepEqual(hit, {
    kind: 'framework',
    name: '@omega.js/backend',
    dir: path.join(BRAND, 'targets', 'backend-api'),
  });
});

test('findTarget: inside functions/ walks up to the target root', () => {
  const hit = findTarget(path.join(BRAND, 'targets', 'backend-api', 'functions'));
  assert.equal(hit.name, '@omega.js/backend');
  assert.equal(hit.dir, path.join(BRAND, 'targets', 'backend-api'));
});

test('findTarget: a deep (even nonexistent) dir inside a target walks up to the target', () => {
  const hit = findTarget(path.join(BRAND, 'targets', 'site', 'src', 'pages', 'deep'));
  assert.equal(hit.name, '@omega.js/web');
});

test('findTarget: standalone project (desktop devDep)', () => {
  const hit = findTarget(path.join(FIXTURES, 'standalone-project'));
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

test('findTarget: deep non-target dir inside a brand walks up to the brand root', () => {
  const hit = findTarget(path.join(DISPATCH, 'brand', 'config'));
  assert.deepEqual(hit, { kind: 'brand', dir: path.join(DISPATCH, 'brand') });
});

test('findTarget: a target inside a brand still dispatches as the target (nearest context wins)', () => {
  const hit = findTarget(path.join(DISPATCH, 'brand', 'targets', 'site'));
  assert.deepEqual(hit, {
    kind: 'framework',
    name: '@omega.js/web',
    dir: path.join(DISPATCH, 'brand', 'targets', 'site'),
  });
});

test('findTarget: a target-of-brand config with no framework dep is skipped, resolving the brand above', () => {
  const hit = findTarget(path.join(DISPATCH, 'brand', 'targets', 'rogue'));
  assert.deepEqual(hit, { kind: 'brand', dir: path.join(DISPATCH, 'brand') });
});

test('findTarget: standalone consumer with BOTH framework dep and config → framework wins', () => {
  const hit = findTarget(path.join(DISPATCH, 'standalone-consumer'));
  assert.equal(hit.kind, 'framework');
  assert.equal(hit.name, '@omega.js/desktop');
});

test('isBrandRoot: true at a brand root, false for a target-of-brand config dir', () => {
  assert.equal(isBrandRoot(path.join(DISPATCH, 'brand')), true);
  assert.equal(isBrandRoot(path.join(DISPATCH, 'brand', 'targets', 'rogue')), false);
  assert.equal(isBrandRoot(path.join(DISPATCH, 'brand', 'targets', 'site')), false);
});

// ─── TARGET_SUBDIRS: functions/ and dist/ are target VIEWS, never roots (#307) ───

/**
 * A backend target staged by `omega build`: the target root declares the framework,
 * and dist/ carries the GENERATED tree — a derived manifest (runtime
 * dependencies only, so a devDependency-declared framework is absent from it)
 * beside the composed config/omega.json5.
 * @returns {{ brandRoot: string, targetDir: string, distDir: string }}
 */
function makeStagedBackend() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-staged-'));
  const brandRoot = path.join(scratch, 'acme');
  const targetDir = path.join(brandRoot, 'targets', 'backend-api');
  const distDir = path.join(targetDir, 'dist');

  fs.mkdirSync(path.join(brandRoot, '.git'), { recursive: true }); // bound the walk
  fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
  fs.mkdirSync(path.join(distDir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), '{ brand: { id: "acme" } }\n');
  fs.writeFileSync(
    path.join(targetDir, 'package.json'),
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

  return { brandRoot, targetDir, distDir };
}

test('findTarget: inside a staged backend\'s dist/ walks up to the target root (#307)', () => {
  const { targetDir, distDir } = makeStagedBackend();

  assert.deepEqual(findTarget(distDir), {
    kind: 'framework',
    name: '@omega.js/backend',
    dir: targetDir,
  });
});

test('isBrandRoot: an TARGET_SUBDIR view (functions/, dist/) is never a brand root, config or not (#307)', () => {
  const { distDir } = makeStagedBackend();
  assert.equal(isBrandRoot(distDir), false, 'a staged dist/ carries a composed config but is output, not a root');

  // functions/ — the pre-pillar runtime cwd, same rule (both live in TARGET_SUBDIRS)
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-functions-'));
  fs.mkdirSync(path.join(scratch, 'functions', 'config'), { recursive: true });
  fs.writeFileSync(path.join(scratch, 'functions', 'config', 'omega.json5'), '{ brand: { id: "legacy" } }\n');
  assert.equal(isBrandRoot(path.join(scratch, 'functions')), false);
});

test('TARGET_SUBDIRS: the stdlib twin mirrors @omega.js/config\'s canonical list (#307)', () => {
  // The dispatcher cannot REQUIRE @omega.js/config (it is vendored into every
  // framework dist), so the list is copied — this pins the copy to the
  // canonical one so the twin can never drift again.
  assert.deepEqual(TARGET_SUBDIRS, require('@omega.js/config/load').TARGET_SUBDIRS);
});

// ─── Repo boundary (#73) ─────────────────────────────────────────────────────

test('findTarget: the walk stops at the nearest .git — a context outside the repo is never adopted', () => {
  // Outer dir = a framework target; inner repo = an unconfigured project. An
  // unbounded walk would climb out of the repo and dispatch the outer target.
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

test('run(): no target context falls back to the HOST CLI (bootstrap case, e.g. a verb in a fresh dir)', async () => {
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
  process.chdir(path.join(BRAND, 'targets', 'site'));
  try {
    await run({ hostName: '@omega.js/web', hostRun: () => { ran += 1; } });
  } finally {
    process.chdir(cwd0);
  }
  assert.equal(ran, 1);
});

test('run(): cross-framework dispatch resolves the target\'s ./cli and calls run()', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-x-'));
  const targetDir = path.join(scratch, 'targets', 'site');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(
    path.join(targetDir, 'package.json'),
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
  process.chdir(targetDir);
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
  // A verb's ensureTarget scaffolds config/omega.json5 into a STANDALONE project before
  // the framework dep lands in its package.json — brand-shaped, but no manager to
  // dispatch to. The dispatcher must not dead-end there.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-nomgr-'));
  const targetDir = path.join(scratch, 'fresh-target');
  fs.mkdirSync(path.join(targetDir, 'config'), { recursive: true });
  fs.mkdirSync(path.join(targetDir, '.git'), { recursive: true }); // bound the walk inside the scratch
  fs.writeFileSync(
    path.join(targetDir, 'package.json'),
    JSON.stringify({ name: 'fresh-target', dependencies: {} })
  );
  fs.writeFileSync(path.join(targetDir, 'config', 'omega.json5'), '{ brand: { id: "fresh-target" } }\n');

  const cwd0 = process.cwd();
  const error0 = console.error;
  const notes = [];
  let ran = 0;
  console.error = (...args) => { notes.push(args.join(' ')); };
  process.chdir(targetDir);
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
  assert.ok(note.includes(targetDir), `note names the brand-shaped dir: ${note}`);
});

test('run(): the MANAGER host in a brand-shaped dir never says to install what it is running (#276)', async () => {
  // The fresh brand-template clone: brand-shaped, nothing installed, and the
  // host IS the manager. "Install @omega.js/manager" would name the thing
  // about to run — that wording is for framework hosts only.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-mgrhost-'));
  const cloneDir = path.join(scratch, 'clone');
  fs.mkdirSync(path.join(cloneDir, 'config'), { recursive: true });
  fs.mkdirSync(path.join(cloneDir, '.git'), { recursive: true }); // bound the walk inside the scratch
  fs.writeFileSync(
    path.join(cloneDir, 'package.json'),
    JSON.stringify({ name: 'clone', dependencies: {} })
  );
  fs.writeFileSync(path.join(cloneDir, 'config', 'omega.json5'), '{ brand: { id: "clone" } }\n');

  const cwd0 = process.cwd();
  const error0 = console.error;
  const notes = [];
  let ran = 0;
  console.error = (...args) => { notes.push(args.join(' ')); };
  process.chdir(cloneDir);
  try {
    await run({ hostName: '@omega.js/manager', hostRun: () => { ran += 1; } });
  } finally {
    process.chdir(cwd0);
    console.error = error0;
  }

  assert.equal(ran, 1);
  const note = notes.join('\n');
  assert.doesNotMatch(note, /is not installed/, `the self-contradicting wording must not fire for the manager host: ${note}`);
  assert.match(note, /running the bundled @omega\.js\/manager/);
  assert.ok(note.includes(cloneDir), `note names the brand-shaped dir: ${note}`);
});

test('run(): an unresolvable CROSS-FRAMEWORK target still hard-fails (never falls back to the wrong CLI)', () => {
  // The brand fallback (#194) must not soften this branch: the target names a
  // DIFFERENT framework, so running the host's CLI would run the wrong tool.
  // Real execution in a child process — this path calls process.exit(1).
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-xfail-'));
  const targetDir = path.join(scratch, 'site');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(
    path.join(targetDir, 'package.json'),
    JSON.stringify({ name: 'site', dependencies: { '@omega.js/web': '*' } })
  );
  const runner = path.join(scratch, 'runner.js');
  fs.writeFileSync(
    runner,
    `require(${JSON.stringify(path.join(__dirname, '..', 'src', 'omega-bin.js'))})`
      + `.run({ hostName: '@omega.js/desktop', hostRun: () => console.log('HOST-RAN') });`
  );

  const out = require('child_process').spawnSync(process.execPath, [runner], { cwd: targetDir, encoding: 'utf8' });
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
    JSON.stringify({ name: 'my-brand', private: true, workspaces: ['targets/*'] })
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
