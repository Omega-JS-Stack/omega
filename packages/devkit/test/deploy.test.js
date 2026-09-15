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

test('dispatchRepo: the CONFIG names the SOURCE repo a dispatch addresses, never a remote (#799/#883)', () => {
  assert.deepStrictEqual(
    dispatchRepo({ brand: { id: 'acme' }, repo: { org: 'Acme-Org' } }),
    { owner: 'Acme-Org', repo: 'acme-omega' },
  );

  // The workflows live on the SOURCE repo whatever a target publishes to, so a
  // web target's own website repo never becomes the dispatch address (#883).
  assert.deepStrictEqual(
    dispatchRepo({ brand: { id: 'acme' }, repo: { org: 'Acme-Org' }, targets: { web: { type: 'web' } } }),
    { owner: 'Acme-Org', repo: 'acme-omega' },
  );

  // Half an address addresses nothing: throw instead of POSTing to `undefined/acme`.
  assert.throws(() => dispatchRepo({ brand: { id: 'acme' } }), /brand repo to dispatch on/);
  assert.throws(() => dispatchRepo({}), /brand repo to dispatch on/);
});

test('dispatchTarget: the repo from config, and the COMPOSED workflow name inside a brand (#847)', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { dispatchTarget } = require('../src/deploy.js');

  const config = { brand: { id: 'acme' }, repo: { org: 'Acme-Org' } };
  const brandRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-dispatch-target-')));
  const targetDir = path.join(brandRoot, 'targets', 'extension');

  try {
    fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), '{ brand: { id: \'acme\' }, targets: { extension: { type: \'extension\' } } }');

    // A target inside a brand: its CI lives at the BRAND ROOT under the
    // per-target name the scaffold composed (#265).
    assert.deepStrictEqual(
      dispatchTarget({ projectRoot: targetDir, config, workflow: 'publish.yml' }),
      { owner: 'Acme-Org', repo: 'acme-omega', workflow: 'extension-publish.yml' },
    );

    // Standalone: the framework's own file name, unchanged.
    const standalone = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-dispatch-standalone-')));
    try {
      assert.deepStrictEqual(
        dispatchTarget({ projectRoot: standalone, config, workflow: 'build.yml' }),
        { owner: 'Acme-Org', repo: 'acme-omega', workflow: 'build.yml' },
      );

      // Half an address addresses nothing: the repo rule is dispatchRepo's.
      assert.throws(
        () => dispatchTarget({ projectRoot: standalone, config: { brand: { id: 'acme' } }, workflow: 'build.yml' }),
        /brand repo to dispatch on/,
      );
    } finally {
      fs.rmSync(standalone, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
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

/**
 * The NETWORK steps every delivery now starts with (#915, #922), recorded
 * rather than run: the default-branch read, the gh-pages heal of the name that
 * read returned, and the composed workflows' compare and push to that branch.
 * The behind check is git's, so it is recorded here too and a case that wants a
 * refusal overrides it.
 *
 * @param {string[]} order - The run's step log.
 * @returns {object} The steps to inject.
 */
function laneSteps(order) {
  return {
    defaultBranch: async () => { order.push('defaultBranch'); return 'main'; },
    heal: async (options) => { order.push('heal'); return options.current; },
    behind: (options) => order.push(`behind:${options.branch}`),
    workflows: async (options) => { order.push(`workflows:${options.branch}`); return { pushed: [], sha: null }; },
  };
}

test('resolveDeployLane: ONE lane for every brand with a repo, on omega-deploy (#915)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { resolveDeployLane } = require('../src/deploy.js');

  // Nested: the brand root is not the toplevel of the repo it sits in. Its
  // mirror repo takes the snapshot on the deploy branch like any other brand,
  // and that repo's own default branch holds the composed workflows.
  const nested = stageBrandTree({ linked: false });
  try {
    const lane = resolveDeployLane({ dir: nested.targetDir, execFn: () => `${nested.scratch}\n` });
    assert.deepStrictEqual(
      { mode: lane.mode, ref: lane.ref, nested: lane.nested, linked: lane.linked, brandRoot: lane.brandRoot },
      { mode: 'snapshot', ref: 'omega-deploy', nested: true, linked: false, brandRoot: nested.brandRoot },
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

  // Registry-clean and its own repo: the SAME lane (#915). The push lane, which
  // committed the developer's branch and dispatched it, is gone: CI only ever
  // builds omega-deploy, whoever started the deploy.
  const plain = stageBrandTree({ linked: false });
  try {
    const lane = resolveDeployLane({
      dir: plain.brandRoot,
      execFn: (cmd) => (cmd.includes('--show-toplevel') ? `${plain.brandRoot}\n` : 'release/2\n'),
    });
    assert.deepStrictEqual(
      { mode: lane.mode, ref: lane.ref, nested: lane.nested, linked: lane.linked },
      { mode: 'snapshot', ref: 'omega-deploy', nested: false, linked: false },
    );
  } finally {
    fs.rmSync(plain.scratch, { recursive: true, force: true });
  }

  // A brand outside git at all cannot snapshot: the dispatch alone, on whatever
  // the deploy branch already holds
  const loose = stageBrandTree({ linked: false });
  try {
    const lane = resolveDeployLane({
      dir: loose.brandRoot,
      execFn: () => { throw new Error('not a git repository'); },
    });
    assert.deepStrictEqual(
      { mode: lane.mode, ref: lane.ref, nested: lane.nested, repo: lane.repo },
      { mode: 'dispatch', ref: 'omega-deploy', nested: false, repo: false },
    );
  } finally {
    fs.rmSync(loose.scratch, { recursive: true, force: true });
  }
});

test('deployViaDispatch: the snapshot lane checks, composes, packs, pushes, restores, waits, THEN dispatches (#872, #915)', async () => {
  const fs = require('node:fs');
  const order = [];
  const nested = stageBrandTree({ linked: true });
  let waitedFor = null;

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
        ...laneSteps(order),
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
        // The ref has to RESOLVE to what the push just wrote before anything
        // dispatches against it (#902).
        waitRef: async (options) => {
          waitedFor = options;
          order.push(`waitRef:${options.ref}`);
        },
        wait: async (options) => { order.push(`wait:${options.workflow}`); },
      },
    });

    assert.deepStrictEqual(order, [
      'defaultBranch',
      'heal',
      // A nested brand's git toplevel is the enclosing repo's, so there is no
      // checkout of the brand's own repo to be behind (#915).
      'workflows:main',
      `stage:${nested.brandRoot}`,
      'push:omega-deploy',
      'restore',
      'waitRef:omega-deploy',
      'wait:desktop-build.yml',
      'dispatch',
    ]);
    assert.strictEqual(waitedFor.sha, 'abc123', 'it waits for the sha the push returned');
    assert.strictEqual(result.dispatched, true);
    assert.strictEqual(result.lane.mode, 'snapshot');
    assert.strictEqual(result.sha, 'abc123', 'the verb prints and follows the sha this deploy pushed (#902)');
    assert.strictEqual(result.plan.body.ref, 'omega-deploy', 'the dispatch runs the ref the snapshot landed on');
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
          ...laneSteps(order),
          stage: async () => ({ staged: [], restore: async () => order.push('restore') }),
          push: () => { throw new Error('remote rejected the snapshot'); },
          wait: async () => order.push('wait'),
        },
      }),
      /remote rejected the snapshot/,
    );

    assert.deepStrictEqual(order, ['defaultBranch', 'heal', 'workflows:main', 'restore'], 'the tree goes back, and nothing else runs');
  } finally {
    fs.rmSync(nested.scratch, { recursive: true, force: true });
  }
});

test('deployViaDispatch: a PLAIN brand takes the same one lane, and a brand outside git only dispatches (#915)', async () => {
  const fs = require('node:fs');
  const plain = stageBrandTree({ linked: false });
  const order = [];
  const steps = {
    ...laneSteps(order),
    // Registry-clean: nothing to pack, so the stage never runs on this tree.
    stage: async () => { order.push('stage'); return { staged: [], restore: async () => order.push('restore') }; },
    push: (options) => { order.push(`push:${options.ref}`); return 'abc1234567890'; },
    waitRef: () => order.push('waitRef'),
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
    // The push lane is gone (#915): a registry-clean brand that owns its repo
    // snapshots to omega-deploy like every other brand, and its own branch is
    // never committed for it.
    const result = await deployViaDispatch({ ...base });
    assert.deepStrictEqual(order, [
      'defaultBranch',
      'heal',
      'behind:main',
      'workflows:main',
      'push:omega-deploy',
      'waitRef',
      'wait',
      'dispatch',
    ]);
    assert.strictEqual(result.sha, 'abc1234567890', 'every lane pushes a snapshot the follower can hold the run to (#902)');
    assert.strictEqual(result.lane.mode, 'snapshot');

    // A brand outside git altogether: nothing to snapshot FROM, so the dispatch
    // is the whole lane, never a raw `fatal: not a git repository`.
    order.length = 0;
    const loose = await deployViaDispatch({ ...base, execFn: () => { throw new Error('not a git repository'); } });
    assert.deepStrictEqual(order, ['wait', 'dispatch'], 'no repo: no delivery at all, and no git error');
    assert.strictEqual(loose.lane.mode, 'dispatch');
    assert.strictEqual(loose.plan.body.ref, 'omega-deploy', 'and it dispatches the one branch CI builds');
  } finally {
    fs.rmSync(plain.scratch, { recursive: true, force: true });
  }
});

test('deliverLane: a checkout BEHIND the default branch refuses, naming the fix (#915)', async () => {
  const { deliverLane, assertNotBehind } = require('../src/deploy.js');
  const lane = { mode: 'snapshot', ref: 'omega-deploy', nested: false, linked: false, repo: true, brandRoot: '/brand' };
  const order = [];

  await assert.rejects(
    () => deliverLane({
      lane,
      owner: 'acme',
      repo: 'acme-omega',
      token: 'tok',
      steps: {
        defaultBranch: async () => 'main',
        behind: (options) => assertNotBehind({
          ...options,
          // Real git's answer, injected: `merge-base --is-ancestor` exits
          // nonzero exactly when the remote branch is not in this history.
          execFn: (args) => {
            if (args[0] === 'merge-base') throw Object.assign(new Error('exit 1'), { status: 1 });
            return '';
          },
        }),
        workflows: async () => order.push('workflows'),
        push: () => order.push('push'),
      },
    }),
    (error) => {
      assert.match(error.message, /behind origin\/main/);
      assert.match(error.message, /force-pushes it over omega-deploy/, 'it says what would be lost');
      assert.match(error.message, /git pull/, 'and the fix');
      return true;
    },
  );

  assert.deepStrictEqual(order, [], 'the refusal is before the workflow push and before the snapshot');
});

test('assertNotBehind: a fetch that fails for any reason but a missing remote or ref REFUSES (#915)', () => {
  const { assertNotBehind } = require('../src/deploy.js');
  const fetchFailing = (said) => (args) => {
    if (args[0] === 'fetch') throw Object.assign(new Error('Command failed'), { status: 128, stderr: said });
    return '';
  };

  // A token that cannot read the repo would otherwise deploy as "nothing to be
  // behind", force-pushing a stale checkout over everything the branch carries.
  assert.throws(
    () => assertNotBehind({ cwd: '/brand', branch: 'main', execFn: fetchFailing('fatal: Authentication failed for \'https://github.com/acme/acme-omega.git/\'\n') }),
    (error) => {
      assert.match(error.message, /Authentication failed/, 'git\'s own words ride the refusal');
      assert.match(error.message, /origin\/main/);
      return true;
    },
  );

  // The two answers that really are nothing to be behind.
  const lines = [];
  assertNotBehind({
    cwd: '/brand',
    branch: 'main',
    logger: { log: (line) => lines.push(line) },
    execFn: fetchFailing('fatal: couldn\'t find remote ref main\n'),
  });
  assertNotBehind({
    cwd: '/brand',
    branch: 'main',
    logger: { log: (line) => lines.push(line) },
    execFn: fetchFailing('fatal: \'origin\' does not appear to be a git repository\n'),
  });

  assert.strictEqual(lines.length, 2, 'both proceed, each saying so once');
  assert.match(lines[0], /nothing to be behind/);
});

test('deliverLane: a NESTED brand skips the behind check: its git toplevel is someone else\'s repo (#915)', async () => {
  const { deliverLane } = require('../src/deploy.js');
  const order = [];
  const lane = { mode: 'snapshot', ref: 'omega-deploy', nested: true, linked: false, repo: true, brandRoot: '/brand' };

  await deliverLane({
    lane,
    owner: 'Omega-JS-Stack',
    repo: 'playground-omega',
    token: 'tok',
    steps: {
      ...laneSteps(order),
      behind: () => order.push('behind'),
      push: () => 'abc1234567890',
      waitRef: async () => order.push('waitRef'),
    },
  });

  assert.deepStrictEqual(order, ['defaultBranch', 'heal', 'workflows:main', 'waitRef'], 'no behind check ran');
});

test('deliverLane: a gh-pages default is HEALED before anything is written to it (#922)', async () => {
  const { deliverLane } = require('../src/deploy.js');
  const order = [];
  const composed = [];
  const lane = { mode: 'snapshot', ref: 'omega-deploy', nested: true, linked: false, repo: true, brandRoot: '/brand' };

  await deliverLane({
    lane,
    owner: 'acme',
    repo: 'acme-omega',
    token: 'tok',
    steps: {
      defaultBranch: async () => { order.push('defaultBranch'); return 'gh-pages'; },
      // The heal takes the name the read returned and answers with the branch
      // the rest of the lane uses: published output is never composed onto.
      heal: async (options) => { order.push(`heal:${options.current}`); return 'main'; },
      workflows: async (options) => {
        composed.push(options.branch);
        order.push(`workflows:${options.branch}`);
        return { pushed: [], sha: null };
      },
      push: () => 'abc1234567890',
      waitRef: async () => order.push('waitRef'),
    },
  });

  assert.deepStrictEqual(order, ['defaultBranch', 'heal:gh-pages', 'workflows:main', 'waitRef']);
  assert.deepStrictEqual(composed, ['main'], 'the compose commit goes to the healed branch, never to gh-pages');
});

test('deployViaDispatch: a dry run reports the lane and touches neither git nor the network (#872)', async () => {
  const fs = require('node:fs');
  const nested = stageBrandTree({ linked: true });
  const order = [];
  const lines = [];

  try {
    const result = await deployViaDispatch({
      workflow: 'desktop-build.yml',
      owner: 'acme',
      repo: 'acme-omega',
      dir: nested.targetDir,
      dryRun: true,
      execFn: () => `${nested.scratch}\n`,
      fetchFn: async () => { order.push('dispatch'); return { status: 204 }; },
      logger: { log: (line) => lines.push(line) },
      steps: {
        ...laneSteps(order),
        stage: async () => { order.push('stage'); return { staged: [], restore: async () => {} }; },
        push: () => order.push('snapshot'),
      },
    });

    assert.deepStrictEqual(order, [], 'a dry run runs no step at all, the gh-pages heal included (#922)');
    assert.strictEqual(result.dispatched, false);
    assert.strictEqual(result.lane.mode, 'snapshot');
    assert.strictEqual(result.plan.body.ref, 'omega-deploy');

    // The workflow half of the plan, read off DISK so the preview costs no
    // network call (#915): this fixture composed none, so it says so.
    assert.ok(
      lines.some((line) => line.includes('.github/workflows') && line.includes('omega-deploy')),
      `the dry run names the workflow plan and the branch the folder would go to (got ${JSON.stringify(lines)})`,
    );
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

test('deployViaDispatch: a LINKED brand that owns its repo checks it is current, composes, then snapshots (#872, #915)', async () => {
  const fs = require('node:fs');
  const linked = stageBrandTree({ linked: true });
  const order = [];
  const steps = {
    ...laneSteps(order),
    stage: async () => { order.push('stage'); return { staged: ['@omega.js/web'], restore: async () => order.push('restore') }; },
    push: (options) => { order.push(`push:${options.ref}`); return 'abc1234567890'; },
    waitRef: async (options) => order.push(`waitRef:${options.ref}@${options.sha}`),
    wait: async () => order.push('wait'),
  };

  try {
    // GitHub registers a workflow from the repo's DEFAULT branch, and the
    // snapshot branch is not it: the composed workflow files reach that branch
    // through the deploy's own data-api commit, and NOTHING else does (#915).
    await deployViaDispatch({
      workflow: 'website-build.yml',
      owner: 'acme',
      repo: 'acme-omega',
      dir: linked.targetDir,
      token: 'tok',
      execFn: (cmd) => (cmd.includes('--show-toplevel') ? `${linked.brandRoot}\n` : 'main\n'),
      fetchFn: async () => { order.push('dispatch'); return { status: 204 }; },
      steps,
    });

    assert.deepStrictEqual(order, [
      'defaultBranch',
      'heal',
      'behind:main',
      'workflows:main',
      'stage',
      'push:omega-deploy',
      'restore',
      'waitRef:omega-deploy@abc1234567890',
      'wait',
      'dispatch',
    ]);
  } finally {
    fs.rmSync(linked.scratch, { recursive: true, force: true });
  }
});

test('deployViaDispatch: a snapshot the BRAND ROOT already pushed is dispatched against, never pushed again (#901)', async () => {
  const fs = require('node:fs');
  const { laneLabel } = require('../src/deploy.js');
  const nested = stageBrandTree({ linked: true });
  const order = [];
  const lines = [];

  try {
    const result = await deployViaDispatch({
      workflow: 'desktop-build.yml',
      owner: 'Omega-JS-Stack',
      repo: 'playground-omega',
      dir: nested.targetDir,
      token: 'tok',
      // The sha the brand-root fan-out put on this lane's ref before it
      // spawned a single target (#901).
      snapshot: 'abc1234567890',
      logger: { log: (line) => lines.push(line) },
      execFn: () => `${nested.scratch}\n`,
      fetchFn: async () => { order.push('dispatch'); return { status: 204 }; },
      steps: {
        ...laneSteps(order),
        stage: async () => { order.push('stage'); return { staged: [], restore: async () => order.push('restore') }; },
        push: (options) => order.push(`push:${options.ref}`),
        waitRef: async () => order.push('waitRef'),
        wait: async (options) => order.push(`wait:${options.ref}`),
      },
    });

    assert.deepStrictEqual(order, ['wait:omega-deploy', 'dispatch'], 'no compare, no stage, no second push: the wait and the dispatch stay');
    assert.strictEqual(result.dispatched, true);
    assert.strictEqual(result.sha, 'abc1234567890', 'the run\'s snapshot is what this verb prints and follows (#902)');
    assert.strictEqual(result.plan.body.ref, 'omega-deploy', 'the dispatch runs the ref the root snapshot landed on');
    assert.ok(lines.some((line) => line.includes('abc1234')), 'the run says which snapshot it is dispatching against');

    // The dispatch line every verb prints carries the same sha, so a fan-out
    // log shows every target running the ONE snapshot.
    assert.strictEqual(laneLabel(result.lane, 'abc1234567890'), 'snapshot lane, ref omega-deploy @ abc1234');
    assert.strictEqual(laneLabel(result.lane), 'snapshot lane, ref omega-deploy', 'a verb that pushed its own snapshot prints what it always did');
  } finally {
    fs.rmSync(nested.scratch, { recursive: true, force: true });
  }
});

test('deployViaDispatch: a snapshot sha on a repo-less brand is an ERROR: there is nothing to skip (#901)', async () => {
  const fs = require('node:fs');
  const plain = stageBrandTree({ linked: false });
  const order = [];

  try {
    await assert.rejects(
      deployViaDispatch({
        workflow: 'website-build.yml',
        owner: 'acme',
        repo: 'acme-omega',
        dir: plain.brandRoot,
        token: 'tok',
        snapshot: 'abc1234567890',
        execFn: () => { throw new Error('not a git repository'); },
        fetchFn: async () => { order.push('dispatch'); return { status: 204 }; },
        steps: {
          ...laneSteps(order),
          push: () => order.push('snapshot'),
          wait: () => order.push('wait'),
        },
      }),
      (error) => {
        assert.match(error.message, /--snapshot/);
        assert.match(error.message, /dispatch lane/, 'the refusal names the lane this deploy is actually on');
        return true;
      },
    );

    assert.deepStrictEqual(order, [], 'the refusal is before any step');
  } finally {
    fs.rmSync(plain.scratch, { recursive: true, force: true });
  }
});

test('deliverLane: the one lane checks, composes, packs, pushes, restores, and returns the sha (#901, #915)', async () => {
  const { deliverLane } = require('../src/deploy.js');
  const order = [];
  const lines = [];
  const waited = [];
  const composed = [];
  const lane = { mode: 'snapshot', ref: 'omega-deploy', nested: false, linked: true, repo: true, brandRoot: '/brand' };
  const steps = {
    defaultBranch: async (options) => { order.push(`defaultBranch:${options.owner}/${options.repo}`); return 'main'; },
    heal: async (options) => { order.push(`heal:${options.current}`); return options.current; },
    behind: (options) => order.push(`behind:${options.cwd}@${options.branch}`),
    workflows: async (options) => {
      composed.push(options);
      order.push(`workflows:${options.owner}/${options.repo}#${options.branch}`);
      return { pushed: ['web-build.yml'], sha: 'def4567890123' };
    },
    stage: async ({ dir }) => { order.push(`stage:${dir}`); return { staged: ['@omega.js/web'], restore: async () => order.push('restore') }; },
    push: (options) => {
      assert.deepStrictEqual(options.require, ['omega_modules', 'package-lock.json'], 'the push refuses a tree whose ignore rules would drop the staged tarballs');
      order.push(`push:${options.owner}/${options.repo}#${options.ref}`);
      return 'abc1234567890';
    },
    // The push is not delivered until GitHub's own ref resolves to it (#902):
    // a dispatch sent in the same second still reads the PREVIOUS commit.
    waitRef: async (options) => {
      waited.push(options);
      order.push(`waitRef:${options.owner}/${options.repo}#${options.ref}`);
    },
    wait: () => order.push('wait'),
  };

  const result = await deliverLane({
    lane,
    owner: 'acme',
    repo: 'acme-omega',
    token: 'tok',
    logger: { log: (line) => lines.push(line) },
    steps,
  });

  assert.deepStrictEqual(order, [
    'defaultBranch:acme/acme-omega',
    'heal:main',
    'behind:/brand@main',
    'workflows:acme/acme-omega#main',
    'stage:/brand',
    'push:acme/acme-omega#omega-deploy',
    'restore',
    'waitRef:acme/acme-omega#omega-deploy',
  ]);
  assert.strictEqual(composed[0].brandRoot, '/brand', 'the composed workflows are read from the brand folder');
  assert.strictEqual(waited[0].sha, 'abc1234567890', 'it waits for the very sha the push returned');
  assert.strictEqual(result.sha, 'abc1234567890', 'the sha every target of the run dispatches against');
  assert.ok(lines.some((line) => line.includes('Snapshotting /brand')), 'the delivery says what it is sending where');
});

test('deliverLane: a brand outside git delivers NOTHING (#915)', async () => {
  const order = [];
  const { deliverLane } = require('../src/deploy.js');
  const lane = { mode: 'dispatch', ref: 'omega-deploy', nested: false, linked: false, repo: false, brandRoot: '/brand' };
  const steps = {
    defaultBranch: async () => { order.push('defaultBranch'); return 'main'; },
    heal: async () => { order.push('heal'); return 'main'; },
    behind: () => order.push('behind'),
    workflows: async () => order.push('workflows'),
    stage: async () => { order.push('stage'); return { staged: [], restore: async () => {} }; },
    push: () => order.push('snapshot'),
    waitRef: async () => order.push('waitRef'),
    wait: () => order.push('wait'),
  };

  const result = await deliverLane({ lane, logger: { log: () => {} }, steps });
  assert.deepStrictEqual(order, [], 'no index to snapshot from: not one step, and no git error');
  assert.strictEqual(result.sha, null, 'and no snapshot for anyone to dispatch against');
});
