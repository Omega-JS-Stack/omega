// Unit + real-npm tests for tools/prepare-guard.js — the gate that stops a
// CONSUMER install from rebuilding a file:-linked monorepo package in place
// (#350), the install-path half of the read-only contract #281 established for
// build verbs.
//
// Real-execution only (no mocks): the decision cases feed the env npm actually
// exports (captured from npm 11.12.1), and the end-to-end cases run a REAL
// `npm install` (offline — every dependency is a local file: path) against a
// scratch monorepo, once WITHOUT the guard (the red baseline: npm rebuilds the
// linked package) and once with it. The rewire cases run the REAL
// prepare-package against a scratch package, which is what overwrites
// `scripts.prepare` on every build.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const guardPrepare = require('../tools/prepare-guard');
const { prepareDecision, rewire, GUARDED_PREPARE, UNGUARDED_PREPARE } = guardPrepare;

const GUARD = path.join(__dirname, '..', 'tools', 'prepare-guard.js');

/** Fresh scratch dir (real path — macOS /var is a symlink), cleaned after the test. */
function makeScratch(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-prepare-guard-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Write a scratch monorepo (package.json named "omega" + a packages/devkit
 * workspace, which is what isMonorepoRoot recognizes) holding one buildable
 * package whose prepare is the real one-liner from the framework packages:
 * `node -e "require('<guard>')() && require('<build>')()"`. The build appends a
 * line to builds.log, so "did prepare run?" is a file read.
 * @param {string} root - Directory to write the monorepo into.
 * @param {object} [options]
 * @param {boolean} [options.guarded] - Wire the guard into the prepare script.
 * @returns {{root: string, packageDir: string, buildsLog: string}}
 */
function writeMonorepo(root, options = {}) {
  const { guarded = true } = options;
  const packageDir = path.join(root, 'packages', 'widget');

  fs.mkdirSync(path.join(root, 'packages', 'devkit'), { recursive: true });
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'omega',
    version: '1.0.0',
    private: true,
    workspaces: ['packages/*'],
  }, null, 2));
  fs.writeFileSync(path.join(root, 'packages', 'devkit', 'package.json'), JSON.stringify({
    name: '@omega.js/devkit',
    version: '1.0.0',
    private: true,
  }, null, 2));

  const build = path.join(packageDir, 'build.js');
  fs.writeFileSync(build, [
    'const fs = require(\'fs\');',
    'const path = require(\'path\');',
    'module.exports = () => {',
    '  fs.appendFileSync(path.join(__dirname, \'builds.log\'), `${Date.now()}\\n`);',
    '};',
    '',
  ].join('\n'));

  const clauses = guarded ? [GUARD, build] : [build];
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
    name: '@omega.js/widget',
    version: '1.0.0',
    scripts: {
      prepare: `node -e "${clauses.map((file) => `require('${file}')()`).join(' && ')}"`,
    },
  }, null, 2));

  return { root, packageDir, buildsLog: path.join(packageDir, 'builds.log') };
}

/**
 * Write a consumer with a file: dependency on the scratch package.
 * @param {string} dir - Consumer directory.
 * @param {string} packageDir - The linked package's directory.
 * @returns {string} The consumer directory.
 */
function writeConsumer(dir, packageDir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'fixture-consumer',
    version: '1.0.0',
    private: true,
    dependencies: { '@omega.js/widget': `file:${packageDir}` },
  }, null, 2));
  return dir;
}

/**
 * Run a real npm command in a directory. Offline: the only dependency is a
 * local file: path, so nothing is fetched.
 * @param {string[]} args - npm arguments (add --foreground-scripts to SEE the
 *   lifecycle output — npm buffers it away from a plain install, so the guard's
 *   notice lands on that channel; the flag changes nothing else).
 * @param {string} cwd - Working directory.
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function npm(args, cwd) {
  const result = spawnSync('npm', [...args, '--offline', '--no-audit', '--no-fund'], {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

/** How many times the scratch package's prepare has built. */
function buildCount(buildsLog) {
  return fs.existsSync(buildsLog) ? fs.readFileSync(buildsLog, 'utf8').trim().split('\n').filter(Boolean).length : 0;
}

/** Capture console.warn around a call, restoring after. */
function captured(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    return { result: fn(), warnings: warnings.join('\n') };
  } finally {
    console.warn = original;
  }
}

// ── the decision ────────────────────────────────────────────────────────────

test('a consumer install reaching into the monorepo skips the prepare', (t) => {
  const scratch = makeScratch(t);
  const { packageDir } = writeMonorepo(scratch);
  const consumer = path.join(scratch, '..', 'brand');

  const decision = prepareDecision({
    packageDir,
    env: { npm_command: 'install', npm_config_local_prefix: consumer, INIT_CWD: consumer },
  });

  assert.equal(decision.skip, true);
  assert.equal(decision.reason, 'consumer-install');
  assert.equal(decision.monorepoRoot, scratch);
});

test('npm ci in a consumer skips too — it installs the tree the same way', (t) => {
  const scratch = makeScratch(t);
  const { packageDir } = writeMonorepo(scratch);

  const decision = prepareDecision({
    packageDir,
    env: { npm_command: 'ci', npm_config_local_prefix: path.join(scratch, '..', 'brand') },
  });

  assert.equal(decision.skip, true);
});

test('INIT_CWD is the fallback when npm names no local prefix', (t) => {
  const scratch = makeScratch(t);
  const { packageDir } = writeMonorepo(scratch);

  const decision = prepareDecision({
    packageDir,
    env: { npm_command: 'install', INIT_CWD: path.join(scratch, '..', 'brand') },
  });

  assert.equal(decision.skip, true);
  assert.equal(decision.reason, 'consumer-install');
});

test("the monorepo's own root install builds", (t) => {
  const scratch = makeScratch(t);
  const { packageDir } = writeMonorepo(scratch);

  const decision = prepareDecision({
    packageDir,
    env: { npm_command: 'install', npm_config_local_prefix: scratch, INIT_CWD: scratch },
  });

  assert.equal(decision.skip, false);
  assert.equal(decision.reason, 'monorepo-install');
});

test('a workspace install builds — npm runs it from the monorepo root', (t) => {
  const scratch = makeScratch(t);
  const { packageDir } = writeMonorepo(scratch);

  const decision = prepareDecision({
    packageDir,
    env: {
      npm_command: 'install',
      npm_config_local_prefix: scratch,
      INIT_CWD: scratch,
      npm_config_workspace: 'packages/widget',
    },
  });

  assert.equal(decision.skip, false);
  assert.equal(decision.reason, 'monorepo-install');
});

test('an install typed inside the package builds — its root is still the monorepo', (t) => {
  const scratch = makeScratch(t);
  const { packageDir } = writeMonorepo(scratch);

  const decision = prepareDecision({
    packageDir,
    env: { npm_command: 'install', npm_config_local_prefix: scratch, INIT_CWD: packageDir },
  });

  assert.equal(decision.skip, false);
});

test('an install from a brand INSIDE the monorepo builds — it is a monorepo workflow', (t) => {
  const scratch = makeScratch(t);
  const { packageDir } = writeMonorepo(scratch);
  const brand = path.join(scratch, 'brands', 'sandbox-brand');
  fs.mkdirSync(brand, { recursive: true });

  const decision = prepareDecision({
    packageDir,
    env: { npm_command: 'install', npm_config_local_prefix: brand, INIT_CWD: brand },
  });

  assert.equal(decision.skip, false);
  assert.equal(decision.reason, 'monorepo-install');
});

test('npm update, rebuild and dedupe in a consumer skip too — each re-runs a file:-linked prepare', (t) => {
  const scratch = makeScratch(t);
  const { packageDir } = writeMonorepo(scratch);
  const consumer = path.join(scratch, '..', 'brand');

  for (const command of ['update', 'rebuild', 'dedupe']) {
    const decision = prepareDecision({
      packageDir,
      env: { npm_command: command, npm_config_local_prefix: consumer, INIT_CWD: consumer },
    });
    assert.equal(decision.skip, true, command);
    assert.equal(decision.reason, 'consumer-install', command);
  }
});

test("the monorepo's own update/rebuild/dedupe still builds", (t) => {
  const scratch = makeScratch(t);
  const { packageDir } = writeMonorepo(scratch);

  for (const command of ['update', 'rebuild', 'dedupe']) {
    const decision = prepareDecision({
      packageDir,
      env: { npm_command: command, npm_config_local_prefix: scratch, INIT_CWD: scratch },
    });
    assert.equal(decision.skip, false, command);
    assert.equal(decision.reason, 'monorepo-install', command);
  }
});

test('the pack/publish prepare lane always builds, wherever it was invoked from', (t) => {
  const scratch = makeScratch(t);
  const { packageDir } = writeMonorepo(scratch);
  const elsewhere = path.join(scratch, '..', 'elsewhere');

  for (const command of ['pack', 'publish']) {
    const decision = prepareDecision({
      packageDir,
      env: { npm_command: command, npm_config_local_prefix: elsewhere, INIT_CWD: elsewhere },
    });
    assert.equal(decision.skip, false, command);
    assert.equal(decision.reason, 'not-install', command);
  }
});

test('a manual `npm run prepare` builds — run-script is not an install', (t) => {
  const scratch = makeScratch(t);
  const { packageDir } = writeMonorepo(scratch);

  const decision = prepareDecision({
    packageDir,
    env: { npm_command: 'run-script', npm_lifecycle_event: 'prepare', npm_config_local_prefix: scratch },
  });

  assert.equal(decision.skip, false);
  assert.equal(decision.reason, 'not-install');
});

test('a package outside any monorepo checkout builds', (t) => {
  const scratch = makeScratch(t);
  const loose = path.join(scratch, 'loose-package');
  fs.mkdirSync(loose, { recursive: true });
  fs.writeFileSync(path.join(loose, 'package.json'), JSON.stringify({ name: '@omega.js/widget', version: '1.0.0' }));

  const decision = prepareDecision({
    packageDir: loose,
    env: { npm_command: 'install', npm_config_local_prefix: path.join(scratch, '..', 'brand') },
  });

  assert.equal(decision.skip, false);
  assert.equal(decision.reason, 'no-monorepo');
});

test('an install that names no root builds — no evidence is not evidence of a consumer', (t) => {
  const scratch = makeScratch(t);
  const { packageDir } = writeMonorepo(scratch);

  const decision = prepareDecision({ packageDir, env: { npm_command: 'install' } });

  assert.equal(decision.skip, false);
  assert.equal(decision.reason, 'no-install-root');
});

// ── the gate ────────────────────────────────────────────────────────────────

test('the gate returns false and prints ONE line naming the package, the install and the watch', (t) => {
  const scratch = makeScratch(t);
  const { packageDir } = writeMonorepo(scratch);
  const consumer = path.join(scratch, '..', 'brand');

  const { result, warnings } = captured(() => guardPrepare({
    packageDir,
    env: { npm_command: 'install', npm_config_local_prefix: consumer },
  }));

  assert.equal(result, false);
  assert.equal(warnings.split('\n').length, 1);
  assert.match(warnings, /@omega\.js\/widget/);
  assert.match(warnings, new RegExp(path.resolve(consumer).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(warnings, /npm start/);
});

test('the gate returns true and stays silent for a monorepo install', (t) => {
  const scratch = makeScratch(t);
  const { packageDir } = writeMonorepo(scratch);

  const { result, warnings } = captured(() => guardPrepare({
    packageDir,
    env: { npm_command: 'install', npm_config_local_prefix: scratch },
  }));

  assert.equal(result, true);
  assert.equal(warnings, '');
});

// ── real npm ────────────────────────────────────────────────────────────────

test('WITHOUT the guard, a consumer npm install rebuilds the linked package (the bug)', (t) => {
  const scratch = makeScratch(t);
  const { root, packageDir, buildsLog } = writeMonorepo(path.join(scratch, 'monorepo'), { guarded: false });
  const consumer = writeConsumer(path.join(scratch, 'brand'), packageDir);

  assert.equal(npm(['install'], root).status, 0);
  const afterMonorepoInstall = buildCount(buildsLog);
  assert.ok(afterMonorepoInstall >= 1, 'the monorepo install builds');

  const install = npm(['install'], consumer);
  assert.equal(install.status, 0);
  assert.ok(buildCount(buildsLog) > afterMonorepoInstall, 'npm ran the prepare inside the monorepo package');
});

test('WITH the guard, a consumer npm install leaves the linked package untouched', (t) => {
  const scratch = makeScratch(t);
  const { root, packageDir, buildsLog } = writeMonorepo(path.join(scratch, 'monorepo'));
  const consumer = writeConsumer(path.join(scratch, 'brand'), packageDir);

  assert.equal(npm(['install'], root).status, 0);
  const afterMonorepoInstall = buildCount(buildsLog);
  assert.ok(afterMonorepoInstall >= 1, 'the monorepo install still builds');

  const install = npm(['install'], consumer);
  assert.equal(install.status, 0, install.stderr);
  assert.equal(buildCount(buildsLog), afterMonorepoInstall, 'no rebuild inside the monorepo package');
  assert.ok(fs.existsSync(path.join(consumer, 'node_modules', '@omega.js', 'widget')), 'the link is still installed');

  // Same install with the lifecycle output shown: the notice is on the wire
  fs.rmSync(path.join(consumer, 'node_modules'), { recursive: true, force: true });
  const loud = npm(['install', '--foreground-scripts'], consumer);
  assert.equal(loud.status, 0, loud.stderr);
  assert.equal(buildCount(buildsLog), afterMonorepoInstall, 'still no rebuild');
  assert.match(`${loud.stdout}${loud.stderr}`, /skipped @omega\.js\/widget's prepare/);
});

test('WITH the guard, `npm pack` in the linked package still builds its dist', (t) => {
  const scratch = makeScratch(t);
  const { root, packageDir, buildsLog } = writeMonorepo(path.join(scratch, 'monorepo'));

  assert.equal(npm(['install'], root).status, 0);
  const afterMonorepoInstall = buildCount(buildsLog);

  const pack = npm(['pack', '--dry-run'], packageDir);
  assert.equal(pack.status, 0, pack.stderr);
  assert.equal(buildCount(buildsLog), afterMonorepoInstall + 1, 'the publish lane built');
});

// ── staying wired ───────────────────────────────────────────────────────────

/**
 * Write a scratch package prepare-package can build: src/, its config, and the
 * gated prepare script. The hooked variant mirrors the real packages exactly —
 * a TWO-command `after` array (a stand-in for the vendor hook, then rewire) —
 * because the gate only survives if prepare-package runs every entry.
 * @param {string} dir - Package directory.
 * @param {object} [options]
 * @param {boolean} [options.hooked] - Wire the after chain.
 * @returns {string} The package directory.
 */
function writePreparable(dir, options = {}) {
  const { hooked = true } = options;
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
    name: '@omega.js/widget',
    version: '1.0.0',
    main: './dist/index.js',
    scripts: { prepare: GUARDED_PREPARE },
    preparePackage: {
      input: './src',
      output: './dist',
      type: 'copy',
      hooks: hooked
        ? {
          after: [
            `node -e "require('fs').writeFileSync('${path.join(dir, 'first-hook.txt')}', 'ran')"`,
            `node -e "require('${GUARD}').rewire()"`,
          ],
          afterBlocking: true,
        }
        : {},
    },
  }, null, 2)}\n`);
  return dir;
}

/** The `prepare` script currently on disk. */
function prepareScript(packageDir) {
  return JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')).scripts.prepare;
}

test('a real prepare-package build overwrites the gate (why rewire exists)', (t) => {
  const scratch = makeScratch(t);
  const packageDir = writePreparable(path.join(scratch, 'widget'), { hooked: false });

  const built = spawnSync(process.execPath, ['-e', `require('${require.resolve('prepare-package')}')()`], {
    cwd: packageDir,
    encoding: 'utf8',
  });

  assert.equal(built.status, 0, built.stderr);
  assert.equal(prepareScript(packageDir), UNGUARDED_PREPARE, 'prepare-package owns scripts.prepare');
});

test('the after CHAIN puts the gate back on every real prepare-package build', (t) => {
  const scratch = makeScratch(t);
  const packageDir = writePreparable(path.join(scratch, 'widget'));

  const built = spawnSync(process.execPath, ['-e', `require('${require.resolve('prepare-package')}')()`], {
    cwd: packageDir,
    encoding: 'utf8',
  });

  assert.equal(built.status, 0, built.stderr);
  // Every entry of the array runs, not just the first: the gate is the LAST one
  assert.ok(fs.existsSync(path.join(packageDir, 'first-hook.txt')), 'the first after hook ran');
  assert.equal(prepareScript(packageDir), GUARDED_PREPARE);
  assert.ok(fs.existsSync(path.join(packageDir, 'dist', 'index.js')), 'the build still ran');
});

test('rewire is idempotent — an already-gated manifest is left byte-identical', (t) => {
  const scratch = makeScratch(t);
  const packageDir = writePreparable(path.join(scratch, 'widget'));
  const manifestPath = path.join(packageDir, 'package.json');
  const before = fs.readFileSync(manifestPath, 'utf8');

  assert.equal(rewire({ packageDir }), false);
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), before);
});

test('rewire never stomps a prepare it does not own', (t) => {
  const scratch = makeScratch(t);
  const packageDir = writePreparable(path.join(scratch, 'widget'));
  const manifestPath = path.join(packageDir, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.scripts.prepare = 'node scripts/build.js';
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  assert.equal(rewire({ packageDir }), false);
  assert.equal(prepareScript(packageDir), 'node scripts/build.js');
});
