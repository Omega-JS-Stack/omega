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
const JSON5 = require('json5');
const { pushSnapshot } = require('../src/deploy-snapshot.js');
const { gitAuthEnv, gitAuthValue, scrubToken } = require('../src/git-auth.js');

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
  jetpack.write(path.join(brandRoot, '.gitignore'), 'dist/\n.omega/\n');
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

// #883: this lane and the web deploy's gh-pages push both push to a repo their
// checkout is not authenticated for, and each used to spell the delivery and
// the redaction itself. One helper, so a credential cannot leak out of the lane
// that forgot a rule the other one kept.
test('git-auth: the credential travels as config env, and a scrub covers both its forms', () => {
  assert.deepEqual(gitAuthEnv(TOKEN), {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${TOKEN}`).toString('base64')}`,
  });

  // No token, no half-set config: git asks for credentials itself.
  assert.deepEqual(gitAuthEnv(null), {});
  assert.deepEqual(gitAuthEnv(''), {});

  const said = scrubToken(`fatal: https://x-access-token:${TOKEN}@github.com (${gitAuthValue(TOKEN)})`, TOKEN);
  assert.equal(said.includes(TOKEN), false, 'the raw token is scrubbed');
  assert.equal(said.includes(gitAuthValue(TOKEN)), false, 'and so is the base64 the header carries');
  assert.equal(scrubToken('fatal: nothing secret here', null), 'fatal: nothing secret here', 'no token, nothing to scrub');
});

test('a failed snapshot push is rethrown with the token scrubbed out of git\'s message', () => {
  const { brandRoot } = buildFixture();

  const failing = (file, args, options) => {
    if (args[0] === 'push') {
      throw new Error(`Command failed: git push (AUTHORIZATION: basic ${gitAuthValue(TOKEN)}) token=${TOKEN}`);
    }
    return execFileSync(file, args, { encoding: 'utf8', ...options });
  };

  let thrown = null;
  try {
    pushSnapshot({ brandRoot, owner: 'acme', repo: 'acme-omega', ref: 'main', token: TOKEN, execFn: failing });
  } catch (error) {
    thrown = error;
  }

  assert.match(thrown.message, /Pushing the snapshot to acme\/acme-omega failed/, 'the failure names the mirror it was pushing to');
  assert.equal(thrown.message.includes(TOKEN), false, 'the raw token never reaches the message');
  assert.equal(thrown.message.includes(gitAuthValue(TOKEN)), false, 'and neither does its base64');
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

// ─── The minted favicon and logo set ───

/** The paths a ref's tree carries under .omega/, sorted. */
function mintedIn(bare, ref) {
  return treeOf(bare, ref).filter((file) => file.startsWith('.omega/'));
}

test('the minted favicon folder and the three bridged files ride, nothing else under .omega/ (#1027)', () => {
  const { repo, brandRoot, bare } = buildFixture();
  const status = () => run('git', ['status', '--porcelain'], repo);
  const before = status();

  for (const relative of [
    'assets/favicon/favicon.ico',
    'assets/favicon/favicon-32x32.png',
    'assets/favicon/site.webmanifest',
    'assets/logo/brandmark/color-x.svg',
    'assets/logo/brandmark/color-512.png',
    'assets/social/brandmark/color-1024.png',
    // The rest of the mint stays home: the ladders, the app icons, the state file
    'assets/logo/brandmark/color-256.png',
    'assets/logo/brandmark/black-x.svg',
    'assets/social/brandmark/color-512.png',
    'assets/icons/icon.icns',
    'state.json',
  ]) {
    jetpack.write(path.join(brandRoot, '.omega', relative), 'minted\n');
  }

  pushSnapshot({ brandRoot, owner: 'acme', repo: 'acme-omega', ref: 'omega-deploy', token: TOKEN, execFn: localRemote(bare, []) });

  assert.deepEqual(mintedIn(bare, 'omega-deploy'), [
    '.omega/assets/favicon/favicon-32x32.png',
    '.omega/assets/favicon/favicon.ico',
    '.omega/assets/favicon/site.webmanifest',
    '.omega/assets/logo/brandmark/color-512.png',
    '.omega/assets/logo/brandmark/color-x.svg',
    '.omega/assets/social/brandmark/color-1024.png',
  ]);
  assert.ok(treeOf(bare, 'omega-deploy').includes('src/app.js'), 'the brand tree rides beside them');
  assert.equal(status(), before, 'the forced adds stayed in the temporary index');
});

test('a brand with no minted set pushes clean, with no .omega path in the tree (#1027)', () => {
  const { brandRoot, bare } = buildFixture();
  jetpack.write(path.join(brandRoot, '.omega', 'state.json'), '{}\n');

  const sha = pushSnapshot({ brandRoot, owner: 'acme', repo: 'acme-omega', ref: 'omega-deploy', token: TOKEN, execFn: localRemote(bare, []) });

  assert.equal(run('git', ['rev-parse', 'omega-deploy'], bare).trim(), sha, 'the push landed');
  assert.deepEqual(mintedIn(bare, 'omega-deploy'), []);
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

// ─── The resolved company layer (#677) ───

test('the resolved company layer is generated for the push and gone after it', () => {
  const { base, repo, brandRoot, bare } = buildFixture();

  // A parent brand carrying a company/ tree, plus the machine registry line its
  // own runs write: exactly what the dispatching machine has and a runner lacks.
  const parentRoot = path.join(base, 'parent');
  jetpack.write(path.join(parentRoot, 'config', 'omega.json5'), `{ brand: { id: 'acme-co', name: 'Acme Co', url: 'https://acme.test', images: { wordmark: '/wordmark.png' } }, company: { id: 'self' } }`);
  jetpack.write(path.join(parentRoot, 'company', 'config', 'omega.json5'), `{ monitoring: { providers: { sentry: { org: 'acme-co' } } } }`);
  jetpack.write(path.join(brandRoot, 'config', 'omega.json5'), `{ brand: { id: 'playground', name: 'Playground' }, company: { id: 'acme-co' } }`);

  const home = path.join(base, 'home');
  const previousHome = process.env.OMEGA_HOME;
  process.env.OMEGA_HOME = home;
  jetpack.write(path.join(home, 'brands.json'), JSON.stringify({ 'acme-co': { root: parentRoot, name: 'Acme Co', url: 'https://acme.test' } }));

  try {
    pushSnapshot({
      brandRoot,
      owner: 'Omega-JS-Stack',
      repo: 'playground-omega',
      ref: 'main',
      token: TOKEN,
      execFn: localRemote(bare, []),
    });
  } finally {
    if (previousHome === undefined) delete process.env.OMEGA_HOME;
    else process.env.OMEGA_HOME = previousHome;
  }

  // It rode the mirror...
  assert.ok(treeOf(bare, 'main').includes('config/company-resolved.json5'), 'the runner receives what this machine resolved');

  const carried = JSON5.parse(run('git', ['show', 'main:config/company-resolved.json5'], bare));
  // `webhooks` rides too (#677): the runner's readers need the brand's opt-out
  // statement as much as its public facts.
  assert.deepEqual(carried.company, { id: 'acme-co', name: 'Acme Co', url: 'https://acme.test', images: { wordmark: '/wordmark.png' }, webhooks: true });
  assert.equal(carried.config.monitoring.providers.sentry.org, 'acme-co', 'the company CONFIG layer rides too');

  // ...and the developer's tree is clean again.
  assert.equal(jetpack.exists(path.join(brandRoot, 'config', 'company-resolved.json5')), false);
  assert.equal(run('git', ['status', '--porcelain'], repo).includes('company-resolved'), false);
});

test('a brand with no company generates nothing', () => {
  const { base, brandRoot, bare } = buildFixture();
  jetpack.write(path.join(brandRoot, 'config', 'omega.json5'), `{ brand: { id: 'playground', name: 'Playground' } }`);

  const previousHome = process.env.OMEGA_HOME;
  process.env.OMEGA_HOME = path.join(base, 'home');

  try {
    pushSnapshot({ brandRoot, owner: 'acme', repo: 'acme-omega', ref: 'main', token: TOKEN, execFn: localRemote(bare, []) });
  } finally {
    if (previousHome === undefined) delete process.env.OMEGA_HOME;
    else process.env.OMEGA_HOME = previousHome;
  }

  assert.equal(treeOf(bare, 'main').includes('config/company-resolved.json5'), false);
});

// ─── The composed workflows on the default branch (#915) ───
//
// The ONE write a deploy makes outside the deploy branch: GitHub registers a
// workflow from the default branch, so the composed files have to be there, and
// nothing ELSE of the developer's tree ever is. Byte-compared first, written
// through the git DATA api (blobs, tree, commit, ref), so no working tree,
// index or local branch is touched on either side.

/**
 * A brand folder carrying composed workflows and nothing else.
 * @param {object} files - `{ 'web-build.yml': 'contents' }`.
 * @returns {string} The brand root.
 */
function brandWithWorkflows(files) {
  const brandRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-workflows-')));
  for (const [name, content] of Object.entries(files)) {
    jetpack.write(path.join(brandRoot, '.github', 'workflows', name), content);
  }
  return brandRoot;
}

/**
 * GitHub's contents + git-data routes, in memory: what the branch holds, what
 * its head is, and every call made against it.
 *
 * @param {object} options - `held` is the branch's files (`null` per name = a
 *   404), and `head` is its head sha (`null` = an empty repo, which answers the
 *   ref read with GitHub's own 409 `Git Repository is empty.`).
 * @returns {{ fetchFn: Function, calls: object[], written: object }} The double.
 */
function githubDouble({ held = {}, head = 'head0000000000' } = {}) {
  const calls = [];
  const written = { blobs: [], tree: null, commit: null, ref: null };
  const answer = (status, body) => ({
    status,
    json: async () => body,
    text: async () => JSON.stringify(body || ''),
    statusText: String(status),
  });

  const fetchFn = async (url, init = {}) => {
    const route = url.replace('https://api.github.com/repos/acme/acme-omega', '');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, route, body });

    // The workflows DIRECTORY lists every file the branch holds there; an empty
    // repo answers the listing with a 404 like any other contents read.
    if (route.split('?')[0] === '/contents/.github/workflows') {
      const listed = Object.keys(held).filter((name) => held[name] !== null && held[name] !== undefined);
      return head
        ? answer(200, listed.map((name) => ({ name, path: `.github/workflows/${name}`, type: 'file' })))
        : answer(404, { message: 'This repository is empty.' });
    }
    if (route.startsWith('/contents/')) {
      const name = route.split('/').pop().split('?')[0];
      return held[name] === undefined || held[name] === null
        ? answer(404, { message: 'Not Found' })
        : answer(200, { content: Buffer.from(held[name]).toString('base64'), sha: `blob-${name}` });
    }
    if (route.startsWith('/git/ref/heads/')) {
      return head ? answer(200, { object: { sha: head } }) : answer(409, { message: 'Git Repository is empty.' });
    }
    if (route.startsWith('/git/commits/')) {
      return answer(200, { tree: { sha: 'tree-of-head' } });
    }
    if (route === '/git/blobs') {
      written.blobs.push(Buffer.from(body.content, 'base64').toString('utf8'));
      return answer(201, { sha: `blob-${written.blobs.length}` });
    }
    if (route === '/git/trees') {
      written.tree = body;
      return answer(201, { sha: 'tree-new' });
    }
    if (route === '/git/commits') {
      written.commit = body;
      return answer(201, { sha: 'commit-new-0000' });
    }
    if (route.startsWith('/git/refs')) {
      written.ref = { method, route, body };
      return answer(method === 'POST' ? 201 : 200, {});
    }

    throw new Error(`the double was asked for ${method} ${route}`);
  };

  return { fetchFn, calls, written };
}

test('pushWorkflowFiles: every file already matches, so the default branch is NOT touched (#915)', async () => {
  const { pushWorkflowFiles } = require('../src/deploy-snapshot.js');
  const brandRoot = brandWithWorkflows({ 'web-build.yml': 'name: web\n', 'backend-deploy.yml': 'name: backend\n' });
  const lines = [];
  const github = githubDouble({ held: { 'web-build.yml': 'name: web\n', 'backend-deploy.yml': 'name: backend\n' } });

  const result = await pushWorkflowFiles({
    brandRoot,
    owner: 'acme',
    repo: 'acme-omega',
    branch: 'main',
    token: TOKEN,
    fetchFn: github.fetchFn,
    logger: { log: (line) => lines.push(line) },
  });

  assert.deepEqual(result.pushed, [], 'nothing was written');
  assert.equal(github.calls.every((call) => call.method === 'GET'), true, 'the branch was READ and nothing more');
  assert.equal(lines.length, 1, 'one line says so');
  assert.match(lines[0], /already carries/);

  fs.rmSync(brandRoot, { recursive: true, force: true });
});

test('pushWorkflowFiles: one missing and one changed ride ONE conventional commit (#915)', async () => {
  const { pushWorkflowFiles } = require('../src/deploy-snapshot.js');
  const brandRoot = brandWithWorkflows({
    'backend-deploy.yml': 'name: backend\n',
    'desktop-build.yml': 'name: desktop v2\n',
    'web-build.yml': 'name: web\n',
  });
  // backend matches, desktop differs, web is not there at all.
  const github = githubDouble({
    held: { 'backend-deploy.yml': 'name: backend\n', 'desktop-build.yml': 'name: desktop\n', 'web-build.yml': null },
  });

  const result = await pushWorkflowFiles({
    brandRoot, owner: 'acme', repo: 'acme-omega', branch: 'main', token: TOKEN, fetchFn: github.fetchFn,
  });

  assert.deepEqual(result.pushed, ['desktop-build.yml', 'web-build.yml'], 'exactly the two that differ');
  assert.deepEqual(github.written.blobs, ['name: desktop v2\n', 'name: web\n'], 'and only their bytes became blobs');
  assert.deepEqual(github.written.tree.tree.map((entry) => entry.path), [
    '.github/workflows/desktop-build.yml',
    '.github/workflows/web-build.yml',
  ]);
  assert.equal(github.written.tree.base_tree, 'tree-of-head', 'on top of the branch\'s own tree: nothing else changes');
  assert.equal(github.written.commit.message, 'chore(ci): compose desktop-build.yml, web-build.yml');
  assert.deepEqual(github.written.commit.parents, ['head0000000000'], 'a commit on the branch\'s head, never a rewrite of it');
  assert.deepEqual(github.written.ref, {
    method: 'PATCH',
    route: '/git/refs/heads/main',
    body: { sha: 'commit-new-0000' },
  });
});

test('pushWorkflowFiles: an EMPTY repo gets a parentless commit and a created ref (#915)', async () => {
  const { pushWorkflowFiles } = require('../src/deploy-snapshot.js');
  const brandRoot = brandWithWorkflows({ 'web-build.yml': 'name: web\n' });
  const github = githubDouble({ held: {}, head: null });

  const result = await pushWorkflowFiles({
    brandRoot, owner: 'acme', repo: 'acme-omega', branch: 'main', token: TOKEN, fetchFn: github.fetchFn,
  });

  assert.deepEqual(result.pushed, ['web-build.yml']);
  assert.equal(github.written.tree.base_tree, undefined, 'there is no tree to build on');
  assert.deepEqual(github.written.commit.parents, [], 'and no head to parent it to');
  assert.deepEqual(github.written.ref, {
    method: 'POST',
    route: '/git/refs',
    body: { ref: 'refs/heads/main', sha: 'commit-new-0000' },
  });

  fs.rmSync(brandRoot, { recursive: true, force: true });
});

test('pushWorkflowFiles: a RETIRED composed file leaves in the same commit, a hand-written one stays (#932)', async () => {
  const { pushWorkflowFiles } = require('../src/deploy-snapshot.js');
  const webHeader = '# GENERATED by the targets/web framework scaffold \u2014 do not edit.\n';
  const websiteHeader = '# GENERATED by the targets/website framework scaffold \u2014 do not edit.\n';
  const brandRoot = brandWithWorkflows({ 'web-build.yml': `${webHeader}name: web v2\n` });
  // The rename left website-build.yml behind; release.yml is the brand's own.
  const github = githubDouble({
    held: {
      'release.yml': 'name: release\n',
      'web-build.yml': `${webHeader}name: web\n`,
      'website-build.yml': `${websiteHeader}name: website\n`,
    },
  });

  const result = await pushWorkflowFiles({
    brandRoot, owner: 'acme', repo: 'acme-omega', branch: 'main', token: TOKEN, fetchFn: github.fetchFn,
  });

  assert.deepEqual(result.pushed, ['web-build.yml']);
  assert.deepEqual(result.removed, ['website-build.yml'], 'the retired composed file, and only it');
  assert.deepEqual(github.written.tree.tree, [
    { path: '.github/workflows/web-build.yml', mode: '100644', type: 'blob', sha: 'blob-1' },
    { path: '.github/workflows/website-build.yml', mode: '100644', type: 'blob', sha: null },
  ], 'a null sha deletes the file; release.yml is never in the tree');
  assert.equal(github.written.tree.base_tree, 'tree-of-head');
  assert.equal(github.written.commit.message, 'chore(ci): compose web-build.yml, retire website-build.yml');
  assert.deepEqual(github.written.ref, {
    method: 'PATCH',
    route: '/git/refs/heads/main',
    body: { sha: 'commit-new-0000' },
  });

  fs.rmSync(brandRoot, { recursive: true, force: true });
});
