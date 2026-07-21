/**
 * Deploy executor (D13/D9) — the ONE workflow_dispatch path shared by CLI
 * deploys and server-side content-publish. Pins: remote-url parsing, token
 * layering, the dispatch plan shape (dry-run = the plan, nothing sent),
 * success/failure against an injected fetch, and the no-token error.
 */
const assert = require('node:assert');
const { test } = require('node:test');
const {
  parseRemoteUrl,
  resolveRepo,
  resolveToken,
  buildDispatch,
  dispatchWorkflow,
  deployViaDispatch,
} = require('../src/deploy.js');

test('parseRemoteUrl: ssh, https, and .git-less forms', () => {
  assert.deepStrictEqual(parseRemoteUrl('git@github.com:Omega-JS-Stack/omega.git'), { owner: 'Omega-JS-Stack', repo: 'omega' });
  assert.deepStrictEqual(parseRemoteUrl('https://github.com/acme/site.git'), { owner: 'acme', repo: 'site' });
  assert.deepStrictEqual(parseRemoteUrl('https://github.com/acme/site'), { owner: 'acme', repo: 'site' });
  assert.strictEqual(parseRemoteUrl('https://gitlab.com/acme/site.git'), null, 'non-GitHub remotes are not silently accepted');
  assert.strictEqual(parseRemoteUrl(''), null);
});

test('resolveRepo: reads the origin remote via the injected exec', () => {
  const calls = [];
  const repo = resolveRepo({
    cwd: '/tmp/x',
    execFn: (cmd, opts) => {
      calls.push({ cmd, cwd: opts.cwd });
      return 'git@github.com:acme/site.git\n';
    },
  });
  assert.deepStrictEqual(repo, { owner: 'acme', repo: 'site' });
  assert.strictEqual(calls[0].cmd, 'git config --get remote.origin.url');
  assert.strictEqual(calls[0].cwd, '/tmp/x');

  assert.throws(
    () => resolveRepo({ execFn: () => 'https://example.com/not-github.git' }),
    /Cannot parse a GitHub repo/,
  );
});

test('resolveToken: GH_TOKEN → GITHUB_TOKEN → gh auth token → null', () => {
  assert.strictEqual(resolveToken({ env: { GH_TOKEN: 'a', GITHUB_TOKEN: 'b' }, execFn: () => { throw new Error('no'); } }), 'a');
  assert.strictEqual(resolveToken({ env: { GITHUB_TOKEN: 'b' }, execFn: () => { throw new Error('no'); } }), 'b');
  assert.strictEqual(resolveToken({ env: {}, execFn: () => 'gh-tok\n' }), 'gh-tok');
  assert.strictEqual(resolveToken({ env: {}, execFn: () => { throw new Error('gh not installed'); } }), null);
});

test('buildDispatch: plan shape + inputs only when present', () => {
  const plan = buildDispatch({ owner: 'acme', repo: 'site', workflow: 'build.yml' });
  assert.strictEqual(plan.method, 'POST');
  assert.strictEqual(plan.url, 'https://api.github.com/repos/acme/site/actions/workflows/build.yml/dispatches');
  assert.deepStrictEqual(plan.body, { ref: 'main' }, 'no inputs key when none given');
  assert.strictEqual(plan.runsUrl, 'https://github.com/acme/site/actions/workflows/build.yml');

  const withInputs = buildDispatch({ owner: 'a', repo: 'r', workflow: 'w.yml', ref: 'develop', inputs: { platforms: 'all' } });
  assert.deepStrictEqual(withInputs.body, { ref: 'develop', inputs: { platforms: 'all' } });

  assert.throws(() => buildDispatch({ owner: 'a', repo: 'r' }), /missing workflow/);
});

test('dispatchWorkflow: 204 succeeds, non-204 throws with body, no token throws guidance', async () => {
  const plan = buildDispatch({ owner: 'a', repo: 'r', workflow: 'w.yml' });

  const sent = [];
  const ok = await dispatchWorkflow(plan, {
    token: 'tok',
    fetchFn: async (url, init) => {
      sent.push({ url, init });
      return { status: 204 };
    },
  });
  assert.strictEqual(ok, plan);
  assert.strictEqual(sent[0].url, plan.url);
  assert.strictEqual(sent[0].init.headers.Authorization, 'Bearer tok');
  assert.deepStrictEqual(JSON.parse(sent[0].init.body), { ref: 'main' });

  await assert.rejects(
    dispatchWorkflow(plan, { token: 'tok', fetchFn: async () => ({ status: 404, text: async () => 'Not Found' }) }),
    /workflow_dispatch failed \(404\): Not Found/,
  );

  await assert.rejects(dispatchWorkflow(plan, { token: null }), /No GitHub token/);
});

test('deployViaDispatch: dry-run builds the plan and sends NOTHING', async () => {
  let fetched = 0;
  const result = await deployViaDispatch({
    workflow: 'build.yml',
    dryRun: true,
    execFn: () => 'git@github.com:acme/site.git',
    fetchFn: async () => { fetched++; return { status: 204 }; },
  });
  assert.strictEqual(result.dispatched, false);
  assert.strictEqual(fetched, 0, 'dry-run must not touch the network');
  assert.strictEqual(result.plan.url, 'https://api.github.com/repos/acme/site/actions/workflows/build.yml/dispatches');
});

test('deployViaDispatch: explicit owner/repo skips git; live path dispatches', async () => {
  const sent = [];
  const result = await deployViaDispatch({
    workflow: 'publish.yml',
    owner: 'acme',
    repo: 'site',
    env: { GH_TOKEN: 'tok' },
    fetchFn: async (url) => { sent.push(url); return { status: 204 }; },
    execFn: () => { throw new Error('git must not be called when owner/repo are explicit'); },
  });
  assert.strictEqual(result.dispatched, true);
  assert.strictEqual(sent.length, 1);
});

// ---- findLocalSpecs / assertNoLocalSpecs (the auto-local-lane detector)

test('findLocalSpecs lists tree-wide file: @omega.js specs; assertNoLocalSpecs throws on them', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { findLocalSpecs, assertNoLocalSpecs } = require('../src/deploy.js');

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-deploy-guard-'));
  try {
    const app = path.join(scratch, 'apps', 'site');
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ name: 'brand', private: true, workspaces: ['apps/*'] }));
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({
      name: 'site',
      dependencies: { '@omega.js/web': 'file:../../monorepo/packages/web', '@omega.js/client': '^0.1.0' },
    }));

    const offenders = findLocalSpecs({ dir: app });
    assert.equal(offenders.length, 1, 'exactly the file: spec is an offender');
    assert.match(offenders[0], /@omega\.js\/web: file:/);
    assert.throws(() => assertNoLocalSpecs({ dir: app }), /Local file: packages are linked/);

    // Registry-clean tree → empty list, no throw
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({
      name: 'site',
      dependencies: { '@omega.js/web': '^0.1.0', '@omega.js/client': '^0.1.0' },
    }));
    assert.deepEqual(findLocalSpecs({ dir: app }), []);
    assertNoLocalSpecs({ dir: app });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
