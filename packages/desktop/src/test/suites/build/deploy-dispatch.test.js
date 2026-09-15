// Build-layer test for the dispatch lane's run follower
// ([#873](https://github.com/Omega-JS-Stack/omega/issues/873)).
//
// `omega deploy` delegates to `omega release`, which owns desktop's dispatch.
// The dispatch used to BE the verb's answer: it printed the runs page and
// exited 0 while the run it started went red minutes later. Now the ONE devkit
// follower (`@omega.js/devkit/deploy-follow`, ported out of this very file) is
// called with the repo and workflow the dispatch used, and its verdict is the
// verb's exit code. The follower's own behavior is pinned in devkit's
// `test/deploy-follow.test.js`.

const path = require('path');
const fs = require('fs');
const os = require('os');
const defineCases = require('@omega.js/devkit/test/define-cases');

const RELEASE = path.join(__dirname, '..', '..', '..', 'commands', 'release.js');

// Required as literals: that is what resolves to the same instance the command
// loads (a vendored devkit inside dist, the workspace one from src).
const devkitDeploy = require('@omega.js/devkit/deploy');
const devkitFollow = require('@omega.js/devkit/deploy-follow');
const devkitRecord = require('@omega.js/devkit/deploy-record');
const attachLogFile = require('@omega.js/devkit/attach-log-file');

// The dispatch a stub stands in for: accepted, on the ONE lane (#915).
const LANE = { mode: 'snapshot', ref: 'omega-deploy' };

/**
 * A desktop target inside a brand that names its repo, run as cwd.
 *
 * @returns {{ brandRoot: string, targetDir: string }} The staged tree.
 */
function stageBrand() {
  const brandRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-dispatch-')));
  const targetDir = path.join(brandRoot, 'targets', 'desktop');

  fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
  fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), JSON.stringify({
    brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' },
    repo: { provider: 'github', org: 'Acme-Org' },
    targets: { desktop: { type: 'desktop' } },
  }));
  fs.writeFileSync(path.join(brandRoot, 'package.json'), '{"name":"acme-brand","version":"0.0.0"}');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'package.json'), '{"name":"acme-desktop","version":"0.0.0"}');

  return { brandRoot, targetDir };
}

/**
 * Run the release verb from a staged target with the network steps swapped
 * out. The verb DESTRUCTURES its imports at load, so it is dropped from the
 * cache and re-required inside the patch.
 *
 * @param {object} follower - What `followRun` does for this run.
 * @param {object} [options] - Extra verb options for this run (the fan-out's `--snapshot`).
 * @param {object} [token] - The token surfaces this run has: `env` is what
 *   `GH_TOKEN` holds (null for a shell that never exported one) and `resolved`
 *   is what devkit's `resolveToken()` chain answers (null for a machine with no
 *   token anywhere, `gh` included).
 * @returns {Promise<{ sent: object[], followed: object[], error: Error|null, lines: string[], targetDir: string, brandRoot: string }>} The run's record.
 */
async function runRelease(follower, options = {}, token = {}) {
  const envToken = 'env' in token ? token.env : 'tok';
  const resolvedToken = 'resolved' in token ? token.resolved : 'tok';
  const { brandRoot, targetDir } = stageBrand();
  const followed = [];
  const sent = [];
  const patched = [
    [devkitDeploy, 'deployViaDispatch', async (args) => {
      sent.push(args);
      // The executor's own answer shape (`buildDispatch`): the verb prints the
      // plan's runs url rather than rebuilding that address for itself, and a
      // run carrying the root's snapshot is on the snapshot lane by definition.
      // The `sha` is part of that shape (#902): it is what the verb labels the
      // dispatch with and what it holds the followed run's head to, so a stub
      // that dropped it hid both.
      return {
        sha: args.snapshot || null,
        plan: {
          method: 'POST',
          url: `https://api.github.com/repos/${args.owner}/${args.repo}/actions/workflows/${args.workflow}/dispatches`,
          body: { ref: LANE.ref, ...(args.inputs ? { inputs: args.inputs } : {}) },
          runsUrl: `https://github.com/${args.owner}/${args.repo}/actions/workflows/${args.workflow}`,
        },
        dispatched: !args.dryRun,
        lane: LANE,
      };
    }],
    [devkitDeploy, 'resolveToken', () => resolvedToken],
    [devkitRecord, 'recordDeploy', () => {}],
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
  const previousToken = process.env.GH_TOKEN;
  if (envToken === null) delete process.env.GH_TOKEN;
  else process.env.GH_TOKEN = envToken;
  process.chdir(targetDir);
  delete require.cache[require.resolve(RELEASE)];

  let error = null;
  try {
    await require(RELEASE)(options);
  } catch (e) {
    error = e;
  } finally {
    // The verb tees this process' writers: hand them back before the next
    // suite prints through a fixture that is about to be gone.
    attachLogFile.detach();
    console.log = previousLog;
    process.chdir(previousCwd);
    if (previousToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = previousToken;
    for (const [module, key, value] of restore) module[key] = value;
    delete require.cache[require.resolve(RELEASE)];
  }

  return { sent, followed, error, lines, targetDir, brandRoot };
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'deploy dispatch: the run is followed, and its conclusion is the verb\'s (#873)',
  tests: [
    {
      name: 'the dispatched run is followed with the repo and workflow the dispatch used (#873, #847)',
      run: async (ctx) => {
        const { sent, followed, error, targetDir, brandRoot } = await runRelease(async () => ({ run: {}, conclusion: 'success' }));

        try {
          ctx.expect(error).toBe(null);

          // The dispatch address is devkit's ONE helper's (#847): the repo the
          // brand's config names, and the per-target workflow the scaffold
          // composed at the brand root (#265).
          ctx.expect(sent.length).toBe(1);
          ctx.expect({ owner: sent[0].owner, repo: sent[0].repo, workflow: sent[0].workflow })
            .toEqual({ owner: 'Acme-Org', repo: 'acme-omega', workflow: 'desktop-build.yml' });
          ctx.expect(followed.length).toBe(1);
          ctx.expect(followed[0].owner).toBe('Acme-Org');
          ctx.expect(followed[0].repo).toBe('acme-omega');
          // The COMPOSED name (#265), the one the dispatch itself named.
          ctx.expect(followed[0].workflow).toBe('desktop-build.yml');
          ctx.expect(followed[0].token).toBe('tok');
          ctx.expect(followed[0].since instanceof Date).toBe(true);
          // And the whole verb went to the target's own deploy log, the name
          // every target's deploy writes now (logs/ci.log is retired).
          ctx.expect(fs.existsSync(path.join(targetDir, 'logs', 'deploy.log'))).toBe(true);
          ctx.expect(fs.existsSync(path.join(targetDir, 'logs', 'ci.log'))).toBe(false);
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },
    {
      // #901: the brand root pushes the snapshot ONCE and hands every target
      // of the run the sha, so this verb dispatches against it and pushes
      // nothing. The flag is the root's word to the verb, never typed.
      name: '--snapshot=<sha> reaches the executor as the run\'s snapshot (#901)',
      run: async (ctx) => {
        const { sent, followed, error, lines, brandRoot } = await runRelease(
          async () => ({ run: {}, conclusion: 'success' }),
          { snapshot: 'abc1234567890' },
        );

        try {
          ctx.expect(error).toBe(null);
          ctx.expect(sent.length).toBe(1);
          ctx.expect(sent[0].snapshot).toBe('abc1234567890');

          // And the sha the executor answers with is what the run is BOTH
          // labelled with and held to (#902): the dispatch line names it, and
          // the follower refuses a run whose head is anything else.
          ctx.expect(lines.join('\n')).toContain('Dispatched desktop-build.yml (snapshot lane, ref omega-deploy @ abc1234)');
          ctx.expect(followed.length).toBe(1);
          ctx.expect(followed[0].headSha).toBe('abc1234567890');
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },
    {
      // The token chain is devkit's ONE resolver, `GH_TOKEN` → `GITHUB_TOKEN` →
      // `gh auth token`, which every other target and this verb's own follower
      // already use. Testing the bare env var here refused a machine signed in
      // with `gh` and holding no variable at all.
      name: 'a signed-in `gh` and no GH_TOKEN in the env still dispatches: the token chain is the one resolver',
      run: async (ctx) => {
        const { sent, followed, error, brandRoot } = await runRelease(
          async () => ({ run: {}, conclusion: 'success' }),
          {},
          { env: null, resolved: 'gh-cli-token' },
        );

        try {
          ctx.expect(error).toBe(null);
          ctx.expect(sent.length).toBe(1);
          ctx.expect(followed[0].token).toBe('gh-cli-token');
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'no token anywhere refuses by name, before the dispatch',
      run: async (ctx) => {
        const { sent, error, brandRoot, targetDir } = await runRelease(
          async () => ({ run: {}, conclusion: 'success' }),
          {},
          { env: null, resolved: null },
        );

        try {
          ctx.expect(error === null).toBe(false);
          ctx.expect(error.message).toContain('GH_TOKEN');
          ctx.expect(error.message).toContain('gh auth login');
          ctx.expect(sent.length).toBe(0);
          // The tee attached before the token check (#873), so the harness's
          // detach above popped this verb's layer and not the `omega test` log
          // under it.
          ctx.expect(fs.existsSync(path.join(targetDir, 'logs', 'deploy.log'))).toBe(true);
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },
    {
      // P4/P6: the preview used to be a SECOND dispatch call in deploy.js, built
      // without the snapshot or the ref, so `--dry-run --snapshot=<sha>`
      // printed a plan that ignored the sha the fan-out pushed. One call site
      // now answers both.
      name: 'a --dry-run threads the snapshot and sends nothing, and the runs url is the PLAN\'s (#895, #901)',
      run: async (ctx) => {
        const { sent, followed, error, lines, brandRoot } = await runRelease(
          async () => ({ run: {}, conclusion: 'success' }),
          { dryRun: true, snapshot: 'abc1234567890', platforms: 'mac' },
          // A dry run resolves no token: every step under it is a read or a plan.
          { env: null, resolved: null },
        );

        try {
          ctx.expect(error).toBe(null);
          ctx.expect(sent.length).toBe(1);
          ctx.expect(sent[0].dryRun).toBe(true);
          ctx.expect(sent[0].snapshot).toBe('abc1234567890');
          ctx.expect(followed.length).toBe(0);

          const preview = lines.join('\n');
          // The header names the LANE, the same spelling the other three verbs
          // print (docs/shared/deploys.md); the sha rides the Dispatched line only.
          ctx.expect(preview).toContain('DRY RUN (snapshot lane, ref omega-deploy)');
          ctx.expect(preview).not.toContain('abc1234');
          ctx.expect(preview).toContain('https://github.com/Acme-Org/acme-omega/actions/workflows/desktop-build.yml');
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'a follower that throws is the verb throwing, so a red run exits 1 (#873)',
      run: async (ctx) => {
        const { error, brandRoot } = await runRelease(async () => {
          throw new Error('desktop-build.yml concluded failure: https://github.com/Acme-Org/acme-omega/actions/runs/7');
        });

        try {
          ctx.expect(error && error.message).toContain('concluded failure');
          ctx.expect(error.message).toContain('actions/runs/7');
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },
  ],
});
