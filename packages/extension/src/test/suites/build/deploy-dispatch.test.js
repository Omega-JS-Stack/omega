// Build-layer test for commands/deploy.js's dispatch address (#799): the repo a
// CI dispatch targets comes from the brand's config, never the git remote of
// whatever repo the target sits in. Inside a brand nested in another repo (a
// brand inside the framework monorepo) the remote is the ENCLOSING repo, so the
// dispatch went to a workflow that was never there.

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const defineCases = require('@omega.js/devkit/test/define-cases');

const deployPath = path.join(__dirname, '..', '..', '..', 'commands', 'deploy.js');

// The modules the verb reaches on its way to the dispatch. Required HERE as
// literals, because that is what resolves to the same instance the command
// loads (a vendored devkit inside dist, the workspace one from src) and what
// runs their load-time reads while the cwd is still this package's.
const devkitDeploy = require('@omega.js/devkit/deploy');
const devkitFollow = require('@omega.js/devkit/deploy-follow');
const devkitRecord = require('@omega.js/devkit/deploy-record');
const brandVersion = require('@omega.js/devkit/brand-version');
const ensureTargetLib = require('../../../commands/lib/ensure-target.js');
const deployPrecheckLib = require('../../../commands/lib/deploy-precheck.js');
const packageTask = require('../../../gulp/tasks/package.js');
const attachLogFile = require('@omega.js/devkit/attach-log-file');

/**
 * Swap exports for stubs, run, and swap them back. The verb DESTRUCTURES its
 * imports at load, so the command is dropped from the cache and re-required
 * inside the patch: what it closes over is then the stub.
 *
 * @param {Array<[object, object]>} stubs - `[module, { <export>: value }]` pairs.
 * @param {Function} run - Receives the freshly required command module.
 * @returns {Promise<*>} Whatever `run` returns.
 */
async function withStubs(stubs, run) {
  const restore = [];

  for (const [module, exports] of stubs) {
    for (const [key, value] of Object.entries(exports)) {
      restore.push([module, key, module[key]]);
      module[key] = value;
    }
  }

  delete require.cache[require.resolve(deployPath)];

  try {
    return await run(require(deployPath));
  } finally {
    for (const [module, key, value] of restore) {
      module[key] = value;
    }
    delete require.cache[require.resolve(deployPath)];
  }
}

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

// A brand monorepo with one extension target: config/omega.json5 at the root,
// the target under targets/, which is what the config walk looks for.
function stageBrand(config) {
  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'extension-brand-'));
  const targetDir = path.join(brandRoot, 'targets', 'extension');
  fs.mkdirSync(path.join(brandRoot, 'config'), { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(brandRoot, 'config', 'omega.json5'), JSON.stringify(config));
  // A target is a package: the gulp tasks the verb loads read this one's
  // manifest as they load.
  fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({ name: 'acme-extension', version: '0.0.0', private: true }));
  return { brandRoot, targetDir };
}

/**
 * The verb with every boundary stubbed: the scaffold, the version check, the
 * consumer hook, the precheck, the dispatch and the follower. What is left is
 * the verb's own work, which is where the dispatch address is decided.
 *
 * @param {object} options
 * @param {Function} options.dispatch - Stands in for `deployViaDispatch`.
 * @param {object} options.follower - Stands in for the devkit follower.
 * @returns {Array<[object, object]>} `withStubs` pairs.
 */
function stubsFor({ dispatch, follower }) {
  return [
    [devkitDeploy, { deployViaDispatch: dispatch, resolveToken: () => 'tok' }],
    [devkitRecord, { recordDeploy: () => {} }],
    [brandVersion, { assertBrandVersion: () => {} }],
    [ensureTargetLib, { ensureTarget: async () => {} }],
    [deployPrecheckLib, { deployPrecheck: async () => {} }],
    [packageTask, { hook: async () => {} }],
    [devkitFollow, follower],
  ];
}

/** Run the verb from a staged target, and put the cwd back when it is done. */
async function inTarget(targetDir, run) {
  const previous = process.cwd();
  process.chdir(targetDir);
  try {
    return await run();
  } finally {
    // The verb tees this process' writers: hand them back before the next
    // suite prints through a fixture that is about to be gone.
    attachLogFile.detach();
    process.chdir(previous);
  }
}

module.exports = defineCases({
  type: 'suite',
  layer: 'build',
  description: 'deploy — the CI dispatch address comes from config',
  tests: [
    {
      name: 'the dispatch gets the helper\'s address: the CONFIG\'s repo and the COMPOSED workflow (#799, #847)',
      run: async (ctx) => {
        const { brandRoot, targetDir } = stageBrand({
          brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' },
          repo: { provider: 'github', org: 'Acme-Org' },
          targets: { extension: { type: 'extension' } },
        });
        const sent = [];
        const stubs = stubsFor({
          dispatch: async (args) => {
            sent.push(args);
            return dispatched(args);
          },
          follower: { followRun: async () => ({ run: {}, conclusion: 'success' }) },
        });

        try {
          await inTarget(targetDir, () => withStubs(stubs, (deploy) => deploy({})));

          // The one devkit helper answers both halves (#847): the repo is the
          // derived `<brand.id>-omega` default (#809, the config declares an org
          // and no repo of its own), and the workflow is the per-target name the
          // brand root's scaffold composed (#265).
          ctx.expect(sent.length).toBe(1);
          ctx.expect({ owner: sent[0].owner, repo: sent[0].repo, workflow: sent[0].workflow })
            .toEqual({ owner: 'Acme-Org', repo: 'acme-omega', workflow: 'extension-publish.yml' });
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },
    {
      name: 'dispatch address: a config that names no repo REFUSES instead of dispatching somewhere (#799)',
      run: async (ctx) => {
        const { brandRoot, targetDir } = stageBrand({
          brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' },
          targets: { extension: { type: 'extension' } },
        });
        const sent = [];
        const stubs = stubsFor({
          dispatch: async (args) => {
            sent.push(args);
            return dispatched(args);
          },
          follower: { followRun: async () => ({ run: {}, conclusion: 'success' }) },
        });

        try {
          let thrown = null;
          await inTarget(targetDir, () => withStubs(stubs, (deploy) => deploy({})))
            .catch((error) => { thrown = error; });

          ctx.expect(thrown && thrown.message).toMatch(/brand repo to dispatch on/);
          ctx.expect(sent.length).toBe(0);
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },
    {
      // #901: the brand root pushes the snapshot ONCE and hands every target of
      // the run the sha, so this verb dispatches against it and pushes nothing.
      // The flag is the root's word to the verb, never typed.
      name: '--snapshot=<sha> reaches the executor as the run\'s snapshot (#901)',
      run: async (ctx) => {
        const { brandRoot, targetDir } = stageBrand({
          brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' },
          repo: { provider: 'github', org: 'Acme-Org' },
          targets: { extension: { type: 'extension' } },
        });
        const sent = [];
        const followed = [];
        const lines = [];
        const stubs = stubsFor({
          dispatch: async (args) => {
            sent.push(args);
            return dispatched(args);
          },
          follower: {
            followRun: async (args) => {
              followed.push(args);
              return { run: {}, conclusion: 'success' };
            },
          },
        });
        const previousLog = console.log;
        console.log = (...args) => lines.push(args.map(String).join(' '));

        try {
          await inTarget(targetDir, () => withStubs(stubs, (deploy) => deploy({ snapshot: 'abc1234567890' })));
          console.log = previousLog;

          ctx.expect(sent.length).toBe(1);
          ctx.expect(sent[0].snapshot).toBe('abc1234567890');

          // And the sha the executor answers with is what the run is BOTH
          // labelled with and held to (#902): the dispatch line names it, and
          // the follower refuses a run whose head is anything else.
          ctx.expect(lines.join('\n')).toContain('Dispatched extension-publish.yml (snapshot lane, ref omega-deploy @ abc1234)');
          ctx.expect(followed.length).toBe(1);
          ctx.expect(followed[0].headSha).toBe('abc1234567890');
        } finally {
          console.log = previousLog;
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },
    {
      // #873: the dispatch used to BE the verb's answer, so a run that went red
      // minutes later left the deploy reported green.
      name: 'a dispatched deploy FOLLOWS its run, and a red run fails the verb (#873)',
      run: async (ctx) => {
        const { brandRoot, targetDir } = stageBrand({
          brand: { id: 'acme', name: 'Acme', url: 'https://acme.test' },
          repo: { provider: 'github', org: 'Acme-Org' },
          targets: { extension: { type: 'extension' } },
        });
        const followed = [];
        const follower = {
          followRun: async (args) => {
            followed.push(args);
            return { run: {}, conclusion: 'success' };
          },
        };
        const stubs = stubsFor({ dispatch: async (args) => dispatched(args), follower });

        try {
          await inTarget(targetDir, () => withStubs(stubs, (deploy) => deploy({})));

          ctx.expect(followed.length).toBe(1);
          ctx.expect(followed[0].owner).toBe('Acme-Org');
          ctx.expect(followed[0].repo).toBe('acme-omega');
          // The COMPOSED name (#265), the one the dispatch itself named.
          ctx.expect(followed[0].workflow).toBe('extension-publish.yml');
          ctx.expect(followed[0].token).toBe('tok');
          ctx.expect(followed[0].since instanceof Date).toBe(true);
          // And the whole verb went to the target's own deploy log (#873).
          ctx.expect(fs.existsSync(path.join(targetDir, 'logs', 'deploy.log'))).toBe(true);

          // A follower that throws is the verb throwing: the CLI exits 1.
          let thrown = null;
          follower.followRun = async () => { throw new Error('extension-publish.yml concluded failure: https://github.com/x'); };
          await inTarget(targetDir, () => withStubs(stubs, (deploy) => deploy({})))
            .catch((error) => { thrown = error; });
          ctx.expect(thrown && thrown.message.includes('concluded failure')).toBe(true);
        } finally {
          fs.rmSync(brandRoot, { recursive: true, force: true });
        }
      },
    },
  ],
});
