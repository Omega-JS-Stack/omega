// Tests for the workspace `translation-sdk` ensure op
// ([#168](https://github.com/Omega-JS-Stack/omega/issues/168)): a web target whose
// resolved config translates with the `claude` provider declares
// @anthropic-ai/claude-agent-sdk and gets it installed, the same converge-to-
// config way the other workspace ops reconcile brand files. Converged = zero
// mutation, dry run plans without writing, translation off / provider chatgpt
// is untouched, and the install runs through a recording fake (never npm).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const translationSdkOp = require('../src/services/workspace/ensure/translation-sdk.js');

const SDK = '@anthropic-ai/claude-agent-sdk';
const { FALLBACK_RANGE } = translationSdkOp;

/**
 * Stage a brand monorepo with one website target. `translation` is the raw
 * section for the BRAND config (the shared layer every target inherits); `pkg`
 * overrides the target's package.json.
 */
function stageBrand({ translation, pkg, target = 'web' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-translation-sdk-'));

  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'fixture-brand',
    private: true,
    workspaces: ['targets/*'],
  }, null, 2)}\n`);

  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(path.join(root, 'config', 'omega.json5'), `${JSON.stringify({
    brand: { id: 'fixture-brand', name: 'Fixture Brand', url: 'https://fixture-brand.test' },
    targets: { [target]: {} },
    ...(translation ? { translation } : {}),
  }, null, 2)}\n`);

  const targetName = target === 'web' ? 'website' : target;
  const targetPath = path.join(root, 'targets', targetName);
  fs.mkdirSync(targetPath, { recursive: true });
  fs.writeFileSync(path.join(targetPath, 'package.json'), `${JSON.stringify(pkg || {
    name: `fixture-${targetName}`,
    private: true,
    dependencies: { '@omega.js/web': '^0.1.0' },
  }, null, 2)}\n`);

  return { root, targetPath, targets: [{ name: targetName, dir: `targets/${targetName}`, path: targetPath, target }] };
}

/** Recording install fake: the op never shells out to npm in tests. */
function fakeRun(result = { success: true }) {
  const calls = [];
  const run = async (command, args, cwd) => {
    calls.push([command, args.join(' '), cwd]);
    return result;
  };
  run.calls = calls;
  return run;
}

const readPkg = (targetPath) => JSON.parse(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8'));

const CLAUDE = { languages: ['es'] }; // enabled + provider default to on/claude

// ─── Drift ───────────────────────────────────────────────────────────────────

test('translation-sdk: claude translation + no dep → package.json gains it and npm install runs', async () => {
  const { root, targetPath, targets } = stageBrand({ translation: CLAUDE });
  const run = fakeRun();

  const result = await translationSdkOp({ brandRoot: root, targets, runCommand: run });

  assert.deepEqual(result.output.translationSdk, { added: ['website'], installed: true });

  const pkg = readPkg(targetPath);
  assert.equal(pkg.dependencies[SDK], FALLBACK_RANGE, 'the fallback range (no web installed in this fixture)');
  assert.equal(pkg.dependencies['@omega.js/web'], '^0.1.0', 'existing deps survive');

  assert.deepEqual(run.calls, [['npm', 'install --no-audit --no-fund', root]]);
});

test('translation-sdk: the range comes from the INSTALLED web package\'s optional peer', async () => {
  const { root, targetPath, targets } = stageBrand({ translation: CLAUDE });
  const webRoot = path.join(root, 'node_modules', '@omega.js', 'web');
  fs.mkdirSync(webRoot, { recursive: true });
  fs.writeFileSync(path.join(webRoot, 'package.json'), JSON.stringify({
    name: '@omega.js/web',
    peerDependencies: { [SDK]: '>=9.9' },
  }));

  await translationSdkOp({ brandRoot: root, targets, runCommand: fakeRun() });

  assert.equal(readPkg(targetPath).dependencies[SDK], '>=9.9');
});

test('translation-sdk: the fallback range still matches web\'s declared optional peer', () => {
  const webPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'package.json'), 'utf8'));

  assert.equal(
    webPkg.peerDependencies[SDK],
    FALLBACK_RANGE,
    'packages/web bumped its optional peer: update FALLBACK_RANGE in ensure/translation-sdk.js',
  );
});

test('translation-sdk: explicit enabled + provider claude drifts the same way', async () => {
  const { root, targetPath, targets } = stageBrand({
    translation: { enabled: true, provider: 'claude', languages: ['fr'] },
  });

  const result = await translationSdkOp({ brandRoot: root, targets, runCommand: fakeRun() });

  assert.deepEqual(result.output.translationSdk.added, ['website']);
  assert.ok(readPkg(targetPath).dependencies[SDK]);
});

test('translation-sdk: a failed install warns and the dep stays declared', async () => {
  const { root, targetPath, targets } = stageBrand({ translation: CLAUDE });

  const result = await translationSdkOp({
    brandRoot: root,
    targets,
    runCommand: fakeRun({ success: false, error: 'exit code 1' }),
  });

  assert.equal(result.status, 'warned');
  assert.deepEqual(result.output.translationSdk, { added: ['website'], installed: false, error: 'exit code 1' });
  assert.ok(readPkg(targetPath).dependencies[SDK]);
});

// ─── Converged ───────────────────────────────────────────────────────────────

test('translation-sdk: dep already declared → null return, byte-identical package.json, no install', async () => {
  const { root, targetPath, targets } = stageBrand({
    translation: CLAUDE,
    pkg: { name: 'fixture-website', dependencies: { '@omega.js/web': '^0.1.0', [SDK]: '^0.2.138' } },
  });
  const before = fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8');
  const run = fakeRun();

  assert.equal(await translationSdkOp({ brandRoot: root, targets, runCommand: run }), null);
  assert.equal(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8'), before);
  assert.deepEqual(run.calls, []);
});

test('translation-sdk: a devDependency declaration counts as converged', async () => {
  const { root, targets } = stageBrand({
    translation: CLAUDE,
    pkg: { name: 'fixture-website', devDependencies: { [SDK]: '>=0.2' } },
  });
  const run = fakeRun();

  assert.equal(await translationSdkOp({ brandRoot: root, targets, runCommand: run }), null);
  assert.deepEqual(run.calls, []);
});

test('translation-sdk: a second pass over a healed target changes nothing', async () => {
  const { root, targetPath, targets } = stageBrand({ translation: CLAUDE });

  await translationSdkOp({ brandRoot: root, targets, runCommand: fakeRun() });
  const healed = fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8');

  const run = fakeRun();
  assert.equal(await translationSdkOp({ brandRoot: root, targets, runCommand: run }), null);
  assert.equal(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8'), healed);
  assert.deepEqual(run.calls, []);
});

// ─── Dry run ─────────────────────────────────────────────────────────────────

test('translation-sdk: dry run plans the add + install and writes nothing', async () => {
  const { root, targetPath, targets } = stageBrand({ translation: CLAUDE });
  const before = fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8');
  const run = fakeRun();

  const result = await translationSdkOp({ brandRoot: root, targets, options: { dryRun: true }, runCommand: run });

  assert.deepEqual(result.output, { translationSdk: 'planned' });
  assert.equal(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8'), before);
  assert.deepEqual(run.calls, []);
});

// ─── Gates ───────────────────────────────────────────────────────────────────

test('translation-sdk: translation off (no languages, or enabled false) is untouched', async () => {
  for (const translation of [undefined, { languages: [] }, { enabled: false, languages: ['es'] }]) {
    const { root, targetPath, targets } = stageBrand({ translation });
    const before = fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8');
    const run = fakeRun();

    assert.equal(await translationSdkOp({ brandRoot: root, targets, runCommand: run }), null);
    assert.equal(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8'), before);
    assert.deepEqual(run.calls, []);
  }
});

test('translation-sdk: the chatgpt provider needs no SDK, so the target is untouched', async () => {
  const { root, targetPath, targets } = stageBrand({
    translation: { languages: ['es'], providers: { chatgpt: {} } },
  });
  const before = fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8');
  const run = fakeRun();

  assert.equal(await translationSdkOp({ brandRoot: root, targets, runCommand: run }), null);
  assert.equal(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8'), before);
  assert.deepEqual(run.calls, []);
});

test('translation-sdk: an unreadable translation section warns instead of halting the walk', async () => {
  const { root, targetPath, targets } = stageBrand({ translation: { languages: ['zz'] } });
  const before = fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8');
  const run = fakeRun();

  const result = await translationSdkOp({ brandRoot: root, targets, runCommand: run });

  assert.equal(result.status, 'warned', 'the workspace runner is stopOnError, so this must not throw');
  assert.equal(result.output.findings.length, 1);
  assert.match(result.output.findings[0], /^website: Unknown translation language\(s\): zz/);
  assert.equal(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8'), before, 'the target is left alone');
  assert.deepEqual(run.calls, []);
});

test('translation-sdk: non-web targets are untouched (their framework ships the SDK)', async () => {
  const { root, targetPath, targets } = stageBrand({ translation: CLAUDE, target: 'extension' });
  const before = fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8');
  const run = fakeRun();

  assert.equal(await translationSdkOp({ brandRoot: root, targets, runCommand: run }), null);
  assert.equal(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf8'), before);
  assert.deepEqual(run.calls, []);
});
