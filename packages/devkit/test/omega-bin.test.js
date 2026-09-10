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

const { findTarget, isBrandRoot, verbOf, isBoxVerbArgv, TARGET_SUBDIRS, FRAMEWORKS, MANAGER, run } = require('../src/omega-bin.js');

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

// ─── Contextless-verb guard (#699) ───────────────────────────────────────────

/**
 * A targetless cwd with the dispatcher wired to a host that only ANNOUNCES
 * itself — a real run in a child process, since the refusal exits the process.
 * @returns {{ workDir: string, invoke: (args: string[]) => object }}
 */
function stageTargetless() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-guard-'));
  const workDir = path.join(scratch, 'work');
  fs.mkdirSync(workDir);
  const runner = path.join(scratch, 'runner.js'); // outside workDir — it must stay empty
  fs.writeFileSync(
    runner,
    `require(${JSON.stringify(path.join(__dirname, '..', 'src', 'omega-bin.js'))})`
      + `.run({ hostName: '@omega.js/desktop', hostRun: () => console.log('HOST-RAN') });`
  );

  return {
    workDir,
    invoke: (args) => require('child_process').spawnSync(
      process.execPath, [runner, ...args], { cwd: workDir, encoding: 'utf8' }
    ),
  };
}

test('run(): a MUTATING verb with no target context is REFUSED, and writes nothing (#699)', () => {
  // The accident: `omega deploy --yes` outside any target fell back to the
  // hoist-winner CLI, whose deploy scaffolded a whole target into the cwd.
  const { workDir, invoke } = stageTargetless();
  const out = invoke(['deploy', '--yes']);

  assert.equal(out.status, 1);
  assert.equal(out.stdout.includes('HOST-RAN'), false, 'the host CLI must never start');
  assert.match(out.stderr, /refusing to run "deploy"/);
  assert.ok(out.stderr.includes(workDir), `the refusal names the cwd: ${out.stderr}`);
  assert.match(out.stderr, /Nothing was scaffolded/);
  assert.deepEqual(fs.readdirSync(workDir), [], 'the cwd is untouched');
});

test('run(): the refusal lists every verb that still runs, onboard aliases included (#706)', () => {
  // The message named onboard/help/version/cwd/logs while the allowlist also
  // carried `create` and `new` — a reader following it typed the one spelling
  // it mentioned and never learned the other two work.
  const { invoke } = stageTargetless();
  const out = invoke(['deploy']);

  assert.match(out.stderr, /only onboard \(create, new\), help, version, cwd and logs run/);
});

test('run(): every mutating verb spelling is refused — positional and flag-style alias (#699)', () => {
  const { invoke } = stageTargetless();
  for (const args of [['build'], ['package'], ['test'], ['install', 'local'], ['--deploy'], ['-b'], ['update']]) {
    const out = invoke(args);
    assert.equal(out.status, 1, `${args.join(' ')} must be refused: ${out.stderr}`);
    assert.equal(out.stdout.includes('HOST-RAN'), false);
  }
});

test('run(): the bootstrap and read-only verbs still dispatch with no target context (#276)', () => {
  const { invoke } = stageTargetless();
  for (const args of [[], ['onboard'], ['new'], ['help'], ['--help'], ['deploy', '--help'], ['version'], ['-v'], ['cwd'], ['logs']]) {
    const out = invoke(args);
    assert.equal(out.status, 0, `${args.join(' ') || '(bare)'} must still run: ${out.stderr}`);
    assert.ok(out.stdout.includes('HOST-RAN'), `${args.join(' ') || '(bare)'} reaches the host CLI`);
  }
});

test('verbOf: --help wins over a positional, then the positional, then a flag alias', () => {
  assert.equal(verbOf([]), null);
  assert.equal(verbOf(['deploy', '--yes']), 'deploy');
  assert.equal(verbOf(['--yes', 'deploy']), 'deploy');
  assert.equal(verbOf(['deploy', '--help']), 'help');
  assert.equal(verbOf(['-h']), 'help');
  assert.equal(verbOf(['--deploy']), '--deploy');
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

// ─── A framework's OWN root (#757) ───────────────────────────────────────────

/**
 * A framework package's own root, as it really ships: an `@omega.js/*` name, a
 * `./cli` export, and a DEVDEPENDENCY on another framework (packages/extension
 * and packages/desktop depend on @omega.js/web for their vendorAssets, the
 * manager on @omega.js/backend). Nothing here is a consumer target.
 * @param {{ name: string, cli?: boolean, deps?: object }} spec
 * @returns {{ scratch: string, pkgDir: string, marker: string }}
 */
function stageOwnRoot({ name, cli = true, deps = {} }) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-own-'));
  const pkgDir = path.join(scratch, 'packages', name.split('/').pop());
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.mkdirSync(path.join(scratch, '.git'), { recursive: true }); // bound the walk

  const marker = path.join(scratch, 'marker.txt');
  const manifest = { name, version: '0.1.0', devDependencies: deps, exports: { '.': './index.js' } };
  if (cli) {
    manifest.exports['./cli'] = './dist/cli-run.js';
    fs.mkdirSync(path.join(pkgDir, 'dist'), { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'dist', 'cli-run.js'),
      `module.exports = { run() { require('fs').writeFileSync(${JSON.stringify(marker)}, __filename); } };`
    );
  }
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(manifest, null, 2));

  return { scratch, pkgDir, marker };
}

test('findTarget: a framework\'s OWN root beats the framework it DEPENDS on (#757)', () => {
  // The bug: packages/extension devDepends on @omega.js/web (vendorAssets), so
  // the dependency walk named WEB at the extension's own root and `omega test`
  // there ran an Eleventy build that scaffolded a web target into the package.
  const { pkgDir } = stageOwnRoot({ name: '@omega.js/extension', deps: { '@omega.js/web': '*' } });

  assert.deepEqual(findTarget(pkgDir), {
    kind: 'self',
    name: '@omega.js/extension',
    dir: pkgDir,
  });
});

test('findTarget: a deep dir inside a framework package walks up to its own root (#757)', () => {
  const { pkgDir } = stageOwnRoot({ name: '@omega.js/desktop', deps: { '@omega.js/web': '*' } });
  const deep = path.join(pkgDir, 'test', 'boot');

  assert.deepEqual(findTarget(deep), { kind: 'self', name: '@omega.js/desktop', dir: pkgDir });
});

test('findTarget: an @omega.js package with no CLI is still its OWN root, never a target (#757)', () => {
  const { pkgDir } = stageOwnRoot({ name: '@omega.js/config', cli: false });

  assert.deepEqual(findTarget(pkgDir), { kind: 'self', name: '@omega.js/config', dir: pkgDir });
});

test('run(): a framework\'s own root dispatches to its OWN ./cli (#757)', async () => {
  const { pkgDir, marker } = stageOwnRoot({ name: '@omega.js/extension', deps: { '@omega.js/web': '*' } });

  const cwd0 = process.cwd();
  process.chdir(pkgDir);
  try {
    await run({
      hostName: '@omega.js/web',
      hostRun: () => { throw new Error('the hoist-winner host must not run inside another framework\'s package'); },
      argv: ['test', 'boot/manifest'],
    });
  } finally {
    process.chdir(cwd0);
  }

  // realpath: process.chdir() resolves macOS's /var → /private/var symlink, and
  // the resolved CLI path comes back through the chdir'd cwd.
  assert.equal(
    fs.readFileSync(marker, 'utf8'),
    fs.realpathSync(path.join(pkgDir, 'dist', 'cli-run.js'))
  );
});

test('run(): a framework\'s own root with the host match runs hostRun directly (#757)', async () => {
  const { pkgDir } = stageOwnRoot({ name: '@omega.js/extension', deps: { '@omega.js/web': '*' } });

  const cwd0 = process.cwd();
  let ran = 0;
  process.chdir(pkgDir);
  try {
    await run({ hostName: '@omega.js/extension', hostRun: () => { ran += 1; }, argv: ['test'] });
  } finally {
    process.chdir(cwd0);
  }
  assert.equal(ran, 1);
});

test('run(): an @omega.js package that ships no CLI REFUSES, never reaching the host fallback (#757)', () => {
  // packages/config, packages/devkit and friends: an OMEGA package is never a
  // target, so there is nothing to scaffold and nothing to hand the host.
  const { scratch, pkgDir } = stageOwnRoot({ name: '@omega.js/config', cli: false });
  const runner = path.join(scratch, 'runner.js');
  fs.writeFileSync(
    runner,
    `require(${JSON.stringify(path.join(__dirname, '..', 'src', 'omega-bin.js'))})`
      + `.run({ hostName: '@omega.js/web', hostRun: () => console.log('HOST-RAN') });`
  );

  const out = require('child_process').spawnSync(
    process.execPath, [runner, 'build'], { cwd: pkgDir, encoding: 'utf8' }
  );

  assert.equal(out.status, 1);
  assert.equal(out.stdout.includes('HOST-RAN'), false, 'the host CLI must never start inside an OMEGA package');
  assert.match(out.stderr, /@omega\.js\/config/);
  assert.match(out.stderr, /Nothing was scaffolded/);
  assert.deepEqual(fs.readdirSync(pkgDir).sort(), ['package.json'], 'the package is untouched');
});

// The signing box's verbs with NO target context: a box is a machine, not a
// project, so `omega runner` / `omega sign-windows` run from any directory
// through @omega.js/desktop — the host when it is desktop, else desktop
// resolved from the cwd, else a refusal naming the install (#337).
function stageBox({ hostName, installDesktop }) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-box-'));
  const workDir = path.join(scratch, 'work');
  fs.mkdirSync(workDir);
  const marker = path.join(scratch, 'marker.txt');
  if (installDesktop) {
    const fwDir = path.join(scratch, 'node_modules', '@omega.js', 'desktop');
    fs.mkdirSync(fwDir, { recursive: true });
    fs.writeFileSync(path.join(fwDir, 'package.json'), JSON.stringify({ name: '@omega.js/desktop', exports: { './cli': './cli.js' } }));
    fs.writeFileSync(path.join(fwDir, 'cli.js'), `module.exports = { run() { require('fs').writeFileSync(${JSON.stringify(marker)}, 'desktop-dispatched'); } };`);
  }
  const runner = path.join(scratch, 'runner.js');
  fs.writeFileSync(
    runner,
    `require(${JSON.stringify(path.join(__dirname, '..', 'src', 'omega-bin.js'))})`
      + `.run({ hostName: ${JSON.stringify(hostName)}, hostRun: () => console.log('HOST-RAN') });`
  );
  return {
    workDir,
    marker,
    invoke: (args) => require('child_process').spawnSync(process.execPath, [runner, ...args], { cwd: workDir, encoding: 'utf8' }),
  };
}

test('isBoxVerbArgv: a box verb answers to its bare token AND its -- flag spelling (#337)', () => {
  // The desktop CLI's alias table takes `--runner` and `--sign-windows`, so both
  // spellings reach the same command — and both must be recognised HERE, or the
  // flag form loads a project's .env cascade onto the box.
  for (const argv of [
    ['runner'], ['runner', 'status'], ['sign-windows', '--smoke'],
    ['--runner'], ['--runner', 'status'], ['--sign-windows'], ['--sign-windows', '--smoke'],
  ]) {
    assert.equal(isBoxVerbArgv(argv), true, `${argv.join(' ')} is a box invocation`);
  }
  for (const argv of [[], ['build'], ['--deploy'], ['test', 'runner'], ['runner', '--help'], ['--runner', '--help']]) {
    assert.equal(isBoxVerbArgv(argv), false, `${argv.join(' ') || '(bare)'} is not a box invocation`);
  }
});

test('run(): the signing-box verbs run with no target when desktop IS the host (a bare global install) (#337)', () => {
  const { workDir, invoke } = stageBox({ hostName: '@omega.js/desktop', installDesktop: false });
  for (const args of [['runner', 'status'], ['runner', 'install'], ['sign-windows', '--smoke'], ['--runner', 'status'], ['--sign-windows', '--smoke']]) {
    const out = invoke(args);
    assert.equal(out.status, 0, `${args.join(' ')} must run: ${out.stderr}`);
    assert.ok(out.stdout.includes('HOST-RAN'), `${args.join(' ')} reaches desktop's CLI`);
  }
  assert.deepEqual(fs.readdirSync(workDir), [], 'nothing was scaffolded into the cwd');
});

test('run(): the signing-box verbs dispatch to an installed desktop when another framework won the bin link (#337)', () => {
  const { workDir, marker, invoke } = stageBox({ hostName: '@omega.js/backend', installDesktop: true });
  const out = invoke(['runner', 'status']);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout.includes('HOST-RAN'), false, 'the backend host must not run a desktop verb');
  assert.equal(fs.readFileSync(marker, 'utf8'), 'desktop-dispatched');
  assert.match(out.stderr, /signing-box verb, running @omega\.js\/desktop/);
  assert.deepEqual(fs.readdirSync(workDir), []);
});

test('run(): the signing-box verbs refuse, naming the install, when desktop is nowhere (#337)', () => {
  const { workDir, invoke } = stageBox({ hostName: '@omega.js/backend', installDesktop: false });
  const out = invoke(['sign-windows', '--smoke']);
  assert.equal(out.status, 1);
  assert.equal(out.stdout.includes('HOST-RAN'), false);
  assert.match(out.stderr, /npm i -g @omega\.js\/desktop/);
  assert.ok(out.stderr.includes(workDir), `the refusal names the cwd: ${out.stderr}`);
  assert.deepEqual(fs.readdirSync(workDir), []);
});
