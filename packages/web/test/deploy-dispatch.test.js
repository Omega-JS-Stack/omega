/**
 * The dispatch lane's run follower
 * ([#873](https://github.com/Omega-JS-Stack/omega/issues/873)).
 *
 * The dispatch used to BE the verb's answer: it printed the runs page and
 * exited 0 while the run it started went red minutes later. Now the ONE devkit
 * follower (`@omega.js/devkit/deploy-follow`) is called with the repo and
 * workflow the dispatch used, and its verdict is the verb's exit code. The
 * follower's own behavior is pinned in devkit's `test/deploy-follow.test.js`.
 *
 * Offline by construction: the dispatch, the scaffold, the precheck and the
 * token read are all swapped for stubs, so nothing here touches git, `gh` or
 * the network.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const DEPLOY = require.resolve('../src/commands/deploy.js');

const devkitDeploy = require('@omega.js/devkit/deploy');
const devkitFollow = require('@omega.js/devkit/deploy-follow');
const devkitRecord = require('@omega.js/devkit/deploy-record');
const attachLogFile = require('@omega.js/devkit/attach-log-file');
const ensureTargetLib = require('../src/commands/lib/ensure-target.js');
const deployPrecheckLib = require('../src/commands/lib/deploy-precheck.js');

// The dispatch a stub stands in for: accepted, on the ONE lane (#915).
const DISPATCHED = {
  plan: { method: 'POST', url: 'https://api.github.com/x', body: {}, runsUrl: 'https://github.com/Acme-Org/acme-omega/actions' },
  dispatched: true,
  lane: { mode: 'snapshot', ref: 'omega-deploy' },
};

/**
 * The executor's answer for one run, the sha included. That field is part of
 * the shape (#902): the verb labels the dispatch with it and holds the followed
 * run's head to it, so a stub that dropped it hid both.
 *
 * @param {object} [args] - What the verb asked the executor for.
 * @returns {object} The dispatch answer.
 */
function dispatched(args) {
  return { ...DISPATCHED, sha: (args || {}).snapshot || null, lane: DISPATCHED.lane };
}

/** A web target inside a brand that names its repo. */
function stageBrand() {
  const brandRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'web-dispatch-')));
  const targetDir = path.join(brandRoot, 'targets', 'web');

  fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), JSON.stringify({
    brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' },
    repo: { provider: 'github', org: 'Acme-Org' },
    targets: { web: { type: 'web' } },
  }));
  fs.writeFileSync(path.join(brandRoot, 'package.json'), '{"name":"acme-brand","version":"0.0.0"}');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'package.json'), '{"name":"acme-website","version":"0.0.0","private":true}');

  return { brandRoot, targetDir };
}

/**
 * Run the verb from a staged target with every step around the follower
 * swapped out. The verb DESTRUCTURES its imports at load, so it is dropped
 * from the cache and re-required inside the patch.
 *
 * @param {Function} follower - What `followRun` does for this run.
 * @param {object} [options] - Extra verb options for this run (the fan-out's `--snapshot`).
 * @returns {Promise<{ sent: object[], followed: object[], error: Error|null, lines: string[], targetDir: string, brandRoot: string }>} The run's record.
 */
async function runDeploy(follower, options = {}) {
  const { brandRoot, targetDir } = stageBrand();
  const followed = [];
  const sent = [];
  const patched = [
    [devkitDeploy, 'deployViaDispatch', async (args) => {
      sent.push(args);
      return dispatched(args);
    }],
    [devkitDeploy, 'resolveToken', () => 'tok'],
    [devkitRecord, 'recordDeploy', () => {}],
    [ensureTargetLib, 'ensureTarget', () => {}],
    [deployPrecheckLib, 'deployPrecheck', async () => {}],
    [devkitFollow, 'followRun', async (args) => {
      followed.push(args);
      return follower(args);
    }],
  ];
  const restore = patched.map(([module, key]) => [module, key, module[key]]);
  for (const [module, key, value] of patched) module[key] = value;

  const lines = [];
  const previousLog = console.log;
  console.log = (...args) => lines.push(args.map(String).join(' '));

  const previousCwd = process.cwd();
  process.chdir(targetDir);
  delete require.cache[DEPLOY];

  let error = null;
  try {
    await require(DEPLOY)(options);
  } catch (e) {
    error = e;
  } finally {
    // The verb tees this process' writers: hand them back before the next test
    // prints through a fixture that is about to be gone.
    attachLogFile.detach();
    console.log = previousLog;
    process.chdir(previousCwd);
    for (const [module, key, value] of restore) module[key] = value;
    delete require.cache[DEPLOY];
  }

  return { sent, followed, error, lines, targetDir, brandRoot };
}

test('deploy: the dispatched run is followed with the repo and workflow the dispatch used (#873, #847)', async () => {
  const { sent, followed, error, targetDir, brandRoot } = await runDeploy(async () => ({ run: {}, conclusion: 'success' }));

  try {
    assert.strictEqual(error, null, error && error.message);

    // The dispatch address is devkit's ONE helper's (#847): the repo the brand's
    // config names (never the website repo this target publishes to, #883), and
    // the per-target workflow the scaffold composed at the brand root (#265).
    assert.strictEqual(sent.length, 1);
    assert.deepStrictEqual(
      { owner: sent[0].owner, repo: sent[0].repo, workflow: sent[0].workflow },
      { owner: 'Acme-Org', repo: 'acme-omega', workflow: 'web-build.yml' },
    );

    assert.strictEqual(followed.length, 1);
    assert.strictEqual(followed[0].owner, 'Acme-Org');
    assert.strictEqual(followed[0].repo, 'acme-omega');
    // The COMPOSED name (#265), the one the dispatch itself named.
    assert.strictEqual(followed[0].workflow, 'web-build.yml');
    assert.strictEqual(followed[0].token, 'tok');
    assert.ok(followed[0].since instanceof Date, 'the instant read before the dispatch');
    // And the whole verb went to the target's own deploy log (#873).
    assert.ok(fs.existsSync(path.join(targetDir, 'logs', 'deploy.log')), 'the verb tees logs/deploy.log');
  } finally {
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

test('deploy: a follower that throws is the verb throwing, so a red run exits 1 (#873)', async () => {
  const { error, brandRoot } = await runDeploy(async () => {
    throw new Error('web-build.yml concluded failure: https://github.com/Acme-Org/acme-omega/actions/runs/7');
  });

  try {
    assert.match(error && error.message, /concluded failure/);
    assert.match(error.message, /actions\/runs\/7/);
  } finally {
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});

// #901: the brand root pushes the snapshot ONCE and hands every target of the
// run the sha, so this verb dispatches against it and pushes nothing. The flag
// is the root's word to the verb, never typed by a human.
test('deploy: --snapshot=<sha> reaches the executor as the run\'s snapshot (#901)', async () => {
  const { sent, followed, error, lines, brandRoot } = await runDeploy(
    async () => ({ run: {}, conclusion: 'success' }),
    { snapshot: 'abc1234567890' },
  );

  try {
    assert.strictEqual(error, null, error && error.message);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].snapshot, 'abc1234567890');

    // And the sha the executor answers with is what the run is BOTH labelled
    // with and held to (#902): the dispatch line names it, and the follower
    // refuses a run whose head is anything else.
    assert.ok(
      lines.join('\n').includes('Dispatched web-build.yml (snapshot lane, ref omega-deploy @ abc1234)'),
      `the dispatch line names the snapshot sha (printed: ${lines.join('\n')})`,
    );
    assert.strictEqual(followed.length, 1);
    assert.strictEqual(followed[0].headSha, 'abc1234567890');
  } finally {
    fs.rmSync(brandRoot, { recursive: true, force: true });
  }
});
