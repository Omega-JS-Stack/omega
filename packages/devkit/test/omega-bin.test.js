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

test('findTarget: a deep (even nonexistent) dir inside a target walks up to the target its refusal names', () => {
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

test('run(): no target context and no manager installed falls back to the HOST CLI (bootstrap case, e.g. a verb in a fresh dir)', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-boot-'));
  const cwd0 = process.cwd();
  const error0 = console.error;
  const notes = [];
  let ran = 0;
  console.error = (...args) => { notes.push(args.join(' ')); };
  process.chdir(scratch);
  try {
    await run({ hostName: '@omega.js/web', hostRun: () => { ran += 1; } });
  } finally {
    process.chdir(cwd0);
    console.error = error0;
  }
  assert.equal(ran, 1);
  // The manager preference (#908) must not swallow this lane: with nothing
  // installed there is no manager CLI to hand over to.
  const note = notes.join('\n');
  assert.match(note, /no target context found from [\s\S]*running @omega\.js\/web/);
  assert.doesNotMatch(note, /running @omega\.js\/manager/);
});

/** A fake @omega.js/manager installed under `root`, whose CLI's run() is `body`. */
function installManager(root, body) {
  const dir = path.join(root, 'node_modules', '@omega.js', 'manager');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@omega.js/manager', exports: { './cli': './cli.js' } }));
  fs.writeFileSync(path.join(dir, 'cli.js'), `module.exports = { run() { ${body} } };`);
}

/**
 * A targetless cwd with a fake @omega.js/manager installed above it: the fresh
 * brand-template clone after `npm i --save-dev @omega.js/manager`, where the
 * backend won npm's .bin/omega link because the manager depends on it (#908).
 * @returns {{ workDir: string, marker: string }}
 */
function stageInstalledManager() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-mgr-'));
  fs.mkdirSync(path.join(scratch, '.git'), { recursive: true }); // bound the walk
  const workDir = path.join(scratch, 'clone');
  fs.mkdirSync(workDir);

  const marker = path.join(scratch, 'marker.txt');
  installManager(scratch, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'manager-dispatched');`);

  return { workDir, marker };
}

test('run(): no target context dispatches to an INSTALLED manager, never the hoist-winner host (#908)', async () => {
  // The reported break: `npx omega onboard` in a fresh clone that had installed
  // only @omega.js/manager reached the BACKEND's CLI, which knows no such verb.
  const { workDir, marker } = stageInstalledManager();
  const cwd0 = process.cwd();
  const error0 = console.error;
  const notes = [];
  console.error = (...args) => { notes.push(args.join(' ')); };
  process.chdir(workDir);
  try {
    await run({
      hostName: '@omega.js/backend',
      hostRun: () => { throw new Error('must not run the backend'); },
      argv: ['onboard', '--id=notifly'],
    });
  } finally {
    process.chdir(cwd0);
    console.error = error0;
  }

  assert.equal(fs.readFileSync(marker, 'utf8'), 'manager-dispatched');
  const note = notes.join('\n');
  assert.match(note, /no target context found from .*: running @omega\.js\/manager/);
  assert.ok(note.includes(fs.realpathSync(workDir)), `the note names the cwd: ${note}`);
});

test('run(): an installed manager never rescues a REFUSED verb with no target context (#699)', async () => {
  // Order stands: the contextless-verb guard runs ahead of every dispatch, so a
  // mutating verb is still refused before the manager is even resolved.
  const { workDir, marker } = stageInstalledManager();
  const runner = path.join(path.dirname(workDir), 'runner.js');
  fs.writeFileSync(
    runner,
    `require(${JSON.stringify(path.join(__dirname, '..', 'src', 'omega-bin.js'))})`
      + `.run({ hostName: '@omega.js/backend', hostRun: () => console.log('HOST-RAN') });`
  );

  const out = require('child_process').spawnSync(
    process.execPath, [runner, 'deploy', '--yes'], { cwd: workDir, encoding: 'utf8' }
  );

  assert.equal(out.status, 1);
  assert.equal(out.stdout.includes('HOST-RAN'), false);
  assert.match(out.stderr, /refusing to run "deploy"/);
  assert.equal(fs.existsSync(marker), false, 'the manager CLI never started');
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

  assert.deepEqual(['onboard (create, new)', 'help', 'version', 'cwd', 'logs', 'status'].filter((verb) => !(out.stderr.match(/only (.+) run/) || ['', ''])[1].includes(verb)), [], out.stderr);
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
  for (const args of [[], ['onboard'], ['new'], ['status'], ['help'], ['--help'], ['deploy', '--help'], ['version'], ['-v'], ['cwd'], ['logs']]) {
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
  fs.writeFileSync(path.join(brandRoot, 'package.json'), JSON.stringify({ name: 'my-brand', private: true, workspaces: ['targets/*'] }));
  fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), '{ brand: { id: "my-brand" } }\n');

  // Fake installed manager at the brand root (resolution walks up from there).
  const marker = path.join(scratch, 'marker.txt');
  installManager(brandRoot, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'brand-dispatched');`);

  const cwd0 = process.cwd();
  process.chdir(brandRoot);
  try {
    await run({
      hostName: '@omega.js/web',
      hostRun: () => { throw new Error('hostRun must not fire at a brand root'); },
      argv: ['build'],
    });
    assert.equal(process.env.OMEGA_ROOT_DISPATCH, undefined, 'an accepted root run sets no env marker for its children');
  } finally {
    process.chdir(cwd0);
  }
  assert.equal(fs.readFileSync(marker, 'utf8'), 'brand-dispatched');
});

test('run(): a verb only the manager owns that needs no brand runs the manager inside a target, and exits 1 naming the install with none', () => {
  const { scratch, brandRoot, targetDir } = stageBrandTarget();
  const none = invokeBin({ scratch, hostName: '@omega.js/web', cwd: targetDir, args: ['status'] });
  assert.ok(none.status === 1 && !none.stdout.includes('HOST-RAN') && /@omega\.js\/manager/.test(none.stderr) && /project root/.test(none.stderr), `no manager: ${none.status} ${none.stdout}${none.stderr}`);
  installManager(brandRoot, "console.log('MANAGER-RAN');");
  for (const args of [['status'], ['status', '--json'], ['onboard', '--id=acme']]) {
    const out = invokeBin({ scratch, hostName: '@omega.js/web', cwd: targetDir, args });
    assert.ok(out.status === 0 && out.stdout.includes('MANAGER-RAN') && !out.stdout.includes('HOST-RAN'), `${args.join(' ')} in a target: ${out.stdout}${out.stderr}`);
  }
});

// ─── A verb runs wherever one of its owners is; brand-wide verbs refuse below the root ───

const BIN = path.join(__dirname, '..', 'src', 'omega-bin.js');

/**
 * Run the dispatcher as a real process (a refusal exits it), wired to a host
 * that only announces itself.
 */
function invokeBin({ scratch, hostName, cwd, args }) {
  const runner = path.join(scratch, 'runner.js');
  fs.writeFileSync(runner, `require(${JSON.stringify(BIN)}).run({ hostName: ${JSON.stringify(hostName)}, hostRun: () => console.log('HOST-RAN') });`);
  return require('child_process').spawnSync(process.execPath, [runner, ...args], { cwd, encoding: 'utf8' });
}

/**
 * A brand with one web target, and a deep dir inside it. Realpaths throughout:
 * the child's cwd resolves macOS's /var symlink, and the refusal prints that path.
 * @returns {{ scratch: string, brandRoot: string, targetDir: string, deep: string }}
 */
function stageBrandTarget() {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-root-')));
  const brandRoot = path.join(scratch, 'acme');
  const targetDir = path.join(brandRoot, 'targets', 'site');
  const deep = path.join(targetDir, 'src', 'pages');
  fs.mkdirSync(path.join(brandRoot, '.git'), { recursive: true });
  fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), '{ brand: { id: "acme" } }\n');
  fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({ name: 'acme-site', devDependencies: { '@omega.js/web': '*' } }));
  return { scratch, brandRoot, targetDir, deep };
}

/**
 * A monorepo checkout as the dispatcher sees it: a root named "omega" with a
 * packages/devkit workspace, two framework packages that ship the `omega` bin and
 * a `./cli` (extension devDepends on web, the shape that misread as a target),
 * the manager, and a package with neither.
 * @returns {{ root: string, marker: string }}
 */
function stageMonorepo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-bin-mono-')));
  const marker = path.join(root, 'marker.txt');
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'omega', workspaces: ['packages/*'] }));

  const write = (dirName, manifest) => {
    const dir = path.join(root, 'packages', dirName);
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
    fs.writeFileSync(
      path.join(dir, 'dist', 'cli-run.js'),
      `module.exports = { run() { require('fs').writeFileSync(${JSON.stringify(marker)}, ${JSON.stringify(manifest.name)}); } };\n`
        + 'if (require.main === module) module.exports.run();\n'
    );
  };
  const framework = (name, deps = {}) => ({ name, bin: { omega: 'bin/omega' }, exports: { './cli': './dist/cli-run.js' }, devDependencies: deps });
  write('devkit', { name: '@omega.js/devkit' });
  write('extension', framework('@omega.js/extension', { '@omega.js/web': '*' }));
  write('web', framework('@omega.js/web'));
  write('config', { name: '@omega.js/config' });
  // Ships the bin, but its CLI's `test` is the brand fan-out: never a monorepo pick
  write('manager', framework('@omega.js/manager'));
  return { root, marker };
}

test('run(): a verb the target\'s framework owns runs in place, in the target dir and deep inside it', () => {
  const { scratch, targetDir, deep } = stageBrandTarget();
  for (const cwd of [targetDir, deep]) {
    for (const verb of ['test', 'build', 'dev']) {
      const out = invokeBin({ scratch, hostName: '@omega.js/web', cwd, args: [verb, '--dry-run'] });
      assert.equal(out.status, 0, `${verb} in ${cwd}: ${out.stderr}`);
      assert.ok(out.stdout.includes('HOST-RAN'), `${verb} ran the target framework's CLI in ${cwd}`);
      assert.equal(out.stderr.includes('refusing'), false, out.stderr);
    }
  }
});

test('run(): ownership reads every row a token selects: `serve` runs in a web target (dev\'s alias) and in a backend target (its own verb)', () => {
  const { scratch, targetDir } = stageBrandTarget();
  const web = invokeBin({ scratch, hostName: '@omega.js/web', cwd: targetDir, args: ['serve'] });
  assert.equal(web.status, 0, web.stderr);
  assert.ok(web.stdout.includes('HOST-RAN'));

  const backendDir = path.join(path.dirname(targetDir), 'api');
  fs.mkdirSync(backendDir);
  fs.writeFileSync(path.join(backendDir, 'package.json'), JSON.stringify({ name: 'acme-api', dependencies: { '@omega.js/backend': '*' } }));
  const backend = invokeBin({ scratch, hostName: '@omega.js/backend', cwd: backendDir, args: ['serve'] });
  assert.equal(backend.status, 0, backend.stderr);
  assert.ok(backend.stdout.includes('HOST-RAN'));

  const desktopDir = path.join(path.dirname(targetDir), 'app');
  fs.mkdirSync(desktopDir);
  fs.writeFileSync(path.join(desktopDir, 'package.json'), JSON.stringify({ name: 'acme-app', dependencies: { '@omega.js/desktop': '*' } }));
  const desktop = invokeBin({ scratch, hostName: '@omega.js/desktop', cwd: desktopDir, args: ['serve'] });
  assert.equal(desktop.status, 0, desktop.stderr);
  assert.ok(desktop.stdout.includes('HOST-RAN'), '`serve` is dev\'s alias, and desktop owns dev');
});

test('run(): `dev` runs in place in a backend, desktop and extension target, and the brand root hands it to the manager', () => {
  const { scratch, brandRoot, targetDir } = stageBrandTarget();
  for (const [dir, framework] of [['api', 'backend'], ['app', 'desktop'], ['ext', 'extension']]) {
    const cwd = path.join(path.dirname(targetDir), dir);
    fs.mkdirSync(cwd);
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: `acme-${dir}`, devDependencies: { [`@omega.js/${framework}`]: '*' } }));
    const out = invokeBin({ scratch, hostName: `@omega.js/${framework}`, cwd, args: ['dev'] });
    assert.equal(out.status, 0, `${framework}: ${out.stderr}`);
    assert.ok(out.stdout.includes('HOST-RAN'), `${framework} ran its own dev in place`);
  }

  installManager(brandRoot, "console.log('MANAGER-RAN');");
  const root = invokeBin({ scratch, hostName: '@omega.js/backend', cwd: brandRoot, args: ['dev'] });
  assert.equal(root.status, 0, root.stderr);
  assert.ok(root.stdout.includes('MANAGER-RAN'), root.stdout);
  assert.equal(root.stdout.includes('HOST-RAN'), false, 'the brand root runs the manager, never the host framework');
});

test('run(): a brand-wide verb inside a target refuses and prints the brand-root form, no picker', () => {
  const { scratch, brandRoot, targetDir, deep } = stageBrandTarget();
  for (const cwd of [targetDir, deep]) {
    for (const verb of ['install', 'manage', 'migrate']) {
      const out = invokeBin({ scratch, hostName: '@omega.js/web', cwd, args: [verb, 'local'] });
      assert.equal(out.status, 1, `${verb} in ${cwd} must refuse: ${out.stdout}`);
      assert.equal(out.stdout.includes('HOST-RAN'), false, 'the target CLI never started');
      assert.match(out.stderr, /this verb runs at the brand root/);
      assert.ok(out.stderr.includes(`Run: cd ${brandRoot} && npx omega ${verb} local`), out.stderr);
      assert.equal(out.stderr.includes('--target='), false, `a brand-wide verb picks no target: ${out.stderr}`);
    }
  }
});

test('run(): a verb the target\'s framework does not own refuses with the brand-root form and its picker', () => {
  const { scratch, brandRoot, deep } = stageBrandTarget();
  const out = invokeBin({ scratch, hostName: '@omega.js/web', cwd: deep, args: ['package', '--quick'] });

  assert.equal(out.status, 1);
  assert.equal(out.stdout.includes('HOST-RAN'), false);
  assert.ok(out.stderr.includes(`cd ${brandRoot} && npx omega package --target=site --quick`), out.stderr);
});

test('run(): a brand subfolder that is no framework target still refuses every verb', () => {
  const { scratch, brandRoot } = stageBrandTarget();
  const docs = path.join(brandRoot, 'docs');
  fs.mkdirSync(docs);
  const out = invokeBin({ scratch, hostName: '@omega.js/web', cwd: docs, args: ['build'] });

  assert.equal(out.status, 1);
  assert.ok(out.stderr.includes(`cd ${brandRoot} && npx omega build`), out.stderr);
});

test('run(): framework source is never a target: every verb inside a framework package refuses with the monorepo root form', () => {
  const { root, marker } = stageMonorepo();
  const deep = path.join(root, 'packages', 'extension', 'test', 'boot');
  fs.mkdirSync(deep, { recursive: true });

  // Each refusal prints the one form the monorepo root accepts for that verb
  const forms = {
    test: 'npx omega test --target=extension boot/manifest',
    build: 'npm run build --workspaces --if-present',
    clean: 'npm run clean --workspaces --if-present',
  };
  for (const [verb, ...rest] of [['test', 'boot/manifest'], ['build', '--dry-run'], ['clean']]) {
    const out = invokeBin({ scratch: root, hostName: '@omega.js/web', cwd: deep, args: [verb, ...rest] });
    assert.equal(out.status, 1, `${verb} must refuse: ${out.stdout}`);
    assert.equal(fs.existsSync(marker), false, `${verb}: no package CLI started`);
    assert.match(out.stderr, /this verb runs at the monorepo root/);
    assert.ok(out.stderr.includes(`Run: cd ${root} && ${forms[verb]}`), out.stderr);
  }
});

test('run(): a verb the package does not own refuses with the monorepo root form', () => {
  const { root, marker } = stageMonorepo();
  const out = invokeBin({ scratch: root, hostName: '@omega.js/web', cwd: path.join(root, 'packages', 'extension'), args: ['package', '--quick'] });

  assert.equal(out.status, 1);
  assert.equal(fs.existsSync(marker), false, 'no package CLI started');
  assert.match(out.stderr, /this verb runs at the monorepo root/);
  assert.ok(out.stderr.includes(`Run: cd ${root} && npm run package --workspaces --if-present`), out.stderr);
});

test('run(): the manager package is source too: its own verbs refuse there', () => {
  const { root, marker } = stageMonorepo();
  const out = invokeBin({ scratch: root, hostName: '@omega.js/web', cwd: path.join(root, 'packages', 'manager'), args: ['manage'] });

  assert.equal(out.status, 1);
  assert.equal(fs.existsSync(marker), false);
  assert.ok(out.stderr.includes(`Run: cd ${root} && npm run manage --workspaces --if-present`), out.stderr);

  const dev = invokeBin({ scratch: root, hostName: '@omega.js/web', cwd: path.join(root, 'packages', 'manager'), args: ['dev'] });
  assert.ok(dev.stderr.includes(`Run: cd ${root} && npm start`), dev.stderr);
});

test('run(): a package that owns no verb refuses every one', () => {
  const { root, marker } = stageMonorepo();
  const out = invokeBin({ scratch: root, hostName: '@omega.js/web', cwd: path.join(root, 'packages', 'devkit'), args: ['test'] });

  assert.equal(out.status, 1);
  assert.equal(fs.existsSync(marker), false);
  // devkit is no framework pick, so its suite is its own workspace's npm test
  assert.ok(out.stderr.includes(`Run: cd ${root} && npm test --workspace packages/devkit`), out.stderr);
});

test('run(): a contextless verb and a box verb run from a subfolder', () => {
  const { scratch, deep } = stageBrandTarget();
  const version = invokeBin({ scratch, hostName: '@omega.js/web', cwd: deep, args: ['version'] });
  assert.equal(version.status, 0, version.stderr);
  assert.ok(version.stdout.includes('HOST-RAN'), 'version ran inside the target subfolder');

  const { root } = stageMonorepo();
  const inside = path.join(root, 'packages', 'web', 'src');
  fs.mkdirSync(inside, { recursive: true });
  const box = invokeBin({ scratch: root, hostName: '@omega.js/desktop', cwd: inside, args: ['runner', 'status'] });
  assert.equal(box.status, 0, box.stderr);
  assert.ok(box.stdout.includes('HOST-RAN'), 'the box verb reached desktop from inside a package');
});

test('findTarget: the monorepo root answers kind monorepo, and a package inside it names that package', () => {
  const { root } = stageMonorepo();
  assert.deepEqual(findTarget(root), { kind: 'monorepo', dir: root });

  // Identity beats dependency: extension devDepends on web, and is still no web target
  assert.deepEqual(findTarget(path.join(root, 'packages', 'extension', 'test')), {
    kind: 'monorepo',
    dir: root,
    package: { name: '@omega.js/extension', dir: path.join(root, 'packages', 'extension') },
  });

  const real = path.join(__dirname, '..', '..', '..');
  assert.deepEqual(findTarget(real), { kind: 'monorepo', dir: path.resolve(real) }, 'this checkout is one');
});

test('run(): monorepo `test --target=` spawns each picked package\'s CLI file in its dir, in registry order', async () => {
  const { root } = stageMonorepo();
  const calls = [];
  const cwd0 = process.cwd();
  const error0 = console.error;
  console.error = () => {};
  process.chdir(root);
  try {
    await run({
      hostName: '@omega.js/web',
      hostRun: () => { throw new Error('the host never runs at the monorepo root'); },
      argv: ['test', '--target=extension,web', 'framework:'],
      spawn: (command, args, options) => { calls.push({ command, args, options }); return { status: 0 }; },
    });
  } finally {
    process.chdir(cwd0);
    console.error = error0;
  }

  assert.deepEqual(calls.map((call) => call.args), [
    [path.join(root, 'packages', 'web', 'dist', 'cli-run.js'), 'test', 'framework:'],
    [path.join(root, 'packages', 'extension', 'dist', 'cli-run.js'), 'test', 'framework:'],
  ], 'web before extension (the registry order), each through its own CLI file, never the dispatcher');
  assert.equal(calls[0].command, process.execPath);
  assert.equal(calls[0].options.cwd, path.join(root, 'packages', 'web'));
  assert.equal(calls[0].options.env, undefined, 'the child inherits this process env');
  assert.equal(process.env.OMEGA_ROOT_DISPATCH, undefined, 'no env marker rides into the children');
});

test('run(): the monorepo root really runs the picked package\'s own CLI, which the in-package refusal never sees', () => {
  const { root, marker } = stageMonorepo();
  const out = invokeBin({ scratch: root, hostName: '@omega.js/web', cwd: root, args: ['test', '--target=extension'] });

  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stderr.includes('refusing'), false, out.stderr);
  assert.equal(fs.readFileSync(marker, 'utf8'), '@omega.js/extension');
});

test('run(): the monorepo test stops at the first failing package with its exit code', async () => {
  const { root } = stageMonorepo();
  const calls = [];
  const cwd0 = process.cwd();
  const error0 = console.error;
  console.error = () => {};
  process.chdir(root);
  try {
    await run({
      hostName: '@omega.js/web',
      hostRun: () => {},
      argv: ['test', '--target', '@omega.js/web,extension'],
      spawn: (command, args) => { calls.push(args); return { status: 7 }; },
    });
    assert.equal(process.exitCode, 7);
  } finally {
    process.exitCode = undefined;
    process.chdir(cwd0);
    console.error = error0;
  }
  assert.equal(calls.length, 1, 'extension never ran after web failed');
});

test('run(): an unknown --target at the monorepo root refuses naming the known packages', () => {
  const { root } = stageMonorepo();
  const out = invokeBin({ scratch: root, hostName: '@omega.js/web', cwd: root, args: ['test', '--target=wbe'] });

  assert.equal(out.status, 1);
  assert.match(out.stderr, /unknown --target "wbe": the monorepo's packages are web, extension\. Nothing ran\./);
});

test('run(): no --target at the monorepo root refuses and prints the picker', () => {
  const { root } = stageMonorepo();
  const out = invokeBin({ scratch: root, hostName: '@omega.js/web', cwd: root, args: ['test', 'framework:'] });

  assert.equal(out.status, 1);
  assert.match(out.stderr, /npx omega test --target=web framework:/);
  assert.match(out.stderr, /The packages are web, extension; the whole battery is npm test/);
});

test('run(): any verb but test at the monorepo root refuses naming the root npm script', () => {
  const { root, marker } = stageMonorepo();
  const build = invokeBin({ scratch: root, hostName: '@omega.js/web', cwd: root, args: ['-b'] });
  assert.equal(build.status, 1);
  assert.match(build.stderr, /for "-b" run the root npm script: npm run build --workspaces --if-present/);

  const dev = invokeBin({ scratch: root, hostName: '@omega.js/web', cwd: root, args: ['dev'] });
  assert.equal(dev.status, 1);
  assert.match(dev.stderr, /run the root npm script: npm start/);
  assert.equal(fs.existsSync(marker), false);
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
