/**
 * `resolveTargetRun`: the ONE lane every brand-root fan-out (`fanout: 'each'`)
 * runs a verb through. Every target, framework and custom alike, runs
 * `npm run <verb>` in its own dir with the brand's flags after `--`; a target
 * with no such script steps aside loudly. `resolveTargetCommand`: a
 * single-target command (`fanout: 'none'`) passes through to the framework's
 * own CLI with the exact argv. Real brand monorepos on disk; nothing is spawned.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const jetpack = require('fs-jetpack');

const { discoverTargets } = require('../src/lib/brand.js');
const { resolveTargetRun, resolveTargetCommand, isFrameworkScript } = require('../src/lib/framework-bin.js');

const BASE = { brand: { id: 'b', name: 'B', url: 'https://b.test' } };

/**
 * A brand with a web target, a backend (in `projectType` mode) and a custom
 * `api`, each carrying the scripts given. No framework is installed: the lane
 * never needs one.
 */
function makeBrand({ web = {}, backend = {}, api = {}, projectType } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'omega-framework-bin-'));
  const targets = { web: { type: 'web' }, backend: { type: 'backend', ...(projectType ? { projectType } : {}) }, api: { type: 'custom' } };
  jetpack.write(join(root, 'config', 'omega.json5'), JSON.stringify({ ...BASE, targets }, null, 2));
  jetpack.write(join(root, 'package.json'), { name: 'b', workspaces: ['targets/*'] });
  jetpack.write(join(root, 'targets', 'web', 'package.json'), { name: 'web', dependencies: { '@omega.js/web': '*' }, scripts: web });
  jetpack.write(join(root, 'targets', 'backend', 'package.json'), { name: 'backend', dependencies: { '@omega.js/backend': '*' }, scripts: backend });
  jetpack.write(join(root, 'targets', 'api', 'package.json'), { name: 'api', scripts: api });
  return root;
}

/** Run fn over the brand's discovered targets by name, then remove the brand. */
function withTargets(options, fn) {
  const root = makeBrand(options);
  try {
    fn(Object.fromEntries(discoverTargets(root).map((entry) => [entry.name, entry])));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a framework target runs its own `npm run <verb>`, the brand flags after --', () => {
  withTargets({ web: { build: 'omega build' } }, (targets) => {
    const run = resolveTargetRun(targets.web, 'build', ['--quick']);
    assert.equal(run.kind, 'framework');
    assert.equal(run.framework, '@omega.js/web');
    assert.equal(run.command, 'npm');
    assert.deepEqual(run.args, ['run', 'build', '--', '--quick']);
    assert.equal(run.label, 'npm run build -- --quick');

    const bare = resolveTargetRun(targets.web, 'build', []);
    assert.deepEqual(bare.args, ['run', 'build'], 'no flags, no separator');
    assert.equal(bare.label, 'npm run build');
  });
});

test('a custom target takes the SAME lane, and its own script runs bare', () => {
  withTargets({ api: { deploy: 'render deploy' } }, (targets) => {
    const run = resolveTargetRun(targets.api, 'deploy', ['--snapshot=abc']);
    assert.equal(run.kind, 'custom');
    assert.equal(run.framework, undefined);
    assert.equal(run.frameworkScript, false);
    assert.deepEqual(run.args, ['run', 'deploy'], 'a brand-owned script has no contract for the brand flags');
    assert.equal(run.label, 'npm run deploy');
  });
});

test('the one predicate: only a script that is exactly `omega <verb>` is the framework\'s own and hears the flags', () => {
  assert.equal(isFrameworkScript('omega deploy', 'deploy'), true);
  for (const command of ['render deploy', 'omega deploy --direct', 'npx omega deploy', 'gulp build']) {
    assert.equal(isFrameworkScript(command, 'deploy'), false, command);
  }

  withTargets({ web: { build: 'gulp build', deploy: 'omega deploy' }, backend: { test: 'node --test' }, projectType: 'custom' }, (targets) => {
    assert.deepEqual(resolveTargetRun(targets.web, 'deploy', ['--direct']).args, ['run', 'deploy', '--', '--direct']);
    assert.equal(resolveTargetRun(targets.web, 'deploy', ['--direct']).frameworkScript, true);
    assert.deepEqual(resolveTargetRun(targets.web, 'build', ['--quick']).args, ['run', 'build'], 'a framework target\'s own edit of a script runs bare too');
    assert.deepEqual(resolveTargetRun(targets.backend, 'test', ['--extended', 'framework:']).args, ['run', 'test'], 'a custom-mode backend\'s test is the brand\'s');
  });
});

test('a target with no such script steps aside loudly, framework or custom', () => {
  withTargets({}, (targets) => {
    for (const name of ['web', 'api']) {
      const run = resolveTargetRun(targets[name], 'clean', []);
      assert.equal(run.kind, 'skip');
      assert.match(run.detail, new RegExp(`no "clean" script in targets/${name}/package.json`));
    }
  });
});

test('every spelling of a fan-out verb runs the script its row names', () => {
  withTargets({ web: { build: 'omega build' }, backend: { clean: 'omega clean' } }, (targets) => {
    assert.deepEqual(resolveTargetRun(targets.web, '--build', []).args, ['run', 'build']);
    assert.deepEqual(resolveTargetRun(targets.backend, 'clean:npm', []).args, ['run', 'clean']);
  });
});

test('a single-target command is never a fan-out lane: resolveTargetRun refuses it as a caller\'s bug', () => {
  withTargets({ backend: { emulator: 'omega emulator' } }, (targets) => {
    assert.throws(() => resolveTargetRun(targets.backend, 'emulator', []), /"emulator" is a single-target command/);
  });
});

test('a single-target command passes through to the framework\'s own CLI, the argv exactly as typed', () => {
  withTargets({}, (targets) => {
    const root = join(targets.web.path, '..', '..');
    jetpack.write(join(root, 'node_modules', '@omega.js', 'backend', 'package.json'), { name: '@omega.js/backend', bin: { omega: 'bin/omega' } });
    const bin = join(root, 'node_modules', '@omega.js', 'backend', 'bin', 'omega');

    const run = resolveTargetCommand(targets.backend, 'firestore:set', ['firestore:set', 'users/abc', '{"a":1}']);
    assert.equal(run.kind, 'framework');
    assert.equal(run.framework, '@omega.js/backend');
    assert.equal(run.command, process.execPath);
    assert.deepEqual(run.args, [bin, 'firestore:set', 'users/abc', '{"a":1}'], 'the alias reaches the CLI as typed');
    assert.equal(run.label, 'omega firestore:set users/abc {"a":1}');
  });
});

test('a single-target command on a custom target steps aside, naming the framework and the target', () => {
  withTargets({}, (targets) => {
    const run = resolveTargetCommand(targets.api, 'emulators', ['emulators']);
    assert.equal(run.kind, 'skip');
    assert.equal(run.detail, 'emulators is a @omega.js/backend command; api is custom');
  });
});

test('a single-target command whose framework is not installed is an error, never a silent pass', () => {
  withTargets({}, (targets) => {
    const run = resolveTargetCommand(targets.backend, 'emulator', ['emulator']);
    assert.equal(run.kind, 'error');
    assert.match(run.detail, /@omega\.js\/backend is not installed/);
  });
});

test('a dry run stops at the plan unless the script is the framework\'s own verb, which honors the flag', () => {
  withTargets({
    web: { build: 'omega build', deploy: 'omega deploy' },
    backend: { deploy: 'render deploys create' },
    api: { deploy: 'render deploy' },
    projectType: 'custom',
  }, (targets) => {
    // A verb whose row says the root answers --dry-run itself plans on every target
    const build = resolveTargetRun(targets.web, 'build', [], { dryRun: true });
    assert.equal(build.kind, 'plan');
    assert.equal(build.detail, 'would run npm run build in targets/web');

    // The framework's own `omega deploy` takes the flag and plans itself
    const deploy = resolveTargetRun(targets.web, 'deploy', ['--dry-run'], { dryRun: true });
    assert.equal(deploy.kind, 'framework');
    assert.deepEqual(deploy.args, ['run', 'deploy', '--', '--dry-run']);

    // A brand's own script has no such contract: a custom-mode backend and a custom target plan
    for (const name of ['backend', 'api']) {
      const run = resolveTargetRun(targets[name], 'deploy', ['--dry-run'], { dryRun: true });
      assert.equal(run.kind, 'plan', name);
      assert.equal(run.detail, `would run npm run deploy in targets/${name}`);
    }
  });
});

test('a verb the table does not know is a caller\'s bug', () => {
  withTargets({}, (targets) => {
    assert.throws(() => resolveTargetRun(targets.web, 'notaverb', []), /"notaverb" has no row/);
  });
});
