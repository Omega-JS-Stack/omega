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
  dispatchRepo,
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

test('dispatchRepo: the CONFIG names the repo a dispatch addresses, never a remote (#799)', () => {
  assert.deepStrictEqual(
    dispatchRepo({ brand: { id: 'acme' }, repo: { providers: { github: { org: 'Acme-Org' } } } }),
    { owner: 'Acme-Org', repo: 'acme-omega' },
  );

  // The slug wins, exactly as brandRepo resolves it (the app repo may sit under
  // the paid company org).
  assert.deepStrictEqual(
    dispatchRepo({ brand: { id: 'acme' }, repo: { providers: { github: { org: 'Acme-Org', repo: 'itw-creative-works/acme-app' } } } }),
    { owner: 'itw-creative-works', repo: 'acme-app' },
  );

  // Half an address addresses nothing: throw instead of POSTing to `undefined/acme`.
  assert.throws(() => dispatchRepo({ brand: { id: 'acme' } }), /brand repo to dispatch on/);
  assert.throws(() => dispatchRepo({}), /brand repo to dispatch on/);
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

// ---- findLocalSpecs (what makes a tree LINKED, and so a snapshot lane, #872)

test('findLocalSpecs lists tree-wide file: @omega.js specs', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { findLocalSpecs } = require('../src/deploy.js');

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'omega-deploy-guard-'));
  try {
    const targetDir = path.join(scratch, 'targets', 'site');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({ name: 'brand', private: true, workspaces: ['targets/*'] }));
    fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({
      name: 'site',
      dependencies: { '@omega.js/web': 'file:../../monorepo/packages/web', '@omega.js/client': '^0.1.0' },
    }));

    const offenders = findLocalSpecs({ dir: targetDir });
    assert.equal(offenders.length, 1, 'exactly the file: spec is an offender');
    assert.match(offenders[0], /@omega\.js\/web: file:/);

    // Registry-clean tree: an empty list, which is the push lane
    fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({
      name: 'site',
      dependencies: { '@omega.js/web': '^0.1.0', '@omega.js/client': '^0.1.0' },
    }));
    assert.deepEqual(findLocalSpecs({ dir: targetDir }), []);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// ---- resolveDeployLane + the snapshot lane (#872)

/** A brand tree: a root with `targets/site`, linked or registry-clean. */
function stageBrandTree({ linked }) {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');

  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-deploy-lane-')));
  const targetDir = path.join(scratch, 'brand', 'targets', 'site');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(path.join(scratch, 'brand', 'config'), { recursive: true });
  fs.writeFileSync(path.join(scratch, 'brand', 'config', 'omega.json5'), '{ brand: { id: \'acme\' } }');
  fs.writeFileSync(path.join(scratch, 'brand', 'package.json'), JSON.stringify({ name: 'brand', private: true, workspaces: ['targets/*'] }));
  fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({
    name: 'site',
    dependencies: { '@omega.js/web': linked ? 'file:../../../packages/web' : '^0.1.0' },
  }));

  return { scratch, brandRoot: path.join(scratch, 'brand'), targetDir };
}

test('resolveDeployLane: a NESTED brand mirrors to main, a linked one to the snapshot branch, a plain one pushes (#872)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { resolveDeployLane } = require('../src/deploy.js');

  // Nested: the brand root is not the toplevel of the repo it sits in
  const nested = stageBrandTree({ linked: false });
  try {
    const lane = resolveDeployLane({ dir: nested.targetDir, execFn: () => `${nested.scratch}\n` });
    assert.deepStrictEqual(
      { mode: lane.mode, ref: lane.ref, nested: lane.nested, linked: lane.linked, brandRoot: lane.brandRoot },
      { mode: 'snapshot', ref: 'main', nested: true, linked: false, brandRoot: nested.brandRoot },
    );
  } finally {
    fs.rmSync(nested.scratch, { recursive: true, force: true });
  }

  // Linked, its own repo: the packed tarballs never enter the real history
  const linked = stageBrandTree({ linked: true });
  try {
    const lane = resolveDeployLane({ dir: linked.targetDir, execFn: (cmd) => (cmd.includes('--show-toplevel') ? `${linked.brandRoot}\n` : 'feature\n') });
    assert.deepStrictEqual(
      { mode: lane.mode, ref: lane.ref, nested: lane.nested, linked: lane.linked },
      { mode: 'snapshot', ref: 'omega-deploy', nested: false, linked: true },
    );
  } finally {
    fs.rmSync(linked.scratch, { recursive: true, force: true });
  }

  // Registry-clean and its own repo: the ordinary push lane, on the branch the
  // developer is standing on
  const plain = stageBrandTree({ linked: false });
  try {
    const lane = resolveDeployLane({
      dir: plain.brandRoot,
      execFn: (cmd) => (cmd.includes('--show-toplevel') ? `${plain.brandRoot}\n` : 'release/2\n'),
    });
    assert.deepStrictEqual(
      { mode: lane.mode, ref: lane.ref, nested: lane.nested, linked: lane.linked },
      { mode: 'push', ref: 'release/2', nested: false, linked: false },
    );
  } finally {
    fs.rmSync(plain.scratch, { recursive: true, force: true });
  }

  // A brand outside git at all cannot snapshot: the push lane, on main
  const loose = stageBrandTree({ linked: false });
  try {
    const lane = resolveDeployLane({
      dir: loose.brandRoot,
      execFn: () => { throw new Error('not a git repository'); },
    });
    assert.deepStrictEqual(
      { mode: lane.mode, ref: lane.ref, nested: lane.nested, repo: lane.repo },
      { mode: 'push', ref: 'main', nested: false, repo: false },
    );
  } finally {
    fs.rmSync(loose.scratch, { recursive: true, force: true });
  }
});

test('deployViaDispatch: the snapshot lane packs, pushes, restores, waits, THEN dispatches (#872)', async () => {
  const fs = require('node:fs');
  const order = [];
  const nested = stageBrandTree({ linked: true });

  try {
    const result = await deployViaDispatch({
      workflow: 'desktop-build.yml',
      owner: 'Omega-JS-Stack',
      repo: 'playground-omega',
      dir: nested.targetDir,
      token: 'tok',
      execFn: () => `${nested.scratch}\n`,
      fetchFn: async () => { order.push('dispatch'); return { status: 204 }; },
      steps: {
        stage: async ({ dir }) => {
          order.push(`stage:${dir}`);
          return { staged: ['@omega.js/web'], restore: async () => order.push('restore') };
        },
        push: (options) => {
          // The push is told what the stage produced, so it can refuse a tree
          // whose ignore rules would drop it (#872).
          assert.deepStrictEqual(options.require, ['omega_modules', 'package-lock.json']);
          order.push(`push:${options.ref}`);
          return 'abc123';
        },
        wait: async (options) => { order.push(`wait:${options.workflow}`); },
        sync: () => order.push('sync'),
      },
    });

    assert.deepStrictEqual(order, [
      `stage:${nested.brandRoot}`,
      'push:main',
      'restore',
      'wait:desktop-build.yml',
      'dispatch',
    ]);
    assert.strictEqual(result.dispatched, true);
    assert.strictEqual(result.lane.mode, 'snapshot');
    assert.strictEqual(result.plan.body.ref, 'main', 'the dispatch runs the ref the snapshot landed on');
  } finally {
    fs.rmSync(nested.scratch, { recursive: true, force: true });
  }
});

test('deployViaDispatch: a failed snapshot restores the tree and never dispatches (#872)', async () => {
  const fs = require('node:fs');
  const order = [];
  const nested = stageBrandTree({ linked: true });

  try {
    await assert.rejects(
      deployViaDispatch({
        workflow: 'desktop-build.yml',
        owner: 'acme',
        repo: 'acme-omega',
        dir: nested.targetDir,
        token: 'tok',
        execFn: () => `${nested.scratch}\n`,
        fetchFn: async () => { order.push('dispatch'); return { status: 204 }; },
        steps: {
          stage: async () => ({ staged: [], restore: async () => order.push('restore') }),
          push: () => { throw new Error('remote rejected the snapshot'); },
          wait: async () => order.push('wait'),
        },
      }),
      /remote rejected the snapshot/,
    );

    assert.deepStrictEqual(order, ['restore'], 'the tree goes back, and nothing else runs');
  } finally {
    fs.rmSync(nested.scratch, { recursive: true, force: true });
  }
});

test('deployViaDispatch: the push lane commits, pushes, waits for the workflow, then dispatches; --no-sync skips the push (#872)', async () => {
  const fs = require('node:fs');
  const plain = stageBrandTree({ linked: false });
  const order = [];
  const steps = {
    push: () => order.push('snapshot'),
    sync: (options) => order.push(`sync:${options.cwd}`),
    // The registration wait is the snapshot lane's too: a brand's FIRST deploy
    // is the push that carries the composed workflow, on either lane.
    wait: () => order.push('wait'),
  };
  const base = {
    workflow: 'website-build.yml',
    owner: 'acme',
    repo: 'acme-omega',
    dir: plain.brandRoot,
    token: 'tok',
    execFn: (cmd) => (cmd.includes('--show-toplevel') ? `${plain.brandRoot}\n` : 'main\n'),
    fetchFn: async () => { order.push('dispatch'); return { status: 204 }; },
    steps,
  };

  try {
    await deployViaDispatch({ ...base });
    assert.deepStrictEqual(order, [`sync:${plain.brandRoot}`, 'wait', 'dispatch']);

    order.length = 0;
    await deployViaDispatch({ ...base, sync: false });
    assert.deepStrictEqual(order, ['wait', 'dispatch'], '--no-sync deploys what GitHub already has');

    // A brand outside git altogether: the lane says push, and there is nothing
    // to commit or push, so the dispatch is the whole lane (the doc's "degrades
    // to the dispatch it can still perform"), never a raw `fatal: not a git
    // repository` out of `git add`.
    order.length = 0;
    await deployViaDispatch({ ...base, execFn: () => { throw new Error('not a git repository'); } });
    assert.deepStrictEqual(order, ['wait', 'dispatch'], 'no repo: no sync step, and no git error');
  } finally {
    fs.rmSync(plain.scratch, { recursive: true, force: true });
  }
});

test('deployViaDispatch: a dry run reports the lane and touches neither git nor the network (#872)', async () => {
  const fs = require('node:fs');
  const nested = stageBrandTree({ linked: true });
  const order = [];

  try {
    const result = await deployViaDispatch({
      workflow: 'desktop-build.yml',
      owner: 'acme',
      repo: 'acme-omega',
      dir: nested.targetDir,
      dryRun: true,
      execFn: () => `${nested.scratch}\n`,
      fetchFn: async () => { order.push('dispatch'); return { status: 204 }; },
      steps: {
        stage: async () => { order.push('stage'); return { staged: [], restore: async () => {} }; },
        push: () => order.push('snapshot'),
      },
    });

    assert.deepStrictEqual(order, [], 'a dry run runs no step at all');
    assert.strictEqual(result.dispatched, false);
    assert.strictEqual(result.lane.mode, 'snapshot');
    assert.strictEqual(result.plan.body.ref, 'main');
  } finally {
    fs.rmSync(nested.scratch, { recursive: true, force: true });
  }
});

test('resolveDeployLane: a LINKED brand outside any git repo refuses BY NAME (#872)', () => {
  const fs = require('node:fs');
  const { resolveDeployLane } = require('../src/deploy.js');

  // The shape: `omega i local` in a folder nobody ran `git init` in. The lane
  // it would otherwise pick is the snapshot one, which is built out of a git
  // index, so the push died on a raw `fatal: not a git repository` from
  // `git check-ignore` a step later.
  const loose = stageBrandTree({ linked: true });

  try {
    assert.throws(
      () => resolveDeployLane({ dir: loose.targetDir, execFn: () => { throw new Error('fatal: not a git repository'); } }),
      (error) => {
        assert.match(error.message, /a linked brand needs a git repo to snapshot from/);
        assert.match(error.message, /git init/, 'and the two ways out');
        assert.match(error.message, /omega i live/);
        return true;
      },
    );
  } finally {
    fs.rmSync(loose.scratch, { recursive: true, force: true });
  }
});

test('deployViaDispatch: a LINKED brand that owns its repo SYNCS first, then snapshots (#872)', async () => {
  const fs = require('node:fs');
  const linked = stageBrandTree({ linked: true });
  const order = [];
  const steps = {
    stage: async () => { order.push('stage'); return { staged: ['@omega.js/web'], restore: async () => order.push('restore') }; },
    push: (options) => order.push(`push:${options.ref}`),
    wait: async () => order.push('wait'),
    sync: (options) => order.push(`sync:${options.cwd}`),
  };
  const base = {
    workflow: 'website-build.yml',
    owner: 'acme',
    repo: 'acme-omega',
    dir: linked.targetDir,
    token: 'tok',
    execFn: (cmd) => (cmd.includes('--show-toplevel') ? `${linked.brandRoot}\n` : 'main\n'),
    fetchFn: async () => { order.push('dispatch'); return { status: 204 }; },
    steps,
  };

  try {
    // GitHub registers a workflow from the repo's DEFAULT branch, and the
    // snapshot branch is not it: the composed workflow reaches main through the
    // developer's own commit, and the snapshot only carries the tarballs.
    await deployViaDispatch({ ...base });
    assert.deepStrictEqual(order, [
      `sync:${linked.brandRoot}`,
      'stage',
      'push:omega-deploy',
      'restore',
      'wait',
      'dispatch',
    ]);

    order.length = 0;
    await deployViaDispatch({ ...base, sync: false });
    assert.deepStrictEqual(order, ['stage', 'push:omega-deploy', 'restore', 'wait', 'dispatch'], '--no-sync deploys what GitHub already has');
  } finally {
    fs.rmSync(linked.scratch, { recursive: true, force: true });
  }
});

test('deployViaDispatch: a NESTED brand never syncs: its repo IS the snapshot (#872)', async () => {
  const fs = require('node:fs');
  const nested = stageBrandTree({ linked: true });
  const order = [];

  try {
    await deployViaDispatch({
      workflow: 'desktop-build.yml',
      owner: 'Omega-JS-Stack',
      repo: 'playground-omega',
      dir: nested.targetDir,
      token: 'tok',
      execFn: () => `${nested.scratch}\n`,
      fetchFn: async () => { order.push('dispatch'); return { status: 204 }; },
      steps: {
        stage: async () => { order.push('stage'); return { staged: [], restore: async () => order.push('restore') }; },
        push: (options) => order.push(`push:${options.ref}`),
        wait: async () => order.push('wait'),
        sync: () => order.push('sync'),
      },
    });

    assert.deepStrictEqual(order, ['stage', 'push:main', 'restore', 'wait', 'dispatch'], 'the enclosing repo is nobody the deploy pushes to');
  } finally {
    fs.rmSync(nested.scratch, { recursive: true, force: true });
  }
});
