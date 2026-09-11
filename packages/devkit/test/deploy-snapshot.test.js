// Unit tests for src/deploy-snapshot.js: the snapshot half of the ONE deploy
// lane ([#872](https://github.com/Omega-JS-Stack/omega/issues/872)).
//
// REAL git against a REAL bare repo in a temp dir, because what is being pinned
// is git's own behavior: a commit whose root is the BRAND FOLDER (never the
// enclosing repo's root), the .gitignore rules that decide what rides, an
// untracked tarball folder that must ride, and a force push that rewrites the
// mirror. Only the network is injected (the fetch waitForWorkflow polls, and
// the remote URL, rewritten to the bare repo by the injected exec).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const jetpack = require('fs-jetpack');
const { pushSnapshot, waitForWorkflow } = require('../src/deploy-snapshot.js');

const TOKEN = 'ghp_fixture_token';

/** Run a real command, failing loudly with its own output. */
function run(file, args, cwd) {
  return execFileSync(file, args, { cwd, encoding: 'utf8' });
}

/**
 * A monorepo-shaped fixture: an enclosing repo, a brand folder nested inside
 * it, ignored files at both levels, an untracked staging folder, and the bare
 * repo the snapshot is pushed to.
 * @returns {{ base: string, repo: string, brandRoot: string, bare: string }} The fixture.
 */
function buildFixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-snapshot-')));
  const repo = path.join(base, 'repo');
  const brandRoot = path.join(repo, 'brands', 'playground');

  jetpack.write(path.join(repo, '.gitignore'), 'node_modules/\n*.log\n');
  jetpack.write(path.join(repo, 'packages', 'framework.js'), '// the enclosing repo, which never rides\n');
  jetpack.write(path.join(brandRoot, 'package.json'), '{ "name": "playground" }\n');
  jetpack.write(path.join(brandRoot, '.gitignore'), 'dist/\n');
  jetpack.write(path.join(brandRoot, 'src', 'app.js'), '// brand source\n');

  run('git', ['init', '-q', '-b', 'main'], repo);
  run('git', ['config', 'user.email', 'snapshot@example.com'], repo);
  run('git', ['config', 'user.name', 'Snapshot Test'], repo);
  run('git', ['add', '-A'], repo);
  run('git', ['commit', '-qm', 'fixture'], repo);

  // After the commit: the files a deploy produces and git has never seen. The
  // staged tarballs and the regenerated lockfile are untracked-not-ignored, so
  // they ride; the ignored ones never do.
  jetpack.write(path.join(brandRoot, 'omega_modules', 'omega.js-liba-1.0.0.tgz'), 'tarball\n');
  jetpack.write(path.join(brandRoot, 'package-lock.json'), '{ "lockfileVersion": 3 }\n');
  jetpack.write(path.join(brandRoot, 'debug.log'), 'ignored by the repo root\n');
  jetpack.write(path.join(brandRoot, 'dist', 'out.js'), '// ignored by the brand\n');

  const bare = path.join(base, 'mirror.git');
  run('git', ['init', '-q', '--bare', bare], base);

  return { base, repo, brandRoot, bare };
}

/**
 * An exec that runs REAL git, with the GitHub remote swapped for the bare repo
 * beside it: the only thing a test cannot have is the network.
 * @param {string} bare - The bare repo standing in for the mirror.
 * @param {Array} calls - Collects every call, for the token assertion.
 * @returns {Function} The exec to inject.
 */
function localRemote(bare, calls) {
  return (file, args, options) => {
    calls.push({ file, args, options });
    const rewritten = args.map((arg) => (String(arg).startsWith('https://github.com/') ? bare : arg));
    return execFileSync(file, rewritten, { encoding: 'utf8', ...options });
  };
}

/** The paths a ref's tree carries, sorted. */
function treeOf(bare, ref) {
  return run('git', ['ls-tree', '-r', '--name-only', ref], bare).trim().split('\n').sort();
}

test('the pushed commit\'s root IS the brand folder, ignored files absent, staged files present', () => {
  const { repo, brandRoot, bare } = buildFixture();
  const calls = [];
  const status = () => run('git', ['status', '--porcelain'], repo);
  const before = status();

  const sha = pushSnapshot({
    brandRoot,
    owner: 'Omega-JS-Stack',
    repo: 'playground-omega',
    ref: 'main',
    token: TOKEN,
    message: 'chore(deploy): snapshot',
    // What a LINKED brand's deploy staged, and therefore what this push exists
    // to carry (#872)
    require: ['omega_modules', 'package-lock.json'],
    execFn: localRemote(bare, calls),
  });

  assert.match(sha, /^[0-9a-f]{40}$/, 'the pushed sha comes back');
  assert.equal(run('git', ['rev-parse', 'main'], bare).trim(), sha, 'the mirror ref points at it');

  // The brand folder is the ROOT of the pushed tree: no brands/playground prefix
  assert.deepEqual(treeOf(bare, 'main'), [
    '.gitignore',
    'omega_modules/omega.js-liba-1.0.0.tgz',
    'package-lock.json',
    'package.json',
    'src/app.js',
  ]);

  // A mirror carries no history of the repo it was cut from
  assert.equal(run('git', ['rev-list', '--count', 'main'], bare).trim(), '1');

  // Nothing local moved: no branch, no index change, no working-tree change
  assert.equal(status(), before, 'the working tree is exactly as it was');
  assert.equal(run('git', ['branch', '--list'], repo).trim(), '* main', 'no snapshot branch was created');

  // The token travels in the env, never in argv
  for (const call of calls) {
    assert.equal(call.args.some((arg) => String(arg).includes(TOKEN)), false, `a ${call.file} argument carried the token`);
  }
  const push = calls.find((call) => call.args[0] === 'push');
  assert.equal(push.options.env.GIT_CONFIG_VALUE_0, `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${TOKEN}`).toString('base64')}`, 'the basic form git over https accepts');
});

test('a second snapshot force-updates the mirror', () => {
  const { brandRoot, bare } = buildFixture();
  const calls = [];
  const push = () => pushSnapshot({
    brandRoot, owner: 'acme', repo: 'acme-omega', ref: 'main', token: TOKEN, execFn: localRemote(bare, calls),
  });

  const first = push();
  jetpack.write(path.join(brandRoot, 'src', 'app.js'), '// edited after the first snapshot\n');
  const second = push();

  assert.notEqual(second, first, 'a new tree is a new commit');
  assert.equal(run('git', ['rev-parse', 'main'], bare).trim(), second, 'the mirror moved to it');
  // Siblings, never a fast-forward: only a force push can land the second one
  assert.equal(run('git', ['rev-list', '--count', 'main'], bare).trim(), '1');
});

test('a brand that IS its own repo snapshots its whole tree', () => {
  const { repo, bare } = buildFixture();

  const sha = pushSnapshot({
    brandRoot: repo, owner: 'acme', repo: 'acme-omega', ref: 'omega-deploy', token: TOKEN, execFn: localRemote(bare, []),
  });

  assert.equal(run('git', ['rev-parse', 'omega-deploy'], bare).trim(), sha, 'the snapshot branch carries it');
  assert.deepEqual(treeOf(bare, 'omega-deploy'), [
    '.gitignore',
    'brands/playground/.gitignore',
    'brands/playground/omega_modules/omega.js-liba-1.0.0.tgz',
    'brands/playground/package-lock.json',
    'brands/playground/package.json',
    'brands/playground/src/app.js',
    'packages/framework.js',
  ]);
});

test('waitForWorkflow polls until GitHub answers for the workflow', async () => {
  const seen = [];
  const answers = [404, 404, 200];

  await waitForWorkflow({
    owner: 'acme',
    repo: 'acme-omega',
    workflow: 'desktop-build.yml',
    ref: 'main',
    token: TOKEN,
    attempts: 5,
    delayMs: 0,
    fetchFn: async (url, options) => {
      // The repo read the first 404 triggers (the default-branch check below)
      // answers `main`, which is the ordinary repo and changes nothing.
      if (url === 'https://api.github.com/repos/acme/acme-omega') {
        return { status: 200, json: async () => ({ default_branch: 'main' }) };
      }
      seen.push({ url, authorization: options.headers.Authorization });
      return { status: answers[seen.length - 1] };
    },
  });

  assert.equal(seen.length, 3, 'it stopped at the first 200');
  assert.equal(seen[0].url, 'https://api.github.com/repos/acme/acme-omega/actions/workflows/desktop-build.yml');
  assert.equal(seen[0].authorization, `Bearer ${TOKEN}`);
});

test('waitForWorkflow: a gh-pages DEFAULT branch is flipped back to main, once (#872)', async () => {
  // GitHub registers a workflow from the DEFAULT branch, so a repo whose first
  // web deploy created gh-pages on an empty repo points every listing and every
  // dispatch at the published site, where no workflow file will ever be. The
  // same rule the manager's repo ensure applies, here because a deploy is often
  // what CREATES that state.
  const calls = [];
  const lines = [];
  let defaultBranch = 'gh-pages';

  await waitForWorkflow({
    owner: 'acme',
    repo: 'acme-omega',
    workflow: 'website-build.yml',
    ref: 'main',
    token: TOKEN,
    attempts: 5,
    delayMs: 0,
    logger: { log: (line) => lines.push(line) },
    fetchFn: async (url, options) => {
      calls.push(`${options.method || 'GET'} ${url}`);

      if (url === 'https://api.github.com/repos/acme/acme-omega') {
        if (options.method === 'PATCH') {
          defaultBranch = JSON.parse(options.body).default_branch;
          return { status: 200 };
        }
        return { status: 200, json: async () => ({ default_branch: defaultBranch }) };
      }

      // The workflow registers as soon as the default branch is the one that
      // carries it.
      return { status: defaultBranch === 'main' ? 200 : 404 };
    },
  });

  assert.deepEqual(calls, [
    'GET https://api.github.com/repos/acme/acme-omega/actions/workflows/website-build.yml',
    'GET https://api.github.com/repos/acme/acme-omega',
    'PATCH https://api.github.com/repos/acme/acme-omega',
    'GET https://api.github.com/repos/acme/acme-omega/actions/workflows/website-build.yml',
  ]);
  assert.equal(defaultBranch, 'main', 'the repo points at main again');
  assert.equal(lines.filter((line) => line.includes('default branch')).length, 1, 'one line says so');
});

test('waitForWorkflow: a snapshot BRANCH never touches the default branch (#872)', async () => {
  const calls = [];

  await assert.rejects(
    () => waitForWorkflow({
      owner: 'acme',
      repo: 'acme-omega',
      workflow: 'website-build.yml',
      ref: 'omega-deploy',
      token: TOKEN,
      attempts: 2,
      delayMs: 0,
      fetchFn: async (url) => {
        calls.push(url);
        return { status: 404 };
      },
    }),
    /website-build\.yml/,
  );

  assert.equal(calls.every((url) => url.includes('/actions/workflows/')), true, 'only the workflow listing was ever read');
});

test('waitForWorkflow gives up loudly, naming the workflow and the ref', async () => {
  let attempts = 0;

  await assert.rejects(
    () => waitForWorkflow({
      owner: 'acme',
      repo: 'acme-omega',
      workflow: 'desktop-build.yml',
      ref: 'omega-deploy',
      token: TOKEN,
      attempts: 3,
      delayMs: 0,
      fetchFn: async () => {
        attempts++;
        return { status: 404 };
      },
    }),
    /desktop-build\.yml[\s\S]*omega-deploy/,
  );
  assert.equal(attempts, 3, 'the whole budget was spent');
});

test('a brand whose ignore rules hide the staged tarballs fails BEFORE the push (#872)', () => {
  const { brandRoot, bare } = buildFixture();
  const calls = [];

  // The shape the guard exists for: a brand that ignores build output by name
  // and catches the staging folder with it. The push would succeed, the runner's
  // `npm ci` would then fail on a file: spec pointing at nothing, minutes later
  // and a machine away.
  jetpack.write(path.join(brandRoot, '.gitignore'), 'dist/\nomega_modules/\npackage-lock.json\n');

  assert.throws(
    () => pushSnapshot({
      brandRoot,
      owner: 'acme',
      repo: 'acme-omega',
      ref: 'main',
      token: TOKEN,
      require: ['omega_modules', 'package-lock.json'],
      execFn: localRemote(bare, calls),
    }),
    (error) => {
      assert.match(error.message, /omega_modules/, 'the error names the path that cannot ride');
      assert.match(error.message, /package-lock\.json/, 'and every other one');
      assert.match(error.message, /\.gitignore/, 'and where the rule lives');
      return true;
    },
  );

  assert.equal(calls.some((call) => call.args[0] === 'push'), false, 'nothing was pushed');
  assert.equal(run('git', ['for-each-ref'], bare).trim(), '', 'the mirror is untouched');
  // The staged files are untouched: cleaning them up is the caller's restore.
  assert.equal(jetpack.exists(path.join(brandRoot, 'omega_modules', 'omega.js-liba-1.0.0.tgz')), 'file');
});
